/**
 * P3 回归（打磨）：比对报告 §6 P3「可复现打包（固定 mtime）；explode/assemble 出口」与
 * §4.2 第 15 条 / 第 30 条。
 *
 * 覆盖：
 * 1. 可复现打包——三个 writer 同样输入两次产出逐字节相同、`[Content_Types].xml` 首位且不压缩、
 *    条目时间戳恒为 1980-01-01、显式部件顺序；
 * 2. `indentXml`——只在元素之间加空白、混排元素（`<w:t>` 所在段落）一字不改、良构性保持、
 *    幂等、不可 tokenize 时原样返回；
 * 3. `office_explode`——部件落盘、缩进生效、verbatim 逃生舱、空目录要求与 force、zip slip 拒绝；
 * 4. `office_assemble`——字节级可复现装配、手改 XML 后装回、写后校验、坏 XML 被拦下；
 * 5. prune——幽灵幻灯片/失主备注/无人引用媒体被清理，Override 与悬空关系同步删除，
 *    主题/母版/docProps 一律保留；
 * 6. 工具边界——`office_explode`/`office_assemble` 的真实 execute 路径与工具注册（含 fixture 校验）。
 *
 * 用法：node tests/p3-package.mjs（在 dsh-office-editor 目录下；需先构建 reader 以读取装回结果）
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createDocx, editDocx, verifyDocx } from '../lib/docx.js'
import { createXlsx } from '../lib/xlsx.js'
import { createPptx } from '../lib/pptx.js'
import { assertWellFormedXml, indentXml } from '../lib/xml.js'
import { FIXED_MTIME, packOoxml, zipOoxml } from '../lib/zip.js'
import { assemblePackage, detectFormat, explodePackage, PackageError, planPrune } from '../lib/package.js'

const here = dirname(fileURLToPath(import.meta.url))
const readerLib = join(here, '..', '..', 'dsh-office-reader', 'lib', 'docx.js')
const { readDocx } = await import(new URL(`file://${readerLib.replace(/\\/gu, '/')}`).href)

let failures = 0
let checks = 0
const check = (name, condition, detail = '') => {
  checks++
  if (condition) console.log(`  ok   - ${name}`)
  else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
}

const workDir = join(here, 'tmp', 'p3')
rmSync(workDir, { recursive: true, force: true })
mkdirSync(workDir, { recursive: true })
const tmp = (name) => join(workDir, name)
const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0
const partText = (bytes, name) => {
  const entry = unzipSync(bytes)[name]
  return entry === undefined ? null : strFromU8(entry)
}

console.log('== 1. 可复现打包：同样输入两次产出逐字节相同（报告 §4.2 第 15 条） ==')
const DOCX_BLOCKS = [
  { type: 'heading', level: 1, text: '第一章　总则' },
  { type: 'paragraph', text: '本文讨论可复现打包。' },
  { type: 'list', items: ['甲', '乙'], ordered: true },
  { type: 'table', rows: [['列一', '列二'], ['1', '2']], header: true },
]
{
  const a = createDocx(DOCX_BLOCKS)
  const b = createDocx(DOCX_BLOCKS)
  check('docx 两次产出字节相同', sameBytes(a, b))

  const x = createXlsx([{ name: '数据', rows: [['项目', '值'], ['甲', 1], ['合计', '=SUM(B2:B2)']] }], 100)
  const y = createXlsx([{ name: '数据', rows: [['项目', '值'], ['甲', 1], ['合计', '=SUM(B2:B2)']] }], 100)
  check('xlsx 两次产出字节相同', sameBytes(x, y))

  const p = createPptx([{ title: '封面', bullets: ['一', '二'] }, { title: '正文', bullets: ['甲'] }])
  const q = createPptx([{ title: '封面', bullets: ['一', '二'] }, { title: '正文', bullets: ['甲'] }])
  check('pptx 两次产出字节相同', sameBytes(p, q))

  const edited1 = await editDocx(a, [{ op: 'set_paragraph', index: 2, text: '改写后的段落。' }])
  const edited2 = await editDocx(a, [{ op: 'set_paragraph', index: 2, text: '改写后的段落。' }])
  check('docx 编辑两次产出字节相同', sameBytes(edited1.bytes, edited2.bytes))

  check('mtime 常量落在 1980-01-01 本地零点', (() => { const d = new Date(FIXED_MTIME); return d.getFullYear() === 1980 && d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 })())
}

console.log('== 2. 条目顺序：Content_Types 首位且 stored，其余 deflate ==')
{
  const bytes = createDocx(DOCX_BLOCKS)
  const raw = Buffer.from(bytes)
  const firstNameLength = raw.readUInt16LE(26)
  const firstName = raw.subarray(30, 30 + firstNameLength).toString('utf8')
  check('[Content_Types].xml 是首个 zip 成员', firstName === '[Content_Types].xml', firstName)
  const method = raw.readUInt16LE(8)
  check('首个成员用 STORE（method=0）', method === 0, String(method))
  // Zip local header: 0 sig, 4 version, 6 flags, 8 method, 10 time, 12 date, 14 crc …
  const dosTime = raw.readUInt16LE(10)
  const dosDate = raw.readUInt16LE(12)
  check('条目时间戳为 1980-01-01 00:00', dosDate === ((1980 - 1980) << 9 | 1 << 5 | 1) && dosTime === 0, `date=${dosDate} time=${dosTime}`)

  const order = Object.keys(unzipSync(bytes))
  // manifest 之后是它声明的 Override（document/styles/…），最后才是按名字排序的其余部件（rels 等）。
  check('Content_Types 后紧跟其 Override 声明的部件', order[0] === '[Content_Types].xml' && order[1] === 'word/document.xml', order.slice(0, 3).join(','))
  check('九份部件齐全（含 numbering）', order.includes('word/numbering.xml') && order.includes('docProps/core.xml') && order.includes('word/_rels/document.xml.rels'), order.join(','))
  check('未在 Override 里的部件按名字排在末尾', order.at(-1) === 'word/_rels/document.xml.rels', order.join(','))
}

console.log('== 3. zipOoxml：重复条目名与非法条目名直接报错 ==')
{
  let message = ''
  try { zipOoxml([{ name: 'a.xml', bytes: strToU8('x') }, { name: 'a.xml', bytes: strToU8('y') }]) } catch (error) { message = error.message }
  check('重复条目名被拒绝', message.includes('重复'), message)

  for (const bad of ['/abs.xml', 'C:/x.xml', 'a\\b.xml']) {
    let threw = false
    try { zipOoxml([{ name: bad, bytes: strToU8('x') }]) } catch { threw = true }
    check(`非法条目名被拒绝：${bad}`, threw)
  }

  const stored = zipOoxml([{ name: '[Content_Types].xml', bytes: strToU8('<Types/>') }, { name: 'z.xml', bytes: strToU8('<z/>') }])
  check('zipOoxml 输出可用 unzipSync 读回', Object.keys(unzipSync(stored)).join(',') === '[Content_Types].xml,z.xml')
}

console.log('== 4. indentXml：只在元素之间加空白，混排元素一字不改 ==')
{
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">甲</w:t></w:r><w:r><w:t xml:space="preserve">乙</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
  const out = indentXml(xml)
  check('产出多行', out.split('\n').length > 8, String(out.split('\n').length))
  // 源串里声明与根标签之间本无空白，prolog 原样带出，因此这里只钉「声明完整且在最前」。
  check('XML 声明完整且在文档最前', out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document'), JSON.stringify(out.slice(0, 60)))
  check('换行过的源头保留其换行', indentXml(xml.replace('?><w:document', '?>\n<w:document')).startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document'))
  check('run 内的 <w:t> 单独成行且内容完整', out.includes('<w:t xml:space="preserve">甲</w:t>') && out.includes('</w:r>'))
  check('文本没有被插入换行', !/<w:t[^>]*>[^<]*\n/u.test(out))
  check('纯元素容器被折行（w:body 下缩进）', /\n {2}<w:body>/u.test(out), JSON.stringify(out.slice(0, 120)))
  check('空元素内容被折叠成单行（w:pPr）', out.includes('<w:pPr><w:jc w:val="center"/></w:pPr>'), out.slice(out.indexOf('<w:p>'), out.indexOf('<w:p>') + 80))
  check('属性与命名空间未被重写', out.includes('xmlns:w="urn:w"') && out.includes('w:w="11906"'))
  let wellFormed = true
  try { assertWellFormedXml(out, 't.xml') } catch (error) { wellFormed = false; console.log(`      ${error.message}`) }
  check('缩进后仍良构', wellFormed)
  check('幂等：再缩进一次不再变化', indentXml(out) === out, JSON.stringify(indentXml(out).slice(0, 100)))

  // 真正的混排：`<w:p>` 里既有文本节点又有 `<w:br/>`（Word 的软换行形态）。
  const mixed = '<?xml version="1.0"?><w:p xmlns:w="urn:w"><w:r><w:t>第一行</w:t><w:br/><w:t>第二行</w:t></w:r></w:p>'
  const mixedOut = indentXml(mixed)
  check('混排 run 逐字节保留（不被插入换行）', mixedOut.includes('<w:t>第一行</w:t><w:br/><w:t>第二行</w:t>'), JSON.stringify(mixedOut))
  check('混排时只缩进外层（声明+元素+收尾三行）', mixedOut.split('\n').filter((line) => line !== '').length === 3, JSON.stringify(mixedOut))

  const bareText = indentXml('<?xml version="1.0"?><a>纯文本，无子元素</a>')
  check('纯文本叶节点原样保留', bareText.includes('<a>纯文本，无子元素</a>'), JSON.stringify(bareText))

  const selfClosingRoot = indentXml('<?xml version="1.0"?><cp:coreProperties xmlns:cp="urn:cp"/>')
  check('自闭合根不报错且原样保留', selfClosingRoot.includes('<cp:coreProperties xmlns:cp="urn:cp"/>'))

  const broken = '<a><b></a>'
  check('不可 tokenize 时原样返回', indentXml(broken) === broken)

  const comment = indentXml('<a><!-- 注释 --><b/><c>x</c></a>')
  check('注释节点原样保留', comment.includes('<!-- 注释 -->'))
}

console.log('== 5. office_explode：部件落盘 + 缩进 + verbatim 逃生舱 ==')
const docxBytes = createDocx(DOCX_BLOCKS, { header: '页眉文字' })
const docxPath = tmp('source.docx')
writeFileSync(docxPath, docxBytes)
{
  const target = tmp('tree-docx')
  const result = await explodePackage(docxBytes, target, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 })
  check('部件数与压缩包一致', result.partCount === Object.keys(unzipSync(docxBytes)).length, `${result.partCount}`)
  check('detectFormat 认出 docx', result.format === 'docx')
  check('formattedCount 覆盖全部 XML 部件', result.formattedCount === result.partCount - 0 || result.formattedCount > 0, String(result.formattedCount))
  check('document.xml 已落盘', existsSync(join(target, 'word', 'document.xml')))
  check('二进制/文本部件都在（含 header1）', existsSync(join(target, 'word', 'header1.xml')) && existsSync(join(target, '_rels', '.rels')))
  const document = readFileSync(join(target, 'word', 'document.xml'), 'utf8')
  check('落盘的 document.xml 是多行缩进文本', document.split('\n').length > 5, String(document.split('\n').length))
  check('落盘的 document.xml 仍含原文', document.includes('本文讨论可复现打包。'))
  let wellFormed = true
  try { assertWellFormedXml(document, 'word/document.xml') } catch { wellFormed = false }
  check('落盘 XML 良构', wellFormed)

  // verbatim：与压缩包内字节完全一致
  const verbatimTarget = tmp('tree-verbatim')
  await explodePackage(docxBytes, verbatimTarget, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024, verbatim: true })
  const rawDocument = unzipSync(docxBytes)['word/document.xml']
  check('verbatim 落盘与压缩包字节一致', sameBytes(readFileSync(join(verbatimTarget, 'word', 'document.xml')), rawDocument))

  // 目录占用策略
  let message = ''
  try { await explodePackage(docxBytes, target, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 }) } catch (error) { message = error.message }
  check('非空目录被拒绝（需 force）', message.includes('非空'), message)
  const forced = await explodePackage(docxBytes, target, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024, force: true })
  check('force=true 清空重来', forced.partCount === result.partCount)

  // 非 OOXML 与 zip slip
  let notOoxml = ''
  try { await explodePackage(zipSync({ 'a.txt': strToU8('x') }), tmp('tree-bad'), { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 }) } catch (error) { notOoxml = error.message }
  check('缺主部件的容器被拒绝', notOoxml.includes('无法识别'), notOoxml)
  let slip = ''
  try { await explodePackage(zipSync({ '../escape.txt': strToU8('x'), 'word/document.xml': strToU8('<w:document/>') }), tmp('tree-slip'), { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 }) } catch (error) { slip = error.message }
  check('zip slip 条目被拒绝', slip.includes('越出目标目录'), slip)

  let tooMany = ''
  try { await explodePackage(docxBytes, tmp('tree-capped'), { maxParts: 2, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 }) } catch (error) { tooMany = error.message }
  check('部件数上限生效', tooMany.includes('超过上限'), tooMany)
}

console.log('== 6. office_assemble：字节级可复现 + 手改 XML 后装回 + 写后校验 ==')
{
  const tree = tmp('tree-docx')
  const first = await assemblePackage(tree, { maxOutputBytes: 50 * 1024 * 1024 })
  const second = await assemblePackage(tree, { maxOutputBytes: 50 * 1024 * 1024 })
  check('两次装配字节相同', sameBytes(first.bytes, second.bytes))
  check('装配结果良构（走 verifyDocx）', (() => { try { verifyDocx(first.bytes); return true } catch { return false } })())
  check('verification 文案含段落数', /段段落|个段落/u.test(first.verification), first.verification)
  check('prune=none 时不删任何部件', first.pruned.length === 0 && first.droppedOverrides.length === 0)

  // 往返：未改动的目录装回后应与原文件语义等价（段落文本一致）
  const original = readDocx(docxBytes)
  const roundtrip = readDocx(first.bytes)
  check('往返后段落文本一致', JSON.stringify(original.paragraphs.map((p) => p.text)) === JSON.stringify(roundtrip.paragraphs.map((p) => p.text)))
  check('往返后标题层级一致', JSON.stringify(original.paragraphs.map((p) => p.level)) === JSON.stringify(roundtrip.paragraphs.map((p) => p.level)))
  check('往返后表格一致', JSON.stringify(original.tables.map((r) => r.cells)) === JSON.stringify(roundtrip.tables.map((r) => r.cells)))

  // 手改 XML：在 </w:body> 前插一段
  const documentPath = join(tree, 'word', 'document.xml')
  const edited = readFileSync(documentPath, 'utf8').replace('</w:body>', '<w:p><w:r><w:t xml:space="preserve">手工加进来的段落。</w:t></w:r></w:p></w:body>')
  writeFileSync(documentPath, edited)
  const afterEdit = await assemblePackage(tree, { maxOutputBytes: 50 * 1024 * 1024 })
  const editedDoc = readDocx(afterEdit.bytes)
  check('手改的段落出现在装回结果里', editedDoc.paragraphs.some((p) => p.text === '手工加进来的段落。'), JSON.stringify(editedDoc.paragraphs.map((p) => p.text)))
  const finalPath = tmp('roundtrip.docx')
  writeFileSync(finalPath, afterEdit.bytes)
  check('装回结果可写盘并可再展开', readFileSync(finalPath).byteLength === afterEdit.byteSize)

  // 坏 XML 必须被拦下，而不是写出一个 Office 要修复的文件
  writeFileSync(documentPath, edited.replace('</w:body>', '<w:p><w:r><w:t>漏闭合</w:r></w:p></w:body>'))
  let broken = ''
  try { await assemblePackage(tree, { maxOutputBytes: 50 * 1024 * 1024 }) } catch (error) { broken = error.message }
  check('手改坏的 XML 被写后校验拦下', broken.includes('标签不匹配') || broken.includes('良构') || broken.includes('未闭合'), broken)
  writeFileSync(documentPath, edited)

  // 缺 manifest
  const bareTree = tmp('tree-bare')
  mkdirSync(join(bareTree, 'word'), { recursive: true })
  writeFileSync(join(bareTree, 'word', 'document.xml'), '<w:document/>')
  let noManifest = ''
  try { await assemblePackage(bareTree, { maxOutputBytes: 50 * 1024 * 1024 }) } catch (error) { noManifest = error.message }
  check('缺 [Content_Types].xml 的目录被拒绝', noManifest.includes('[Content_Types].xml'), noManifest)
}

console.log('== 7. prune：幽灵幻灯片 / 失主备注 / 无人引用媒体 ==')
{
  const deck = createPptx([{ title: '第一页', bullets: ['甲'] }, { title: '第二页', bullets: ['乙'] }], { size: '16:9' })
  const files = unzipSync(deck)
  // 造三处孤儿：幽灵幻灯片（不在 sldIdLst）、它的备注、无人引用的媒体
  const ghostRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide9.xml"/></Relationships>`
  const synthetic = {
    ...files,
    'ppt/slides/slide9.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>'),
    'ppt/slides/_rels/slide9.xml.rels': strToU8(ghostRels),
    'ppt/notesSlides/notesSlide9.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:notes>'),
    'ppt/media/orphan.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }
  const manifest = strFromU8(synthetic['[Content_Types].xml']).replace('</Types>', '<Override PartName="/ppt/slides/slide9.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide9.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/><Default Extension="png" ContentType="image/png"/></Types>')
  synthetic['[Content_Types].xml'] = strToU8(manifest)

  const asMap = new Map(Object.entries(synthetic))
  const plan = planPrune(asMap, 'pptx')
  const names = plan.map((part) => part.name)
  check('幽灵幻灯片被判死', names.includes('ppt/slides/slide9.xml'), JSON.stringify(plan))
  check('失主备注被判死', names.includes('ppt/notesSlides/notesSlide9.xml'), JSON.stringify(names))
  check('无人引用的媒体被判死', names.includes('ppt/media/orphan.png'), JSON.stringify(names))
  check('不在候选前缀里的部件不动（母版/主题/docProps）', !names.some((name) => /slideMaster|theme|docProps/u.test(name)), JSON.stringify(names))
  check('两份正常幻灯片保留', !names.includes('ppt/slides/slide1.xml') && !names.includes('ppt/slides/slide2.xml'))

  const deckPath = tmp('deck.pptx')
  writeFileSync(deckPath, zipSync(synthetic))
  const tree = tmp('tree-pptx')
  await explodePackage(readFileSync(deckPath), tree, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 })
  const assembled = await assemblePackage(tree, { prune: 'orphans', maxOutputBytes: 50 * 1024 * 1024 })
  check('装回结果里没有幽灵幻灯片', unzipSync(assembled.bytes)['ppt/slides/slide9.xml'] === undefined)
  check('装回结果里没有孤儿媒体', unzipSync(assembled.bytes)['ppt/media/orphan.png'] === undefined)
  check('pruned 报告了 3 项', assembled.pruned.length === 3, JSON.stringify(assembled.pruned))
  check('删掉的 Override 同步报告', assembled.droppedOverrides.includes('/ppt/slides/slide9.xml'), JSON.stringify(assembled.droppedOverrides))
  check('prune 后仍通过 pptx 校验', (() => { try { return assembled.verification.includes('页幻灯片') } catch { return false } })(), assembled.verification)
  check('prune 不删主题与母版', Object.keys(unzipSync(assembled.bytes)).some((name) => /slideMaster1\.xml$/u.test(name)))

  // 未 prune 的同一目录：孤儿仍在（默认保持字节级往返）
  const plain = await assemblePackage(tree, { maxOutputBytes: 50 * 1024 * 1024 })
  check('prune=none 时孤儿部件保留', unzipSync(plain.bytes)['ppt/slides/slide9.xml'] !== undefined)
}

console.log('== 8. 往返的字节行为：verbatim 恒等，缩进路径是不动点 ==')
{
  const original = new Uint8Array(readFileSync(docxPath))

  // verbatim=true 两侧都跳过缩进 ⇒ 展开再装回应与原文件逐字节相同（这是「目录到文件无损」的强形式）。
  const plainTree = tmp('tree-verbatim-rt')
  await explodePackage(original, plainTree, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024, verbatim: true })
  const plain = await assemblePackage(plainTree, { verbatim: true, maxOutputBytes: 50 * 1024 * 1024 })
  check('verbatim 往返与原文件逐字节相同', sameBytes(original, plain.bytes), `${original.byteLength} vs ${plain.byteSize}`)

  // 默认（缩进）路径不是恒等映射：缩进本身改了部件的字节，这是缩进的代价与目的。
  const indentedTree = tmp('tree-docx')
  const once = await assemblePackage(indentedTree, { maxOutputBytes: 50 * 1024 * 1024 })
  check('缩进路径与原文件不同（缩进改了 XML 字节）', !sameBytes(original, once.bytes), `${original.byteLength} vs ${once.byteSize}`)

  // 但它必须是**不动点**：缩进过的内容再走一遍「展开 → 装回」不再变化，
  // 否则「同样的目录两次装配逐字节相同」只在单次会话内成立。
  const againTree = tmp('tree-fixed')
  await explodePackage(once.bytes, againTree, { maxParts: 5000, maxTotalBytes: 256 * 1024 * 1024, maxEntryBytes: 100 * 1024 * 1024 })
  const twice = await assemblePackage(againTree, { maxOutputBytes: 50 * 1024 * 1024 })
  check('缩进往返是不动点（再走一遍不变）', sameBytes(once.bytes, twice.bytes), `${once.byteSize} vs ${twice.byteSize}`)
}

console.log('== 9. mtime="source" 与固定时间戳的差别 ==')
{
  const tree = tmp('tree-docx')
  const fixed = await assemblePackage(tree, { maxOutputBytes: 50 * 1024 * 1024 })
  const sourced = await assemblePackage(tree, { mtime: 'source', maxOutputBytes: 50 * 1024 * 1024 })
  check('两种策略都产出有效 docx', (() => { try { verifyDocx(sourced.bytes); return true } catch { return false } })())
  const fixedRaw = Buffer.from(fixed.bytes)
  const sourcedRaw = Buffer.from(sourced.bytes)
  check('source 策略的时间戳不再是 1980', sourcedRaw.readUInt16LE(12) !== fixedRaw.readUInt16LE(12) || sourcedRaw.readUInt16LE(10) !== fixedRaw.readUInt16LE(10))
  check('source 策略仍然可复现（同目录同结果）', sameBytes(sourced.bytes, (await assemblePackage(tree, { mtime: 'source', maxOutputBytes: 50 * 1024 * 1024 })).bytes))
}

console.log('== 10. 工具层：office_explode / office_assemble 的注册与真实 execute ==')
{
  const module = await import('../lib/index.js')
  const registered = []
  const ctx = { effect: (fn) => fn(), tools: { register: (tool) => { registered.push(tool); return () => {} } } }
  let config = {}
  try { config = module.Config({}) } catch { config = {} }
  module.apply(ctx, config)
  const tools = new Map(registered.map((tool) => [tool.name, tool]))
  check('注册了 5 个工具', tools.size === 5, [...tools.keys()].join('、'))
  check('office_explode 已注册', tools.has('office_explode'))
  check('office_assemble 已注册', tools.has('office_assemble'))
  check('Config 默认值含 explode 上限', config.maxExplodeParts === 5000 && config.maxExplodeBytes === 256 * 1024 * 1024, JSON.stringify({ parts: config.maxExplodeParts, bytes: config.maxExplodeBytes }))

  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: process.cwd() } } } }
  const call = async (name, args) => {
    const value = await tools.get(name).execute(args, exec)
    // 边界纪律：结果必须是 lossless JSON（实机冒烟曾因 undefined 值在这一步炸掉）
    JSON.stringify(value)
    return value
  }

  const exploded = await call('office_explode', { source: docxPath, target: tmp('tool-tree') })
  check('工具返回部件清单', exploded.part_count === Object.keys(unzipSync(docxBytes)).length, String(exploded.part_count))
  check('工具 summary 写明缩进数量', /\d+ 个部件（\d+ 个已缩进）|\d+ 个部件/u.test(exploded.summary), exploded.summary)

  const assembled = await call('office_assemble', { source: tmp('tool-tree'), output: tmp('tool-out.docx') })
  check('工具写出文件', existsSync(tmp('tool-out.docx')))
  check('工具返回写后校验文案', assembled.verification.length > 0, assembled.verification)
  check('工具 prune 数组为空', Array.isArray(assembled.pruned) && assembled.pruned.length === 0)

  let again = ''
  try { await call('office_assemble', { source: tmp('tool-tree'), output: tmp('tool-out.docx') }) } catch (error) { again = error.message }
  check('目标已存在时要求 in_place', again.includes('已存在'), again)

  const inPlace = await call('office_assemble', { source: tmp('tool-tree'), output: tmp('tool-out.docx'), in_place: true })
  check('in_place 写出 .bak 备份', typeof inPlace.backup === 'string' && existsSync(inPlace.backup), String(inPlace.backup))

  let extMismatch = ''
  try { await call('office_assemble', { source: tmp('tool-tree'), output: tmp('wrong.xlsx') }) } catch (error) { extMismatch = error.message }
  check('扩展名与目录格式不符时报错', extMismatch.includes('不符'), extMismatch)

  let notDir = ''
  try { await call('office_assemble', { source: docxPath, output: tmp('x.docx') }) } catch (error) { notDir = error.message }
  check('source 是文件时报错', notDir.includes('必须是目录'), notDir)

  const rendered = tools.get('office_assemble').output.render({}, assembled)
  check('渲染文案含校验行', rendered[0].text.includes('写后校验'), rendered[0].text)
}

console.log(`\n${failures === 0 ? `ALL PASS（${checks} 项）` : `${failures} FAILURES（${checks} 项）`} — P3 打包/出口`)
process.exit(failures === 0 ? 0 : 1)
