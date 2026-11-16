/**
 * Package-level surgery on OOXML containers: explode a document into an editable part tree,
 * assemble a tree back into a document, and prune the orphaned parts a delete leaves behind.
 *
 * This is the answer to the report's §4.2 item 30 ("可选：爆炸/组装出口"), which asked for the
 * reference skills' explode → edit XML → assemble flow **without** their "caller pastes XML by
 * hand" ergonomics — so the interface is "a directory", not a blob of XML in a tool argument.
 *
 * Two contract decisions worth stating outright:
 *
 * 1. **Verbatim is always available.** `verbatim: true` dumps the archive exactly as stored. The
 *    default runs {@link indentXml}, which only adds inter-element whitespace; it is not a
 *    round-tripping serializer (report §4.3 rules that out) and it refuses to touch any element
 *    that mixes text with child elements, which is what keeps `<w:t>` and `<a:t>` intact.
 * 2. **Assemble verifies before it claims success.** The produced bytes go through this plugin's
 *    own `verifyDocx`/`verifyXlsx`/`verifyPptx` (zip CRC, required parts, per-part well-formedness,
 *    plus pptx's `sldIdLst`/content-type cross-checks), so a hand-edited tree that broke the
 *    package fails loudly instead of writing a file Word will offer to repair.
 *
 * @module dsh-office-editor/src/package
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { indentXml } from './xml.js'
import { CONTENT_TYPES_PART, orderEntries, packOoxml, summarizeEntries, zipOoxml, type EntrySummary, type MtimeSource } from './zip.js'
import { verifyDocx } from './docx.js'
import { verifyXlsx } from './xlsx.js'
import { verifyPptx } from './pptx.js'

/** The three OOXML flavors this layer understands. */
export type OfficeFormat = 'docx' | 'xlsx' | 'pptx'

/** Error thrown for caller-fixable problems (bad tree, refusing a destructive write). */
export class PackageError extends Error {
  override readonly name = 'PackageError'
}

/** Caps for one explode call. */
export interface ExplodeCaps {
  /** Maximum number of parts written to disk. */
  maxParts: number
  /** Maximum total uncompressed bytes written to disk. */
  maxTotalBytes: number
}

/** Options for {@link explodePackage}. */
export interface ExplodeOptions extends ExplodeCaps {
  /** Anti-zip-bomb per-entry ceiling, in bytes. */
  maxEntryBytes: number
  /** Skip the structural indent and dump the archive byte-for-byte (default false). */
  verbatim?: boolean
  /** Clear an existing non-empty target directory instead of refusing (default false). */
  force?: boolean
}

/** Result of {@link explodePackage}. */
export interface ExplodeResult {
  /** Absolute directory the tree landed in. */
  target: string
  /** Detected container flavor. */
  format: OfficeFormat
  /** Number of parts written. */
  partCount: number
  /** Parts whose XML was indented by {@link indentXml}. */
  formattedCount: number
  /** Total bytes written. */
  totalBytes: number
  /** Every part on disk, sorted, with its size. */
  parts: EntrySummary[]
}

/** Prune mode for {@link assemblePackage}. */
export type PruneMode = 'none' | 'orphans'

/** Options for {@link assemblePackage}. */
export interface AssembleOptions {
  /** Remove orphaned parts (and their rels and content-type overrides) before packing. */
  prune?: PruneMode
  /** Skip the structural indent applied to `.xml`/`.rels` on the way out (default false). */
  verbatim?: boolean
  /** Timestamp policy for the produced archive; defaults to reproducible fixed timestamps. */
  mtime?: MtimeSource
  /** Maximum size of the produced archive in bytes. */
  maxOutputBytes: number
}

/** One removed part, for the tool's report. */
export interface PrunedPart {
  /** Archive-relative part name. */
  name: string
  /** Which rule condemned it. */
  reason: string
}

/** Result of {@link assemblePackage}. */
export interface AssembleResult {
  /** Detected container flavor. */
  format: OfficeFormat
  /** Number of parts packed. */
  partCount: number
  /** Archive size in bytes. */
  byteSize: number
  /** The assembled archive. */
  bytes: Uint8Array
  /** Parts removed by pruning, with reasons. */
  pruned: PrunedPart[]
  /** Content-type overrides dropped alongside the pruned parts. */
  droppedOverrides: string[]
  /** Dangling relationships removed from surviving `.rels` parts. */
  droppedRelationships: string[]
  /** One line from the format's verifier. */
  verification: string
}

/** Parts that pruning is allowed to consider, per format. */
const PRUNABLE_PREFIXES: Record<OfficeFormat, readonly string[]> = {
  pptx: ['ppt/slides/', 'ppt/notesSlides/', 'ppt/media/'],
  docx: ['word/media/'],
  xlsx: ['xl/media/'],
}

/**
 * Detect the container flavor.
 *
 * Checked by *main part*, not by extension: an exploded tree has no extension, and a
 * mis-extended file still has to be assembled into the format its parts describe.
 *
 * @param files - package members by name.
 * @returns the flavor, or null when no main part is present.
 */
export function detectFormat(files: ReadonlyMap<string, Uint8Array>): OfficeFormat | null {
  if (files.has('word/document.xml')) return 'docx'
  if (files.has('ppt/presentation.xml')) return 'pptx'
  if (files.has('xl/workbook.xml')) return 'xlsx'
  return null
}

/** Does the name denote an XML part the indenter may touch? */
function isXmlPart(name: string): boolean {
  return /\.(?:xml|rels)$/iu.test(name)
}

/**
 * Turn an archive member name into a safe path under `root`.
 *
 * Zip entries are attacker-controlled in general (`../../x` is the classic "zip slip"), and an
 * exploded tree is caller-controlled, so both directions route through here.
 *
 * @param root - absolute directory the tree lives in.
 * @param name - archive-relative part name.
 * @returns the absolute path.
 * @throws a PackageError when the name escapes the tree or is not archive-relative.
 */
function safeJoin(root: string, name: string): string {
  if (name === '' || name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/u.test(name)) {
    throw new PackageError(`部件名必须是包内相对路径：${JSON.stringify(name)}`)
  }
  const absolute = resolve(root, name)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new PackageError(`部件名越出目标目录：${JSON.stringify(name)}`)
  }
  return absolute
}

/** Recursively list every regular file under `root`, as archive-relative POSIX names. */
async function listTree(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      out.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  await walk(root)
  return out
}

/** Read an exploded tree into a part map. */
async function readTree(root: string): Promise<Map<string, Uint8Array>> {
  const names = await listTree(root)
  const files = new Map<string, Uint8Array>()
  for (const name of names) {
    files.set(name, new Uint8Array(await readFile(safeJoin(root, name))))
  }
  return files
}

/**
 * Explode an OOXML container into a directory of parts.
 *
 * The target must not exist as a non-directory and must be empty unless `force` is set; a
 * half-overwritten tree would silently assemble the wrong document. Extraction is bounded by
 * {@link ExplodeOptions.maxParts} and {@link ExplodeOptions.maxTotalBytes} so a hostile archive
 * cannot fill the disk.
 *
 * @param bytes - the container's bytes.
 * @param target - absolute directory to write into.
 * @param options - caps and toggles.
 * @returns what was written.
 * @throws a PackageError when the container is unusable or the target is not acceptable.
 */
export async function explodePackage(bytes: Uint8Array, target: string, options: ExplodeOptions): Promise<ExplodeResult> {
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(bytes)
  } catch (error) {
    throw new PackageError(`无法解包该文件（${error instanceof Error ? error.message : String(error)}）——它不是有效的 OOXML（zip）容器`)
  }
  const names = Object.keys(archive)
  if (names.length === 0) throw new PackageError('该容器是空的，没有可展开的部件')
  if (names.length > options.maxParts) {
    throw new PackageError(`部件数 ${names.length} 超过上限 ${options.maxParts}（可在 Config 里调整 maxExplodeParts）`)
  }
  const format = detectFormat(new Map(Object.entries(archive)))
  if (format === null) {
    throw new PackageError('无法识别该容器：既没有 word/document.xml、ppt/presentation.xml，也没有 xl/workbook.xml')
  }

  const existing = await stat(target).then((info) => info).catch(() => null)
  if (existing !== null && !existing.isDirectory()) {
    throw new PackageError(`目标已存在且不是目录：${target}`)
  }
  if (existing !== null) {
    const entries = await readdir(target)
    if (entries.length > 0) {
      if (options.force !== true) {
        throw new PackageError(`目标目录非空：${target}（如需清空重来请设 force=true；或换一个目录）`)
      }
      await rm(target, { recursive: true, force: true })
    }
  }
  await mkdir(target, { recursive: true })

  let totalBytes = 0
  let formattedCount = 0
  const parts: EntrySummary[] = []
  for (const name of names.sort()) {
    const data = archive[name]
    if (data.byteLength > options.maxEntryBytes) {
      throw new PackageError(`部件 ${name} 解压后 ${data.byteLength} 字节，超过单部件上限 ${options.maxEntryBytes}`)
    }
    totalBytes += data.byteLength
    if (totalBytes > options.maxTotalBytes) {
      throw new PackageError(`解压总量超过上限 ${options.maxTotalBytes} 字节（可调整 Config 的 maxExplodeBytes）`)
    }
    const absolute = safeJoin(target, name)
    await mkdir(dirname(absolute), { recursive: true })
    let payload = data
    if (options.verbatim !== true && isXmlPart(name)) {
      const text = strFromU8(data)
      const formatted = indentXml(text)
      if (formatted !== text) {
        payload = strToU8(formatted)
        formattedCount++
      }
    }
    await writeFile(absolute, payload)
    parts.push({ name, bytes: payload.byteLength })
  }

  return { target, format, partCount: parts.length, formattedCount, totalBytes, parts }
}

// ---------- prune ----------

/** Resolve a relationship target against its declaring part (mirrors the reader's helper). */
function resolveRelTarget(partName: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) return null
  const withoutFragment = target.split('#')[0]
  if (withoutFragment === '') return null
  if (withoutFragment.startsWith('/')) return normalizeSegments(withoutFragment.slice(1))
  const baseDir = partName.includes('/') ? partName.slice(0, partName.lastIndexOf('/')) : ''
  return normalizeSegments(`${baseDir}/${withoutFragment}`)
}

/** Collapse `.`/`..` segments of a package path. */
function normalizeSegments(path: string): string {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

/** The `.rels` part that declares `part`'s relationships. */
function relsPathFor(part: string): string {
  const slash = part.lastIndexOf('/')
  const dir = slash < 0 ? '' : part.slice(0, slash)
  const base = slash < 0 ? part : part.slice(slash + 1)
  return dir === '' ? `_rels/${base}.rels` : `${dir}/_rels/${base}.rels`
}

/** Every internal relationship target declared by one rels part. */
function relTargets(owner: string, relsXml: string): Array<{ rid: string; target: string }> {
  const out: Array<{ rid: string; target: string }> = []
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/>/gu)) {
    if (/TargetMode="External"/u.test(match[0])) continue
    const target = /Target="([^"]*)"/u.exec(match[0])?.[1]
    if (target === undefined) continue
    const resolved = resolveRelTarget(owner, target)
    if (resolved === null || resolved === '') continue
    out.push({ rid: /Id="([^"]*)"/u.exec(match[0])?.[1] ?? '', target: resolved })
  }
  return out
}

/** Breadth-first walk of the relationship graph from `_rels/.rels`. */
function reachableParts(files: ReadonlyMap<string, Uint8Array>): Set<string> {
  const reachable = new Set<string>()
  const queue: string[] = []
  const visit = (owner: string): void => {
    const rels = files.get(relsPathFor(owner))
    if (rels === undefined) return
    for (const { target } of relTargets(owner, strFromU8(rels))) {
      if (reachable.has(target)) continue
      reachable.add(target)
      queue.push(target)
    }
  }
  visit('')
  while (queue.length > 0) {
    const part = queue.pop() as string
    visit(part)
  }
  return reachable
}

/** The `r:id`s `<p:sldIdLst>` still lists, mapped to their slide part names. */
function visibleSlideParts(files: ReadonlyMap<string, Uint8Array>): Set<string> | null {
  const presentation = files.get('ppt/presentation.xml')
  const rels = files.get('ppt/_rels/presentation.xml.rels')
  if (presentation === undefined || rels === undefined) return null
  const byId = new Map(relTargets('ppt/presentation.xml', strFromU8(rels)).map(({ rid, target }) => [rid, target]))
  const visible = new Set<string>()
  for (const match of strFromU8(presentation).matchAll(/<p:sldId\b[^>]*r:id="([^"]*)"/gu)) {
    const target = byId.get(match[1])
    if (target !== undefined) visible.add(target)
  }
  return visible
}

/** Media parts referenced by any part in `keep`. */
function mediaReferencedBy(files: ReadonlyMap<string, Uint8Array>, keep: ReadonlySet<string>): Set<string> {
  const media = new Set<string>()
  for (const part of keep) {
    const rels = files.get(relsPathFor(part))
    if (rels === undefined) continue
    for (const { target } of relTargets(part, strFromU8(rels))) {
      if (target.startsWith('ppt/media/') || target.startsWith('word/media/') || target.startsWith('xl/media/')) media.add(target)
    }
  }
  return media
}

/**
 * Decide which parts to drop from an exploded tree.
 *
 * The rule set is deliberately narrow, following the reference `prune.py`: only parts under
 * {@link PRUNABLE_PREFIXES} are candidates, and everything else (styles, themes, masters, layouts,
 * `docProps`, `customXml`) is left alone no matter how unreachable it looks — pruning those needs
 * far more context than this function has. Within the candidate set:
 *
 * - **pptx slides** survive only when `<p:sldIdLst>` still lists them (a slide can stay reachable
 *   through `presentation.xml.rels` after its `sldId` was removed — the "ghost slide");
 * - a **notes slide** is dropped only when every slide referencing it is dropped;
 * - **media** is dropped only when no surviving part references it;
 * - if slides exist but none is visible, the whole prune is refused — that shape means
 *   `presentation.xml` or its rels is unreadable, and obeying it would delete every slide.
 *
 * @param files - the exploded tree's parts.
 * @param format - container flavor.
 * @returns the parts to drop with their reasons.
 * @throws a PackageError when the deck's slide list cannot be trusted.
 */export function planPrune(files: ReadonlyMap<string, Uint8Array>, format: OfficeFormat): PrunedPart[] {
  const prefixes = PRUNABLE_PREFIXES[format]
  const reachable = reachableParts(files)
  const doomed = new Map<string, string>()
  const candidates = [...files.keys()].filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))

  if (format === 'pptx') {
    const visible = visibleSlideParts(files)
    const allSlides = [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    if (visible === null && allSlides.length > 0) {
      throw new PackageError('无法从 ppt/presentation.xml 读出幻灯片列表（或其 rels），拒绝裁剪：先确认该部件完好')
    }
    const visibleSet = visible ?? new Set<string>()
    const doomedSlides = new Set<string>()
    for (const slide of allSlides) {
      if (!visibleSet.has(slide)) {
        doomedSlides.add(slide)
        doomed.set(slide, reachable.has(slide) ? '不在 sldIdLst 中（幽灵幻灯片）' : '不被任何关系引用')
      }
    }
    // A notes slide dies only when every slide that references it dies with it.
    const ownersOfNotes = new Map<string, string[]>()
    for (const slide of allSlides) {
      const rels = files.get(relsPathFor(slide))
      if (rels === undefined) continue
      for (const { target } of relTargets(slide, strFromU8(rels))) {
        if (!target.startsWith('ppt/notesSlides/')) continue
        const owners = ownersOfNotes.get(target) ?? []
        owners.push(slide)
        ownersOfNotes.set(target, owners)
      }
    }
    for (const [notes, owners] of ownersOfNotes) {
      if (owners.length > 0 && owners.every((owner) => doomedSlides.has(owner))) {
        doomed.set(notes, '所属幻灯片已被删除')
      }
    }
    const keep = new Set([...files.keys()].filter((name) => !doomed.has(name)))
    const referenced = mediaReferencedBy(files, keep)
    for (const media of candidates.filter((name) => name.includes('/media/'))) {
      if (!referenced.has(media)) doomed.set(media, '没有任何保留的部件引用它')
    }
  } else {
    // docx/xlsx only prune unreferenced media, which is where orphan bloat actually comes from.
    const referenced = mediaReferencedBy(files, new Set(files.keys()))
    for (const media of candidates) {
      if (!referenced.has(media)) doomed.set(media, '没有任何部件引用它')
    }
  }

  return [...doomed].map(([name, reason]) => ({ name, reason })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Strip `<Override>` entries pointing at removed parts, returning the rewritten manifest. */
function dropOverrides(manifest: string, removed: ReadonlySet<string>): { xml: string; dropped: string[] } {
  const dropped: string[] = []
  const xml = manifest.replace(/<Override\b[^>]*\/>/gu, (tag) => {
    const partName = /PartName="([^"]*)"/u.exec(tag)?.[1]
    if (partName === undefined) return tag
    const canonical = partName.replace(/^\//u, '')
    if (!removed.has(canonical)) return tag
    dropped.push(partName)
    return ''
  })
  return { xml, dropped }
}

/** Strip relationships pointing at removed parts, returning the rewritten rels file. */
function dropRelationships(owner: string, relsXml: string, removed: ReadonlySet<string>): { xml: string; dropped: string[] } {
  const dropped: string[] = []
  const xml = relsXml.replace(/<Relationship\b[^>]*\/>/gu, (tag) => {
    if (/TargetMode="External"/u.test(tag)) return tag
    const target = /Target="([^"]*)"/u.exec(tag)?.[1]
    if (target === undefined) return tag
    const resolved = resolveRelTarget(owner, target)
    if (resolved === null || !removed.has(resolved)) return tag
    dropped.push(`${owner || '（包根）'}: ${target}`)
    return ''
  })
  return { xml, dropped }
}

/**
 * Assemble an exploded tree into an OOXML container.
 *
 * Everything the caller cannot see is reported back: which parts pruning removed and why, which
 * content-type overrides and relationships went with them, and the verifier's own summary line.
 *
 * @param root - absolute directory holding the tree.
 * @param options - prune/verbatim/timestamp policy and the output size cap.
 * @returns the packed bytes plus the audit trail.
 * @throws a PackageError when the tree is not a usable package or the result is oversized.
 */
export function assemblePackage(root: string, options: AssembleOptions): Promise<AssembleResult>
/**
 * @param root - absolute directory holding the tree.
 * @param options - prune/verbatim/timestamp policy and the output size cap.
 * @param seed - pre-read tree, for callers that already listed it (tests).
 * @returns the packed bytes plus the audit trail.
 */
export function assemblePackage(root: string, options: AssembleOptions, seed: Map<string, Uint8Array>): Promise<AssembleResult>
export async function assemblePackage(root: string, options: AssembleOptions, seed?: Map<string, Uint8Array>): Promise<AssembleResult> {
  const files = seed ?? await readTree(root)
  if (files.size === 0) throw new PackageError(`目录是空的：${root}`)
  if (!files.has(CONTENT_TYPES_PART)) {
    throw new PackageError(`目录里没有 ${CONTENT_TYPES_PART}：这不是一个展开后的 OOXML 包`)
  }
  const working = new Map(files)
  const format = detectFormat(working)
  if (format === null) {
    throw new PackageError('无法识别该目录：既没有 word/document.xml、ppt/presentation.xml，也没有 xl/workbook.xml')
  }

  const pruned: PrunedPart[] = []
  const droppedOverrides: string[] = []
  const droppedRelationships: string[] = []
  if (options.prune === 'orphans') {
    pruned.push(...planPrune(working, format))
    const removed = new Set(pruned.map((part) => part.name))
    for (const part of removed) {
      working.delete(part)
      // The removed part's own rels file has no owner left; dropping it keeps the tree consistent.
      working.delete(relsPathFor(part))
    }
    if (removed.size > 0) {
      const manifest = working.get(CONTENT_TYPES_PART)
      if (manifest !== undefined) {
        const result = dropOverrides(strFromU8(manifest), removed)
        working.set(CONTENT_TYPES_PART, strToU8(result.xml))
        droppedOverrides.push(...result.dropped)
      }
      for (const [name, data] of [...working]) {
        const declared = /^(.*?)_rels\/([^/]*)\.rels$/u.exec(name)
        if (declared === null) continue
        const owner = `${declared[1]}${declared[2]}`
        const result = dropRelationships(owner, strFromU8(data), removed)
        if (result.dropped.length === 0) continue
        working.set(name, strToU8(result.xml))
        droppedRelationships.push(...result.dropped)
      }
    }
  }

  const entries = orderEntries(working)
  const payloads = await Promise.all(entries.map(async (entry) => {
    let bytes = entry.bytes
    if (options.verbatim !== true && isXmlPart(entry.name)) {
      const text = strFromU8(bytes)
      const formatted = indentXml(text)
      if (formatted !== text) bytes = strToU8(formatted)
    }
    if (options.mtime !== 'source') return { name: entry.name, bytes }
    const info = await stat(safeJoin(root, entry.name)).catch(() => null)
    return info === null ? { name: entry.name, bytes } : { name: entry.name, bytes, mtime: info.mtimeMs }
  }))
  const packed = zipOoxml(payloads, options.mtime === 'source' ? { mtime: 'source' } : {})
  if (packed.byteLength > options.maxOutputBytes) {
    throw new PackageError(`生成内容过大（${Math.round(packed.byteLength / 1024 / 1024)}MB），超过上限 ${Math.round(options.maxOutputBytes / 1024 / 1024)}MB`)
  }

  const verification = format === 'docx'
    ? verifyDocxSummary(packed)
    : format === 'xlsx'
      ? verifyXlsxSummary(packed)
      : verifyPptxSummary(packed)

  return { format, partCount: entries.length, byteSize: packed.byteLength, bytes: packed, pruned, droppedOverrides, droppedRelationships, verification }
}

/** Verify docx bytes and summarize; kept separate so both call sites share the wording. */
function verifyDocxSummary(bytes: Uint8Array): string {
  const verified = verifyDocx(bytes)
  return `${verified.paragraphCount} 个段落（含 ${verified.emptyParagraphs.length} 个空段落），${verified.entryCount} 个部件`
}

/** Verify xlsx bytes and summarize. */
function verifyXlsxSummary(bytes: Uint8Array): string {
  const verified = verifyXlsx(bytes)
  return `${verified.sheetCount} 个工作表：${verified.sheetNames.join('、')}，${verified.entryCount} 个部件`
}

/** Verify pptx bytes and summarize. */
function verifyPptxSummary(bytes: Uint8Array): string {
  const verified = verifyPptx(bytes)
  return `${verified.slideCount} 页幻灯片：${verified.slideTitles.join('、')}，${verified.entryCount} 个部件`
}

/** Re-exported so callers do not need to reach into the zip module for the summary shape. */
export { summarizeEntries }
