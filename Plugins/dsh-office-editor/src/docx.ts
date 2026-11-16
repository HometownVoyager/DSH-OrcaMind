/**
 * .docx create/edit engine: build OOXML documents from structured blocks (fflate zip), and edit
 * existing documents with paragraph-indexed operations and run-aware text replacement.
 *
 * Two invariants this module must not break again:
 *
 * 1. **Paragraph addressing is shared with dsh-office-reader.** `index` counts the *top-level*
 *    `<w:p>` elements of `word/document.xml` in document order — empty paragraphs and
 *    table-cell paragraphs included, paragraphs nested inside another paragraph (textboxes)
 *    excluded. `tests/paragraph-contract.mjs` asserts this module and the reader agree; the two
 *    plugins stay independent at build time by mirroring the traversal in `scanParas`.
 * 2. **Editing is non-destructive.** Rewriting a paragraph keeps its `w:pPr` — style, numbering,
 *    alignment, spacing, section break — and every run keeps its own `w:rPr`, bookmarks, comment
 *    anchors, fields, hyperlinks and drawings; only the text of the affected `<w:t>` nodes
 *    changes. The documented exception is `set_paragraph`, whose contract *is* "replace the whole
 *    visible text", so it drops the old text runs but keeps the paragraph properties and reuses
 *    the original run formatting.
 *
 * @module dsh-office-editor/src/docx
 */

import { strFromU8, strToU8, unzipSync } from 'fflate'
import { packOoxml, partsToMap, type MtimeSource } from './zip.js'
import { assertWellFormedXml } from './xml.js'

export { assertWellFormedXml } from './xml.js'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const REL_TYPE = {
  styles: `${R_NS}/styles`,
  settings: `${R_NS}/settings`,
  numbering: `${R_NS}/numbering`,
  header: `${R_NS}/header`,
  footer: `${R_NS}/footer`,
  image: `${R_NS}/image`,
  comments: `${R_NS}/comments`,
  officeDocument: `${R_NS}/officeDocument`,
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  appProps: `${R_NS}/extended-properties`,
} as const

const CT = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  comments: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const

/** Escape text for XML character data. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Decode the five XML entities plus numeric references used by Word. */
function unesc(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Escape a string for use inside a `RegExp`. */
function reEsc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** ISO-8601 UTC timestamp in Word's `dcterms:W3CDTF` shape. */
function w3cdtf(date = new Date()): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

// ---------- content blocks ----------

/** Content block types supported by document creation. */
export type DocxBlock =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string; style?: string }
  | { type: 'list'; items: string[]; ordered?: boolean; level?: number }
  | { type: 'table'; rows: string[][]; header?: boolean }
  | { type: 'pagebreak' }

function runXml(text: string, bold = false): string {
  return bold
    ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
    : `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}

function paraXml(text: string, pPr = '', bold = false): string {
  return `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}${runXml(text, bold)}</w:p>`
}

function listParaXml(text: string, numId: number, level: number): string {
  return paraXml(text, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`)
}

/** Twips of text width for A4 at the default 1800-twip side margins. */
const A4_TEXT_TWIPS = 9360

/**
 * A table needs `w:tblGrid`: CT_Tbl requires it and Word offers to repair a table without one.
 * Cells carry explicit `dxa` widths derived from the same grid so the columns line up.
 */
function tableXml(rows: string[][], header: boolean): string {
  const border = '<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/>'
  const columns = Math.max(1, rows.reduce((max, row) => Math.max(max, row.length), 0))
  const colTwips = Math.floor(A4_TEXT_TWIPS / columns)
  const grid = `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${colTwips}"/>`).join('')}</w:tblGrid>`
  const trs = rows.map((row, index) => {
    const rowProps = header && index === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
    const cells = row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="${colTwips}" w:type="dxa"/></w:tcPr>${paraXml(String(cell ?? ''), '', header && index === 0)}</w:tc>`)
    return `<w:tr>${rowProps}${cells.join('')}</w:tr>`
  })
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${grid}${trs.join('')}</w:tbl>`
}

function blockXml(block: DocxBlock, numberingUsed: { bullet: boolean; ordered: boolean }): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Math.trunc(block.level ?? 1), 1), 4)
      return paraXml(String(block.text ?? ''), `<w:pStyle w:val="Heading${level}"/>`)
    }
    case 'paragraph': {
      const styleId = block.style === undefined ? undefined : resolveStyleId(block.style)
      return paraXml(String(block.text ?? ''), styleId === undefined ? '' : `<w:pStyle w:val="${esc(styleId)}"/>`)
    }
    case 'list': {
      if (!Array.isArray(block.items)) throw new Error('list 块的 items 必须是字符串数组')
      numberingUsed[block.ordered === true ? 'ordered' : 'bullet'] = true
      const numId = block.ordered === true ? 2 : 1
      const level = Math.min(Math.max(Math.trunc(block.level ?? 0), 0), 2)
      return block.items.map((item) => listParaXml(String(item ?? ''), numId, level)).join('')
    }
    case 'table': {
      if (!Array.isArray(block.rows)) throw new Error('table 块的 rows 必须是二维字符串数组')
      return tableXml(block.rows, block.header === true)
    }
    case 'pagebreak':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    default:
      throw new Error(`未知内容块类型：${JSON.stringify(block)}（支持 heading/paragraph/list/table/pagebreak）`)
  }
}

/** One `<w:lvl>` of a numbering definition. */
function lvlXml(level: number, numFmt: string, lvlText: string, font?: string): string {
  const indent = 720 + level * 360
  const rPr = font === undefined ? '' : `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>`
  return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/><w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>${rPr}</w:lvl>`
}

/** Bulleted and numbered lists with three nesting levels each. */
const NUMBERING_XML = [
  XML_DECL,
  `<w:numbering xmlns:w="${W_NS}">`,
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>',
  lvlXml(0, 'bullet', '•', 'Symbol'), lvlXml(1, 'bullet', 'o', 'Courier New'), lvlXml(2, 'bullet', '▪', 'Wingdings'),
  '</w:abstractNum>',
  '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>',
  lvlXml(0, 'decimal', '%1.'), lvlXml(1, 'lowerLetter', '%2)'), lvlXml(2, 'lowerRoman', '%3.'),
  '</w:abstractNum>',
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>',
  '</w:numbering>',
].join('')

/**
 * Named styles. Style *names* must match Word's built-in names (`heading 1`, `Title`, `Quote`,
 * `Caption`, `List Bullet`, …) and carry `w:qFormat`, otherwise Word's navigation pane, TOC
 * field and cross-references do not recognise them.
 */
const STYLES_XML = [
  XML_DECL,
  `<w:styles xmlns:w="${W_NS}">`,
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="等线" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>',
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="160" w:after="80"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="3"/><w:spacing w:before="140" w:after="80"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="404040"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="200"/><w:keepNext/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:contextualSpacing/><w:ind w:left="720"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="ListParagraph"/><w:qFormat/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="ListParagraph"/><w:qFormat/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:style>',
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>',
  '</w:styles>',
].join('')

/** Page geometry in twips: ISO A4 and US Letter portrait. */
export const PAGE_SIZES = {
  A4: { w: 11906, h: 16838 },
  Letter: { w: 12240, h: 15840 },
} as const

/** Page margins in twips. `thesis` is GB/T 7713.1's usual 2.5cm/3cm text block. */
export const PAGE_MARGIN_PRESETS = {
  normal: { top: 1440, right: 1800, bottom: 1440, left: 1800 },
  narrow: { top: 720, right: 720, bottom: 720, left: 720 },
  wide: { top: 1440, right: 2880, bottom: 1440, left: 2880 },
  thesis: { top: 1418, right: 1418, bottom: 1418, left: 1701 },
} as const

/** Page setup accepted by `office_create` and by the `set_page_setup` edit op. */
export interface PageSetup {
  /** Paper size preset (default A4). */
  size?: keyof typeof PAGE_SIZES
  /** `portrait` (default) or `landscape`. */
  orientation?: 'portrait' | 'landscape'
  /** Named margin preset, or explicit margins in twips (mm × 56.7). */
  margins?: keyof typeof PAGE_MARGIN_PRESETS | { top?: number; right?: number; bottom?: number; left?: number }
  /** Distance from the page edge to the header/footer in twips. */
  header?: number
  footer?: number
}

/** Document metadata written to docProps/core.xml. */
export interface DocxMetadata {
  title?: string
  subject?: string
  creator?: string
  keywords?: string
  description?: string
}

/** Resolve a page-setup description into the `w:pgSz`/`w:pgMar` element pair. */
function resolvePage(setup: PageSetup | undefined): { pgSz: string; pgMar: string } {
  const size = PAGE_SIZES[setup?.size ?? 'A4']
  const landscape = setup?.orientation === 'landscape'
  const w = landscape ? size.h : size.w
  const h = landscape ? size.w : size.h
  const marginSpec = setup?.margins
  const margins = typeof marginSpec === 'object' && marginSpec !== null
    ? {
        top: Math.trunc(marginSpec.top ?? PAGE_MARGIN_PRESETS.normal.top),
        right: Math.trunc(marginSpec.right ?? PAGE_MARGIN_PRESETS.normal.right),
        bottom: Math.trunc(marginSpec.bottom ?? PAGE_MARGIN_PRESETS.normal.bottom),
        left: Math.trunc(marginSpec.left ?? PAGE_MARGIN_PRESETS.normal.left),
      }
    : PAGE_MARGIN_PRESETS[marginSpec ?? 'normal']
  const orient = landscape ? ' w:orient="landscape"' : ''
  return {
    pgSz: `<w:pgSz w:w="${w}" w:h="${h}"${orient}/>`,
    pgMar: `<w:pgMar w:top="${margins.top}" w:right="${margins.right}" w:bottom="${margins.bottom}" w:left="${margins.left}" w:header="${Math.trunc(setup?.header ?? 851)}" w:footer="${Math.trunc(setup?.footer ?? 992)}" w:gutter="0"/>`,
  }
}

function coreXml(meta: DocxMetadata | undefined): string {
  const now = w3cdtf()
  const tag = (name: string, value: string | undefined): string =>
    value === undefined || value === '' ? '' : `<${name}>${esc(value)}</${name}>`
  return [
    XML_DECL,
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    tag('dc:title', meta?.title),
    tag('dc:subject', meta?.subject),
    tag('dc:creator', meta?.creator),
    tag('cp:keywords', meta?.keywords),
    tag('dc:description', meta?.description),
    tag('cp:lastModifiedBy', meta?.creator),
    '<cp:revision>1</cp:revision>',
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`,
    '</cp:coreProperties>',
  ].join('')
}

/** `docProps/app.xml`: Word's application statistics part. */
function appXml(paragraphCount: number, wordCount: number): string {
  return [
    XML_DECL,
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    '<Application>DSH office-editor</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>',
    `<Paragraphs>${paragraphCount}</Paragraphs><Words>${wordCount}</Words>`,
    '<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>',
    '</Properties>',
  ].join('')
}

/** `word/settings.xml`; `updateFields` asks Word to refresh every field when the file opens. */
function settingsXml(updateFields: boolean): string {
  return [
    XML_DECL,
    `<w:settings xmlns:w="${W_NS}">`,
    updateFields ? '<w:updateFields w:val="true"/>' : '',
    '<w:defaultTabStop w:val="420"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    '</w:settings>',
  ].join('')
}

/** An empty header/footer part. */
export function headerFooterXml(kind: 'header' | 'footer', paragraphs: string): string {
  return `${XML_DECL}<w:${kind} xmlns:w="${W_NS}" xmlns:r="${R_NS}">${paragraphs}</w:${kind}>`
}

/** A field run (`PAGE`, `NUMPAGES`, `TOC`, `REF`…) with a cached result. */
export function fieldXml(instr: string, cached: string, dirty = false): string {
  const dirtyAttr = dirty ? ' w:dirty="true"' : ''
  return [
    `<w:r><w:fldChar w:fldCharType="begin"${dirtyAttr}/></w:r>`,
    `<w:r><w:instrText xml:space="preserve">${esc(instr)}</w:instrText></w:r>`,
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    `<w:r><w:t xml:space="preserve">${esc(cached)}</w:t></w:r>`,
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
  ].join('')
}

// ---------- images ----------

/** Read intrinsic pixel dimensions from a PNG, JPEG or GIF header. */
export function imagePixelSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue }
      const marker = bytes[offset + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
      // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] }
      }
      offset += 2 + length
    }
    throw new Error('无法从 JPEG 头部读取尺寸（文件可能已损坏）')
  }
  throw new Error('无法识别的图片数据：仅支持 PNG / JPEG / GIF')
}

/** Image part extension and content type by magic bytes. */
export function imageKind(bytes: Uint8Array): { ext: 'png' | 'jpeg'; contentType: string } {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return { ext: 'png', contentType: 'image/png' }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49) return { ext: 'png', contentType: 'image/gif' }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return { ext: 'jpeg', contentType: 'image/jpeg' }
  throw new Error('无法识别的图片数据：仅支持 PNG / JPEG / GIF')
}

/** EMU per pixel at 96 dpi. */
const EMU_PER_PX = 9525

/**
 * An inline image run. `wp:docPr@descr` carries the alt text — required by this project's own
 * authoring rule that every image gets alt text, and read back by the office reader.
 */
function imageRunXml(relId: string, docPrId: number, name: string, alt: string, cx: number, cy: number): string {
  return [
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">',
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`,
    `<wp:docPr id="${docPrId}" name="${esc(name)}" descr="${esc(alt)}" title="${esc(alt)}"/>`,
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>',
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>',
    `<pic:cNvPr id="${docPrId}" name="${esc(name)}" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr>`,
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`,
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>',
  ].join('')
}

// ---------- paragraph traversal ----------

/** One top-level `<w:p>`: offsets in the parent XML plus its resolved visible text. */
export interface ParaSpan {
  /** Start offset of `<w:p …>` (or `<w:p/>`) in the parent XML. */
  start: number
  /** End offset (exclusive) of `</w:p>` (or of the self-closing tag). */
  end: number
  /** Paragraph XML, i.e. `parent.slice(start, end)`. */
  xml: string
  /** Visible text with tabs/breaks resolved and entities decoded. */
  text: string
  /** True when the paragraph carries no visible text. */
  empty: boolean
}

/** Text contributions inside a Word paragraph. Mirrored by the reader's WORD_BREAKS. */
const WORD_BREAKS: Array<[RegExp, string]> = [
  [/^<w:tab\b/u, '\t'],
  [/^<w:br\b/u, '\n'],
  [/^<w:cr\b/u, '\n'],
]

/** Extract visible text from one paragraph's inner XML (mirrors the reader's extractRunsText). */
function extractParaText(xml: string): string {
  let text = ''
  const re = /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/?[A-Za-z_][\w.:-]*(?:\s[^>]*)?\/?>/gu
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    if (m[1] !== undefined) {
      text += unesc(m[1])
      continue
    }
    for (const [pattern, replacement] of WORD_BREAKS) {
      pattern.lastIndex = 0
      if (pattern.test(m[0])) {
        text += replacement
        break
      }
    }
  }
  return text.replace(/[ \t]*\n[ \t\n]*/gu, '\n').trim()
}

/**
 * Scan `xml` for its top-level `<w:p>` spans in document order.
 *
 * "Top level" means: the paragraph is not nested inside another paragraph. A textbox drawing
 * inside a run holds `<w:p>` of its own, and those inner paragraphs are *not* `段落 N` units in
 * office_read, so they must not consume an editor index either. Counting them both broke that
 * contract and made `replace_text` splice two overlapping spans (report D1).
 *
 * Paragraph nesting is a real parse, not a depth counter: `<w:p>` also appears inside table
 * cells, whose `</w:p>` closers interleave with the host paragraph's in token order, so
 * "depth reaches zero" does not mean "the paragraph ended".
 *
 * Table-cell paragraphs are siblings of body paragraphs here and stay addressable, which is what
 * keeps the editor's paragraph numbering aligned with the reader's flattened paragraph list.
 *
 * @throws an Error when the fragment is not balanced.
 */
export function scanParas(xml: string): ParaSpan[] {
  const spans = topLevelWordParagraphs(xml)
  if (spans.length === 0) {
    // No <w:p> at all: still validate balance so malformed input is reported rather than ignored.
    assertWellFormedXml(xml, 'word/document.xml')
  }
  return spans
}

/** Locate every top-level `<w:p>` element in a WordprocessingML part. */
function topLevelWordParagraphs(xml: string): ParaSpan[] {
  const spans: ParaSpan[] = []
  let cursor = 0
  const stack: string[] = []
  const tokenRe = /<([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>/gu
  for (let m = tokenRe.exec(xml); m !== null; m = tokenRe.exec(xml)) {
    if (m[1] !== undefined) {
      const name = localName(m[1])
      if (name !== 'p') {
        if (m[3] !== '/') stack.push(name)
        continue
      }
      if (m[3] === '/') {
        if (!stack.includes('p')) spans.push(makeSpan(xml, m.index, m.index + m[0].length))
        continue
      }
      if (!stack.includes('p')) cursor = m.index
      stack.push(name)
      continue
    }
    if (m[4] === undefined) continue
    const name = localName(m[4])
    const open = stack.pop()
    if (open === undefined) throw new Error('docx 解析失败：document.xml 的 XML 结构不闭合（出现多余的 </' + name + '>）')
    if (open !== name) throw new Error(`docx 解析失败：document.xml 标签不匹配（<${open}> 被 </${name}> 关闭）`)
    if (name === 'p' && !stack.includes('p')) spans.push(makeSpan(xml, cursor, m.index + m[0].length))
  }
  if (stack.length > 0) throw new Error(`docx 解析失败：document.xml 的 XML 结构不闭合（<${stack[stack.length - 1]}> 未闭合）`)
  return spans
}

/** Local name of a possibly namespace-prefixed element name. */
function localName(name: string): string {
  const at = name.indexOf(':')
  return at < 0 ? name : name.slice(at + 1)
}

function makeSpan(xml: string, start: number, end: number): ParaSpan {
  const slice = xml.slice(start, end)
  const text = extractParaText(slice)
  return { start, end, xml: slice, text, empty: text === '' }
}

/** Resolve a 1-based paragraph index with a clear error. */
function paraAt(paras: ParaSpan[], index: number): ParaSpan {
  if (!Number.isInteger(index) || index < 1 || index > paras.length) {
    throw new Error(`段落序号越界：${index}（当前文档共 ${paras.length} 段，取值 1-${paras.length}）`)
  }
  return paras[index - 1]
}

/**
 * True when `offset` sits inside an unclosed `<w:p>` — i.e. inside a section break carried by a
 * paragraph, or inside a set of nested paragraphs.
 *
 * Counted from the body's start tag so a body-level `w:sectPr` that follows the last paragraph is
 * never mistaken for one nested in it.
 */
function insideParagraph(xml: string, offset: number): boolean {
  const bodyStart = xml.search(/<w:body(?:\s[^>]*)?>/u)
  const from = bodyStart < 0 ? 0 : bodyStart
  const before = xml.slice(from, offset)
  let depth = 0
  const re = /<w:p(?:\s[^>]*)?\/>|<\/w:p>/gu
  for (let m = re.exec(before); m !== null; m = re.exec(before)) {
    if (m[0].endsWith('/>')) continue
    depth += m[0].startsWith('</') ? -1 : 1
  }
  return depth > 0
}

/** Locate the body-level `w:sectPr` (never one nested in a paragraph, never `w:sectPrChange`). */
function findBodySectPr(xml: string): { start: number; innerStart: number; innerEnd: number; inner: string } | null {
  const re = /<w:sectPr(?:\s[^>]*)?>([\s\S]*?)<\/w:sectPr>|<w:sectPr(?:\s[^>]*)?\/>/gu
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    if (insideParagraph(xml, m.index)) continue
    if (m[1] === undefined) return { start: m.index, innerStart: m.index + m[0].length, innerEnd: m.index + m[0].length, inner: '' }
    const innerStart = m.index + m[0].indexOf('>') + 1
    return { start: m.index, innerStart, innerEnd: innerStart + m[1].length, inner: m[1] }
  }
  return null
}

/**
 * Offset at which a new top-level paragraph belongs: after the last paragraph and before the
 * body-level `w:sectPr`, which ECMA-376 requires to be the *last* child of `w:body`.
 */
export function bodyAppendOffset(xml: string, paras: ParaSpan[]): number {
  const bodyEnd = xml.lastIndexOf('</w:body>')
  if (bodyEnd < 0) throw new Error('document.xml 中找不到 </w:body>')
  const sect = findBodySectPr(xml)
  if (sect === null) return bodyEnd
  const lastParaEnd = paras.length === 0 ? -1 : paras[paras.length - 1].end
  return sect.start > lastParaEnd ? sect.start : bodyEnd
}

// ---------- run-aware text surgery ----------

/** One `<w:t>` node inside a paragraph. */
interface TextChunk {
  /** Offset of the whole `<w:t …>` element inside the paragraph XML. */
  xmlStart: number
  /** End offset (exclusive) of the element. */
  xmlEnd: number
  /** Start offset of the character data (equals `xmlEnd` for `<w:t/>`). */
  dataStart: number
  /** End offset (exclusive) of the character data. */
  dataEnd: number
  /** The `<w:t …>` open tag, or the whole self-closing element. */
  openTag: string
  /** Decoded text content (`unesc(raw)`); empty nodes are skipped by the caller. */
  text: string
  /** Raw, still-escaped character data — the coordinates every edit is expressed in. */
  raw: string
}

/** List every non-empty `<w:t>` node of a paragraph in document order. */
function textChunks(partXml: string): TextChunk[] {
  const chunks: TextChunk[] = []
  const re = /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu
  for (let m = re.exec(partXml); m !== null; m = re.exec(partXml)) {
    const xmlStart = m.index
    const xmlEnd = m.index + m[0].length
    // The self-closing branch has no capture group, so `m[1] === undefined` identifies it.
    if (m[1] === undefined) continue
    const openTagLength = m[0].length - m[1].length - '</w:t>'.length
    chunks.push({
      xmlStart,
      xmlEnd,
      dataStart: xmlStart + openTagLength,
      dataEnd: xmlEnd - '</w:t>'.length,
      openTag: m[0].slice(0, openTagLength),
      text: unesc(m[1]),
      raw: m[1],
    })
  }
  return chunks
}

/**
 * Map a decoded-text offset back into the chunk's escaped XML coordinates.
 *
 * Escaping is 1:1 for most characters but an entity is several characters in the XML and one in
 * the decoded text, so edits located on decoded text must be translated before they can be
 * spliced. Both the text nodes' *visible text* and the search hits live in decoded space; the
 * document itself does not.
 */
function dataOffset(chunk: TextChunk, decodedOffset: number): number {
  if (decodedOffset <= 0) return chunk.dataStart
  if (decodedOffset >= chunk.text.length) return chunk.dataEnd
  let produced = 0
  let i = 0
  while (i < chunk.raw.length && produced < decodedOffset) {
    const ch = chunk.raw[i]
    let consumed = 1
    if (ch === '&') {
      const semi = chunk.raw.indexOf(';', i)
      if (semi > i) consumed = semi - i + 1
    }
    i += consumed
    produced++
  }
  return chunk.dataStart + i
}

/** Serialize one `<w:t>` element, adding `xml:space="preserve"` when the text needs it. */
function textNodeXml(openTag: string, text: string): string {
  if (text === '') return openTag.endsWith('/>') ? openTag : `${openTag}/>`
  const needsPreserve = /^\s|\s$/u.test(text) && !/xml:space\s*=/u.test(openTag)
  const tag = needsPreserve ? openTag.replace(/>$/u, ' xml:space="preserve">') : openTag
  return `${tag}${esc(text)}</w:t>`
}

/**
 * Apply replacements to a paragraph's text nodes.
 *
 * Edits are expressed in the paragraph's own *escaped XML* coordinates and never overlap
 * (`replaceInParagraph` only produces disjoint hits), so each node's new text is its original
 * character data with the edit ranges swapped out. Working node-by-node is what keeps every
 * run's `w:rPr` — and every non-text node between them — exactly where it was.
 */
function applyChunkEdits(paragraphXml: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const chunks = textChunks(paragraphXml)
  const ordered = [...edits].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const chunk of chunks) {
    const relevant = ordered.filter((e) => e.start < chunk.xmlEnd && e.end > chunk.xmlStart)
    if (relevant.length === 0) continue
    out += paragraphXml.slice(cursor, chunk.xmlStart)
    let text = ''
    let local = chunk.dataStart
    for (const edit of relevant) {
      const from = Math.max(edit.start, chunk.dataStart)
      const to = Math.min(edit.end, chunk.dataEnd)
      if (from > local) text += unesc(paragraphXml.slice(local, from))
      if (to > from) text += edit.text
      local = Math.max(local, to)
    }
    if (local < chunk.dataEnd) text += unesc(paragraphXml.slice(local, chunk.dataEnd))
    out += textNodeXml(chunk.openTag, text)
    cursor = chunk.xmlEnd
  }
  return out + paragraphXml.slice(cursor)
}

/**
 * Replace every occurrence of `search` in a paragraph while preserving run formatting.
 *
 * Occurrences are located on the *concatenated* text, so a placeholder split across runs is
 * still found, then mapped back to the `<w:t>` nodes that carry them. All hits are collected
 * before anything is rewritten, so a later hit is never invalidated by an earlier replacement
 * and every offset stays in the coordinates the paragraph was scanned in.
 *
 * Tab and break elements between the hit runs stay untouched, and nothing outside the matched
 * range is rewritten — which is what keeps page breaks, fields and inline drawings alive
 * (report D4). The replacement is spread over exactly the hit runs so no node's text is merged
 * into a sibling, which would lose that node's `xml:space`.
 */
export function replaceInParagraph(paragraphXml: string, search: string, replacement: string): { xml: string; count: number } {
  if (search === '') throw new Error('replace_text 的 old 不能为空')
  const chunks = textChunks(paragraphXml)
  const starts: number[] = []
  let concatenated = ''
  for (const chunk of chunks) {
    starts.push(concatenated.length)
    concatenated += chunk.text
  }
  const hits: Array<{ from: number; to: number }> = []
  for (let at = concatenated.indexOf(search); at !== -1; at = concatenated.indexOf(search, at + search.length)) {
    hits.push({ from: at, to: at + search.length })
    if (hits.length > 5000) throw new Error(`文本 "${search}" 在该段中出现次数过多（超过 5000 次）`)
  }
  if (hits.length === 0) return { xml: paragraphXml, count: 0 }

  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const hit of hits) {
    const touched = chunks
      .map((chunk, i) => ({ chunk, i }))
      .filter(({ chunk, i }) => hit.from < starts[i] + chunk.text.length && hit.to > starts[i])
    if (touched.length === 0) continue
    if (touched.length === 1) {
      const { chunk, i } = touched[0]
      edits.push({
        start: dataOffset(chunk, hit.from - starts[i]),
        end: dataOffset(chunk, hit.to - starts[i]),
        text: replacement,
      })
      continue
    }
    for (const [position, { chunk, i }] of touched.entries()) {
      const chunkStart = starts[i]
      const localFrom = Math.max(hit.from, chunkStart) - chunkStart
      const localTo = Math.min(hit.to, chunkStart + chunk.text.length) - chunkStart
      // Spread the replacement over the hit runs so each node keeps its own `xml:space`.
      const sliceStart = Math.floor((replacement.length * position) / touched.length)
      const sliceEnd = Math.floor((replacement.length * (position + 1)) / touched.length)
      edits.push({
        start: dataOffset(chunk, localFrom),
        end: dataOffset(chunk, localTo),
        text: replacement.slice(sliceStart, sliceEnd),
      })
    }
  }
  return { xml: applyChunkEdits(paragraphXml, edits), count: hits.length }
}

// ---------- styles and paragraph properties ----------

/** Built-in paragraph style names accepted by `office_create`/`office_edit`. */
export const DOCX_STYLE_IDS: Record<string, string> = {
  Normal: 'Normal',
  Title: 'Title',
  Subtitle: 'Subtitle',
  Quote: 'Quote',
  Caption: 'Caption',
  'List Paragraph': 'ListParagraph',
  'List Bullet': 'ListBullet',
  'List Number': 'ListNumber',
  'Heading 1': 'Heading1',
  'Heading 2': 'Heading2',
  'Heading 3': 'Heading3',
  'Heading 4': 'Heading4',
}

/** Map a model-supplied style name to a `w:pStyle` id. */
export function resolveStyleId(style: string): string {
  const trimmed = style.trim()
  const mapped = DOCX_STYLE_IDS[trimmed]
  if (mapped !== undefined) return mapped
  const heading = /^heading\s*([1-9])$/iu.exec(trimmed)
  if (heading !== null) return `Heading${heading[1]}`
  if (/^[A-Za-z][A-Za-z0-9]*$/u.test(trimmed)) return trimmed
  throw new Error(`无法识别段落样式："${style}"（可用：Normal/Title/Subtitle/Quote/Caption/Heading 1-4/List Paragraph/List Bullet/List Number，或文档中已有的 styleId）`)
}

/** The paragraph's `w:pPr` inner XML and the run properties a fresh run should inherit. */
function paragraphProps(paragraphXml: string): { pPr: string | null; rPr: string | null } {
  const pPrMatch = /<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>|<w:pPr(?:\s[^>]*)?\/>/u.exec(paragraphXml)
  const pPr = pPrMatch === null ? null : (pPrMatch[1] ?? '')
  // Paragraph-mark run properties: the formatting Word applies to a new run in this paragraph.
  const markRun = pPr === null ? null : /<w:rPr(?:\s[^>]*)?>([\s\S]*?)<\/w:rPr>|<w:rPr(?:\s[^>]*)?\/>/u.exec(pPr)
  if (markRun !== null) return { pPr, rPr: markRun[1] ?? '' }
  const firstRun = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/u.exec(paragraphXml)
  const firstRunPr = firstRun === null ? null : /<w:rPr(?:\s[^>]*)?>([\s\S]*?)<\/w:rPr>|<w:rPr(?:\s[^>]*)?\/>/u.exec(firstRun[1])
  return { pPr, rPr: firstRunPr === null ? null : (firstRunPr[1] ?? '') }
}

/** Set or replace the paragraph's `w:pStyle` while keeping every other paragraph property. */
function withParagraphStyle(paragraphXml: string, styleId: string): string {
  const match = /<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>/u.exec(paragraphXml)
  if (match === null) {
    const open = /^<w:p(?:\s[^>]*)?>/u.exec(paragraphXml)
    if (open === null) return paragraphXml
    return `${open[0]}<w:pPr><w:pStyle w:val="${esc(styleId)}"/></w:pPr>${paragraphXml.slice(open[0].length)}`
  }
  const inner = match[1]
  const next = /<w:pStyle\b[^>]*\/>/u.test(inner)
    ? inner.replace(/<w:pStyle\b[^>]*\/>/u, `<w:pStyle w:val="${esc(styleId)}"/>`)
    : `<w:pStyle w:val="${esc(styleId)}"/>${inner}`
  return paragraphXml.slice(0, match.index) + `<w:pPr>${next}</w:pPr>` + paragraphXml.slice(match.index + match[0].length)
}

/**
 * Rewrite a paragraph's visible text without destroying its structure: paragraph properties
 * (`w:pPr`), bookmarks, comment anchors, fields, hyperlinks and drawings are all kept; the old
 * `<w:t>` text is replaced by one new run carrying the paragraph's own formatting.
 */
export function rewriteParagraphText(paragraphXml: string, text: string): string {
  const { pPr, rPr } = paragraphProps(paragraphXml)
  const openMatch = /^<w:p(?:\s[^>]*)?>/u.exec(paragraphXml)
  if (openMatch === null) return paragraphXml
  const pPrXml = pPr === null ? '' : `<w:pPr>${pPr}</w:pPr>`
  const rPrXml = rPr === null || rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`
  return `${openMatch[0]}${pPrXml}<w:r>${rPrXml}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
}

// ---------- creation ----------

function countWords(blocks: DocxBlock[]): number {
  let words = 0
  const add = (text: string): void => {
    words += text.split(/\s+/u).filter((w) => w !== '').length
  }
  for (const block of blocks) {
    if (block.type === 'heading' || block.type === 'paragraph') add(String(block.text ?? ''))
    else if (block.type === 'list') add(block.items.join(' '))
    else if (block.type === 'table') add(block.rows.flat().join(' '))
  }
  return words
}

/** Options for {@link createDocx}. */
export interface CreateDocxOptions {
  /** Page geometry (defaults to A4 portrait with normal margins). */
  page?: PageSetup
  /** docProps/core.xml values. */
  metadata?: DocxMetadata
  /** Header paragraph XML (inner paragraphs); omitted means no header part. */
  header?: string
  /** Footer paragraph XML (inner paragraphs); omitted means no footer part. */
  footer?: string
  /** Insert a TOC field paragraph at the top of the body and set `w:updateFields`. */
  toc?: boolean
  /** Entry timestamp policy; `fixed` (default) keeps the archive byte-reproducible. */
  mtime?: MtimeSource
  /** Assemble the parts but do not zip — used by tests that inspect individual parts. */
  partsOnly?: false
}

/**
 * Build a new .docx from structured blocks and serialize to bytes.
 * @param blocks - ordered content blocks.
 * @param options - page geometry, metadata, header/footer and TOC.
 * @returns the .docx bytes.
 */
export function createDocx(blocks: DocxBlock[], options: CreateDocxOptions = {}): Uint8Array {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('content 不能为空：至少需要一个内容块')
  const numberingUsed = { bullet: false, ordered: false }
  let body = blocks.map((block) => blockXml(block, numberingUsed)).join('')
  if (options.toc === true) {
    body = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">目录</w:t></w:r></w:p>`
      + `<w:p>${fieldXml(' TOC \\o "1-3" \\h \\z \\u ', '请在 Word 中更新此域以生成目录', true)}</w:p>`
      + body
  }
  const { pgSz, pgMar } = resolvePage(options.page)
  const sectPr = `<w:sectPr>${options.header !== undefined ? `<w:headerReference w:type="default" r:id="rIdHdr"/>` : ''}${options.footer !== undefined ? `<w:footerReference w:type="default" r:id="rIdFtr"/>` : ''}${pgSz}${pgMar}</w:sectPr>`
  const documentXml = `${XML_DECL}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}${sectPr}</w:body></w:document>`

  const contentTypes = [
    XML_DECL,
    `<Types xmlns="${CT_NS}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    `<Override PartName="/word/document.xml" ContentType="${CT.document}"/>`,
    `<Override PartName="/word/styles.xml" ContentType="${CT.styles}"/>`,
    numberingUsed.bullet || numberingUsed.ordered ? `<Override PartName="/word/numbering.xml" ContentType="${CT.numbering}"/>` : '',
    `<Override PartName="/word/settings.xml" ContentType="${CT.settings}"/>`,
    options.header !== undefined ? `<Override PartName="/word/header1.xml" ContentType="${CT.header}"/>` : '',
    options.footer !== undefined ? `<Override PartName="/word/footer1.xml" ContentType="${CT.footer}"/>` : '',
    `<Override PartName="/docProps/core.xml" ContentType="${CT.core}"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="${CT.app}"/>`,
    '</Types>',
  ].join('')

  const rootRels = [
    XML_DECL,
    `<Relationships xmlns="${REL_NS}">`,
    `<Relationship Id="rId1" Type="${REL_TYPE.officeDocument}" Target="word/document.xml"/>`,
    `<Relationship Id="rId2" Type="${REL_TYPE.coreProps}" Target="docProps/core.xml"/>`,
    `<Relationship Id="rId3" Type="${REL_TYPE.appProps}" Target="docProps/app.xml"/>`,
    '</Relationships>',
  ].join('')

  const docRels = [
    XML_DECL,
    `<Relationships xmlns="${REL_NS}">`,
    `<Relationship Id="rId1" Type="${REL_TYPE.styles}" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="${REL_TYPE.settings}" Target="settings.xml"/>`,
    numberingUsed.bullet || numberingUsed.ordered ? `<Relationship Id="rId3" Type="${REL_TYPE.numbering}" Target="numbering.xml"/>` : '',
    options.header !== undefined ? `<Relationship Id="rIdHdr" Type="${REL_TYPE.header}" Target="header1.xml"/>` : '',
    options.footer !== undefined ? `<Relationship Id="rIdFtr" Type="${REL_TYPE.footer}" Target="footer1.xml"/>` : '',
    '</Relationships>',
  ].join('')

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(STYLES_XML),
    'word/settings.xml': strToU8(settingsXml(options.toc === true)),
    'word/_rels/document.xml.rels': strToU8(docRels),
    'docProps/core.xml': strToU8(coreXml(options.metadata)),
    'docProps/app.xml': strToU8(appXml(blocks.length, countWords(blocks))),
  }
  if (numberingUsed.bullet || numberingUsed.ordered) files['word/numbering.xml'] = strToU8(NUMBERING_XML)
  if (options.header !== undefined) files['word/header1.xml'] = strToU8(headerFooterXml('header', options.header))
  if (options.footer !== undefined) files['word/footer1.xml'] = strToU8(headerFooterXml('footer', options.footer))
  return packOoxml(partsToMap(files), options.mtime === 'source' ? { mtime: 'source' } : {})
}

// ---------- comments (annotations) ----------

/** Character style a comment's reference mark uses; Word's own name is `annotation reference`. */
const COMMENT_STYLES_XML = '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>'

/**
 * The `<w:r>` element that encloses a character range of a paragraph.
 *
 * Runs never nest, so the enclosing run of an offset is the innermost open `<w:r>` at that point —
 * found by a token walk rather than by searching for the nearest tag, which would jump out of the
 * paragraph when the text sits inside a hyperlink or a smart-tag wrapper.
 */
function enclosingRun(paragraphXml: string, from: number, to: number): { start: number; end: number } | null {
  const stack: Array<{ start: number; end: number }> = []
  let first: { start: number; end: number } | null = null
  let last: { start: number; end: number } | null = null
  const re = /<w:r(?:\s[^>]*)?\/>|<w:r(?:\s[^>]*)?>|<\/w:r>/gu
  for (let m = re.exec(paragraphXml); m !== null; m = re.exec(paragraphXml)) {
    const token = m[0]
    if (token.endsWith('/>')) {
      const span = { start: m.index, end: m.index + token.length }
      if (from >= span.start && to <= span.end) return span
      continue
    }
    if (!token.startsWith('</')) {
      stack.push({ start: m.index, end: -1 })
      continue
    }
    const open = stack.pop()
    if (open === undefined) continue
    open.end = m.index + token.length
    if (from >= open.start && to <= open.end) {
      if (first === null) first = { ...open }
      last = { ...open }
    }
  }
  if (first === null || last === null) return null
  return { start: first.start, end: last.end }
}

/** Allocate the next free `w:id` in an existing comments part. */
function nextCommentId(commentsXml: string | null): number {
  if (commentsXml === null) return 0
  let max = -1
  for (const m of commentsXml.matchAll(/<w:comment\b[^>]*w:id="(-?\d+)"/gu)) max = Math.max(max, Number(m[1]))
  return max + 1
}

/** Widen a comment range to whole runs, or wrap the paragraph when no anchor was given. */
function commentAnchors(paragraphXml: string, anchor: string | undefined): { start: number; end: number } {
  const open = /^<w:p(?:\s[^>]*)?>/u.exec(paragraphXml)
  const pPr = /<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/u.exec(paragraphXml)
  const bodyStart = pPr !== null ? pPr.index + pPr[0].length : (open === null ? 0 : open[0].length)
  if (anchor === undefined || anchor === '') return { start: bodyStart, end: paragraphXml.lastIndexOf('</w:p>') }
  const chunks = textChunks(paragraphXml)
  let concatenated = ''
  const starts: number[] = []
  for (const chunk of chunks) {
    starts.push(concatenated.length)
    concatenated += chunk.text
  }
  const at = concatenated.indexOf(anchor)
  if (at === -1) throw new Error(`批注锚点未在段落中找到："${anchor}"（可先用 office_find 确认措辞，或省略 anchor 以整段为锚）`)
  const from = at
  const to = at + anchor.length
  const touched = chunks.map((chunk, i) => ({ chunk, i })).filter(({ chunk, i }) => from < starts[i] + chunk.text.length && to > starts[i])
  if (touched.length === 0) throw new Error(`批注锚点无法定位到文本节点："${anchor}"`)
  const run = enclosingRun(paragraphXml, touched[0].chunk.xmlStart, touched[touched.length - 1].chunk.xmlEnd)
  if (run === null) throw new Error(`批注锚点不在任何文本 run 内："${anchor}"（可能是域或图形中的文本，暂不支持批注锚定）`)
  return { start: run.start, end: run.end }
}

/** Wrap one paragraph with comment range markers plus the reference run Word shows as the marker. */
function annotateParagraph(paragraphXml: string, id: number, anchor: string | undefined): string {
  const { start, end } = commentAnchors(paragraphXml, anchor)
  const closer = '<w:commentRangeEnd w:id="' + id + '"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="' + id + '"/></w:r>'
  return paragraphXml.slice(0, start)
    + '<w:commentRangeStart w:id="' + id + '"/>'
    + paragraphXml.slice(start, end)
    + closer
    + paragraphXml.slice(end)
}

/** Build (or extend) `word/comments.xml` with one new comment. */
function withComment(existing: string | null, id: number, text: string, author: string, initials: string, date: string): string {
  const comment = `<w:comment w:id="${id}" w:author="${esc(author)}" w:date="${date}" w:initials="${esc(initials)}">`
    + `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
    + '</w:comment>'
  if (existing === null) return `${XML_DECL}<w:comments xmlns:w="${W_NS}">${comment}</w:comments>`
  return existing.replace('</w:comments>', `${comment}</w:comments>`)
}

/** Add the two comment styles to an existing styles part when they are missing. */
function ensureCommentStyles(styles: string): string {
  let out = styles
  if (!/w:styleId="CommentReference"/u.test(out)) out = out.replace('</w:styles>', `${COMMENT_STYLES_XML.slice(0, COMMENT_STYLES_XML.indexOf('<w:style w:type="paragraph"'))}</w:styles>`)
  if (!/w:styleId="CommentText"/u.test(out)) out = out.replace('</w:styles>', `${COMMENT_STYLES_XML.slice(COMMENT_STYLES_XML.indexOf('<w:style w:type="paragraph"'))}</w:styles>`)
  return out
}

// ---------- editing ----------

/** Ordered operations supported on an existing document. */
export type DocxOp =
  | { op: 'set_paragraph'; index: number; text: string; style?: string }
  | { op: 'set_style'; index: number; style: string }
  | { op: 'insert_before'; index: number; text: string; style?: string }
  | { op: 'insert_after'; index: number; text: string; style?: string }
  | { op: 'append_paragraph'; text: string; style?: string }
  | { op: 'delete_paragraph'; index: number }
  | { op: 'replace_text'; old: string; new: string }
  | { op: 'insert_image'; index: number; path: string; alt: string; width_emu?: number; height_emu?: number }
  | { op: 'insert_figure'; path: string; alt: string; caption?: string; caption_position?: 'above' | 'below'; width_emu?: number }
  | { op: 'insert_table'; rows: string[][]; header?: boolean; caption?: string }
  | { op: 'fill_placeholders'; values: Record<string, string> }
  | { op: 'set_page_setup'; page: PageSetup }
  | { op: 'set_metadata'; metadata: DocxMetadata }
  | { op: 'insert_toc'; title?: string }
  | { op: 'insert_page_number_footer'; text?: string }
  | { op: 'insert_header'; text: string }
  | { op: 'accept_revisions' }
  | { op: 'add_comment'; index: number; text: string; anchor?: string; author?: string; initials?: string }

/** Result of applying operations to a document. */
export interface DocxEditResult {
  /** Serialized .docx bytes. */
  bytes: Uint8Array
  /** One human-readable line per applied operation. */
  applied: string[]
  /** Visible text of every top-level paragraph after the edit (1-based order). */
  paragraphs: string[]
  /** 1-based indexes of paragraphs with no visible text. */
  emptyParagraphs: number[]
}

/** Host hooks for {@link editDocx}. */
export interface EditDocxOptions {
  /** Read an image file by absolute path, for `insert_image`. Injected so the engine stays pure. */
  readFile?: (absolute: string) => Promise<Uint8Array>
  /** Entry timestamp policy; `fixed` (default) keeps the archive byte-reproducible. */
  mtime?: MtimeSource
}

/** Next free `word/media/imageN.*` index. */
function nextMediaIndex(files: ReadonlyMap<string, Uint8Array>): number {
  let max = 0
  for (const name of files.keys()) {
    const m = /^word\/media\/image(\d+)\./u.exec(name)
    if (m !== null) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/** Next free `word/headerN.xml` / `word/footerN.xml` index. */
function nextPartIndex(files: ReadonlyMap<string, Uint8Array>, kind: 'header' | 'footer'): number {
  let max = 0
  for (const name of files.keys()) {
    const m = new RegExp(`^word/${kind}(\\d+)\\.xml$`, 'u').exec(name)
    if (m !== null) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/** Merge values into an existing docProps/core.xml without dropping unrelated properties. */
function mergeCoreProps(core: string, meta: DocxMetadata): string {
  const map: Array<[keyof DocxMetadata, string]> = [
    ['title', 'dc:title'],
    ['subject', 'dc:subject'],
    ['creator', 'dc:creator'],
    ['keywords', 'cp:keywords'],
    ['description', 'dc:description'],
  ]
  let out = core
  for (const [key, tag] of map) {
    const value = meta[key]
    if (value === undefined) continue
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>|<${tag}(?:\\s[^>]*)?/>`, 'u')
    if (pattern.test(out)) out = out.replace(pattern, value === '' ? '' : `<${tag}>${esc(value)}</${tag}>`)
    else if (value !== '') out = out.replace('</cp:coreProperties>', `<${tag}>${esc(value)}</${tag}></cp:coreProperties>`)
  }
  const stamp = /<dcterms:modified(?:\s[^>]*)?>[\s\S]*?<\/dcterms:modified>/u
  if (stamp.test(out)) out = out.replace(stamp, `<dcterms:modified xsi:type="dcterms:W3CDTF">${w3cdtf()}</dcterms:modified>`)
  return out
}

/**
 * A tiny mutable view over the package that every op edits through, so relationship, content-type
 * and media bookkeeping happen in one place.
 */
class DocxPackage {
  readonly files: Map<string, Uint8Array>

  constructor(files: Record<string, Uint8Array>) {
    // A `Map` rather than the record: the package is large, edited in place, and `packOoxml`
    // takes a map — keeping one representation avoids copying every part on write-out.
    this.files = partsToMap(files)
  }

  text(name: string): string | null {
    const entry = this.files.get(name)
    return entry === undefined ? null : strFromU8(entry)
  }

  put(name: string, text: string): void {
    this.files.set(name, strToU8(text))
  }

  putBytes(name: string, bytes: Uint8Array): void {
    this.files.set(name, bytes)
  }

  /** Package part names, in the order the parts were loaded. */
  names(): string[] {
    return [...this.files.keys()]
  }

  has(name: string): boolean {
    return this.files.has(name)
  }

  /** Add a `Default` content-type entry when that extension is not declared yet. */
  ensureDefault(ext: string, contentType: string): void {
    const current = this.text('[Content_Types].xml')
    if (current === null) throw new Error('该 docx 缺少 [Content_Types].xml')
    if (new RegExp(`<Default\\s+Extension="${reEsc(ext)}"`, 'u').test(current)) return
    this.put('[Content_Types].xml', current.replace('</Types>', `<Default Extension="${ext}" ContentType="${contentType}"/></Types>`))
  }

  /** Add an `Override` content-type entry when that part is not declared yet. */
  ensureOverride(partName: string, contentType: string): void {
    const current = this.text('[Content_Types].xml')
    if (current === null) throw new Error('该 docx 缺少 [Content_Types].xml')
    if (current.includes(`PartName="${partName}"`)) return
    this.put('[Content_Types].xml', current.replace('</Types>', `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`))
  }

  /** Ensure `_rels/.rels` points at the part (used when adding docProps to an existing file). */
  ensureRootRel(type: string, target: string): void {
    const current = this.text('_rels/.rels')
    if (current === null) throw new Error('该 docx 缺少 _rels/.rels')
    if (current.includes(`Target="${target}"`)) return
    this.put('_rels/.rels', current.replace('</Relationships>', `<Relationship Id="rId${this.nextRelId(current)}" Type="${type}" Target="${target}"/></Relationships>`))
  }

  /** Ensure `word/_rels/document.xml.rels` has a relationship of `type` for `target`. */
  ensureDocRel(type: string, target: string): string {
    const name = 'word/_rels/document.xml.rels'
    const current = this.text(name) ?? `${XML_DECL}<Relationships xmlns="${REL_NS}"></Relationships>`
    const byTarget = new RegExp(`<Relationship\\b[^>]*Target="${reEsc(target)}"[^>]*/>`, 'u').exec(current)
    if (byTarget !== null) {
      const id = /Id="([^"]+)"/u.exec(byTarget[0])
      if (id !== null) return id[1]
    }
    const id = `rId${this.nextRelId(current)}`
    this.put(name, current.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`))
    return id
  }

  private nextRelId(relsXml: string): number {
    let max = 0
    for (const m of relsXml.matchAll(/Id="rId(\d+)"/gu)) max = Math.max(max, Number(m[1]))
    return max + 1
  }
}

/**
 * Load an existing .docx, apply the ordered operations, and serialize back.
 * @param bytes - raw .docx bytes.
 * @param ops - operations applied in order; a failed op aborts with its 1-based index.
 * @param options - host hooks (`readFile` for image insertion).
 * @returns the rewritten bytes, applied-operation lines and the post-edit paragraph texts.
 */
export async function editDocx(bytes: Uint8Array, ops: DocxOp[], options: EditDocxOptions = {}): Promise<DocxEditResult> {
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(bytes)
  } catch (error) {
    throw new Error(`无法解包该 docx 文件（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (unzipped['word/document.xml'] === undefined) throw new Error('该文件不是有效的 docx（缺少 word/document.xml）')
  const pkg = new DocxPackage(unzipped)
  let xml = pkg.text('word/document.xml') as string
  const applied: string[] = []
  let updateFields = false
  let docPrId = 0

  /** Read the body-level sectPr, creating a default one when the document has none. */
  const requireSectPr = (): { start: number; innerStart: number; innerEnd: number; inner: string } => {
    const sect = findBodySectPr(xml)
    if (sect !== null) return sect
    const bodyEnd = xml.lastIndexOf('</w:body>')
    if (bodyEnd < 0) throw new Error('document.xml 中找不到 </w:body>')
    const { pgSz, pgMar } = resolvePage(undefined)
    xml = `${xml.slice(0, bodyEnd)}<w:sectPr>${pgSz}${pgMar}</w:sectPr>${xml.slice(bodyEnd)}`
    const innerStart = bodyEnd + '<w:sectPr>'.length
    return { start: bodyEnd, innerStart, innerEnd: innerStart, inner: '' }
  }

  /** Ensure a header/footer part exists and is referenced by the body section. */
  const ensureHeaderFooter = (kind: 'header' | 'footer', paragraphs: string): string => {
    const existing = pkg.names().filter((name) => new RegExp(`^word/${kind}\\d+\\.xml$`, 'u').test(name))
    const partName = existing.length > 0 ? existing[0] : `word/${kind}${nextPartIndex(pkg.files, kind)}.xml`
    pkg.put(partName, headerFooterXml(kind, paragraphs))
    pkg.ensureOverride(`/${partName}`, kind === 'header' ? CT.header : CT.footer)
    const relId = pkg.ensureDocRel(kind === 'header' ? REL_TYPE.header : REL_TYPE.footer, partName.slice('word/'.length))
    const sect = requireSectPr()
    const tag = kind === 'header' ? 'w:headerReference' : 'w:footerReference'
    if (!new RegExp(`<${tag}\\b`, 'u').test(sect.inner)) {
      const reference = `<${tag} w:type="default" r:id="${relId}"/>`
      xml = xml.slice(0, sect.innerStart) + reference + xml.slice(sect.innerStart)
    }
    return partName
  }

  for (const [opIndex, op] of ops.entries()) {
    const fail = (message: string): Error => new Error(`第 ${opIndex + 1} 个操作失败：${message}`)
    try {
      switch (op.op) {
        case 'set_paragraph': {
          const span = paraAt(scanParas(xml), op.index)
          let next = rewriteParagraphText(span.xml, String(op.text ?? ''))
          if (op.style !== undefined) next = withParagraphStyle(next, resolveStyleId(op.style))
          xml = xml.slice(0, span.start) + next + xml.slice(span.end)
          applied.push(`set_paragraph(第 ${op.index} 段)${op.style !== undefined ? `，样式 ${op.style}` : ''}`)
          break
        }
        case 'set_style': {
          const span = paraAt(scanParas(xml), op.index)
          const next = withParagraphStyle(span.xml, resolveStyleId(op.style))
          xml = xml.slice(0, span.start) + next + xml.slice(span.end)
          applied.push(`set_style(第 ${op.index} 段 → ${op.style})`)
          break
        }
        case 'insert_before': {
          const span = paraAt(scanParas(xml), op.index)
          // The new paragraph inherits the anchor's markup — inserting a naked run is what turned
          // a styled document into plain text one paragraph at a time.
          let fresh = rewriteParagraphText(span.xml, String(op.text ?? ''))
          if (op.style !== undefined) fresh = withParagraphStyle(fresh, resolveStyleId(op.style))
          xml = xml.slice(0, span.start) + fresh + xml.slice(span.start)
          applied.push(`insert_before(第 ${op.index} 段前)`)
          break
        }
        case 'insert_after': {
          const span = paraAt(scanParas(xml), op.index)
          let fresh = rewriteParagraphText(span.xml, String(op.text ?? ''))
          if (op.style !== undefined) fresh = withParagraphStyle(fresh, resolveStyleId(op.style))
          xml = xml.slice(0, span.end) + fresh + xml.slice(span.end)
          applied.push(`insert_after(第 ${op.index} 段后)`)
          break
        }
        case 'append_paragraph': {
          let fresh = paraXml(String(op.text ?? ''))
          if (op.style !== undefined) fresh = withParagraphStyle(fresh, resolveStyleId(op.style))
          const at = bodyAppendOffset(xml, scanParas(xml))
          xml = xml.slice(0, at) + fresh + xml.slice(at)
          applied.push('append_paragraph')
          break
        }
        case 'delete_paragraph': {
          const span = paraAt(scanParas(xml), op.index)
          const next = xml.slice(0, span.start) + xml.slice(span.end)
          // A table cell must contain at least one paragraph — refuse to empty one out.
          if (/<w:tc(?:\s[^>]*)>(?:(?!<w:p[ />])[\s\S])*?<\/w:tc>/u.test(next)) {
            throw fail(`第 ${op.index} 段是所在表格单元格的最后一段，不能删除（可改用 set_paragraph 清空文字）`)
          }
          xml = next
          applied.push(`delete_paragraph(第 ${op.index} 段)`)
          break
        }
        case 'replace_text': {
          if (typeof op.old !== 'string' || op.old === '') throw fail('replace_text 的 old 不能为空')
          const paras = scanParas(xml)
          const hits: number[] = []
          let replacements = 0
          let next = xml
          // Splice back-to-front so the offsets of the paragraphs still to process stay valid.
          for (let i = paras.length - 1; i >= 0; i--) {
            const span = paras[i]
            const result = replaceInParagraph(span.xml, op.old, String(op.new ?? ''))
            if (result.count === 0) continue
            hits.push(i + 1)
            replacements += result.count
            next = next.slice(0, span.start) + result.xml + next.slice(span.end)
          }
          if (hits.length === 0) throw fail(`未找到文本："${op.old}"（可先用 office_find 确认措辞）`)
          xml = next
          applied.push(`replace_text("${op.old}" → "${op.new ?? ''}"，命中第 ${hits.reverse().join('、')} 段，共 ${replacements} 处)`)
          break
        }
        case 'insert_image': {
          if (options.readFile === undefined) throw fail('当前环境不支持 insert_image（缺少文件读取能力）')
          const path = String(op.path ?? '').trim()
          if (path === '') throw fail('insert_image 的 path 不能为空')
          const alt = String(op.alt ?? '').trim()
          if (alt === '') throw fail('insert_image 需要 alt（图片替代文本，供无障碍与全文检索使用）')
          if (!Number.isInteger(op.index) || op.index < 1) throw fail('insert_image 的 index 必须是正整数（1-based 段落号）')
          const imageBytes = await options.readFile(path)
          const kind = imageKind(imageBytes)
          const natural = imagePixelSize(imageBytes)
          const cx = Math.max(1, Math.trunc(op.width_emu ?? natural.width * EMU_PER_PX))
          const cy = Math.max(1, Math.trunc(op.height_emu ?? natural.height * EMU_PER_PX))
          const fileName = `image${nextMediaIndex(pkg.files)}.${kind.ext}`
          pkg.putBytes(`word/media/${fileName}`, imageBytes)
          pkg.ensureDefault(kind.ext, kind.contentType)
          const relId = pkg.ensureDocRel(REL_TYPE.image, `media/${fileName}`)
          // Always appended as its own top-level paragraph. Anchoring it "at paragraph N" would
          // silently mean "inside table cell N" when that paragraph lives in a table, and an
          // inline drawing as the only child of a cell is a repair prompt waiting to happen.
          const at = bodyAppendOffset(xml, scanParas(xml))
          const paragraph = `<w:p>${imageRunXml(relId, ++docPrId, fileName, alt, cx, cy)}</w:p>`
          xml = xml.slice(0, at) + paragraph + xml.slice(at)
          applied.push(`insert_image(追加到正文末尾 ${fileName}，替代文本"${alt}"，${natural.width}×${natural.height} px；第 ${op.index} 段为位置参考)`)
          break
        }
        case 'insert_figure': {
          if (options.readFile === undefined) throw fail('当前环境不支持 insert_figure（缺少文件读取能力）')
          const path = String(op.path ?? '').trim()
          if (path === '') throw fail('insert_figure 的 path 不能为空')
          const alt = String(op.alt ?? '').trim()
          if (alt === '') throw fail('insert_figure 需要 alt（图片替代文本，供无障碍与全文检索使用）')
          const imageBytes = await options.readFile(path)
          const kind = imageKind(imageBytes)
          const natural = imagePixelSize(imageBytes)
          const cx = Math.max(1, Math.trunc(op.width_emu ?? natural.width * EMU_PER_PX))
          const cy = Math.max(1, Math.round(cx * (natural.height / Math.max(1, natural.width))))
          const fileName = `image${nextMediaIndex(pkg.files)}.${kind.ext}`
          pkg.putBytes(`word/media/${fileName}`, imageBytes)
          pkg.ensureDefault(kind.ext, kind.contentType)
          const relId = pkg.ensureDocRel(REL_TYPE.image, `media/${fileName}`)
          const figure = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${imageRunXml(relId, ++docPrId, fileName, alt, cx, cy)}</w:p>`
          const caption = op.caption === undefined || op.caption.trim() === ''
            ? ''
            : paraXml(op.caption.trim(), '<w:pStyle w:val="Caption"/>')
          const paragraphs = op.caption_position === 'below' ? `${figure}${caption}` : `${caption}${figure}`
          const at = bodyAppendOffset(xml, scanParas(xml))
          xml = xml.slice(0, at) + paragraphs + xml.slice(at)
          applied.push(`insert_figure(追加 ${fileName}，替代文本"${alt}"${caption === '' ? '，无题注' : `，题注"${op.caption?.trim()}"在${op.caption_position === 'below' ? '下' : '上'}方`})`)
          break
        }
        case 'insert_table': {
          if (!Array.isArray(op.rows) || op.rows.length === 0) throw fail('insert_table 的 rows 必须是非空二维数组')
          const table = tableXml(op.rows, op.header === true)
          const caption = op.caption === undefined || op.caption.trim() === ''
            ? ''
            : paraXml(op.caption.trim(), '<w:pStyle w:val="Caption"/>')
          const at = bodyAppendOffset(xml, scanParas(xml))
          xml = xml.slice(0, at) + table + caption + xml.slice(at)
          applied.push(`insert_table(${op.rows.length} 行 × ${Math.max(1, op.rows.reduce((max, row) => Math.max(max, row.length), 0))} 列${caption === '' ? '' : `，表题"${op.caption?.trim()}"`})`)
          break
        }
        case 'fill_placeholders': {
          if (op.values === null || typeof op.values !== 'object' || Array.isArray(op.values)) throw fail('fill_placeholders 的 values 必须是对象（占位符名 → 文本）')
          const keys = Object.keys(op.values)
          if (keys.length === 0) throw fail('fill_placeholders 的 values 不能为空')
          const targets = pkg.names().filter((name) => name === 'word/document.xml' || /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/u.test(name))
          const filled = new Map<string, number>()
          for (const name of targets) {
            let partText = name === 'word/document.xml' ? xml : (pkg.text(name) as string)
            const spans = scanParas(partText)
            let changed = false
            // Back-to-front so earlier spans keep their offsets.
            for (let i = spans.length - 1; i >= 0; i--) {
              let paragraph = spans[i].xml
              let paragraphChanged = false
              for (const key of keys) {
                for (const token of [`{{${key}}}`, `{${key}}`]) {
                  const result = replaceInParagraph(paragraph, token, String(op.values[key] ?? ''))
                  if (result.count === 0) continue
                  paragraph = result.xml
                  paragraphChanged = true
                  filled.set(key, (filled.get(key) ?? 0) + result.count)
                }
              }
              if (!paragraphChanged) continue
              partText = partText.slice(0, spans[i].start) + paragraph + partText.slice(spans[i].end)
              changed = true
            }
            if (!changed) continue
            if (name === 'word/document.xml') xml = partText
            else pkg.put(name, partText)
          }
          const missing = keys.filter((key) => !filled.has(key))
          const summary = [...filled.entries()].map(([key, n]) => `${key}×${n}`).join('、')
          applied.push(`fill_placeholders(填充 ${filled.size} 个占位符${summary === '' ? '' : `：${summary}`}${missing.length > 0 ? `；文档中未找到：${missing.join('、')}` : ''})`)
          break
        }
        case 'set_page_setup': {
          const sect = findBodySectPr(xml)
          if (sect === null) throw fail('该文档没有分节属性（w:sectPr），无法设置页面')
          const { pgSz, pgMar } = resolvePage(op.page)
          let inner = sect.inner
          inner = /<w:pgSz\b[^>]*\/>/u.test(inner) ? inner.replace(/<w:pgSz\b[^>]*\/>/u, pgSz) : pgSz + inner
          inner = /<w:pgMar\b[^>]*\/>/u.test(inner) ? inner.replace(/<w:pgMar\b[^>]*\/>/u, pgMar) : inner + pgMar
          xml = xml.slice(0, sect.innerStart) + inner + xml.slice(sect.innerEnd)
          const margins = op.page?.margins
          applied.push(`set_page_setup(${op.page?.size ?? 'A4'} ${op.page?.orientation ?? 'portrait'}，页边距 ${typeof margins === 'object' && margins !== null ? JSON.stringify(margins) : (margins ?? 'normal')})`)
          break
        }
        case 'set_metadata': {
          const meta = op.metadata ?? {}
          const existing = pkg.text('docProps/core.xml')
          pkg.put('docProps/core.xml', existing === null ? coreXml(meta) : mergeCoreProps(existing, meta))
          pkg.ensureOverride('/docProps/core.xml', CT.core)
          pkg.ensureRootRel(REL_TYPE.coreProps, 'docProps/core.xml')
          const changed = Object.entries(meta).filter(([, value]) => value !== undefined && value !== '')
          applied.push(`set_metadata(${changed.map(([key, value]) => `${key}=${String(value)}`).join('、') || '无变更'})`)
          break
        }
        case 'insert_toc': {
          const title = op.title ?? '目录'
          const paragraphs = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${esc(title)}</w:t></w:r></w:p>`
            + `<w:p>${fieldXml(' TOC \\o "1-3" \\h \\z \\u ', '请在 Word 中更新此域以生成目录', true)}</w:p>`
          const at = bodyAppendOffset(xml, scanParas(xml))
          xml = xml.slice(0, at) + paragraphs + xml.slice(at)
          updateFields = true
          applied.push(`insert_toc("${title}"；已置 w:updateFields，Word 打开时自动更新)`)
          break
        }
        case 'insert_page_number_footer': {
          const prefix = String(op.text ?? '')
          if (prefix === '') throw fail('insert_page_number_footer 的 text 不能为空（例如"第 "）')
          const seed = `<w:r><w:t xml:space="preserve">${esc(prefix)}</w:t></w:r>${fieldXml(' PAGE ', '1')}<w:r><w:t xml:space="preserve"> 页</w:t></w:r>`
          const partName = ensureHeaderFooter('footer', `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${seed}</w:p>`)
          applied.push(`insert_page_number_footer(${partName}，PAGE 域居中共)`)
          break
        }
        case 'insert_header': {
          const text = String(op.text ?? '')
          if (text === '') throw fail('insert_header 的 text 不能为空')
          const partName = ensureHeaderFooter('header', `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`)
          applied.push(`insert_header(${partName}："${text}")`)
          break
        }
        case 'add_comment': {
          const text = String(op.text ?? '')
          if (text.trim() === '') throw fail('add_comment 的 text 不能为空')
          const span = paraAt(scanParas(xml), op.index)
          const existing = pkg.text('word/comments.xml')
          const id = nextCommentId(existing)
          const author = op.author === undefined || String(op.author).trim() === '' ? 'DSH' : String(op.author).trim()
          const initials = op.initials === undefined || String(op.initials).trim() === '' ? author.slice(0, 3) : String(op.initials).trim()
          const annotated = annotateParagraph(span.xml, id, op.anchor === undefined || op.anchor.trim() === '' ? undefined : String(op.anchor))
          xml = xml.slice(0, span.start) + annotated + xml.slice(span.end)
          pkg.put('word/comments.xml', withComment(existing, id, text, author, initials, w3cdtf()))
          pkg.ensureOverride('/word/comments.xml', CT.comments)
          pkg.ensureDocRel(REL_TYPE.comments, 'comments.xml')
          const styles = pkg.text('word/styles.xml')
          if (styles !== null) {
            const next = ensureCommentStyles(styles)
            if (next !== styles) pkg.put('word/styles.xml', next)
          }
          applied.push(`add_comment(第 ${op.index} 段${op.anchor === undefined || op.anchor.trim() === '' ? '整段' : `锚点"${op.anchor}"`}，作者「${author}」，批注 #${id})`)
          break
        }
        case 'accept_revisions': {
          let parts = 0
          let revisions = 0
          for (const name of pkg.names()) {
            if (!/\.xml$/u.test(name) || name.startsWith('docProps/')) continue
            const text = name === 'word/document.xml' ? xml : (pkg.text(name) as string)
            const result = acceptRevisionsInPart(text)
            if (result.count === 0) continue
            revisions += result.count
            parts++
            if (name === 'word/document.xml') xml = result.xml
            else pkg.put(name, result.xml)
          }
          if (revisions === 0) throw fail('该文档没有修订痕迹（w:ins/w:del/*PrChange）')
          applied.push(`accept_revisions(处理 ${revisions} 处修订，覆盖 ${parts} 个部件)`)
          break
        }
        default:
          throw fail(`未知操作：${JSON.stringify(op)}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`第 ${opIndex + 1} 个操作失败`)) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`第 ${opIndex + 1} 个操作失败：${message}`)
    }
  }

  if (updateFields) {
    const settings = pkg.text('word/settings.xml')
    if (settings === null) {
      pkg.put('word/settings.xml', settingsXml(true))
      pkg.ensureOverride('/word/settings.xml', CT.settings)
      pkg.ensureDocRel(REL_TYPE.settings, 'settings.xml')
    } else if (!/w:updateFields/u.test(settings)) {
      pkg.put('word/settings.xml', settings.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>'))
    }
  }

  pkg.put('word/document.xml', xml)
  const finalParas = scanParas(xml)
  return {
    bytes: packOoxml(pkg.files, options.mtime === 'source' ? { mtime: 'source' } : {}),
    applied,
    paragraphs: finalParas.map((span) => span.text),
    emptyParagraphs: finalParas.map((span, i) => (span.empty ? i + 1 : 0)).filter((n) => n > 0),
  }
}

/**
 * Accept every tracked revision in one XML part without Word: unwrap `w:ins`/`w:moveTo`, drop
 * `w:del`/`w:moveFrom`/`*PrChange`, turn `w:delText` back into `w:t`, and merge the paragraph
 * mark a deletion removed.
 * @param xml - one XML part.
 * @returns the rewritten part plus the number of revision markers resolved.
 */
export function acceptRevisionsInPart(xml: string): { xml: string; count: number } {
  let out = xml
  let count = 0
  const bump = (): string => { count++; return '' }
  // Formatting changes: the recorded old formatting goes away, the accepted one stays.
  out = out.replace(/<w:(?:rPr|pPr|tblPr|trPr|tcPr|sectPr|numbering)Change(?:\s[^>]*)?>[\s\S]*?<\/w:(?:rPr|pPr|tblPr|trPr|tcPr|sectPr|numbering)Change>/gu, bump)
  out = out.replace(/<w:(?:rPr|pPr|tblPr|trPr|tcPr|sectPr|numbering)Change(?:\s[^>]*)?\/>/gu, bump)
  out = out.replace(/<w:(?:cellIns|cellDel|cellMerge)(?:\s[^>]*)?>[\s\S]*?<\/w:(?:cellIns|cellDel|cellMerge)>/gu, bump)
  out = out.replace(/<w:(?:moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd)\b[^>]*\/>/gu, bump)
  // Deleted content disappears.
  out = out.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/gu, bump)
  out = out.replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/gu, bump)
  // Insertions and move targets: keep the content, drop the wrapper.
  out = out.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/gu, (_, inner: string) => { count++; return inner })
  out = out.replace(/<w:moveTo\b[^>]*>([\s\S]*?)<\/w:moveTo>/gu, (_, inner: string) => { count++; return inner })
  out = out.replace(/<w:delText(\s[^>]*)?>/gu, () => { count++; return '<w:t>' })
  out = out.replace(/<\/w:delText>/gu, '</w:t>')
  // `w:del` inside `w:rPr` marks a deleted paragraph mark: that paragraph joins the next one, so
  // the now-empty trailing paragraph goes away.
  out = out.replace(/<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?<w:del\b[^>]*\/>[\s\S]*?<\/w:p>/gu, bump)
  return { xml: out, count }
}

// ---------- verification ----------

/** A structural report over a candidate .docx. */
export interface DocxAudit {
  /** Entry count in the zip container. */
  entryCount: number
  /** Paragraph count of `word/document.xml` (top-level, empty paragraphs included). */
  paragraphCount: number
  /** 1-based indexes of empty paragraphs. */
  emptyParagraphs: number[]
  /** Package parts present, for the caller's summary. */
  parts: string[]
}

/**
 * Verify candidate .docx bytes with checks that do **not** reuse the editor's own scanner:
 * a zip pass (fflate validates every entry's CRC while inflating), the required package parts,
 * and a well-formedness walk over every `.xml`/`.rels` entry.
 *
 * The previous `verifyDocx` re-ran the very scanner that produced the bytes, so it reported OK
 * for the malformed XML `replace_text` used to emit (report D1/D5). None of these checks can.
 *
 * @param bytes - candidate .docx bytes.
 * @throws an Error describing the first structural problem found.
 */
export function verifyDocx(bytes: Uint8Array): DocxAudit {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new Error(`生成的 docx 不是有效的 zip 容器（${error instanceof Error ? error.message : String(error)}）`)
  }
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (files[required] === undefined) throw new Error(`生成的 docx 缺少必需部件：${required}`)
  }
  for (const [name, data] of Object.entries(files)) {
    if (name === '[Content_Types].xml' || !/\.(?:xml|rels)$/u.test(name)) continue
    assertWellFormedXml(strFromU8(data), name)
  }
  const documentXml = strFromU8(files['word/document.xml'])
  const paras = scanParas(documentXml)
  return {
    entryCount: Object.keys(files).length,
    paragraphCount: paras.length,
    emptyParagraphs: paras.map((span, i) => (span.empty ? i + 1 : 0)).filter((n) => n > 0),
    parts: Object.keys(files).sort(),
  }
}
