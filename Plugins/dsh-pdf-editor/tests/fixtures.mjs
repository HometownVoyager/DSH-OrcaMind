/**
 * 测试夹具：用 pdf-lib 现场构造测试用 PDF（多页文档、带表单字段的文档、带 XMP 的文档），
 * 不把二进制文件塞进仓库。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib'

const here = dirname(fileURLToPath(import.meta.url))

/** A clean temp directory for one test file; removed and recreated on each run. */
export function tempDir(name) {
  const dir = join(here, 'tmp', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Build a multi-page PDF with one text line per page and optional page rotations. */
export async function makePdf(path, options = {}) {
  const pages = options.pages ?? 3
  const size = options.size ?? [400, 600]
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size)
    page.drawText(`${options.label ?? 'doc'} page ${i + 1}`, { x: 40, y: size[1] - 60, size: 18, font })
    const rotation = options.rotations?.[i]
    if (rotation !== undefined) page.setRotation(degrees(rotation))
  }
  const bytes = await doc.save({ updateFieldAppearances: false })
  writeFileSync(path, bytes)
  return { path, bytes }
}

/** Build a PDF holding one of every supported AcroForm field type, plus one read-only text field. */
export async function makeFormPdf(path) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([500, 700])
  page.drawText('form fixture', { x: 40, y: 660, size: 16, font })
  const form = doc.getForm()
  const name = form.createTextField('name')
  name.setText('Ada')
  name.addToPage(page, { x: 40, y: 600, width: 200, height: 22 })
  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.setMaxLength(10)
  notes.addToPage(page, { x: 40, y: 540, width: 200, height: 50 })
  const agree = form.createCheckBox('agree')
  agree.addToPage(page, { x: 40, y: 500, width: 16, height: 16 })
  const choice = form.createDropdown('choice')
  choice.setOptions(['One', 'Two', 'Three'])
  choice.select('Two')
  choice.addToPage(page, { x: 40, y: 460, width: 160, height: 22 })
  const color = form.createRadioGroup('color')
  color.addOptionToPage('red', page, { x: 40, y: 420, width: 16, height: 16 })
  color.addOptionToPage('blue', page, { x: 80, y: 420, width: 16, height: 16 })
  const list = form.createOptionList('tags')
  list.setOptions(['alpha', 'beta', 'gamma'])
  list.addToPage(page, { x: 300, y: 420, width: 150, height: 80 })
  const locked = form.createTextField('locked')
  locked.setText('sealed')
  locked.enableReadOnly()
  locked.addToPage(page, { x: 40, y: 380, width: 200, height: 22 })
  // A second page without controls: removing page 1 must prune every field, removing page 2 must not.
  const blank = doc.addPage([500, 700])
  blank.drawText('blank page', { x: 40, y: 660, size: 12, font })
  writeFileSync(path, await doc.save({ updateFieldAppearances: false }))
  return { path }
}

/** Build a PDF whose catalog carries an XMP packet, optionally Flate-compressed. */
export async function makeXmpPdf(path, options = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([300, 400])
  page.drawText('xmp fixture', { x: 30, y: 350, size: 14, font })
  doc.setTitle('信息字典标题')
  doc.setAuthor('信息字典作者')
  const packet = options.packet ?? '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    + '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">旧标题</rdf:li></rdf:Alt></dc:title>'
    + '<xmp:CreatorTool>fixture</xmp:CreatorTool>'
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  // The packet must be passed as UTF-8 bytes: pdf-lib's `stream(string)` encodes one byte per UTF-16
  // code unit, which mangles any non-ASCII metadata (the real writer in src/metadata.ts uses
  // TextEncoder for exactly this reason).
  const packetBytes = new TextEncoder().encode(packet)
  const stream = options.compressed === true
    ? doc.context.flateStream(packetBytes, { Type: 'Metadata', Subtype: 'XML' })
    : doc.context.stream(packetBytes, { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream))
  writeFileSync(path, await doc.save({ useObjectStreams: false, updateFieldAppearances: false }))
  return { path, packet }
}

/** Write a 1×1 PNG for image-stamp tests. */
export function writeTinyPng(path) {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AGP/g0WAAAAAElFTkSuQmCC'
  writeFileSync(path, Buffer.from(base64, 'base64'))
  return path
}
