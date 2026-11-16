/**
 * 跨解析器往返测试：用 **pdfjs**（dsh-pdf-reader 的引擎，独立于 pdf-lib）重读本插件写出的每一个文件。
 *
 * 这是「用我们自己的读取器重读自己的输出」在 PDF 域的落地：pdf-lib 能读回自己的输出只能证明自洽，
 * pdfjs 能读才说明这些文件在本项目的读取路径上真的可用（页面树、内容流、表单域、元数据都过一遍）。
 * 用法：node tests/roundtrip.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEditorTools, makeChecker } from './harness.mjs'
import { makeFormPdf, makePdf, makeXmpPdf, tempDir, writeTinyPng } from './fixtures.mjs'

const { check, done } = makeChecker('pdf-editor · pdfjs 往返')
const dir = tempDir('roundtrip')
const env = await loadEditorTools()
const path = (name) => join(dir, name)

const { getDocument } = await import('../../dsh-pdf-reader/node_modules/pdfjs-dist/legacy/build/pdf.mjs')

/** Read a file with pdfjs: page count, per-page text, annotations, and metadata. */
async function viaPdfjs(file) {
  const task = getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true })
  const pdf = await task.promise
  const pages = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index)
    const content = await page.getTextContent()
    const annotations = await page.getAnnotations()
    pages.push({
      text: content.items.map((item) => item.str).join(''),
      annotations: annotations.map((annotation) => ({ fieldName: annotation.fieldName, fieldValue: annotation.fieldValue, subtype: annotation.subtype })),
      size: page.getViewport({ scale: 1 }),
      rotation: page.rotate,
      // pdfjs exposes the effective visible box (crop box intersected with the media box) as `view`.
      view: page.view,
    })
    page.cleanup()
  }
  const meta = await pdf.getMetadata()
  const count = pdf.numPages
  await task.destroy()
  return { pages, count, info: meta.info }
}

console.log('== 页面操作产物 ==')
{
  await makePdf(path('a.pdf'), { pages: 2, label: 'A' })
  await makePdf(path('b.pdf'), { pages: 2, label: 'B', rotations: [90, 0] })
  const merged = await env.call('pdf_pages', { source: path('a.pdf'), op: 'merge', sources: [path('b.pdf')], output: path('merged.pdf') })
  const mergedRead = await viaPdfjs(merged.outputs[0].path)
  check('pdfjs 读到合并后的 4 页', mergedRead.count === 4, String(mergedRead.count))
  check('pdfjs 逐页文本按合并顺序', mergedRead.pages[0].text.includes('A page 1') && mergedRead.pages[2].text.includes('B page 1'), JSON.stringify(mergedRead.pages.map((page) => page.text)))
  check('旋转页在 pdfjs 里也是 90°', mergedRead.pages[2].rotation === 90, String(mergedRead.pages[2].rotation))

  await makePdf(path('five.pdf'), { pages: 5, label: 'F' })
  const split = await env.call('pdf_pages', { source: path('five.pdf'), op: 'split', every: 2, out_dir: path('parts') })
  for (const entry of split.outputs) {
    const read = await viaPdfjs(entry.path)
    check(`pdfjs 读到拆分文件 ${entry.path.split(/[\\/]/u).at(-1)} 的 ${entry.pages} 页`, read.count === entry.pages, String(read.count))
  }

  const rotated = await env.call('pdf_pages', { source: path('five.pdf'), op: 'rotate', range: '1', degrees: 90, output: path('rot.pdf') })
  const rotatedRead = await viaPdfjs(rotated.outputs[0].path)
  check('pdfjs 读到旋转后的 90°', rotatedRead.pages[0].rotation === 90, String(rotatedRead.pages[0].rotation))
  const cropped = await env.call('pdf_pages', { source: path('five.pdf'), op: 'crop', range: '1', box: { x: 5, y: 6, width: 200, height: 300 }, output: path('crop.pdf') })
  const croppedRead = await viaPdfjs(cropped.outputs[0].path)
  check('pdfjs 读到裁剪框（view 反映 cropBox）', Math.round(croppedRead.pages[0].view[2] - croppedRead.pages[0].view[0]) === 200 && Math.round(croppedRead.pages[0].view[1]) === 6, JSON.stringify(croppedRead.pages[0].view))
}

console.log('== 叠加/水印产物 ==')
{
  await makePdf(path('stamp-src.pdf'), { pages: 2, size: [400, 600] })
  writeTinyPng(path('dot.png'))
  const stamped = await env.call('pdf_stamp', {
    source: path('stamp-src.pdf'),
    watermark: { text: 'WATERMARK' },
    marks: [
      { page: 1, kind: 'text', box: { x: 40, y: 500 }, text: 'HELLO STAMP', font_size: 16 },
      { page: 2, kind: 'image', box: { x: 300, y: 500, width: 40, height: 40 }, path: path('dot.png') },
    ],
    output: path('stamped.pdf'),
  })
  const read = await viaPdfjs(stamped.output)
  check('pdfjs 读到 2 页', read.count === 2)
  check('pdfjs 提取到水印与盖章文字', read.pages[0].text.includes('WATERMARK') && read.pages[0].text.includes('HELLO STAMP'), JSON.stringify(read.pages[0].text))
  check('第 2 页也被画上水印', read.pages[1].text.includes('WATERMARK'), JSON.stringify(read.pages[1].text))
  const cjk = await env.call('pdf_stamp', { source: path('stamp-src.pdf'), watermark: { text: '内部资料' }, output: path('stamped-cjk.pdf') })
  const cjkRead = await viaPdfjs(cjk.output)
  check('pdfjs 能提取中文水印（嵌入字体子集可解析）', cjkRead.pages[0].text.includes('内部资料'), JSON.stringify(cjkRead.pages[0].text))
}

console.log('== 表单填写与扁平化产物 ==')
{
  await makeFormPdf(path('form.pdf'))
  const filled = await env.call('pdf_form', { source: path('form.pdf'), values: { name: 'Grace Hopper', agree: true, choice: 'Three' }, output: path('filled.pdf') })
  const read = await viaPdfjs(filled.output)
  const byName = new Map(read.pages[0].annotations.filter((entry) => entry.fieldName !== undefined).map((entry) => [entry.fieldName, entry.fieldValue]))
  check('pdfjs 读到文本域的新值', byName.get('name') === 'Grace Hopper', JSON.stringify([...byName.entries()]))
  // pdfjs reports a choice field's selection as a list (`["Three"]`), like pdf-lib's getSelected().
  const choice = byName.get('choice')
  check('pdfjs 读到下拉框的新值', Array.isArray(choice) ? choice.join(',') === 'Three' : choice === 'Three', JSON.stringify(choice))
  check('pdfjs 读回复选框状态（勾选 → /Yes）', String(byName.get('agree')).includes('Yes'), String(byName.get('agree')))

  const cjk = await env.call('pdf_form', { source: path('form.pdf'), values: { name: '张三' }, output: path('filled-cjk.pdf') })
  const cjkRead = await viaPdfjs(cjk.output)
  const cjkField = cjkRead.pages[0].annotations.find((entry) => entry.fieldName === 'name')
  check('pdfjs 读到中文文本域值', cjkField?.fieldValue === '张三', JSON.stringify(cjkField))

  const flat = await env.call('pdf_form', { source: path('form.pdf'), values: { name: 'Flat Value' }, flatten: true, output: path('flat.pdf') })
  const flatRead = await viaPdfjs(flat.output)
  check('扁平化后 pdfjs 不再看到表单字段注解', flatRead.pages[0].annotations.filter((entry) => entry.subtype === 'Widget').length === 0, JSON.stringify(flatRead.pages[0].annotations))
}

console.log('== 元数据产物 ==')
{
  await makeXmpPdf(path('xmp.pdf'))
  const written = await env.call('pdf_metadata', { source: path('xmp.pdf'), set: { title: '标题', author: '作者', keywords: ['k1', 'k2'] }, sync_xmp: true, output: path('meta.pdf') })
  const read = await viaPdfjs(written.output)
  check('pdfjs 读到标题', read.info.Title === '标题', JSON.stringify(read.info))
  check('pdfjs 读到作者', read.info.Author === '作者', JSON.stringify(read.info))
  check('XMP 同步后仍能被 pdfjs 读取文档', read.count === 1)
}

process.exit(done())
