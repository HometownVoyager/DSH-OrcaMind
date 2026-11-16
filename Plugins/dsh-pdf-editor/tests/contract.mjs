/**
 * 第三方契约测试：把本插件依赖的 pdf-lib 1.17.1 行为逐条钉住。
 *
 * 这些不是"库的单元测试"，而是**本插件源码注释里那些论断的证据**：一旦 pdf-lib 升级改变了这些行为，
 * 我们的校验/字体/表单路径的假设就需要重新评估。任何一条失败都意味着要先读实现再改断言。
 * 用法：node tests/contract.mjs
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFDropdown, PDFName, PDFRadioGroup, PDFTextField, StandardFonts, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { makeChecker } from './harness.mjs'
import { makePdf, makeXmpPdf, tempDir } from './fixtures.mjs'
import { pageFingerprint } from '../lib/pdfedit.js'

const { check, done } = makeChecker('pdf-editor · pdf-lib 契约')
const dir = tempDir('contract')

console.log('== 加载语义：updateMetadata 默认会改写 Producer/ModDate ==')
{
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  doc.setModificationDate(new Date('2020-01-01T00:00:00Z'))
  doc.setProducer('fixture-producer')
  const bytes = await doc.save({ updateFieldAppearances: false })
  const plain = await PDFDocument.load(bytes)
  const quiet = await PDFDocument.load(bytes, { updateMetadata: false })
  check('默认加载会把 ModDate 刷成现在（所以编辑器必须传 updateMetadata:false）',
    (plain.getModificationDate()?.getTime() ?? 0) > Date.now() - 10_000,
    String(plain.getModificationDate()))
  check('updateMetadata:false 保留文件里的旧 ModDate',
    quiet.getModificationDate()?.toISOString() === '2020-01-01T00:00:00.000Z',
    String(quiet.getModificationDate()))
  const reread = await PDFDocument.load(await quiet.save({ updateFieldAppearances: false }), { updateMetadata: false })
  check('关闭后保存不会把 Producer 改成 pdf-lib', reread.getProducer() === 'fixture-producer', String(reread.getProducer()))
}

console.log('== 加密：load 抛出的是普通 Error，消息里含 is encrypted ==')
{
  const base = await makePdf(join(dir, 'enc.pdf'), { pages: 1 })
  const withEncrypt = await PDFDocument.load(base.bytes, { updateMetadata: false })
  withEncrypt.context.trailerInfo.Encrypt = PDFDict.withContext(withEncrypt.context)
  const bytes = await withEncrypt.save({ updateFieldAppearances: false })
  let message = ''
  try {
    await PDFDocument.load(bytes)
  } catch (error) {
    message = error.message
  }
  check('含 /Encrypt 的文档 load 抛错', message !== '')
  check('错误消息含 "is encrypted"（插件据此给出可行动提示）', /is encrypted/u.test(message), message.slice(0, 80))
  const ignored = await PDFDocument.load(bytes, { ignoreEncryption: true })
  check('ignoreEncryption:true 能加载（但内容是密文——我们拒绝这条路）', ignored.getPageCount() === 1)
}

console.log('== 字体：TTF 可嵌入（子集很小），TTC 集合不可嵌入 ==')
{
  const candidates = ['C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\simsun.ttc']
  const present = candidates.filter((path) => existsSync(path))
  check('本机存在用于探测的字体文件', present.length > 0, present.join('、'))
  const ttf = candidates.find((path) => path.endsWith('.ttf') && existsSync(path))
  const ttc = candidates.find((path) => path.endsWith('.ttc') && existsSync(path))
  if (ttf !== undefined) {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(new Uint8Array(await (await import('node:fs/promises')).readFile(ttf)), { subset: true })
    const page = doc.addPage([300, 200])
    page.drawText('中文水印', { x: 20, y: 100, size: 20, font })
    const bytes = await doc.save({ updateFieldAppearances: false })
    check('TTF（simhei）可嵌入并绘制中文，子集化后文件很小', bytes.byteLength < 60_000, `${bytes.byteLength} bytes`)
    try {
      font.encodeText('中文')
      check('嵌入字体的 encodeText 接受中文', true)
    } catch (error) {
      check('嵌入字体的 encodeText 接受中文', false, String(error))
    }
  }
  if (ttc !== undefined) {
    let failed = ''
    try {
      const doc = await PDFDocument.create()
      doc.registerFontkit(fontkit)
      await doc.embedFont(new Uint8Array(await (await import('node:fs/promises')).readFile(ttc)), { subset: true })
    } catch (error) {
      failed = error.message
    }
    check('TTC（simsun）嵌入失败——所以字体探测必须"真的嵌一次"而不是看文件存不存在', /createSubset/u.test(failed), failed)
  } else {
    check('TTC（simsun）不在本机（跳过该项）', true)
  }
}

console.log('== 标准字体：WinAnsi 编码器是唯一权威判定 ==')
{
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  check('Helvetica.encodeText("中文") 抛错', throws(() => helvetica.encodeText('中文')))
  check('Helvetica.encodeText("plain ASCII") 通过', !throws(() => helvetica.encodeText('plain ASCII')))
  check('Helvetica.encodeText("café—ok") 通过（Latin-1 与常见标点仍在 WinAnsi 内）', !throws(() => helvetica.encodeText('café—ok')))
}

console.log('== 表单：下拉框静默接受不在选项里的值，单选组抛错 ==')
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const form = doc.getForm()
  const dropdown = form.createDropdown('choice')
  dropdown.setOptions(['One', 'Two'])
  dropdown.addToPage(page, { x: 20, y: 300, width: 120, height: 20 })
  dropdown.select('不是选项')
  check('PDFDropdown.select 接受未知值（getSelected 会回读它）', dropdown.getSelected()[0] === '不是选项')
  check('未知值不在 getOptions 里（写入后字段被 pdf-lib 切成可编辑）', !dropdown.getOptions().includes('不是选项'))
  check('字段仍是 PDFDropdown', dropdown instanceof PDFDropdown)
  const radio = form.createRadioGroup('color')
  radio.addOptionToPage('red', page, { x: 20, y: 260, width: 16, height: 16 })
  check('PDFRadioGroup.select 未知值抛错', throws(() => radio.select('green')))
  check('非空文本域实例判定走 instanceof', form.createTextField('t') instanceof PDFTextField)
  check('单选组实例判定走 instanceof', radio instanceof PDFRadioGroup)
}

console.log('== 表单外观域：save 默认用标准字体重建，CJK 值会直接抛错 ==')
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const field = doc.getForm().createTextField('name')
  field.addToPage(page, { x: 20, y: 300, width: 200, height: 20 })
  field.setText('张三')
  let message = ''
  try {
    await doc.save()
  } catch (error) {
    message = error.message
  }
  check('save() 默认（updateFieldAppearances:true）对 CJK 值抛 WinAnsi 错', /WinAnsi/u.test(message), message.slice(0, 60))
  const again = await PDFDocument.create()
  const page2 = again.addPage([400, 400])
  const field2 = again.getForm().createTextField('name')
  field2.addToPage(page2, { x: 20, y: 300, width: 200, height: 20 })
  field2.setText('张三')
  const cjk = 'C:\\Windows\\Fonts\\simhei.ttf'
  if (existsSync(cjk)) {
    again.registerFontkit(fontkit)
    const font = await again.embedFont(new Uint8Array(await readFile(cjk)), { subset: true })
    again.getForm().updateFieldAppearances(font)
    const bytes = await again.save({ updateFieldAppearances: false })
    const back = await PDFDocument.load(bytes, { updateMetadata: false })
    check('自备嵌入字体 + updateFieldAppearances(font) + save({updateFieldAppearances:false}) 可写 CJK 值', back.getForm().getTextField('name').getText() === '张三')
    // flatten() 默认同样会重生成外观域；字段此时已是干净的，所以另起一个脏字段来证明它有这条路径。
    const dirty = await PDFDocument.create()
    const dirtyPage = dirty.addPage([400, 400])
    const dirtyField = dirty.getForm().createTextField('name')
    dirtyField.addToPage(dirtyPage, { x: 20, y: 300, width: 200, height: 20 })
    dirtyField.setText('张三')
    check('(对比) 字段脏时 flatten() 默认会抛 WinAnsi 错（所以必须 flatten({updateFieldAppearances:false})）', throws(() => dirty.getForm().flatten()))
  }
}

console.log('== 页面：copyPages 保留内容流字节（指纹可作证据），但丢掉表单域定义 ==')
{
  const source = await makePdf(join(dir, 'src.pdf'), { pages: 3, label: 'src' })
  const loaded = await PDFDocument.load(source.bytes, { updateMetadata: false })
  const before = loaded.getPages().map((page) => pageFingerprint(loaded, page))
  const out = await PDFDocument.create()
  const copied = await out.copyPages(loaded, [2, 1, 0])
  copied.forEach((page) => out.addPage(page))
  const back = await PDFDocument.load(await out.save({ updateFieldAppearances: false }), { updateMetadata: false })
  const after = back.getPages().map((page) => pageFingerprint(back, page))
  check('重排后第 1 页的内容流指纹等于源文件第 3 页', after[0] === before[2], `${after[0]} vs ${before[2]}`)
  check('重排后的顺序可由指纹完整还原', JSON.stringify(after.map((hex) => before.indexOf(hex))) === JSON.stringify([2, 1, 0]), JSON.stringify(after.map((hex) => before.indexOf(hex))))
  check('指纹不是空值（页面的 /Contents 是数组时要递归进去）', before.every((hex) => hex !== 'empty'), before.join(','))

  const withForm = await PDFDocument.load(source.bytes, { updateMetadata: false })
  const field = withForm.getForm().createTextField('f')
  field.addToPage(withForm.getPage(0), { x: 10, y: 10, width: 100, height: 20 })
  const saved = await withForm.save({ updateFieldAppearances: false })
  const reopened = await PDFDocument.load(saved, { updateMetadata: false })
  const copyOut = await PDFDocument.create()
  const [copiedPage] = await copyOut.copyPages(reopened, [0])
  copyOut.addPage(copiedPage)
  check('copyPages 后目标文档的字段数为 0（表单域定义不随页面走）', copyOut.getForm().getFields().length === 0)
  check('但控件注解被复制过来了（因此重建文档必须处理无主控件）', copiedPage.node.Annots()?.size() === 1)
}

console.log('== XMP：原始流在 load→save 往返中保留 ==')
{
  const xmp = await makeXmpPdf(join(dir, 'xmp.pdf'))
  const raw = Buffer.from(await readFile(xmp.path)).toString('utf8')
  check('未压缩的 XMP 包在文件里可见（/Metadata + dc:title + 旧标题）', raw.includes('/Metadata') && raw.includes('dc:title') && raw.includes('旧标题'))
  const doc = await PDFDocument.load(new Uint8Array(await readFile(xmp.path)), { updateMetadata: false })
  doc.setTitle('新标题')
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false })
  const after = Buffer.from(bytes).toString('utf8')
  check('写元数据后 XMP 包仍在（pdf-lib 不丢弃它；两者会不一致，所以插件要报告差异）', after.includes('旧标题'))
  const reread = await PDFDocument.load(bytes, { updateMetadata: false })
  check('信息字典已改成新标题（XMP 未同步）', reread.getTitle() === '新标题')
  const compressed = await makeXmpPdf(join(dir, 'xmp-flate.pdf'), { compressed: true })
  const compressedRaw = Buffer.from(await readFile(compressed.path)).toString('utf8')
  check('压缩后的 XMP 在文件里不可见（需要 inflate 才能读/改）', !compressedRaw.includes('旧标题'))
}

console.log('== 页面箱体与旋转 ==')
{
  const base = await makePdf(join(dir, 'box.pdf'), { pages: 1, size: [300, 500] })
  const doc = await PDFDocument.load(base.bytes, { updateMetadata: false })
  const page = doc.getPage(0)
  check('getCropBox() 缺省回落到 MediaBox', page.getCropBox().width === 300 && page.getCropBox().height === 500)
  page.setCropBox(-10, -10, 800, 800)
  const back = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }), { updateMetadata: false })
  check('超出 MediaBox 的裁剪框被原样接受（库不裁剪，所以由调用方 lint）', back.getPage(0).getCropBox().width === 800)
  const rotated = await PDFDocument.load(base.bytes, { updateMetadata: false })
  rotated.getPage(0).setRotation(degrees(90))
  const again = await PDFDocument.load(await rotated.save({ updateFieldAppearances: false }), { updateMetadata: false })
  check('setRotation 是绝对值（增量叠加是本插件的责任）', again.getPage(0).getRotation().angle === 90)
}

console.log('== 目录：/Kids 是页面顺序的唯一权威 ==')
{
  const base = await makePdf(join(dir, 'kids.pdf'), { pages: 2 })
  const doc = await PDFDocument.load(base.bytes, { updateMetadata: false })
  const tree = doc.context.lookup(doc.catalog.get(PDFName.of('Pages')))
  check('单层页面树的 /Kids 长度等于页数（reorder 直接改写它）', tree.Kids().size() === 2)
}

function throws(fn) {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

process.exit(done())
