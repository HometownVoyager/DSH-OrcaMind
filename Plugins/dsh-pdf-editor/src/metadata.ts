/**
 * Metadata reading and writing, including the XMP packet.
 *
 * Two facts drive this module. First, `PDFDocument.load` defaults to `updateMetadata: true`, which
 * rewrites Producer/ModDate at load time; the editor always loads with it off so that a metadata
 * write is exactly the fields the caller named. Second, an XMP packet and the document information
 * dictionary are independent sources of the same facts, and a viewer may prefer either: pdf-lib
 * preserves the packet but never updates it, so a "fixed" title can still show the old one. The
 * editor reports both, and `sync_xmp` patches the packet's existing elements by targeted text edit
 * — elements that are absent are reported as skipped rather than invented, because inserting correct
 * RDF structure is not a string edit.
 * @module dsh-pdf-editor/src/metadata
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib'

/** Document information dictionary fields the tools read and write. */
export const INFO_FIELDS = ['title', 'author', 'subject', 'keywords', 'creator', 'producer', 'creation_date', 'modification_date'] as const

/** One information-dictionary field name. */
export type InfoField = typeof INFO_FIELDS[number]

/** XMP elements tracked for reading and for `sync_xmp`. */
export const XMP_ELEMENTS: ReadonlyArray<{ key: string; element: string; info?: InfoField }> = [
  { key: 'title', element: 'dc:title', info: 'title' },
  { key: 'creator', element: 'dc:creator', info: 'author' },
  { key: 'description', element: 'dc:description', info: 'subject' },
  { key: 'keywords', element: 'pdf:Keywords', info: 'keywords' },
  { key: 'producer', element: 'pdf:Producer', info: 'producer' },
  { key: 'created', element: 'xmp:CreateDate', info: 'creation_date' },
  { key: 'modified', element: 'xmp:ModifyDate', info: 'modification_date' },
  { key: 'metadata_date', element: 'xmp:MetadataDate' },
]

/** What the document says about itself right now. */
export interface MetadataSnapshot {
  /** Information-dictionary fields, ISO 8601 for dates. */
  info: Partial<Record<InfoField, string>>
  /** XMP values extracted from the packet; empty when there is no packet. */
  xmp: Record<string, string>
  /** Whether the catalog carries a `/Metadata` stream. */
  xmpPresent: boolean
  /** Whether the XMP stream is Flate-compressed. */
  xmpCompressed: boolean
  /** Raw XMP byte length, 0 when absent. */
  xmpBytes: number
}

/** Result of applying a metadata patch. */
export interface MetadataPatchResult {
  /** Information-dictionary fields written. */
  applied: InfoField[]
  /** Information-dictionary fields removed. */
  deleted: InfoField[]
  /** XMP elements whose text was rewritten. */
  xmpUpdated: string[]
  /** XMP elements the patch wanted to write but the packet does not contain. */
  xmpSkipped: string[]
  /** Non-fatal observations (compression, unparseable packet, …). */
  warnings: string[]
}

/** Read the document information dictionary and the XMP packet. */
export function readMetadata(doc: PDFDocument): MetadataSnapshot {
  const info: Partial<Record<InfoField, string>> = {}
  const put = (field: InfoField, value: string | undefined): void => {
    if (value !== undefined && value !== '') info[field] = value
  }
  put('title', doc.getTitle())
  put('author', doc.getAuthor())
  put('subject', doc.getSubject())
  put('keywords', doc.getKeywords())
  put('creator', doc.getCreator())
  put('producer', doc.getProducer())
  put('creation_date', isoOf(doc.getCreationDate()))
  put('modification_date', isoOf(doc.getModificationDate()))
  const packet = readXmpPacket(doc)
  const xmp: Record<string, string> = {}
  if (packet !== null) {
    for (const { key, element } of XMP_ELEMENTS) {
      const value = extractElement(packet.text, element)
      if (value !== undefined && value !== '') xmp[key] = value
    }
  }
  return {
    info,
    xmp,
    xmpPresent: packet !== null,
    xmpCompressed: packet?.compressed ?? false,
    xmpBytes: packet?.byteLength ?? 0,
  }
}

/**
 * Apply a metadata patch: information-dictionary fields, deletions, and optional XMP sync.
 * @param doc - the document to modify.
 * @param patch - field values, fields to delete, and whether to patch the XMP packet.
 * @returns what was applied, deleted, and skipped, plus warnings.
 * @throws an Error when a date value cannot be parsed.
 */
export function applyMetadata(doc: PDFDocument, patch: {
  set?: Partial<Record<InfoField, string | string[]>>
  delete?: readonly InfoField[]
  syncXmp?: boolean
}): MetadataPatchResult {
  const applied: InfoField[] = []
  const deleted: InfoField[] = []
  const warnings: string[] = []
  const set = patch.set ?? {}
  for (const field of INFO_FIELDS) {
    const value = set[field]
    if (value === undefined) continue
    switch (field) {
      case 'title':
        doc.setTitle(asText(value))
        break
      case 'author':
        doc.setAuthor(asText(value))
        break
      case 'subject':
        doc.setSubject(asText(value))
        break
      case 'keywords':
        // pdf-lib stores `keywords.join(' ')`, so the list is pre-joined on commas and handed over
        // as a one-element array, which it writes verbatim. See canonicalKeywords.
        doc.setKeywords([canonicalKeywords(value)])
        break
      case 'creator':
        doc.setCreator(asText(value))
        break
      case 'producer':
        doc.setProducer(asText(value))
        break
      case 'creation_date':
        doc.setCreationDate(parsePdfDate(asText(value)))
        break
      case 'modification_date':
        doc.setModificationDate(parsePdfDate(asText(value)))
        break
    }
    applied.push(field)
  }
  for (const field of patch.delete ?? []) {
    const key = INFO_KEYS[field]
    const info = doc.context.trailerInfo.Info
    if (info === undefined) break
    const dict = doc.context.lookup(info, PDFDict)
    if (dict.has(PDFName.of(key))) {
      dict.delete(PDFName.of(key))
      deleted.push(field)
    }
  }
  const result: MetadataPatchResult = { applied, deleted, xmpUpdated: [], xmpSkipped: [], warnings }
  if (patch.syncXmp !== true) return result
  const packet = readXmpPacket(doc)
  if (packet === null) {
    warnings.push('该文档没有 XMP 包（/Metadata），sync_xmp 无事可做')
    return result
  }
  // XMP is synced from the information dictionary *as it now stands*, so reading the doc back
  // (rather than reusing the patch) also covers fields the caller never touched.
  const current = readMetadata(doc).info
  let text = packet.text
  for (const { element, info } of XMP_ELEMENTS) {
    if (info === undefined) continue
    const value = current[info]
    if (value === undefined) continue
    const patched = replaceElement(text, element, value)
    if (patched === null) {
      result.xmpSkipped.push(element)
      continue
    }
    text = patched
    result.xmpUpdated.push(element)
  }
  if (result.xmpUpdated.length === 0) {
    warnings.push(result.xmpSkipped.length === 0 ? 'sync_xmp 没有可同步的字段（信息字典为空）' : 'sync_xmp 未改动任何 XMP 元素')
    return result
  }
  writeXmpPacket(doc, packet, text)
  return result
}

/** Information-dictionary key for each field. */
const INFO_KEYS: Record<InfoField, string> = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator',
  producer: 'Producer',
  creation_date: 'CreationDate',
  modification_date: 'ModDate',
}

function asText(value: string | string[]): string {
  return Array.isArray(value) ? value.join('; ') : value
}

/**
 * Canonical stored form of the `Keywords` entry.
 *
 * pdf-lib's `setKeywords` stores `keywords.join(' ')` (see its `PDFDocument.js`), so handing it the
 * keyword list directly erases the boundary of a multi-word keyword: `"KV cache, sparse attention"`
 * would read back as four single-word keywords.
 *
 * The writer and the write-back check both go through this one function on purpose. They used to
 * normalize separately — the writer joined on a space, the check joined on a space in its own copy
 * of the logic — which happened to agree until a comma-separated *string* was passed, at which point
 * the stored value and the expected value diverged and the check reported a false failure.
 *
 * @param value - a keyword string (split on `,`, `;` or `、`) or an explicit list.
 * @returns the keyword list joined with the conventional comma separator.
 */
export function canonicalKeywords(value: string | string[]): string {
  const parts = Array.isArray(value) ? value : value.split(/[;,、]/u)
  return parts.map((part) => part.trim()).filter((part) => part !== '').join(', ')
}

function isoOf(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : date.toISOString()
}

/**
 * Parse an ISO 8601 or PDF (`D:YYYYMMDDHHmmSS±HH'mm'`) date.
 *
 * `new Date('D:2026…')` yields `Invalid Date`, and the PDF form carries an optional timezone and a
 * literal apostrophe, so both forms are handled explicitly instead of being handed to `Date.parse`.
 *
 * @param value - ISO 8601 or PDF date string.
 * @returns the parsed date.
 * @throws an Error naming the value when neither form parses.
 */
export function parsePdfDate(value: string): Date {
  const trimmed = value.trim()
  const pdf = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz])|([+-])(\d{2})'?(\d{2})?'?)?$/u.exec(trimmed)
  if (pdf !== null) {
    const [, year, month, day, hour, minute, second, zulu, sign, offHour, offMinute] = pdf
    const parts = [year, month ?? '01', day ?? '01', hour ?? '00', minute ?? '00', second ?? '00'].map((part) => Number(part))
    const offsetMinutes = zulu !== undefined
      ? 0
      : sign === undefined
        ? null
        : (sign === '-' ? -1 : 1) * (Number(offHour ?? '0') * 60 + Number(offMinute ?? '0'))
    const base = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
    return new Date(offsetMinutes === null ? base : base - offsetMinutes * 60_000)
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`日期格式无效：${value}（可用 ISO 8601，如 2026-01-02T03:04:05Z，或 PDF 的 D:20260102030405+08'00'）`)
  }
  return parsed
}

/** The XMP packet as text plus how it is stored. */
interface XmpPacket {
  /** Decoded XML text. */
  text: string
  /** Whether the stream is Flate-compressed. */
  compressed: boolean
  /** On-disk byte length. */
  byteLength: number
  /** Reference to the stream object (absent when the catalog inlines the stream). */
  ref: PDFRef | undefined
  /** Stream dictionary. */
  dict: PDFDict
}

function readXmpPacket(doc: PDFDocument): XmpPacket | null {
  const entry = doc.catalog.get(PDFName.of('Metadata'))
  if (entry === undefined) return null
  const ref = entry instanceof PDFRef ? entry : undefined
  const stream = doc.context.lookup(entry)
  if (!(stream instanceof PDFRawStream)) return null
  const compressed = hasFlateFilter(stream.dict)
  let bytes = stream.contents
  if (compressed) {
    try {
      bytes = new Uint8Array(inflateSync(bytes))
    } catch {
      // A packet whose stream cannot be inflated is reported as absent rather than half-read.
      return null
    }
  }
  return { text: new TextDecoder('utf-8').decode(bytes), compressed, byteLength: stream.contents.byteLength, ref, dict: stream.dict }
}

function writeXmpPacket(doc: PDFDocument, packet: XmpPacket, text: string): void {
  const encoded = new TextEncoder().encode(text)
  const contents = packet.compressed ? new Uint8Array(deflateSync(encoded)) : encoded
  packet.dict.set(PDFName.of('Length'), PDFNumber.of(contents.byteLength))
  const replacement = PDFRawStream.of(packet.dict, contents)
  if (packet.ref !== undefined) doc.context.assign(packet.ref, replacement)
  else doc.catalog.set(PDFName.of('Metadata'), doc.context.register(replacement))
}

function hasFlateFilter(dict: PDFDict): boolean {
  const filter = dict.get(PDFName.of('Filter'))
  if (filter === undefined) return false
  if (filter.toString() === '/FlateDecode') return true
  const resolved = filter instanceof PDFRef ? undefined : filter
  if (resolved instanceof PDFArray) return resolved.asArray().some((entry) => entry.toString() === '/FlateDecode')
  return false
}

/**
 * Read an XMP element's text, unwrapping the `rdf:Alt`/`rdf:Seq` list form producers use.
 * @param xmp - decoded packet text.
 * @param element - qualified element name, e.g. `dc:title`.
 * @returns the text value, or undefined when the element is absent.
 */
export function extractElement(xmp: string, element: string): string | undefined {
  const outer = new RegExp(`<${escapeForRegExp(element)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeForRegExp(element)}>`, 'u').exec(xmp)
  if (outer === null) return undefined
  const inner = outer[1]
  const listItem = /<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/u.exec(inner)
  const raw = listItem === null ? inner : listItem[1]
  return unescapeXml(raw.replace(/<[^>]*>/gu, '').trim())
}

/**
 * Replace an element's text in place, keeping its attributes and list structure.
 * @param xmp - decoded packet text.
 * @param element - qualified element name.
 * @param value - replacement text.
 * @returns the patched packet, or null when the element is absent.
 */
export function replaceElement(xmp: string, element: string, value: string): string | null {
  const name = escapeForRegExp(element)
  const outer = new RegExp(`(<${name}(?:\\s[^>]*)?>)([\\s\\S]*?)(</${name}>)`, 'u')
  const match = outer.exec(xmp)
  if (match === null) return null
  const inner = match[2]
  const escaped = escapeXml(value)
  const replacedInner = /(<rdf:li(?:\s[^>]*)?>)([\s\S]*?)(<\/rdf:li>)/u.test(inner)
    ? inner.replace(/(<rdf:li(?:\s[^>]*)?>)([\s\S]*?)(<\/rdf:li>)/u, (_all, open: string, _body: string, close: string) => `${open}${escaped}${close}`)
    : escaped
  return xmp.slice(0, match.index) + match[1] + replacedInner + match[3] + xmp.slice(match.index + match[0].length)
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
}
