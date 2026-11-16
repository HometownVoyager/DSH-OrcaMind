/**
 * Stamps, watermarks and overlays.
 *
 * Two coordinate systems meet here, and mixing them is the classic "off by a few points" bug: PDF
 * user space has its origin at the bottom-left of the page, while an image the caller measured has
 * its origin at the top-left. Every mark therefore declares the system its box is expressed in
 * (`geometry`), and `image_pixels` boxes are converted with an explicit y flip. Lint runs before any
 * drawing: a mark that falls outside the page, a box with no area, or text no available font can
 * render is reported instead of producing an invisible or misplaced stamp.
 * @module dsh-pdf-editor/src/marks
 */

import { degrees, rgb, type Color, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { canEncode, type FontRequest } from './fonts.js'
import type { LoadedPdf } from './pdfedit.js'

/** Coordinate system a mark's box is expressed in. */
export type GeometrySystem = 'pdf_points' | 'image_pixels'

/** A caller-declared coordinate system, plus the sizes needed to convert it. */
export interface GeometrySpec {
  /** Which system `box` values use. */
  system: GeometrySystem
  /** Reference page size in PDF points (required for `image_pixels`). */
  pageSize?: { width: number; height: number }
  /** Pixel size of the coordinate space `box` values live in (required for `image_pixels`). */
  imageSize?: { width: number; height: number }
}

/** Mark kinds the stamper can draw. */
export type MarkKind = 'text' | 'line' | 'rect' | 'image'

/** One thing to draw on one page. */
export interface MarkSpec {
  /** Page selector token (`3`, `1-3`, `z`, `r1`, `all`) or a 1-based page number. */
  page: string | number
  /** What to draw. */
  kind: MarkKind
  /** Position in the declared geometry; `width`/`height` optional for text. */
  box: { x: number; y: number; width?: number; height?: number }
  /** Text content (`kind: text`). */
  text?: string
  /** Font size in points; defaults to 12 (`kind: text`). */
  fontSize?: number
  /** Colour as `#rrggbb` or `[r, g, b]` with 0–255 channels. */
  color?: string | number[]
  /** Opacity 0–1. */
  opacity?: number
  /** Clockwise rotation in degrees. */
  rotate?: number
  /** Stroke width in points (`kind: line` / `kind: rect`). */
  thickness?: number
  /** Draw a filled rectangle instead of an outline (`kind: rect`). */
  filled?: boolean
  /** Image file path (`kind: image`). */
  path?: string
  /** Centre the text on the page instead of using `box` (set by the watermark shortcut). */
  centre?: boolean
}

/** A convenience watermark applied to every page. */
export interface WatermarkSpec {
  /** Watermark text. */
  text: string
  /** Font size in points; defaults to 48. */
  fontSize?: number
  /** Colour as `#rrggbb` or `[r, g, b]`; defaults to grey. */
  color?: string | number[]
  /** Opacity 0–1; defaults to 0.12. */
  opacity?: number
  /** Clockwise rotation; defaults to 45 (diagonal). */
  angle?: number
  /** Page selector; defaults to every page. */
  pages?: string
}

/** One lint finding. */
export interface MarkIssue {
  /** 1-based mark index in the request, 0 for request-level findings. */
  mark: number
  /** `error` blocks drawing; `warning` is reported and drawn anyway. */
  severity: 'error' | 'warning'
  /** What is wrong, in the caller's vocabulary. */
  message: string
}

/** Everything drawing needs. */
export interface DrawContext {
  /** Loaded document. */
  loaded: LoadedPdf
  /** Font able to render every text in the request. */
  font: PDFFont
  /** Resolve and read an image file. */
  readImage(absolute: string): Promise<Uint8Array>
}

/**
 * Expand one mark's page selector into page numbers.
 * @param mark - the mark spec.
 * @param pageCount - document page count.
 * @param parse - the shared page-selector parser.
 * @returns the page numbers the mark applies to.
 * @throws an Error when the selector is malformed or out of range.
 */
export function markPages(mark: MarkSpec, pageCount: number, parse: (selector: string) => number[]): number[] {
  if (typeof mark.page === 'number') {
    if (!Number.isInteger(mark.page) || mark.page < 1 || mark.page > pageCount) {
      throw new Error(`marks 的 page=${mark.page} 超出 1..${pageCount}`)
    }
    return [mark.page]
  }
  if (mark.page.trim().toLowerCase() === 'all') return [...Array(pageCount)].map((_, index) => index + 1)
  return parse(mark.page)
}

/**
 * Convert a mark box into PDF points.
 *
 * `image_pixels` maps the declared image size onto the declared page size and flips y: the caller's
 * top edge becomes the page's bottom edge, because a box measured on a rendered image is only
 * meaningful when it lands where the image showed it. A box with no height keeps its point position
 * (baseline for text, start point for lines and rects).
 *
 * @param box - the caller's box.
 * @param geometry - the declared coordinate system.
 * @returns the box in PDF points.
 * @throws an Error when an `image_pixels` conversion is missing its reference sizes.
 */
export function toPdfPoints(box: MarkSpec['box'], geometry: GeometrySpec): { x: number; y: number; width: number; height: number } {
  const width = box.width ?? 0
  const height = box.height ?? 0
  if (geometry.system === 'pdf_points') return { x: box.x, y: box.y, width, height }
  const pageSize = geometry.pageSize
  const imageSize = geometry.imageSize
  if (pageSize === undefined || imageSize === undefined || !(imageSize.width > 0) || !(imageSize.height > 0)) {
    throw new Error('geometry=image_pixels 时必须同时给出 page_size 与 image_size（用于换算并翻转 y 轴）')
  }
  const scaleX = pageSize.width / imageSize.width
  const scaleY = pageSize.height / imageSize.height
  // The caller's box starts at the top-left: with a height, its bottom edge is `y + height` downwards.
  const y = height > 0 ? pageSize.height - (box.y + height) * scaleY : pageSize.height - box.y * scaleY
  return { x: box.x * scaleX, y, width: width * scaleX, height: height * scaleY }
}

/**
 * Lint marks before drawing anything.
 * @param loaded - the loaded document.
 * @param marks - the marks to check.
 * @param geometry - the declared coordinate system.
 * @param parse - the shared page-selector parser.
 * @param fontUsable - whether a font able to render every text in the request was found.
 * @returns every finding; `error` findings must stop the write.
 */
export function lintMarks(
  loaded: LoadedPdf,
  marks: readonly MarkSpec[],
  geometry: GeometrySpec,
  parse: (selector: string) => number[],
  fontUsable: boolean,
): MarkIssue[] {
  const issues: MarkIssue[] = []
  if (geometry.system === 'image_pixels' && (geometry.pageSize === undefined || geometry.imageSize === undefined)) {
    issues.push({ mark: 0, severity: 'error', message: 'geometry=image_pixels 时必须给出 page_size 与 image_size' })
  }
  marks.forEach((mark, index) => {
    const at = index + 1
    let pages: number[] = []
    try {
      pages = markPages(mark, loaded.pageCount, parse)
    } catch (error) {
      issues.push({ mark: at, severity: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    if (pages.length === 0 && !issues.some((issue) => issue.mark === at)) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 的 page 没有选中任何页` })
    }
    if (mark.kind === 'text' && (mark.text === undefined || mark.text === '')) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 是文本但没有 text` })
    }
    if (mark.kind === 'text' && !fontUsable) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 的文本含标准字体无法编码的字符（如中文），且没有可用字体：请传 font_path 或配置 cjkFontPath` })
    }
    if (mark.kind === 'image' && (mark.path === undefined || mark.path.trim() === '')) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 是图片但没有 path` })
    }
    if (mark.opacity !== undefined && !(mark.opacity >= 0 && mark.opacity <= 1)) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 的 opacity 必须在 0..1（收到 ${mark.opacity}）` })
    }
    if (mark.kind !== 'text' && !(mark.box.width !== undefined && mark.box.height !== undefined)) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 的 ${mark.kind} 需要 box.width 与 box.height` })
    }
    // A line may be axis-aligned (height 0 or width 0 is a horizontal/vertical line); a rect or an
    // image with a zero side has no area at all.
    if (mark.kind === 'line' && mark.box.width === 0 && mark.box.height === 0) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 的线段起点与终点重合（width 与 height 都为 0）` })
    }
    if ((mark.kind === 'rect' || mark.kind === 'image') && (mark.box.width === 0 || mark.box.height === 0)) {
      issues.push({ mark: at, severity: 'error', message: `marks[${at}] 的 box 面积为 0（width/height 必须非零）` })
    }
    if (mark.kind === 'rect' && mark.filled === true && mark.thickness !== undefined) {
      issues.push({ mark: at, severity: 'warning', message: `marks[${at}] 同时给了 filled 与 thickness：填充矩形不描边，thickness 被忽略` })
    }
    if (mark.kind === 'line' && mark.rotate !== undefined) {
      issues.push({ mark: at, severity: 'warning', message: `marks[${at}] 是线段，rotate 被忽略（用 box 的终点表达方向）` })
    }
    if (mark.centre === true) return
    let box: { x: number; y: number; width: number; height: number }
    try {
      box = toPdfPoints(mark.box, geometry)
    } catch (error) {
      issues.push({ mark: at, severity: 'error', message: error instanceof Error ? error.message : String(error) })
      return
    }
    for (const page of pages) {
      const facts = loaded.pages[page - 1]
      if (facts === undefined) continue
      const pageWidth = facts.cropBox.width
      const pageHeight = facts.cropBox.height
      const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= pageWidth + 0.5 && box.y + box.height <= pageHeight + 0.5
      const touches = box.x < pageWidth && box.y < pageHeight && box.x + Math.max(box.width, 1) > 0 && box.y + Math.max(box.height, 1) > 0
      if (!touches) {
        issues.push({ mark: at, severity: 'error', message: `marks[${at}] 完全落在第 ${page} 页之外（页面 ${pageWidth}×${pageHeight}pt，mark 在 ${round(box.x)},${round(box.y)}）` })
      } else if (!inside && mark.kind !== 'text') {
        issues.push({ mark: at, severity: 'warning', message: `marks[${at}] 超出第 ${page} 页边界（页面 ${pageWidth}×${pageHeight}pt，mark 到 ${round(box.x + box.width)},${round(box.y + box.height)}）` })
      }
    }
  })
  return issues
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

/**
 * Parse `#rrggbb`, `rrggbb`, or `[r, g, b(, a)]` into pdf-lib channels.
 * @param value - the caller's colour, or undefined for the fallback.
 * @param fallback - fallback channels in 0–1.
 * @param fallbackOpacity - opacity to use when neither the colour nor `opacity` carries one.
 * @returns the colour plus its opacity.
 * @throws an Error when a hex string is malformed.
 */
export function parseColor(value: string | number[] | undefined, fallback: readonly [number, number, number], fallbackOpacity: number): { color: Color; opacity: number } {
  if (value === undefined) return { color: rgb(fallback[0], fallback[1], fallback[2]), opacity: fallbackOpacity }
  if (Array.isArray(value)) {
    const [r = fallback[0] * 255, g = fallback[1] * 255, b = fallback[2] * 255, a] = value
    const clamp = (channel: number): number => Math.min(1, Math.max(0, channel / 255))
    return { color: rgb(clamp(r), clamp(g), clamp(b)), opacity: a === undefined ? fallbackOpacity : Math.min(1, Math.max(0, a)) }
  }
  const hex = value.trim().replace(/^#/u, '')
  if (!/^[0-9a-f]{6}$/iu.test(hex)) throw new Error(`颜色格式无效：${value}（可用 #rrggbb 或 [r, g, b]，通道 0-255）`)
  const channel = (offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return { color: rgb(channel(0), channel(2), channel(4)), opacity: fallbackOpacity }
}

/**
 * Draw the marks, returning how many were drawn and on which pages.
 * @param marks - already linted marks.
 * @param geometry - the declared coordinate system.
 * @param context - loaded document, font, and image access.
 * @param parse - the shared page-selector parser.
 * @returns the drawn count and the affected pages.
 */
export async function drawMarks(
  marks: readonly MarkSpec[],
  geometry: GeometrySpec,
  context: DrawContext,
  parse: (selector: string) => number[],
): Promise<{ drawn: number; pages: number[] }> {
  const images = new Map<string, PDFImage>()
  const pages = new Set<number>()
  let drawn = 0
  for (const mark of marks) {
    for (const pageNumber of markPages(mark, context.loaded.pageCount, parse)) {
      const page = context.loaded.doc.getPage(pageNumber - 1)
      await drawOne(mark, page, geometry, context, images)
      pages.add(pageNumber)
      drawn++
    }
  }
  return { drawn, pages: [...pages].sort((a, b) => a - b) }
}

async function drawOne(mark: MarkSpec, page: PDFPage, geometry: GeometrySpec, context: DrawContext, images: Map<string, PDFImage>): Promise<void> {
  const textFallback = mark.kind === 'text' ? ([0.8, 0.1, 0.1] as const) : ([0.2, 0.2, 0.2] as const)
  const { color, opacity } = parseColor(mark.color, textFallback, mark.kind === 'image' ? 1 : 0.9)
  const box = mark.centre === true
    ? centreRotated(page, mark, context.font, mark.rotate ?? 45)
    : toPdfPoints(mark.box, geometry)
  switch (mark.kind) {
    case 'text': {
      const size = mark.fontSize ?? 12
      const text = mark.text ?? ''
      const wrapped = box.width > 0 ? wrapText(text, context.font, size, box.width) : text
      // A box height means "centre the text inside this box"; without one the box position is the
      // baseline, which is what a caller positioning text by a rendered image expects.
      const lines = wrapped.split('\n').length
      const y = box.height > 0 ? box.y + (box.height - size * lines) / 2 + size * 0.22 : box.y
      page.drawText(wrapped, {
        x: box.x,
        y,
        size,
        font: context.font,
        lineHeight: size * 1.2,
        ...(box.width > 0 ? { maxWidth: box.width } : {}),
        color,
        opacity,
        ...(mark.rotate === undefined ? {} : { rotate: degrees(mark.rotate) }),
      })
      return
    }
    case 'line':
      page.drawLine({
        start: { x: box.x, y: box.y },
        end: { x: box.x + box.width, y: box.y + box.height },
        thickness: mark.thickness ?? 1,
        color,
        opacity,
      })
      return
    case 'rect':
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        ...(mark.filled === true ? { color } : { borderColor: color, borderWidth: mark.thickness ?? 1 }),
        opacity,
        ...(mark.rotate === undefined ? {} : { rotate: degrees(mark.rotate) }),
      })
      return
    case 'image': {
      const absolute = mark.path ?? ''
      let image = images.get(absolute)
      if (image === undefined) {
        image = await embedImage(context.loaded.doc, await context.readImage(absolute), absolute)
        images.set(absolute, image)
      }
      page.drawImage(image, { x: box.x, y: box.y, width: box.width, height: box.height, opacity: mark.opacity ?? 1 })
      return
    }
  }
}

/** Embed a PNG or JPEG by content sniffing, so a mislabelled extension cannot pick the wrong parser. */
export function embedImage(doc: PDFDocument, bytes: Uint8Array, label: string): Promise<PDFImage> {
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (isPng) return doc.embedPng(bytes)
  if (isJpeg) return doc.embedJpg(bytes)
  throw new Error(`不支持的图片格式：${label}（只支持 PNG 与 JPEG）`)
}

/**
 * Wrap text to a width using the font's own metrics.
 * @param text - the text to wrap.
 * @param font - the font that will draw it.
 * @param size - font size in points.
 * @param maxWidth - available width in points.
 * @returns the text with newlines inserted at width boundaries.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const char of paragraph) {
      const candidate = current + char
      if (current !== '' && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current)
        current = char
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }
  return lines.join('\n')
}

/**
 * Build the marks for a watermark: the same rotated, semi-transparent text centred on every page.
 * @param loaded - the loaded document.
 * @param watermark - the watermark spec.
 * @param parse - the shared page-selector parser.
 * @returns marks ready for lint and drawing, plus the page numbers.
 */
export function watermarkMarks(loaded: LoadedPdf, watermark: WatermarkSpec, parse: (selector: string) => number[]): { marks: MarkSpec[]; pages: number[] } {
  const pages = watermark.pages === undefined || watermark.pages.trim() === ''
    ? [...Array(loaded.pageCount)].map((_, index) => index + 1)
    : parse(watermark.pages)
  const marks: MarkSpec[] = pages.map((page) => ({
    page,
    kind: 'text',
    box: { x: 0, y: 0 },
    text: watermark.text,
    fontSize: watermark.fontSize ?? 48,
    color: watermark.color ?? '#808080',
    opacity: watermark.opacity ?? 0.12,
    rotate: watermark.angle ?? 45,
    centre: true,
  }))
  return { marks, pages }
}

/**
 * Place a rotated text so that its centre lands on the page centre.
 *
 * The rotation happens about the text's origin, so the origin is the page centre minus the rotated
 * half-advance; the height term uses the font size as the cap-height approximation.
 *
 * @param page - the page being drawn on.
 * @param mark - the text mark.
 * @param font - the drawing font.
 * @param angle - rotation in degrees.
 * @returns the box to use, in PDF points.
 */
export function centreRotated(page: PDFPage, mark: MarkSpec, font: PDFFont, angle: number): { x: number; y: number; width: number; height: number } {
  const size = mark.fontSize ?? 48
  const text = mark.text ?? ''
  const width = font.widthOfTextAtSize(text, size)
  const height = size
  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const x = pageWidth / 2 - (width / 2 * cos - height / 2 * sin)
  const y = pageHeight / 2 - (width / 2 * sin + height / 2 * cos)
  return { x: Math.max(0, x), y: Math.max(0, y), width: 0, height: 0 }
}

/**
 * Whether any of the given texts needs a font beyond the standard WinAnsi set.
 * @param font - a font already embedded in the document (the standard font, typically).
 * @param texts - strings that will be drawn.
 * @returns whether at least one string cannot be encoded.
 */
export function anyNeedsEmbeddedFont(font: PDFFont, texts: readonly string[]): boolean {
  return texts.some((text) => !canEncode(font, text))
}

/** Re-exported so callers building font requests do not import from two modules. */
export type { FontRequest }
