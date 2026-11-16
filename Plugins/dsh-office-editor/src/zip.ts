/**
 * Deterministic OOXML packaging: one place decides entry order, compression and timestamps, so the
 * docx / xlsx / pptx writers all produce byte-identical archives for identical content.
 *
 * Three things made the previous writers non-reproducible, and each is fixed here:
 *
 * 1. **Timestamps.** `zipSync` without `mtime` stamps every entry with `Date.now()`, so the same
 *    input produced different bytes on every call. {@link FIXED_MTIME} pins them instead; see its
 *    own doc comment for why it is local midnight and why fflate's documented `mtime: 0` ("avoid
 *    revealing a modification date") is unusable (`wzh` rejects any year before 1980 with `err(10)`).
 * 2. **Entry order.** `[Content_Types].xml` must be the first member (the xlsx reference
 *    `assemble.py` states the OPC invariant outright); it is emitted first and **stored**
 *    uncompressed, as Word and Excel write it. The remaining order is fixed, not incidental.
 * 3. **Compression.** Every other entry is deflated at level 6, fflate's default, named explicitly
 *    so a future default change cannot silently alter output bytes.
 *
 * @module dsh-office-editor/src/zip
 */

import { zipSync, type Zippable } from 'fflate'

/**
 * The timestamp stamped on every entry of a generated package, as a DOS date of 1980-01-01 00:00.
 *
 * Built from **local** date components on purpose. fflate encodes `mtime` with
 * `getFullYear()/getMonth()/getDate()/getHours()/…`, i.e. in local time, so a UTC-midnight instant
 * (`Date.parse('1980-01-01T00:00:00Z')`) encodes as `08:00` on a UTC+8 machine and as `1979-12-31`
 * west of UTC — the same document would then hash differently per timezone, and the second case
 * trips fflate's `year - 1980 < 0` range check outright. Local midnight is stable everywhere, and
 * 1980-01-01 is the earliest date DOS timestamps can represent.
 */
export const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0).getTime()

/** Where an entry's modification time comes from. */
export type MtimeSource = 'fixed' | 'source'

/** One package member to write. */
export interface ZipEntry {
  /** Archive-relative name using forward slashes. */
  name: string
  /** The member's bytes. */
  bytes: Uint8Array
  /** Modification time in epoch milliseconds; only consulted when `mtime: 'source'`. */
  mtime?: number
}

/** Options for {@link zipOoxml}. */
export interface ZipOoxmlOptions {
  /**
   * Modification time policy. `fixed` (default) stamps {@link FIXED_MTIME} on every entry, which
   * is what makes two runs over identical content byte-identical; `source` stamps each entry's
   * filesystem mtime instead, trading reproducibility for "the archive shows when the parts were
   * actually edited".
   */
  mtime?: MtimeSource
}

/** The part name that must lead every OPC archive. */
export const CONTENT_TYPES_PART = '[Content_Types].xml'

/** Is `name` the content-types manifest? */
export function isContentTypes(name: string): boolean {
  return name === CONTENT_TYPES_PART
}

/** Deflate level for everything that is not the stored manifest. */
const DEFLATE_LEVEL = 6

/**
 * Write a deterministic OOXML package.
 *
 * Entry order is the order of `entries`, which the caller controls; put
 * {@link CONTENT_TYPES_PART} first to satisfy the OPC invariant. Duplicate names are rejected
 * rather than silently collapsed by the zip layer.
 *
 * @param entries - members in emit order.
 * @param options - timestamp policy.
 * @returns the archive bytes.
 * @throws an Error when two entries share a name or an entry name is not archive-relative.
 */
export function zipOoxml(entries: readonly ZipEntry[], options: ZipOoxmlOptions = {}): Uint8Array {
  const files: Zippable = {}
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.name === '' || entry.name.startsWith('/') || /^[A-Za-z]:/u.test(entry.name)) {
      throw new Error(`打包失败：条目名必须是包内相对路径（收到 ${JSON.stringify(entry.name)}）`)
    }
    if (entry.name.includes('\\')) {
      throw new Error(`打包失败：条目名必须用正斜杠（收到 ${JSON.stringify(entry.name)}）`)
    }
    if (seen.has(entry.name)) throw new Error(`打包失败：条目名重复（${entry.name}）`)
    seen.add(entry.name)
    // `[Content_Types].xml` is stored, everything else deflated: level 0 ⇒ STORE, 6 ⇒ DEFLATE.
    const level = isContentTypes(entry.name) ? 0 : DEFLATE_LEVEL
    files[entry.name] = [entry.bytes, options.mtime === 'source' && entry.mtime !== undefined ? { level, mtime: entry.mtime } : { level }]
  }
  return zipSync(files, { mtime: FIXED_MTIME })
}

/**
 * Build the entry list for a package from a name → bytes map, in OPC order.
 *
 * The order is: the content-types manifest, then the parts its `<Override>` elements declare (in
 * declaration order), then everything else sorted by name. This mirrors how Word lays out its own
 * archives closely enough for naive consumers, while staying fully deterministic — the reference
 * `assemble.py` uses exactly this plan (and notes that "some naive OOXML consumers care about the
 * position of `[Content_Types].xml` and the main document").
 *
 * @param files - package members by archive-relative name.
 * @returns entries in emit order.
 */
export function orderEntries(files: ReadonlyMap<string, Uint8Array>): ZipEntry[] {
  const entries: ZipEntry[] = []
  const manifest = files.get(CONTENT_TYPES_PART)
  if (manifest !== undefined) entries.push({ name: CONTENT_TYPES_PART, bytes: manifest })
  const remaining = new Set(files.keys())
  remaining.delete(CONTENT_TYPES_PART)
  if (manifest !== undefined) {
    for (const match of new TextDecoder().decode(manifest).matchAll(/<Override\b[^>]*PartName="([^"]*)"/gu)) {
      const name = match[1].replace(/^\//u, '')
      const bytes = remaining.has(name) ? files.get(name) : undefined
      if (bytes === undefined) continue
      entries.push({ name, bytes })
      remaining.delete(name)
    }
  }
  for (const name of [...remaining].sort()) {
    const bytes = files.get(name)
    if (bytes !== undefined) entries.push({ name, bytes })
  }
  return entries
}

/**
 * Re-zip already-serialized package members through {@link zipOoxml} in {@link orderEntries} order.
 *
 * Used by the three engines for their write-out path, so `createDocx`/`createXlsx`/`createPptx`
 * and every `office_edit` write share one packaging policy.
 *
 * @param files - package members by archive-relative name.
 * @param options - timestamp policy.
 * @returns the archive bytes.
 */
export function packOoxml(files: ReadonlyMap<string, Uint8Array>, options: ZipOoxmlOptions = {}): Uint8Array {
  return zipOoxml(orderEntries(files), options)
}

/**
 * A plain `Record` of parts (the shape the engines build) as the `Map` {@link packOoxml} takes.
 *
 * The `Record` is the natural accumulator while a document is being built, and its insertion order
 * deliberately does **not** leak into the archive: {@link orderEntries} re-sorts.
 *
 * @param files - parts by name.
 * @returns the same parts as a `Map`, in the record's own key order.
 */
export function partsToMap(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map(Object.entries(files))
}

/** One entry as reported by the package tools. */
export interface EntrySummary {
  /** Archive-relative part name. */
  name: string
  /** Uncompressed size in bytes. */
  bytes: number
}

/**
 * Summarize package members for tool output: one row per part, sorted by name.
 *
 * @param files - package members by archive-relative name.
 * @returns the sorted summary rows.
 */
export function summarizeEntries(files: ReadonlyMap<string, Uint8Array>): EntrySummary[] {
  return [...files]
    .map(([name, bytes]) => ({ name, bytes: bytes.byteLength }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
