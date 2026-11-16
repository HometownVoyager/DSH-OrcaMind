/**
 * pdf_pages 工具测试：合并/拆分/抽页/删页/重排/旋转/裁剪/插入，含写后校验与各条错误路径。
 * 用法：node tests/pages.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { loadEditorTools, makeChecker } from './harness.mjs'
import { makeFormPdf, makePdf, tempDir } from './fixtures.mjs'

const { check, done } = makeChecker('pdf-editor · pdf_pages')
const dir = tempDir('pages')
const env = await loadEditorTools()

const doc = (path) => join(dir, path)
const facts = async (path) => {
  const loaded = await PDFDocument.load(new Uint8Array(readFileSync(path)), { updateMetadata: false })
  return {
    pages: loaded.getPageCount(),
    rotations: loaded.getPages().map((page) => page.getRotation().angle),
    cropBoxes: loaded.getPages().map((page) => page.getCropBox()),
    fields: loaded.getForm().getFields().length,
    widgets: loaded.getPages().reduce((sum, page) => sum + (page.node.Annots()?.size() ?? 0), 0),
  }
}

console.log('== merge：页数、顺序（内容指纹）、输出路径 ==')
{
  await makePdf(doc('a.pdf'), { pages: 2, label: 'A' })
  await makePdf(doc('b.pdf'), { pages: 3, label: 'B' })
  const result = await env.call('pdf_pages', { source: doc('a.pdf'), op: 'merge', sources: [doc('b.pdf')], output: doc('merged.pdf') })
  check('合并结果 5 页', result.outputs[0].pages === 5, JSON.stringify(result.outputs))
  check('verified=true 且校验项齐全（结构/回读/页数/指纹）', result.verified === true && result.checks.length >= 4, JSON.stringify({ checks: result.checks, problems: result.problems }))
  check('输出文件存在', existsSync(doc('merged.pdf')))
  const merged = await facts(doc('merged.pdf'))
  check('重读页数为 5', merged.pages === 5)
  check('渲染文案包含合并摘要', env.render('pdf_pages', result)[0].text.includes('合并 2 个文档'))
  const text = await firstText(doc('merged.pdf'))
  check('第 1 页来自 A、第 3 页来自 B（按文本抽查）', text[0].includes('A page 1') && text[2].includes('B page 1'), JSON.stringify(text))
}

console.log('== merge：表单控件默认剥掉并报告（keep_widgets 可保留） ==')
{
  await makeFormPdf(doc('form.pdf'))
  const stripped = await env.call('pdf_pages', { source: doc('form.pdf'), op: 'merge', sources: [doc('a.pdf')], output: doc('merged-form.pdf') })
  check('报告剥离的控件数（1 个文档 8 个控件）', stripped.outputs[0].widgets_dropped >= 6, JSON.stringify(stripped.outputs))
  check('警告里说明剥掉了控件', stripped.warnings.some((line) => line.includes('控件')), JSON.stringify(stripped.warnings))
  const strippedFacts = await facts(doc('merged-form.pdf'))
  check('重建文档的 AcroForm 字段数为 0', strippedFacts.fields === 0)
  check('页面上不再有控件注解', strippedFacts.widgets === 0, String(strippedFacts.widgets))
  const kept = await env.call('pdf_pages', { source: doc('form.pdf'), op: 'merge', sources: [doc('a.pdf')], output: doc('merged-form-keep.pdf'), keep_widgets: true })
  check('keep_widgets=true 时保留控件注解', (await facts(doc('merged-form-keep.pdf'))).widgets > 0, JSON.stringify(kept.outputs))
}

console.log('== split：ranges / every / each 与文件名 ==')
{
  await makePdf(doc('s.pdf'), { pages: 5, label: 'S' })
  const byRange = await env.call('pdf_pages', { source: doc('s.pdf'), op: 'split', ranges: ['1-2', '3-', 'z'], out_dir: doc('split-range') })
  check('按 ranges 切出 3 个文件', byRange.outputs.length === 3, JSON.stringify(byRange.outputs))
  const names = readdirSync(doc('split-range')).sort()
  check('文件名带上范围标记（p1-2 / p3-z / pz）', names.join('、') === 's-p1-2.pdf、s-p3-z.pdf、s-pz.pdf', names.join('、'))
  check('各文件页数正确', byRange.outputs.map((entry) => entry.pages).join(',') === '2,3,1', JSON.stringify(byRange.outputs))
  check('拆分后逐文件校验通过（每文件 4 项）', byRange.verified === true && byRange.checks.length >= 4 * 3, JSON.stringify({ checks: byRange.checks.length, problems: byRange.problems }))

  const byEvery = await env.call('pdf_pages', { source: doc('s.pdf'), op: 'split', every: 2, out_dir: doc('split-every') })
  check('every=2 → 3 个文件（2/2/1 页）', byEvery.outputs.map((entry) => entry.pages).join(',') === '2,2,1', JSON.stringify(byEvery.outputs))
  const byEach = await env.call('pdf_pages', { source: doc('s.pdf'), op: 'split', each: true, out_dir: doc('split-each') })
  check('each=true → 5 个单页文件', byEach.outputs.length === 5 && byEach.outputs.every((entry) => entry.pages === 1))
  const missing = await env.fail('pdf_pages', { source: doc('s.pdf'), op: 'split', out_dir: doc('split-none') })
  check('不给 ranges/every/each 时报错说明怎么切', missing.includes('ranges / every / each'), missing)
}

console.log('== extract / remove / reorder / rotate / crop ==')
{
  await makePdf(doc('ops.pdf'), { pages: 4, label: 'O', rotations: [90, 0, 0, 0] })
  const extracted = await env.call('pdf_pages', { source: doc('ops.pdf'), op: 'extract', range: '2-3', output: doc('extracted.pdf') })
  check('extract 2-3 → 2 页', extracted.outputs[0].pages === 2)
  check('抽出的页面顺序由指纹校验通过', extracted.verified === true, JSON.stringify(extracted.problems))

  const removed = await env.call('pdf_pages', { source: doc('ops.pdf'), op: 'remove', range: '1', output: doc('removed.pdf') })
  check('remove 第 1 页 → 3 页', removed.outputs[0].pages === 3)
  check('删页后校验通过（剩余页顺序由指纹证明）', removed.verified === true, JSON.stringify(removed.problems))

  const reordered = await env.call('pdf_pages', { source: doc('ops.pdf'), op: 'reorder', pages: [4, 1, 3, 2], output: doc('reordered.pdf') })
  check('reorder 校验通过（指纹证明真的换了顺序）', reordered.verified === true, JSON.stringify(reordered.problems))
  const reorderedText = await firstText(doc('reordered.pdf'))
  check('重排后第 1 页文本是原第 4 页', reorderedText[0].includes('O page 4'), JSON.stringify(reorderedText))
  const badOrder = await env.fail('pdf_pages', { source: doc('ops.pdf'), op: 'reorder', pages: [1, 1, 2, 3] })
  check('reorder 页码重复时报错（必须是排列）', badOrder.includes('重复'), badOrder)
  const shortOrder = await env.fail('pdf_pages', { source: doc('ops.pdf'), op: 'reorder', pages: [1, 2] })
  check('reorder 页数不足时报错', shortOrder.includes('需要 4 个页码'), shortOrder)
}

console.log('== rotate 增量 / crop 坐标 ==')
{
  await makePdf(doc('rot.pdf'), { pages: 2, rotations: [90, 0] })
  const result = await env.call('pdf_pages', { source: doc('rot.pdf'), op: 'rotate', range: '1-2', degrees: 90, output: doc('rot-out.pdf') })
  check('rotate 校验通过', result.verified === true, JSON.stringify(result.problems))
  const after = await facts(doc('rot-out.pdf'))
  check('第 1 页 90° 叠加 90° → 180°（增量而非绝对）', after.rotations[0] === 180, JSON.stringify(after.rotations))
  check('第 2 页 0° → 90°', after.rotations[1] === 90, JSON.stringify(after.rotations))
  check('摘要写明增量结果', result.summary.includes('90°→180°'), result.summary)
  const negative = await env.call('pdf_pages', { source: doc('rot-out.pdf'), op: 'rotate', range: '1', degrees: -90, output: doc('rot-back.pdf') })
  check('反向旋转回到 90°', (await facts(doc('rot-back.pdf'))).rotations[0] === 90, negative.summary)
  const badAngle = await env.fail('pdf_pages', { source: doc('rot.pdf'), op: 'rotate', range: '1', degrees: 45 })
  check('非 90 倍数角度报错', badAngle.includes('90 的整数倍'), badAngle)

  const crop = await env.call('pdf_pages', { source: doc('rot.pdf'), op: 'crop', range: '1-2', box: { x: 10, y: 20, width: 300, height: 400 }, output: doc('crop.pdf') })
  check('crop 校验通过', crop.verified === true, JSON.stringify(crop.problems))
  const cropped = await facts(doc('crop.pdf'))
  check('裁剪框按 PDF 坐标写入（左下原点）', cropped.cropBoxes[0].x === 10 && cropped.cropBoxes[0].y === 20 && cropped.cropBoxes[0].width === 300, JSON.stringify(cropped.cropBoxes[0]))
  const outOfBounds = await env.call('pdf_pages', { source: doc('rot.pdf'), op: 'crop', range: '1', box: { x: 0, y: 0, width: 900, height: 900 }, output: doc('crop-big.pdf') })
  check('超出媒体框只在 warnings 里提示，仍然写入', outOfBounds.warnings.some((line) => line.includes('媒体框')), JSON.stringify(outOfBounds.warnings))
  const zeroCrop = await env.fail('pdf_pages', { source: doc('rot.pdf'), op: 'crop', range: '1', box: { x: 0, y: 0, width: 0, height: 10 } })
  check('零面积裁剪框报错', zeroCrop.includes('宽高必须为正数'), zeroCrop)
}

console.log('== insert：插入位置与拼装顺序 ==')
{
  await makePdf(doc('base.pdf'), { pages: 3, label: 'BASE' })
  await makePdf(doc('ins.pdf'), { pages: 2, label: 'INS' })
  const result = await env.call('pdf_pages', { source: doc('base.pdf'), op: 'insert', sources: [doc('ins.pdf')], at: 2, output: doc('inserted.pdf') })
  check('插入后 5 页', result.outputs[0].pages === 5)
  check('插入后校验通过（拼装顺序由指纹证明）', result.verified === true, JSON.stringify(result.problems))
  const text = await firstText(doc('inserted.pdf'))
  check('顺序为 BASE1 / INS1 / INS2 / BASE2 / BASE3', text[0].includes('BASE page 1') && text[1].includes('INS page 1') && text[3].includes('BASE page 2'), JSON.stringify(text))
  const appended = await env.call('pdf_pages', { source: doc('base.pdf'), op: 'insert', sources: [doc('ins.pdf')], output: doc('inserted-tail.pdf') })
  check('缺省 at 追加到末尾', appended.summary.includes('在第 4 页前插入'), appended.summary)
  const badAt = await env.fail('pdf_pages', { source: doc('base.pdf'), op: 'insert', sources: [doc('ins.pdf')], at: 99 })
  check('at 越界时报错', badAt.includes('at 必须在 1..4'), badAt)
}

console.log('== 删页时的表单清理（report 关注的结构正确性） ==')
{
  await makeFormPdf(doc('form2.pdf'))
  const before = await facts(doc('form2.pdf'))
  check('夹具含 7 个字段与 8 个控件（单选组两个选项）', before.fields === 7 && before.widgets === 8, JSON.stringify(before))
  const keep = await env.call('pdf_pages', { source: doc('form2.pdf'), op: 'remove', range: '2', output: doc('form2-blank-removed.pdf') })
  check('删掉没有控件的第 2 页时字段全部保留', keep.outputs[0].widgets_dropped === 0, JSON.stringify(keep.outputs))
  check('保留分支不产生字段移除警告', !keep.warnings.some((line) => line.includes('字段定义')), JSON.stringify(keep.warnings))
  const after = await facts(doc('form2-blank-removed.pdf'))
  check('字段与控件都还在', after.fields === 7 && after.widgets === 8, JSON.stringify(after))
  const drop = await env.call('pdf_pages', { source: doc('form2.pdf'), op: 'remove', range: '1', output: doc('form2-out.pdf') })
  check('删掉承载全部控件的第 1 页后控件被移除', drop.outputs[0].widgets_dropped === 8, JSON.stringify(drop.outputs))
  check('警告说明移除了字段定义与控件', drop.warnings.some((line) => line.includes('字段定义')), JSON.stringify(drop.warnings))
  const pruned = await facts(doc('form2-out.pdf'))
  check('输出只剩 1 页且字段定义不再指向被删页', pruned.pages === 1 && pruned.fields === 0 && pruned.widgets === 0, JSON.stringify(pruned))
  check('删页后校验通过', drop.verified === true, JSON.stringify(drop.problems))
}

console.log('== 输出与覆盖策略 ==')
{
  await makePdf(doc('twice.pdf'), { pages: 2 })
  await env.call('pdf_pages', { source: doc('twice.pdf'), op: 'extract', range: '1', output: doc('twice-out.pdf') })
  const exists = await env.fail('pdf_pages', { source: doc('twice.pdf'), op: 'extract', range: '1', output: doc('twice-out.pdf') })
  check('目标已存在且未给 in_place 时报错并给出办法', exists.includes('in_place=true'), exists)
  const overwritten = await env.call('pdf_pages', { source: doc('twice.pdf'), op: 'extract', range: '1-2', output: doc('twice-out.pdf'), in_place: true })
  check('in_place=true 覆盖并生成 .bak', overwritten.outputs[0].backup === `${doc('twice-out.pdf')}.bak`, JSON.stringify(overwritten.outputs))
  check('.bak 存在', existsSync(`${doc('twice-out.pdf')}.bak`))
  const inPlace = await env.call('pdf_pages', { source: doc('twice.pdf'), op: 'rotate', range: '1', degrees: 90, in_place: true })
  check('in_place=true 时直接改写源文件', inPlace.outputs[0].path === doc('twice.pdf') && inPlace.outputs[0].backup === `${doc('twice.pdf')}.bak`, JSON.stringify(inPlace.outputs))
  const derived = await env.call('pdf_pages', { source: doc('twice.pdf'), op: 'remove', range: '2' })
  check('原地类操作缺省派生 <原名>-removed.pdf', derived.outputs[0].path.endsWith('twice-removed.pdf'), derived.outputs[0].path)
  const derivedRotate = await env.call('pdf_pages', { source: doc('twice.pdf'), op: 'rotate', range: '2', degrees: 90 })
  check('旋转的缺省派生名是 <原名>-rotated.pdf', derivedRotate.outputs[0].path.endsWith('twice-rotated.pdf'), derivedRotate.outputs[0].path)
}

console.log('== 错误路径：删光、缺参、加密、损坏 ==')
{
  await makePdf(doc('one.pdf'), { pages: 1 })
  const all = await env.fail('pdf_pages', { source: doc('one.pdf'), op: 'remove', range: '1' })
  check('删掉全部页被拒绝（PDF 至少一页）', all.includes('至少要有一页'), all)
  const noSources = await env.fail('pdf_pages', { source: doc('one.pdf'), op: 'merge' })
  check('merge 缺 sources 报错', noSources.includes('sources'), noSources)
  const noRange = await env.fail('pdf_pages', { source: doc('one.pdf'), op: 'extract' })
  check('extract 缺 range 报错并给出语法', noRange.includes('range 参数'), noRange)
  const badRange = await env.fail('pdf_pages', { source: doc('one.pdf'), op: 'extract', range: 'r5' })
  check('r5 越界报错（倒数第 5 页不存在）', badRange.includes('超出文档页数'), badRange)
  const encrypted = await encryptedPdf(doc('encrypted.pdf'))
  const refused = await env.fail('pdf_pages', { source: encrypted, op: 'extract', range: '1' })
  check('加密文档被明确拒绝（并说明为什么不做解密）', refused.includes('已加密') && refused.includes('pdf-lib 不做解密'), refused.slice(0, 120))
  const broken = join(dir, 'broken.pdf')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(broken, '%PDF-1.4 not really a pdf')
  const invalid = await env.fail('pdf_pages', { source: broken, op: 'extract', range: '1' })
  check('损坏文件报「无法解析」', invalid.includes('无法解析'), invalid.slice(0, 120))
  const missing = await env.fail('pdf_pages', { source: doc('nope.pdf'), op: 'extract', range: '1' })
  check('找不到文件时提示路径', missing.includes('找不到文件'), missing)
}

console.log('== verify=false 时如实说明没有校验 ==')
{
  const skipped = await env.call('pdf_pages', { source: doc('one.pdf'), op: 'rotate', range: '1', degrees: 90, output: doc('noverify.pdf'), verify: false })
  check('verified=false 且 checks 为空', skipped.verified === false && skipped.checks.length === 0)
  check('渲染文案说明未做校验', env.render('pdf_pages', skipped)[0].text.includes('未做写后校验'))
}

/** Read the text of every page with a second, independent parser (pdfjs from the reader plugin). */
async function firstText(path) {
  const { getDocument } = await import('../../dsh-pdf-reader/node_modules/pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true })
  const pdf = await task.promise
  const pages = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str).join(''))
    page.cleanup()
  }
  await task.destroy()
  return pages
}

async function encryptedPdf(path) {
  const { PDFDict } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  doc.context.trailerInfo.Encrypt = PDFDict.withContext(doc.context)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, await doc.save({ updateFieldAppearances: false }))
  return path
}

process.exit(done())