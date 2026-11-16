/**
 * .pptx engine: build a text-first deck from structured slides, and edit an existing deck with
 * slide-level operations (template fill, reorder, remove, duplicate/insert).
 *
 * **Slide identity is a part name, never a number.** PresentationML orders slides through
 * `ppt/presentation.xml`'s `<p:sldIdLst>`; `ppt/slides/slideN.xml` numbering is assigned at
 * creation and is *not* rewritten when slides are reordered. Every operation here therefore
 * addresses slides through the `sldIdLst` order, exactly as `dsh-office-reader` reads them, and
 * reorders by moving `<p:sldId>` entries rather than by renaming parts.
 *
 * Registered hard constraints (violating any of them makes PowerPoint offer to repair the file):
 * every new part needs a `[Content_Types].xml` Override; `<p:sldId>` ids are unique and ≥ 256;
 * `<a:t>` with leading or trailing space needs `xml:space="preserve"`; one bullet is one `<a:p>`;
 * font sizes are in hundredths of a point; a CJK run needs `a:latin`+`a:ea`+`a:cs` in schema order.
 *
 * @module dsh-office-editor/src/pptx
 */

import { strFromU8, strToU8, unzipSync } from 'fflate'
import { assertWellFormedXml } from './xml.js'
import { packOoxml, partsToMap, type MtimeSource } from './zip.js'

export { assertWellFormedXml } from './xml.js'

const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const REL_TYPE = {
  officeDocument: `${R_NS}/officeDocument`,
  slide: `${R_NS}/slide`,
  slideLayout: `${R_NS}/slideLayout`,
  slideMaster: `${R_NS}/slideMaster`,
  notesSlide: `${R_NS}/notesSlide`,
  theme: `${R_NS}/theme`,
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  appProps: `${R_NS}/extended-properties`,
} as const

const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const

/** 16:9 slide size in EMU (13.333in × 7.5in). */
export const SLIDE_16_9 = { cx: 12192000, cy: 6858000 } as const
/** 4:3 slide size in EMU (10in × 7.5in). */
export const SLIDE_4_3 = { cx: 9144000, cy: 6858000 } as const

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

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

function reEsc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function w3cdtf(date = new Date()): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

/** A run's text with the `xml:space` attribute Word/PowerPoint needs for edge whitespace. */
function textNode(text: string): string {
  const preserve = /^\s|\s$/u.test(text) ? ' xml:space="preserve"' : ''
  return `<a:t${preserve}>${esc(text)}</a:t>`
}

/** Run properties. `a:latin`, `a:ea` and `a:cs` must appear in that order for CJK to render. */
function runProps(sizePt: number | undefined, opts: { bold?: boolean; italic?: boolean; color?: string } = {}): string {
  const parts = ['<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>']
  if (opts.bold === true) parts.push('<a:b val="1"/>')
  if (opts.italic === true) parts.push('<a:i val="1"/>')
  if (sizePt !== undefined) parts.push(`<a:sz val="${Math.round(sizePt * 100)}"/>`)
  if (opts.color !== undefined) parts.push(`<a:solidFill><a:srgbClr val="${opts.color}"/></a:solidFill>`)
  return `<a:rPr lang="zh-CN" altLang="en-US">${parts.join('')}</a:rPr>`
}

/** One paragraph (bullet) of a text body. */
interface ParaSpec {
  text: string
  /** 0-8; each level indents further. */
  level?: number
  size?: number
  bold?: boolean
  /** `none` renders a plain line rather than a bullet. */
  bullet?: 'none' | 'char'
}

function paragraphXml(para: ParaSpec): string {
  const level = Math.max(0, Math.min(8, Math.trunc(para.level ?? 0)))
  const pPr = `<a:pPr lvl="${level}">${para.bullet === 'none' ? '<a:buNone/>' : '<a:buChar char="•"/>'}</a:pPr>`
  return `<a:p>${pPr}<a:r>${runProps(para.size, { bold: para.bold })}${textNode(para.text)}</a:r></a:p>`
}

/** A placeholder-carrying shape (`p:sp`) with a text body. */
function shapeXml(options: {
  id: number
  name: string
  placeholder?: string
  x: number
  y: number
  cx: number
  cy: number
  paras: ParaSpec[]
  align?: 'l' | 'ctr'
}): string {
  const ph = options.placeholder === undefined ? '' : `<p:ph type="${options.placeholder}"/>`
  const anchor = options.align === 'ctr' ? 'ctr' : 't'
  const algn = options.align === 'ctr' ? 'ctr' : 'l'
  return [
    '<p:sp><p:nvSpPr>',
    `<p:cNvPr id="${options.id}" name="${esc(options.name)}"/>`,
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${options.x}" y="${options.y}"/><a:ext cx="${options.cx}" cy="${options.cy}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>',
    `<p:txBody><a:bodyPr anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>`,
    options.paras.map((para) => paragraphXml({ ...para, ...(options.align === 'ctr' && para.bullet === undefined ? { bullet: 'none' as const } : {}) })).map((xml, i) => (i === 0 && options.align === 'ctr' ? xml.replace('<a:pPr lvl="0">', '<a:pPr lvl="0" algn="ctr">') : xml)).join(''),
    `</p:txBody></p:sp>`,
  ].join('')
}

/** The slide's shape tree: title (+ optional body). */
function slideXml(options: { title: string; bullets: ParaSpec[]; layout: 'title' | 'titleContent' | 'section' | 'blank' }): string {
  const size = SLIDE_16_9
  const shapes: string[] = []
  if (options.layout !== 'blank') {
    const section = options.layout === 'section'
    shapes.push(shapeXml({
      id: 2,
      name: 'Title',
      placeholder: 'title',
      x: Math.round(size.cx * 0.08),
      y: Math.round(size.cy * (section ? 0.42 : 0.07)),
      cx: Math.round(size.cx * 0.84),
      cy: Math.round(size.cy * 0.16),
      align: section ? 'ctr' : 'l',
      paras: [{ text: options.title, size: section ? 40 : 30, bold: true }],
    }))
  }
  if (options.layout === 'titleContent' && options.bullets.length > 0) {
    shapes.push(shapeXml({
      id: 3,
      name: 'Content',
      placeholder: 'body',
      x: Math.round(size.cx * 0.08),
      y: Math.round(size.cy * 0.28),
      cx: Math.round(size.cx * 0.84),
      cy: Math.round(size.cy * 0.62),
      paras: options.bullets.map((para) => ({ size: 20, ...para })),
    }))
  }
  return `${XML_DECL}<p:sld xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><p:cSld><p:spTree>`
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + shapes.join('')
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
}

/** A slide layout: inherits the master and declares its own placeholder set. */
function layoutXml(options: { name: string; type: string; title: boolean; body: boolean; section: boolean }): string {
  const size = SLIDE_16_9
  const shapes: string[] = []
  if (options.title) {
    shapes.push(shapeXml({
      id: 2,
      name: 'Title Placeholder',
      placeholder: 'title',
      x: Math.round(size.cx * 0.08),
      y: Math.round(size.cy * (options.section ? 0.42 : 0.07)),
      cx: Math.round(size.cx * 0.84),
      cy: Math.round(size.cy * 0.16),
      align: options.section ? 'ctr' : 'l',
      paras: [],
    }))
  }
  if (options.body) {
    shapes.push(shapeXml({
      id: 3,
      name: 'Content Placeholder',
      placeholder: 'body',
      x: Math.round(size.cx * 0.08),
      y: Math.round(size.cy * 0.28),
      cx: Math.round(size.cx * 0.84),
      cy: Math.round(size.cy * 0.62),
      paras: [],
    }))
  }
  return `${XML_DECL}<p:sldLayout xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}" type="${options.type}" preserve="1">`
    + `<p:cSld name="${esc(options.name)}"><p:spTree>`
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + shapes.join('')
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
}

/** The slide master: colour map, theme reference, layout list and text styles. */
function masterXml(layoutRids: Array<{ id: string }>): string {
  const layoutIds = layoutRids.map((entry, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="${entry.id}"/>`).join('')
  const titleStyle = '<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3000" b="1"><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
  const bodyStyle = '<p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2000"><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:bodyStyle>'
  return `${XML_DECL}<p:sldMaster xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">`
    + '<p:cSld><p:spTree>'
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld>'
    + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
    + `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>`
    + `<p:txStyles>${titleStyle}${bodyStyle}<p:otherStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:otherStyle></p:txStyles>`
    + '</p:sldMaster>'
}

/** A minimal Office theme: colour scheme, font scheme (CJK-aware) and format scheme. */
function themeXml(): string {
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const line = '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
  const effect = '<a:effectLst/>'
  const fillStyle = (i: number): string => `<a:fillStyleLst>${i === 0 ? fill : fill.repeat(3)}</a:fillStyleLst>`
  const lineStyle = `<a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst>`
  const effectStyle = `<a:effectStyleLst>${`<a:effectStyle>${effect}</a:effectStyle>`.repeat(3)}</a:effectStyleLst>`
  const bgFillStyle = `<a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst>`
  return `${XML_DECL}<a:theme xmlns:a="${A_NS}" name="DSH Office Theme"><a:themeElements>`
    + '<a:clrScheme name="Office">'
    + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
    + '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>'
    + '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>'
    + '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>'
    + '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>'
    + '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>'
    + '</a:clrScheme>'
    + '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="等线 Light"/><a:cs typeface=""/></a:majorFont>'
    + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="等线"/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    + `<a:fmtScheme name="Office">${fillStyle(0)}${lineStyle}${effectStyle}${bgFillStyle}</a:fmtScheme>`
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
}

function relsXml(entries: Array<{ id: string; type: string; target: string }>): string {
  return `${XML_DECL}<Relationships xmlns="${REL_NS}">${entries.map((e) => `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`).join('')}</Relationships>`
}

function coreXml(meta: PptxMetadata): string {
  const now = w3cdtf()
  const tag = (name: string, value: string | undefined): string => (value === undefined || value === '' ? '' : `<${name}>${esc(value)}</${name}>`)
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + tag('dc:title', meta.title) + tag('dc:subject', meta.subject) + tag('dc:creator', meta.creator) + tag('dc:description', meta.description)
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}

function appXml(slideCount: number, titles: string[]): string {
  return `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + '<Application>DSH office-editor</Application><PresentationFormat>宽屏</PresentationFormat>'
    + `<Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips>`
    + '<ScaleCrop>false</ScaleCrop><Company/><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>'
    + (titles.length === 0 ? '' : `<TitlesOfParts><vt:vector size="${titles.length}" baseType="lpstr">${titles.map((t) => `<vt:lpstr>${esc(t)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>`)
    + '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>幻灯片标题</vt:lpstr></vt:variant><vt:variant><vt:i4>'
    + String(titles.length)
    + '</vt:i4></vt:variant></vt:vector></HeadingPairs></Properties>'
}

/** Presentation metadata written to docProps/core.xml. */
export interface PptxMetadata {
  title?: string
  subject?: string
  creator?: string
  description?: string
}

/** One slide for deck creation. */
export interface SlideSpec {
  /** Slide title (omitted for a `blank` slide). */
  title?: string
  /** Bullet lines; `level` indents, `bullet: 'none'` renders a plain line. */
  bullets?: Array<string | ParaSpec>
  /** Which built-in layout to use (default `titleContent`, or `title` when no bullets). */
  layout?: 'title' | 'titleContent' | 'section' | 'blank'
  /** Speaker notes. */
  notes?: string
}

/** Layout part names in the order the master lists them. */
const LAYOUTS = [
  { part: 'slideLayout1.xml', name: '标题幻灯片', type: 'title', title: true, body: false, section: false, spec: 'title' },
  { part: 'slideLayout2.xml', name: '标题和内容', type: 'obj', title: true, body: true, section: false, spec: 'titleContent' },
  { part: 'slideLayout3.xml', name: '节标题', type: 'secHead', title: true, body: false, section: true, spec: 'section' },
  { part: 'slideLayout4.xml', name: '空白', type: 'blank', title: false, body: false, section: false, spec: 'blank' },
] as const

function layoutFor(spec: SlideSpec): (typeof LAYOUTS)[number] {
  const requested = spec.layout ?? ((spec.bullets ?? []).length > 0 ? 'titleContent' : 'title')
  return LAYOUTS.find((entry) => entry.spec === requested) ?? LAYOUTS[1]
}

function notesXml(text: string): string {
  return `${XML_DECL}<p:notes xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><p:cSld><p:spTree>`
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:lstStyle/>${text.split('\n').map((line) => paragraphXml({ text: line, bullet: 'none', size: 12 })).join('')}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>'
}

/** Normalize a bullet entry into a {@link ParaSpec}. */
function toPara(entry: string | ParaSpec): ParaSpec {
  return typeof entry === 'string' ? { text: entry } : entry
}

/**
 * Build a text-first .pptx from structured slides.
 *
 * The deck uses four built-in layouts (title / title+content / section / blank) rather than
 * positioning every shape by hand, which is the rule this project's authoring guidance states and
 * what keeps the output editable in PowerPoint's layout view.
 *
 * @param slides - slide specifications in presentation order.
 * @param options - metadata, slide geometry and the entry timestamp policy.
 * @returns the .pptx bytes.
 */
export function createPptx(slides: SlideSpec[], options: { metadata?: PptxMetadata; size?: '16:9' | '4:3'; mtime?: MtimeSource } = {}): Uint8Array {
  if (!Array.isArray(slides) || slides.length === 0) throw new Error('slides 不能为空：至少需要一页幻灯片')
  const size = options.size === '4:3' ? SLIDE_4_3 : SLIDE_16_9
  const files: Record<string, Uint8Array> = {}

  const layoutRids = LAYOUTS.map((_, i) => ({ id: `rIdLayout${i + 1}` }))
  const slideEntries = slides.map((spec, i) => ({
    spec,
    part: `ppt/slides/slide${i + 1}.xml`,
    rid: `rIdSlide${i + 1}`,
    layoutRid: `rIdLayoutRef${i + 1}`,
    layout: layoutFor(spec),
    notesPart: spec.notes === undefined || spec.notes.trim() === '' ? undefined : `ppt/notesSlides/notesSlide${i + 1}.xml`,
    notesRid: `rIdNotes${i + 1}`,
  }))

  for (const entry of slideEntries) {
    files[entry.part] = strToU8(slideXml({
      title: entry.spec.title ?? '',
      bullets: (entry.spec.bullets ?? []).map(toPara),
      layout: entry.layout.spec,
    }))
    const rels: Array<{ id: string; type: string; target: string }> = [
      { id: 'rId1', type: REL_TYPE.slideLayout, target: `../slideLayouts/${entry.layout.part}` },
    ]
    if (entry.notesPart !== undefined) {
      files[entry.notesPart] = strToU8(notesXml(entry.spec.notes as string))
      rels.push({ id: entry.notesRid, type: REL_TYPE.notesSlide, target: `../notesSlides/${entry.notesPart.slice('ppt/notesSlides/'.length)}` })
      files[`ppt/notesSlides/_rels/${entry.notesPart.slice('ppt/notesSlides/'.length)}.rels`] = strToU8(relsXml([
        { id: 'rId1', type: REL_TYPE.slide, target: `../slides/${entry.part.slice('ppt/slides/'.length)}` },
      ]))
    }
    files[`ppt/slides/_rels/${entry.part.slice('ppt/slides/'.length)}.rels`] = strToU8(relsXml(rels))
  }

  for (const [i, layout] of LAYOUTS.entries()) {
    files[`ppt/slideLayouts/${layout.part}`] = strToU8(layoutXml({ name: layout.name, type: layout.type, title: layout.title, body: layout.body, section: layout.section }))
    files[`ppt/slideLayouts/_rels/${layout.part}.rels`] = strToU8(relsXml([{ id: 'rId1', type: REL_TYPE.slideMaster, target: '../slideMasters/slideMaster1.xml' }]))
    void layoutRids[i]
  }

  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(masterXml(layoutRids))
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(relsXml([
    ...layoutRids.map((entry, i) => ({ id: entry.id, type: REL_TYPE.slideLayout, target: `../slideLayouts/${LAYOUTS[i].part}` })),
    { id: 'rIdTheme', type: REL_TYPE.theme, target: '../theme/theme1.xml' },
  ]))
  files['ppt/theme/theme1.xml'] = strToU8(themeXml())

  files['ppt/presentation.xml'] = strToU8(`${XML_DECL}<p:presentation xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}" saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>'
    + `<p:sldIdLst>${slideEntries.map((entry, i) => `<p:sldId id="${256 + i}" r:id="${entry.rid}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="6858000" cy="9144000"/>`
    + '<p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle></p:presentation>')
  files['ppt/_rels/presentation.xml.rels'] = strToU8(relsXml([
    { id: 'rIdMaster', type: REL_TYPE.slideMaster, target: 'slideMasters/slideMaster1.xml' },
    ...slideEntries.map((entry) => ({ id: entry.rid, type: REL_TYPE.slide, target: `slides/${entry.part.slice('ppt/slides/'.length)}` })),
  ]))

  files['_rels/.rels'] = strToU8(relsXml([
    { id: 'rId1', type: REL_TYPE.officeDocument, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: REL_TYPE.coreProps, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL_TYPE.appProps, target: 'docProps/app.xml' },
  ]))
  files['docProps/core.xml'] = strToU8(coreXml(options.metadata ?? {}))
  files['docProps/app.xml'] = strToU8(appXml(slides.length, slides.map((s) => s.title ?? '')))

  files['[Content_Types].xml'] = strToU8([
    XML_DECL,
    `<Types xmlns="${CT_NS}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT.presentation}"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT.slideMaster}"/>`,
    ...LAYOUTS.map((layout) => `<Override PartName="/ppt/slideLayouts/${layout.part}" ContentType="${CT.slideLayout}"/>`),
    ...slideEntries.map((entry) => `<Override PartName="/${entry.part}" ContentType="${CT.slide}"/>`),
    ...slideEntries.filter((entry) => entry.notesPart !== undefined).map((entry) => `<Override PartName="/${entry.notesPart}" ContentType="${CT.notesSlide}"/>`),
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT.theme}"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="${CT.core}"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="${CT.app}"/>`,
    '</Types>',
  ].join(''))

  return packOoxml(partsToMap(files), options.mtime === 'source' ? { mtime: 'source' } : {})
}

// ---------- existing-deck editing ----------

/** One slide as addressed by an edit operation. */
export interface PptxSlideRef {
  /** 1-based position in presentation order (`sldIdLst`). */
  index: number
  /** Slide part name, e.g. `ppt/slides/slide3.xml`. */
  part: string
  /** `p:sldId/@id` value. */
  sldId: number
  /** Relationship id in `ppt/_rels/presentation.xml.rels`. */
  rid: string
  /** Title text, for operation summaries. */
  title: string
}

/** Ordered operations supported on an existing deck. */
export type PptxOp =
  | { op: 'fill_placeholders'; values: Record<string, string> }
  | { op: 'reorder_slides'; order: number[] }
  | { op: 'remove_slide'; index: number }
  | { op: 'duplicate_slide'; index: number; position?: number }
  | { op: 'set_notes'; index: number; notes: string }

/** Result of applying operations to a deck. */
export interface PptxEditResult {
  /** Serialized .pptx bytes. */
  bytes: Uint8Array
  /** One human-readable line per applied operation. */
  applied: string[]
  /** Slide titles after the edit, in presentation order. */
  slides: string[]
}

/** Host hooks for {@link editPptx}. */
export interface EditPptxOptions {
  /** Accepted for interface symmetry with the docx engine; pptx editing needs no file reads. */
  readFile?: (absolute: string) => Promise<Uint8Array>
  /** Entry timestamp policy; `fixed` (default) keeps the archive byte-reproducible. */
  mtime?: MtimeSource
}

const SLIDE_PART_RE = /^ppt\/slides\/slide\d+\.xml$/u
const NOTES_PART_RE = /^ppt\/notesSlides\/notesSlide\d+\.xml$/u

/** Parse `key="value"` pairs out of one XML open tag. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/gu)) out[m[1]] = m[2]
  return out
}

/** Read the relationship map of one rels part. */
function parseRels(xml: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>()
  for (const m of xml.matchAll(/<Relationship\b[^>]*\/>/gu)) {
    const a = attrs(m[0])
    if (a.Id !== undefined && a.Target !== undefined) out.set(a.Id, { type: a.Type ?? '', target: a.Target })
  }
  return out
}

/** Resolve a rels target against its owning part. */
function resolvePart(ownerPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const base = ownerPart.slice(0, ownerPart.lastIndexOf('/'))
  const out: string[] = []
  for (const segment of `${base}/${target}`.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

function relsPathFor(part: string): string {
  const slash = part.lastIndexOf('/')
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`
}

/**
 * Load an existing deck, apply the ordered operations, and serialize back.
 * @param bytes - raw .pptx bytes.
 * @param ops - operations applied in order; a failed op aborts with its 1-based index.
 * @param options - host hooks (unused by pptx; present for the shared editor interface).
 * @returns the rewritten bytes, applied-operation lines and the post-edit slide titles.
 */
export async function editPptx(bytes: Uint8Array, ops: PptxOp[], options: EditPptxOptions = {}): Promise<PptxEditResult> {
  void options
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new Error(`无法解包该 pptx 文件（${error instanceof Error ? error.message : String(error)}）`)
  }
  const pkg = {
    text: (name: string): string | null => (files[name] === undefined ? null : strFromU8(files[name])),
    put: (name: string, text: string): void => { files[name] = strToU8(text) },
  }
  if (pkg.text('ppt/presentation.xml') === null) throw new Error('该文件不是有效的 pptx（缺少 ppt/presentation.xml）')

  /** Read `ppt/presentation.xml`'s slide list in presentation order. */
  const listSlides = (): PptxSlideRef[] => {
    const presentation = pkg.text('ppt/presentation.xml') as string
    const rels = parseRels(pkg.text('ppt/_rels/presentation.xml.rels') ?? '')
    const out: PptxSlideRef[] = []
    for (const m of presentation.matchAll(/<p:sldId\b[^>]*\/>/gu)) {
      const a = attrs(m[0])
      const rid = a['r:id'] ?? ''
      const rel = rels.get(rid)
      if (rel === undefined) continue
      const part = resolvePart('ppt/presentation.xml', rel.target)
      if (!SLIDE_PART_RE.test(part) || pkg.text(part) === null) continue
      out.push({
        index: out.length + 1,
        part,
        sldId: Number(a.id ?? 0),
        rid,
        title: slideTitle(pkg.text(part) as string),
      })
    }
    return out
  }

  const applied: string[] = []
  let nextPartNumber = 1
  const freePartNumber = (): number => {
    while (pkg.text(`ppt/slides/slide${nextPartNumber}.xml`) !== null) nextPartNumber++
    return nextPartNumber
  }
  let nextSldId = 256
  const freeSldId = (slides: PptxSlideRef[]): number => {
    const used = new Set(slides.map((slide) => slide.sldId))
    while (used.has(nextSldId)) nextSldId++
    return nextSldId
  }
  const ensureOverride = (partName: string, contentType: string): void => {
    const current = pkg.text('[Content_Types].xml')
    if (current === null) throw new Error('该 pptx 缺少 [Content_Types].xml')
    if (current.includes(`PartName="/${partName}"`)) return
    pkg.put('[Content_Types].xml', current.replace('</Types>', `<Override PartName="/${partName}" ContentType="${contentType}"/></Types>`))
  }
  /** Drop a part with its rels and content-type Override. */
  const dropPart = (partName: string): void => {
    delete files[partName]
    delete files[relsPathFor(partName)]
    const current = pkg.text('[Content_Types].xml')
    if (current !== null) {
      pkg.put('[Content_Types].xml', current.replace(new RegExp(`<Override\\s+PartName="/${reEsc(partName)}"[^>]*/>`, 'u'), ''))
    }
  }
  /** Part names still reachable as a notes target from any slide part. */
  const referencedNotesParts = (): Set<string> => {
    const out = new Set<string>()
    for (const name of Object.keys(files)) {
      if (!SLIDE_PART_RE.test(name)) continue
      for (const [, rel] of parseRels(pkg.text(relsPathFor(name)) ?? '')) {
        if (/\/notesSlide$/u.test(rel.type)) out.add(resolvePart(name, rel.target))
      }
    }
    return out
  }

  for (const [opIndex, op] of ops.entries()) {
    const fail = (message: string): Error => new Error(`第 ${opIndex + 1} 个操作失败：${message}`)
    try {
      const slides = listSlides()
      switch (op.op) {
        case 'fill_placeholders': {
          if (op.values === null || typeof op.values !== 'object' || Array.isArray(op.values)) throw fail('fill_placeholders 的 values 必须是对象（占位符名 → 文本）')
          const keys = Object.keys(op.values)
          if (keys.length === 0) throw fail('fill_placeholders 的 values 不能为空')
          const filled = new Map<string, number>()
          let changedParts = 0
          // Notes and layouts can carry the same token (a footer or a template header line), so
          // every text-bearing part is scanned rather than only the slides.
          const targets = Object.keys(files).filter((name) => SLIDE_PART_RE.test(name) || NOTES_PART_RE.test(name))
          for (const name of targets) {
            let partText = pkg.text(name) as string
            let changed = false
            for (const key of keys) {
              for (const token of [`{{${key}}}`, `{${key}}`]) {
                const result = replaceAcrossRuns(partText, token, String(op.values[key] ?? ''))
                if (result.count === 0) continue
                partText = result.xml
                changed = true
                filled.set(key, (filled.get(key) ?? 0) + result.count)
              }
            }
            if (!changed) continue
            pkg.put(name, partText)
            changedParts++
          }
          const missing = keys.filter((key) => !filled.has(key))
          const summary = [...filled.entries()].map(([key, n]) => `${key}×${n}`).join('、')
          applied.push(`fill_placeholders(填充 ${filled.size} 个占位符${summary === '' ? '' : `：${summary}`}，覆盖 ${changedParts} 个部件${missing.length > 0 ? `；未找到：${missing.join('、')}` : ''})`)
          break
        }
        case 'reorder_slides': {
          if (!Array.isArray(op.order) || op.order.length !== slides.length) {
            throw fail(`reorder_slides 的 order 必须列出全部 ${slides.length} 页的当前序号（1-based），共 ${Array.isArray(op.order) ? op.order.length : 0} 个`)
          }
          const seen = new Set<number>()
          for (const index of op.order) {
            if (!Number.isInteger(index) || index < 1 || index > slides.length) throw fail(`order 含无效页码：${index}`)
            if (seen.has(index)) throw fail(`order 中页码重复：${index}`)
            seen.add(index)
          }
          const presentation = pkg.text('ppt/presentation.xml') as string
          const tags = [...presentation.matchAll(/<p:sldId\b[^>]*\/>/gu)].map((m) => m[0])
          const reordered = op.order.map((index) => tags[index - 1])
          const listRe = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/u
          const at = listRe.exec(presentation)
          if (at === null) throw fail('ppt/presentation.xml 里没有 <p:sldIdLst>，无法重排')
          // A replacer function, not a string: `$&`/`$1` in the inserted XML would otherwise be
          // interpreted by String.replace as a substitution pattern and corrupt the slide list.
          pkg.put('ppt/presentation.xml', presentation.slice(0, at.index) + `<p:sldIdLst>${reordered.join('')}</p:sldIdLst>` + presentation.slice(at.index + at[0].length))
          applied.push(`reorder_slides(新顺序：${op.order.join(' → ')})`)
          break
        }
        case 'remove_slide': {
          const target = slides[op.index - 1]
          if (target === undefined) throw fail(`幻灯片序号越界：${op.index}（当前共 ${slides.length} 页，取值 1-${slides.length}）`)
          const presentation = pkg.text('ppt/presentation.xml') as string
          const tag = [...presentation.matchAll(/<p:sldId\b[^>]*\/>/gu)].map((m) => m[0])[op.index - 1]
          pkg.put('ppt/presentation.xml', presentation.replace(tag, ''))
          // Drop the presentation relationship so no dangling rId survives.
          const relsPath = 'ppt/_rels/presentation.xml.rels'
          const rels = pkg.text(relsPath) ?? ''
          pkg.put(relsPath, rels.replace(new RegExp(`<Relationship\\b[^>]*Id="${reEsc(target.rid)}"[^>]*/>`, 'u'), ''))
          // Remove the part itself rather than leaving a ghost slide behind: first detach its notes
          // part (only when no remaining slide shares it), then the slide part, its rels and both
          // content-type Overrides.
          const notesRel = [...parseRels(pkg.text(relsPathFor(target.part)) ?? '').entries()].find(([, rel]) => /\/notesSlide$/u.test(rel.type))
          dropPart(target.part)
          if (notesRel !== undefined) {
            const notesPart = resolvePart(target.part, notesRel[1].target)
            if (!referencedNotesParts().has(notesPart)) dropPart(notesPart)
          }
          applied.push(`remove_slide(第 ${op.index} 页"${target.title}"，部件 ${target.part} 与关系、content-type 一并清理)`)
          break
        }
        case 'duplicate_slide': {
          const source = slides[op.index - 1]
          if (source === undefined) throw fail(`幻灯片序号越界：${op.index}（当前共 ${slides.length} 页，取值 1-${slides.length}）`)
          const position = op.position === undefined ? op.index : op.position
          if (!Number.isInteger(position) || position < 1 || position > slides.length + 1) {
            throw fail(`position 越界：${op.position}（取值 1-${slides.length + 1}）`)
          }
          const number = freePartNumber()
          const newPart = `ppt/slides/slide${number}.xml`
          pkg.put(newPart, pkg.text(source.part) as string)
          // A copied slide points at the same layout, and gets its *own* notes part: sharing one
          // notes part between two slides makes editing either one rewrite the other's script.
          const sourceRels = parseRels(pkg.text(relsPathFor(source.part)) ?? '')
          const newRels: Array<{ id: string; type: string; target: string }> = []
          const layoutRel = [...sourceRels.entries()].find(([, rel]) => /\/slideLayout$/u.test(rel.type))
          newRels.push({ id: 'rId1', type: REL_TYPE.slideLayout, target: layoutRel === undefined ? '../slideLayouts/slideLayout2.xml' : layoutRel[1].target })
          const notesRel = [...sourceRels.entries()].find(([, rel]) => /\/notesSlide$/u.test(rel.type))
          if (notesRel !== undefined) {
            const notesPart = resolvePart(source.part, notesRel[1].target)
            const notesNumber = freeNotesNumber(files, pkg)
            const newNotes = `ppt/notesSlides/notesSlide${notesNumber}.xml`
            pkg.put(newNotes, pkg.text(notesPart) as string)
            pkg.put(relsPathFor(newNotes), relsXml([{ id: 'rId1', type: REL_TYPE.slide, target: `../slides/slide${number}.xml` }]))
            ensureOverride(newNotes, CT.notesSlide)
            newRels.push({ id: 'rId2', type: REL_TYPE.notesSlide, target: `../notesSlides/notesSlide${notesNumber}.xml` })
          }
          pkg.put(relsPathFor(newPart), relsXml(newRels))
          ensureOverride(newPart, CT.slide)

          const rid = `rIdDup${number}`
          const relsPath = 'ppt/_rels/presentation.xml.rels'
          const rels = pkg.text(relsPath) ?? ''
          pkg.put(relsPath, rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_TYPE.slide}" Target="slides/slide${number}.xml"/></Relationships>`))
          const presentation = pkg.text('ppt/presentation.xml') as string
          const tag = `<p:sldId id="${freeSldId(slides)}" r:id="${rid}"/>`
          const tags = [...presentation.matchAll(/<p:sldId\b[^>]*\/>/gu)].map((m) => m[0])
          tags.splice(position - 1, 0, tag)
          const listRe = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/u
          const at = listRe.exec(presentation)
          if (at === null) throw fail('ppt/presentation.xml 里没有 <p:sldIdLst>，无法插入幻灯片')
          pkg.put('ppt/presentation.xml', presentation.slice(0, at.index) + `<p:sldIdLst>${tags.join('')}</p:sldIdLst>` + presentation.slice(at.index + at[0].length))
          applied.push(`duplicate_slide(复制第 ${op.index} 页"${source.title}"到新第 ${position} 页，部件 ${newPart})`)
          break
        }
        case 'set_notes': {
          const target = slides[op.index - 1]
          if (target === undefined) throw fail(`幻灯片序号越界：${op.index}（当前共 ${slides.length} 页，取值 1-${slides.length}）`)
          const text = String(op.notes ?? '')
          const existing = [...parseRels(pkg.text(relsPathFor(target.part)) ?? '').entries()].find(([, rel]) => /\/notesSlide$/u.test(rel.type))
          let notesPart = existing === undefined ? undefined : resolvePart(target.part, existing[1].target)
          if (text.trim() === '') {
            if (notesPart === undefined) throw fail(`第 ${op.index} 页本来就没有备注`)
            const relsPath = relsPathFor(target.part)
            pkg.put(relsPath, (pkg.text(relsPath) as string).replace(new RegExp(`<Relationship\\b[^>]*Id="${reEsc(existing![0])}"[^>]*/>`, 'u'), ''))
            applied.push(`set_notes(第 ${op.index} 页：清空备注并解除关系)`)
            break
          }
          if (notesPart === undefined) {
            const notesNumber = freeNotesNumber(files, pkg)
            notesPart = `ppt/notesSlides/notesSlide${notesNumber}.xml`
            pkg.put(relsPathFor(notesPart), relsXml([{ id: 'rId1', type: REL_TYPE.slide, target: `../slides/${target.part.slice('ppt/slides/'.length)}` }]))
            ensureOverride(notesPart, CT.notesSlide)
            const relsPath = relsPathFor(target.part)
            const rels = pkg.text(relsPath) ?? relsXml([])
            pkg.put(relsPath, rels.replace('</Relationships>', `<Relationship Id="rIdNotesNew" Type="${REL_TYPE.notesSlide}" Target="../notesSlides/notesSlide${notesNumber}.xml"/></Relationships>`))
          }
          pkg.put(notesPart, notesXml(text))
          applied.push(`set_notes(第 ${op.index} 页，${text.split('\n').length} 行，部件 ${notesPart})`)
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

  const finalSlides = listSlides()
  return { bytes: packOoxml(partsToMap(files), options.mtime === 'source' ? { mtime: 'source' } : {}), applied, slides: finalSlides.map((slide) => slide.title) }
}

/** Next free `ppt/notesSlides/notesSlideN.xml` index. */
function freeNotesNumber(files: Record<string, Uint8Array>, pkg: { text(name: string): string | null }): number {
  void pkg
  let n = 1
  while (files[`ppt/notesSlides/notesSlide${n}.xml`] !== undefined) n++
  return n
}

/** Title of a slide part: the `type="title"`/`ctrTitle` placeholder text, else the first line. */
function slideTitle(xml: string): string {
  for (const shape of splitElements(xml, 'p:sp')) {
    if (!/<p:ph\b[^>]*\btype="(?:ctr)?title"/u.test(shape)) continue
    const first = paragraphTexts(shape)[0]
    if (first !== undefined) return first
  }
  return paragraphTexts(xml)[0] ?? ''
}

function paragraphTexts(xml: string): string[] {
  return splitElements(xml, 'a:p')
    .map((paragraph) => {
      const withoutFields = paragraph.replace(/<a:fld\b[^>]*>[\s\S]*?<\/a:fld>/gu, '')
      return runText(withoutFields).replace(/[ \t]+/gu, ' ').trim()
    })
    .filter((text) => text !== '')
}

/** Split a fragment into its top-level `<name …>…</name>` elements (nesting aware). */
export function splitElements(xml: string, name: string): string[] {
  const out: string[] = []
  const escaped = reEsc(name)
  const re = new RegExp(`<${escaped}(?=\\s|/?>)(?:"[^"]*"|'[^']*'|[^>"'])*?(/?)>|</${escaped}\\s*>`, 'gu')
  let depth = 0
  let start = -1
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const token = m[0]
    if (token.startsWith('</')) {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(xml.slice(start, m.index + token.length))
        start = -1
      }
      continue
    }
    if (m[1] === '/') {
      if (depth === 0) out.push(token)
      continue
    }
    if (depth === 0) start = m.index
    depth++
  }
  return out
}

/** Concatenate text nodes plus tab/break elements in document order. */
function runText(xml: string): string {
  let out = ''
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br(?:\s[^>]*)?\/>|<a:tab(?:\s[^>]*)?\/>/gu
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    if (m[1] !== undefined) out += unesc(m[1])
    else out += m[0].startsWith('<a:br') ? '\n' : '\t'
  }
  return out
}

/** One `<a:t>` node of a part. */
interface TextChunk {
  xmlStart: number
  xmlEnd: number
  dataStart: number
  dataEnd: number
  openTag: string
  text: string
  raw: string
}

function textChunks(partXml: string): TextChunk[] {
  const chunks: TextChunk[] = []
  const re = /<a:t(?:\s[^>]*)?\/>|<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gu
  for (let m = re.exec(partXml); m !== null; m = re.exec(partXml)) {
    const xmlStart = m.index
    const xmlEnd = m.index + m[0].length
    if (m[1] === undefined) continue
    const openTagLength = m[0].length - m[1].length - '</a:t>'.length
    chunks.push({
      xmlStart,
      xmlEnd,
      dataStart: xmlStart + openTagLength,
      dataEnd: xmlEnd - '</a:t>'.length,
      openTag: m[0].slice(0, openTagLength),
      text: unesc(m[1]),
      raw: m[1],
    })
  }
  return chunks
}

/** Map a decoded-text offset back into the chunk's escaped XML coordinates. */
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

/**
 * Replace `search` with `replacement` across the `<a:t>` nodes of one part, preserving run
 * properties.
 *
 * The replacement is spread over exactly the runs that carry the match, so a placeholder split
 * across `a:r` boundaries is filled without collapsing the run structure — a template's mixed
 * bold/accent formatting survives, which is the whole reason to fill a designed template instead
 * of rebuilding the slide.
 */
export function replaceAcrossRuns(partXml: string, search: string, replacement: string): { xml: string; count: number } {
  if (search === '') return { xml: partXml, count: 0 }
  const chunks = textChunks(partXml)
  const starts: number[] = []
  let concatenated = ''
  for (const chunk of chunks) {
    starts.push(concatenated.length)
    concatenated += chunk.text
  }
  const hits: Array<{ from: number; to: number }> = []
  for (let at = concatenated.indexOf(search); at !== -1; at = concatenated.indexOf(search, at + search.length)) {
    hits.push({ from: at, to: at + search.length })
    if (hits.length > 5000) throw new Error(`文本 "${search}" 在该部件中出现次数过多（超过 5000 次）`)
  }
  if (hits.length === 0) return { xml: partXml, count: 0 }

  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const hit of hits) {
    const touched = chunks
      .map((chunk, i) => ({ chunk, i }))
      .filter(({ chunk, i }) => hit.from < starts[i] + chunk.text.length && hit.to > starts[i])
    if (touched.length === 0) continue
    if (touched.length === 1) {
      const { chunk, i } = touched[0]
      edits.push({ start: dataOffset(chunk, hit.from - starts[i]), end: dataOffset(chunk, hit.to - starts[i]), text: replacement })
      continue
    }
    for (const [position, { chunk, i }] of touched.entries()) {
      const chunkStart = starts[i]
      const localFrom = Math.max(hit.from, chunkStart) - chunkStart
      const localTo = Math.min(hit.to, chunkStart + chunk.text.length) - chunkStart
      const sliceStart = Math.floor((replacement.length * position) / touched.length)
      const sliceEnd = Math.floor((replacement.length * (position + 1)) / touched.length)
      edits.push({ start: dataOffset(chunk, localFrom), end: dataOffset(chunk, localTo), text: replacement.slice(sliceStart, sliceEnd) })
    }
  }
  return { xml: applyChunkEdits(partXml, edits), count: hits.length }
}

function applyChunkEdits(partXml: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const chunks = textChunks(partXml)
  const ordered = [...edits].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const chunk of chunks) {
    const relevant = ordered.filter((e) => e.start < chunk.xmlEnd && e.end > chunk.xmlStart)
    if (relevant.length === 0) continue
    out += partXml.slice(cursor, chunk.xmlStart)
    let text = ''
    let local = chunk.dataStart
    for (const edit of relevant) {
      const from = Math.max(edit.start, chunk.dataStart)
      const to = Math.min(edit.end, chunk.dataEnd)
      if (from > local) text += unesc(partXml.slice(local, from))
      if (to > from) text += edit.text
      local = Math.max(local, to)
    }
    if (local < chunk.dataEnd) text += unesc(partXml.slice(local, chunk.dataEnd))
    out += textNodeFor(chunk.openTag, text)
    cursor = chunk.xmlEnd
  }
  return out + partXml.slice(cursor)
}

/** Re-serialize one `<a:t>` element, adding `xml:space` only when the text needs it. */
function textNodeFor(openTag: string, text: string): string {
  if (text === '') return openTag.endsWith('/>') ? openTag : `${openTag}/>`
  const needsPreserve = /^\s|\s$/u.test(text) && !/xml:space\s*=/u.test(openTag)
  const tag = needsPreserve ? openTag.replace(/>$/u, ' xml:space="preserve">') : openTag
  return `${tag}${esc(text)}</a:t>`
}

// ---------- verification ----------

/** A structural report over a candidate .pptx. */
export interface PptxAudit {
  entryCount: number
  slideCount: number
  /** Slide part names in presentation order. */
  slideParts: string[]
  slideTitles: string[]
  parts: string[]
}

/**
 * Verify candidate .pptx bytes: a zip pass (fflate validates every entry's CRC while inflating),
 * the required package parts, a well-formedness walk over every XML part, and a consistency check
 * that `sldIdLst` references resolve to existing slide parts.
 *
 * @param bytes - candidate .pptx bytes.
 * @throws an Error describing the first structural problem found.
 */
export function verifyPptx(bytes: Uint8Array): PptxAudit {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new Error(`生成的 pptx 不是有效的 zip 容器（${error instanceof Error ? error.message : String(error)}）`)
  }
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']) {
    if (files[required] === undefined) throw new Error(`生成的 pptx 缺少必需部件：${required}`)
  }
  for (const [name, data] of Object.entries(files)) {
    if (name === '[Content_Types].xml' || !/\.(?:xml|rels)$/u.test(name)) continue
    assertWellFormedXml(strFromU8(data), name)
  }
  const contentTypes = strFromU8(files['[Content_Types].xml'])
  const presentation = strFromU8(files['ppt/presentation.xml'])
  const rels = parseRels(strFromU8(files['ppt/_rels/presentation.xml.rels'] ?? strToU8('')))
  const slideParts: string[] = []
  const slideTitles: string[] = []
  for (const m of presentation.matchAll(/<p:sldId\b[^>]*\/>/gu)) {
    const a = attrs(m[0])
    const rel = rels.get(a['r:id'] ?? '')
    if (rel === undefined) throw new Error(`pptx 的 sldIdLst 引用了不存在的关系：${a['r:id']}`)
    const part = resolvePart('ppt/presentation.xml', rel.target)
    if (files[part] === undefined) throw new Error(`pptx 的 sldIdLst 指向缺失的部件：${part}`)
    if (!contentTypes.includes(`PartName="/${part}"`)) throw new Error(`pptx 缺少 ${part} 的 content-type Override`)
    slideParts.push(part)
    slideTitles.push(slideTitle(strFromU8(files[part])))
  }
  if (slideParts.length === 0) throw new Error('生成的 pptx 没有任何幻灯片')
  return { entryCount: Object.keys(files).length, slideCount: slideParts.length, slideParts, slideTitles, parts: Object.keys(files).sort() }
}
