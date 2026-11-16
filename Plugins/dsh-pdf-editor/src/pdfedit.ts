/**
 * pdf-lib document handling for the editor: loud loading (encryption and malformed objects are
 * refused rather than half-understood), page operations that keep the parts of the file they touch
 * consistent (merges, crop boxes, incremental rotation, widget pruning), and a page-content
 * fingerprint used to prove that a rebuilt document really holds the pages in the requested order.
 * @module dsh-pdf-editor/src/pdfedit
 */

import { createHash } from 'node:crypto'
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, degrees,
  type PDFPage,
} from 'pdf-lib'

/** A rectangle in PDF points, origin bottom-left. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** One page's structural facts, indexed 1-based in the parallel arrays below. */
export interface PageFacts {
  /** Media box (may come from an ancestor node). */
  mediaBox: Box
  /** Crop box, falling back to the media box the way viewers do. */
  cropBox: Box
  /** Effective `/Rotate` in degrees, inherited from the page tree when set there. */
  rotation: number
  /** SHA-1 prefix over the page's content stream bytes — stable across a copy/reorder round trip. */
  fingerprint: string
  /** Widget annotations (form controls) living on the page. */
  widgets: number
}

/** A loaded PDF plus everything the tools need to reason about it. */
export interface LoadedPdf {
  /** The pdf-lib document. */
  doc: PDFDocument
  /** User-facing name (absolute path or URL). */
  displayName: string
  /** Absolute local path, or null for a downloaded source. */
  localPath: string | null
  /** Page count. */
  pageCount: number
  /** Whether the catalog already carries an `/AcroForm` dictionary. */
  hasAcroForm: boolean
  /** Number of AcroForm fields (0 when there is no form). */
  fieldCount: number
  /** Whether the catalog carries an XMP `/Metadata` stream. */
  hasXmp: boolean
  /** Per-page facts, entry `i` describing page `i + 1`. */
  pages: PageFacts[]
  /** Non-fatal observations made while loading. */
  notes: string[]
}

/** Raised when the document cannot be edited at all. */
export class PdfEditorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfEditorError'
  }
}

/**
 * Load a PDF for editing.
 *
 * Encryption is refused with an actionable message instead of `ignoreEncryption: true`: pdf-lib
 * does not decrypt, so string and stream objects would be copied back out as ciphertext — a silent
 * corruption this plugin will not perform. `updateMetadata: false` keeps pdf-lib from stamping its
 * own Producer/ModDate at load time, which would otherwise rewrite metadata the caller never asked
 * to change and hide the document's real producer.
 *
 * @param bytes - raw PDF bytes.
 * @param displayName - user-facing name.
 * @param localPath - absolute local path, or null for a download.
 * @returns the loaded document.
 * @throws a PdfEditorError with a user-facing Chinese message when the file cannot be edited.
 */
export async function loadPdf(bytes: Uint8Array, displayName: string, localPath: string | null): Promise<LoadedPdf> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/is encrypted/u.test(message)) {
      throw new PdfEditorError([
        `该 PDF 已加密（含 /Encrypt 字典），无法编辑：${displayName}`,
        'pdf-lib 不做解密，强行写入会把密文原样搬进新文件（本插件不移植 qpdf，不做这种静默损坏）。',
        '请先取得口令后解密/另存为无加密副本再编辑；只读查看可用 pdf_read / pdf_inspect 的 password 参数。',
      ].join('\n'))
    }
    throw new PdfEditorError(`无法解析该 PDF（结构损坏或不受支持）：${displayName}（${message}）`)
  }
  const notes: string[] = []
  // A file that parses as a PDF but carries no /Root catalog (truncated or hand-written bytes) would
  // otherwise fail later with an opaque TypeError from reading properties off `undefined`.
  const catalog = doc.catalog as PDFDict | undefined
  if (catalog === undefined) {
    throw new PdfEditorError(`无法解析该 PDF（缺少 /Root 目录对象，文件已损坏或不完整）：${displayName}`)
  }
  const hasAcroForm = catalog.has(PDFName.of('AcroForm'))
  const hasXmp = catalog.has(PDFName.of('Metadata'))
  let fieldCount = 0
  if (hasAcroForm) {
    try {
      fieldCount = doc.getForm().getFields().length
    } catch (error) {
      // A malformed AcroForm must not block page-level work, but the caller is told about it.
      notes.push(`/AcroForm 解析失败（表单相关操作将不可用）：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const pages: PageFacts[] = []
  for (const page of doc.getPages()) {
    const mediaBox = boxOf(page.getMediaBox())
    const cropBox = boxOf(page.getCropBox())
    pages.push({
      mediaBox,
      // pdf-lib's CropBox() already falls back to the inherited MediaBox; normalising here keeps
      // the reported box honest for documents whose crop box is wider or shifted.
      cropBox: cropBox.width === 0 || cropBox.height === 0 ? mediaBox : cropBox,
      rotation: normaliseAngle(page.getRotation().angle),
      fingerprint: pageFingerprint(doc, page),
      widgets: countWidgets(doc, page),
    })
  }
  return { doc, displayName, localPath, pageCount: doc.getPageCount(), hasAcroForm, fieldCount, hasXmp, pages, notes }
}

/** Normalise an angle into `[0, 360)`. */
export function normaliseAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

function boxOf(box: { x: number; y: number; width: number; height: number }): Box {
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** Resolve a page's `/Annots` array, following a reference when the entry is one. */
function annotsOf(doc: PDFDocument, page: PDFPage): PDFArray | undefined {
  if (!page.node.has(PDFName.of('Annots'))) return undefined
  const value = doc.context.lookup(page.node.get(PDFName.of('Annots')))
  return value instanceof PDFArray ? value : undefined
}

/** Count `/Widget` annotations on a page (form controls). */
export function countWidgets(doc: PDFDocument, page: PDFPage): number {
  const annots = annotsOf(doc, page)
  if (annots === undefined) return 0
  let count = 0
  for (const entry of annots.asArray()) {
    const dict = doc.context.lookup(entry)
    if (dict instanceof PDFDict && dict.get(PDFName.of('Subtype'))?.toString() === '/Widget') count++
  }
  return count
}

/**
 * Fingerprint a page by its content stream bytes.
 *
 * Used to prove that merge/split/reorder put the requested pages in the requested places: page
 * count alone cannot tell a reordered document from an unchanged one.
 *
 * @param doc - the owning document.
 * @param page - the page to fingerprint.
 * @returns a hex digest prefix, or `'empty'` when the page has no content stream.
 */
export function pageFingerprint(doc: PDFDocument, page: PDFPage): string {
  const chunks = contentChunks(doc, page.node.get(PDFName.of('Contents')))
  if (chunks.length === 0) return 'empty'
  const hash = createHash('sha1')
  for (const chunk of chunks) hash.update(chunk)
  return hash.digest('hex').slice(0, 12)
}

function contentChunks(doc: PDFDocument, value: unknown): Uint8Array[] {
  if (value === undefined) return []
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value
  if (resolved instanceof PDFArray) return resolved.asArray().flatMap((entry) => contentChunks(doc, entry))
  const stream = resolved as { contents?: unknown } | undefined
  return stream?.contents instanceof Uint8Array ? [stream.contents] : []
}

/** Drop every `/Widget` annotation from a copied page so a rebuilt document holds no orphaned controls. */
export function stripWidgets(doc: PDFDocument, page: PDFPage): number {
  const annots = annotsOf(doc, page)
  if (annots === undefined) return 0
  let dropped = 0
  const keep: PDFObject[] = []
  for (const entry of annots.asArray()) {
    const dict = doc.context.lookup(entry)
    if (dict instanceof PDFDict && dict.get(PDFName.of('Subtype'))?.toString() === '/Widget') {
      dropped++
      continue
    }
    keep.push(entry)
  }
  if (dropped === 0) return 0
  if (keep.length === 0) page.node.delete(PDFName.of('Annots'))
  else page.node.set(PDFName.of('Annots'), doc.context.obj(keep))
  return dropped
}

/**
 * Rebuild a document from an explicit sequence of pages taken from one or more sources.
 *
 * `copyPages` is the only page-import path pdf-lib offers, and it copies page objects *without* the
 * source's `/AcroForm` field definitions — the widget annotations come along and would be left
 * orphaned. Rebuilt documents therefore drop widgets on the imported pages unless the caller opts
 * out, and report how many were dropped.
 *
 * @param plan - each output page: source document plus 0-based page index.
 * @param keepWidgets - keep widget annotations on imported pages.
 * @returns the new document plus the number of dropped widgets.
 */
export async function rebuildFromPages(
  plan: ReadonlyArray<{ source: PDFDocument; index: number }>,
  keepWidgets: boolean,
): Promise<{ doc: PDFDocument; widgetsDropped: number }> {
  const out = await PDFDocument.create()
  let widgetsDropped = 0
  // Group consecutive runs per source: copyPages is cheapest when asked for a run at once.
  const copied = new Map<PDFDocument, PDFPage[]>()
  const bySource = new Map<PDFDocument, number[]>()
  for (const entry of plan) {
    const list = bySource.get(entry.source) ?? []
    list.push(entry.index)
    bySource.set(entry.source, list)
  }
  for (const [source, indices] of bySource) copied.set(source, await out.copyPages(source, indices))
  const cursor = new Map<PDFDocument, number>()
  for (const entry of plan) {
    const pool = copied.get(entry.source) ?? []
    const at = cursor.get(entry.source) ?? 0
    const page = pool[at]
    cursor.set(entry.source, at + 1)
    if (page === undefined) continue
    out.addPage(page)
    if (!keepWidgets) widgetsDropped += stripWidgets(out, page)
  }
  return { doc: out, widgetsDropped }
}

/**
 * Apply an incremental rotation to the selected pages.
 *
 * Side A's `reorient.py` rotates *by* 90/180/270 on top of the page's current rotation; setting an
 * absolute angle instead would silently undo a producer's own `/Rotate`.
 *
 * @param loaded - the document to modify.
 * @param pages - 1-based page numbers.
 * @param angle - degrees to add (any multiple of 90, negative allowed).
 * @returns the resulting per-page angles.
 */
export function rotatePages(loaded: LoadedPdf, pages: readonly number[], angle: number): Array<{ page: number; from: number; to: number }> {
  if (!Number.isFinite(angle) || angle % 90 !== 0) {
    throw new PdfEditorError(`旋转角度必须是 90 的整数倍（收到 ${angle}）`)
  }
  const result: Array<{ page: number; from: number; to: number }> = []
  for (const pageNumber of pages) {
    const page = loaded.doc.getPage(pageNumber - 1)
    const from = normaliseAngle(page.getRotation().angle)
    const to = normaliseAngle(from + angle)
    page.setRotation(degrees(to))
    result.push({ page: pageNumber, from, to })
  }
  return result
}

/**
 * Set the crop box of the selected pages.
 *
 * The box is in PDF user-space points with the origin at the bottom-left, matching `/MediaBox`.
 * pdf-lib does not clip a crop box to the media box, so a box that sticks out is reported by the
 * caller's lint rather than being silently trimmed.
 *
 * @param loaded - the document to modify.
 * @param pages - 1-based page numbers.
 * @param box - the crop box in PDF points.
 * @returns the resulting per-page crop boxes.
 */
export function cropPages(loaded: LoadedPdf, pages: readonly number[], box: Box): Array<{ page: number; from: Box; to: Box }> {
  if (!(box.width > 0) || !(box.height > 0)) {
    throw new PdfEditorError(`裁剪框宽高必须为正数（收到 ${box.width}×${box.height}）`)
  }
  const result: Array<{ page: number; from: Box; to: Box }> = []
  for (const pageNumber of pages) {
    const page = loaded.doc.getPage(pageNumber - 1)
    const from = boxOf(page.getCropBox())
    page.setCropBox(box.x, box.y, box.width, box.height)
    result.push({ page: pageNumber, from, to: { ...box } })
  }
  return result
}

/**
 * Remove pages in place, pruning form fields whose widgets lived only on removed pages.
 *
 * pdf-lib's `removePage` deletes the page object but leaves the AcroForm field list untouched, so
 * the surviving `/Fields` entries point at widgets whose `/P` page no longer exists — the kind of
 * structurally broken file that opens in one viewer and not the next. Fields with no remaining
 * widget are removed; fields that keep widgets elsewhere are untouched.
 *
 * @param loaded - the document to modify.
 * @param pages - 1-based page numbers to remove (descending order is handled internally).
 * @returns counts of removed pages, fields, and widgets.
 */
export function removePages(loaded: LoadedPdf, pages: readonly number[]): { pagesRemoved: number; fieldsRemoved: number; widgetsRemoved: number } {
  const doc = loaded.doc
  const victims = [...pages].sort((a, b) => b - a)
  const survive = new Set<number>()
  for (let p = 1; p <= loaded.pageCount; p++) if (!pages.includes(p)) survive.add(p)
  const survivedPageRefs = new Set<string>()
  for (const pageNumber of survive) survivedPageRefs.add(refKey(doc.getPage(pageNumber - 1).ref))
  let fieldsRemoved = 0
  let widgetsRemoved = 0
  if (loaded.hasAcroForm) {
    for (const field of doc.getForm().getFields()) {
      const widgets = field.acroField.getWidgets()
      const keep: number[] = []
      widgets.forEach((widget, index) => {
        const parent = widget.P()
        if (parent !== undefined && survivedPageRefs.has(refKey(parent))) keep.push(index)
        else widgetsRemoved++
      })
      if (keep.length === widgets.length) continue
      if (keep.length === 0) {
        doc.getForm().removeField(field)
        fieldsRemoved++
        continue
      }
      // `removeWidget` takes an index into the live array, so drop from the back.
      for (let index = widgets.length - 1; index >= 0; index--) {
        if (!keep.includes(index)) field.acroField.removeWidget(index)
      }
    }
  }
  for (const pageNumber of victims) doc.removePage(pageNumber - 1)
  return { pagesRemoved: victims.length, fieldsRemoved, widgetsRemoved }
}

function refKey(ref: PDFRef): string {
  return `${ref.objectNumber}:${ref.generationNumber}`
}

/**
 * Move pages into an explicit order, in place.
 *
 * pdf-lib has no reorder primitive, but the page tree's `/Kids` array is a plain array of page
 * references and the page count never changes, so rewriting `/Kids` in place preserves everything a
 * rebuild would lose (`/AcroForm`, outlines, named destinations, page labels).
 *
 * @param loaded - the document to modify.
 * @param order - 1-based source page numbers in their new order (a permutation of 1..pageCount).
 * @returns nothing; the document is modified in place.
 */
export function reorderPages(loaded: LoadedPdf, order: readonly number[]): void {
  const doc = loaded.doc
  if (order.length !== loaded.pageCount) {
    throw new PdfEditorError(`reorder 需要 ${loaded.pageCount} 个页码（当前顺序是全部页的一个排列），收到 ${order.length} 个`)
  }
  const seen = new Set<number>()
  for (const pageNumber of order) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > loaded.pageCount) {
      throw new PdfEditorError(`reorder 的页码 ${pageNumber} 超出 1..${loaded.pageCount}`)
    }
    if (seen.has(pageNumber)) throw new PdfEditorError(`reorder 的页码重复：${pageNumber}（必须是 1..${loaded.pageCount} 的一个排列）`)
    seen.add(pageNumber)
  }
  const refs = order.map((pageNumber) => doc.getPage(pageNumber - 1).ref)
  // The leaf node holding the pages: a single-page document's root is the page itself.
  const tree = doc.catalog.get(PDFName.of('Pages'))
  if (tree === undefined) throw new PdfEditorError('该 PDF 缺少 /Pages 页面树，无法重排')
  const leaf = doc.context.lookup(tree)
  if (leaf instanceof PDFDict) {
    const kids = leaf.get(PDFName.of('Kids'))
    if (kids instanceof PDFArray && kids.size() === loaded.pageCount) {
      leaf.set(PDFName.of('Kids'), doc.context.obj(refs))
      return
    }
  }
  throw new PdfEditorError('该 PDF 的页面树不是单层 /Kids 结构（嵌套页面树暂不支持重排；可用 extract 重建后另存）')
}

/**
 * Insert pages from other documents into a document at a 1-based position.
 *
 * Inserted pages are imports: their widgets are dropped for the same reason as in
 * {@link rebuildFromPages}, while the base document's own form fields stay intact.
 *
 * @param target - the document receiving pages.
 * @param donors - each donor document plus the 0-based page indices to take.
 * @param at - 1-based insertion position; `pageCount + 1` appends.
 * @param keepWidgets - keep widget annotations on the inserted pages.
 * @returns the number of inserted pages and dropped widgets.
 */
export async function insertPages(
  target: LoadedPdf,
  donors: ReadonlyArray<{ doc: PDFDocument; indices: number[] }>,
  at: number,
  keepWidgets: boolean,
): Promise<{ inserted: number; widgetsDropped: number }> {
  let position = Math.trunc(at)
  if (!Number.isFinite(position) || position < 1 || position > target.pageCount + 1) {
    throw new PdfEditorError(`at 必须在 1..${target.pageCount + 1} 之间（收到 ${at}）`)
  }
  let inserted = 0
  let widgetsDropped = 0
  for (const donor of donors) {
    const pages = await target.doc.copyPages(donor.doc, donor.indices)
    for (const page of pages) {
      target.doc.insertPage(position - 1, page)
      if (!keepWidgets) widgetsDropped += stripWidgets(target.doc, page)
      position++
      inserted++
    }
  }
  return { inserted, widgetsDropped }
}

/**
 * Byte-level structural sanity of a written PDF.
 *
 * The header/trailer checks catch a truncated buffer before anything tries to parse it; the caller
 * separately reloads the document, which is what catches an object graph pdf-lib cannot read back.
 *
 * @param bytes - written PDF bytes.
 * @returns problems found, empty when the file looks structurally sound.
 */
export function structuralCheck(bytes: Uint8Array): string[] {
  const problems: string[] = []
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  if (!head.startsWith('%PDF-')) problems.push('缺少 %PDF- 文件头')
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.byteLength - 2048)))
  if (!tail.includes('%%EOF')) problems.push('缺少 %%EOF 结束标记（文件可能被截断）')
  if (tail.includes('/Encrypt')) problems.push('输出仍含 /Encrypt 字典（不应出现：本插件不写加密文档）')
  return problems
}
