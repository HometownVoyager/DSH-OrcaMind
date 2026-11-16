/**
 * P0 回归测试：比对报告 §3.1.4 / §3.4.3 / §3.3.2 列出的每个缺陷。
 *
 * 每个用例先构造出触发缺陷的输入（内存中的 OOXML，不落盘），再断言缺陷不再出现。
 * 用法：node tests/p0-regression.mjs（在 dsh-office-editor 目录下）
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createDocx, editDocx, verifyDocx, scanParas, replaceInParagraph, assertWellFormedXml, acceptRevisionsInPart, bodyAppendOffset } from '../lib/docx.js'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

let failures = 0
let checks = 0
const check = (name, condition, detail = '') => {
  checks++
  if (condition) console.log(`  ok   - ${name}`)
  else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
}

/** Build a minimal but complete .docx around a given body XML. */
function docxWithBody(bodyXml, extra = {}) {
  const documentXml = `${XML_DECL}<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr></w:body></w:document>`
  const files = {
    '[Content_Types].xml': strToU8(`${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    '_rels/.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(documentXml),
    ...extra,
  }
  return zipSync(files)
}

const bodyOf = (bytes) => strFromU8(unzipSync(bytes)['word/document.xml'])

console.log('== D1: replace_text 命中嵌套（文本框）段落时不得产出畸形 XML ==')
{
  const body = '<w:p><w:r><w:t>外层 匹配</w:t></w:r><w:r><w:t xml:space="preserve">文本</w:t></w:r>'
    + '<w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>内层 匹配</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>'
    + '<w:p><w:r><w:t>末段</w:t></w:r></w:p>'
  const input = docxWithBody(body)
  const out = await editDocx(input, [{ op: 'replace_text', old: '匹配', new: 'X' }])
  const xml = bodyOf(out.bytes)
  let wellFormed = true
  let message = ''
  try { assertWellFormedXml(xml, 'word/document.xml') } catch (error) { wellFormed = false; message = error.message }
  check('输出 XML 良构', wellFormed, message)
  check('页码属性完整（<w:pgSz 后仍是完整元素）', /<w:pgSz w:w="11906" w:h="16838"\/>/u.test(xml), xml.slice(xml.indexOf('<w:pgSz'), xml.indexOf('<w:pgSz') + 80))
  check('顶层段落数为 2（文本框内层段落不计入）', scanParas(xml).length === 2, `got ${scanParas(xml).length}`)
  check('文本框内层文本也被替换', xml.includes('内层 X'), xml)
  // 命中只覆盖 "匹配" 两个字符，所以 run 1 变成 "外层 X"，run 2 的 "文本" 原样保留。
  check('外层段落文本被替换', xml.includes('<w:t>外层 X</w:t>') && xml.includes('<w:t xml:space="preserve">文本</w:t>'), xml)
  check('verifyDocx 通过良构校验', (() => { try { verifyDocx(out.bytes); return true } catch { return false } })())
}

console.log('== D1b: verifyDocx 能抓到畸形 XML（旧实现自证通过） ==')
{
  // 手工制造一个被切片吃掉的 XML：</w:sectPr> 缺失
  const broken = docxWithBody('<w:p><w:r><w:t>甲</w:t></w:r></w:p>')
  const files = unzipSync(broken)
  files['word/document.xml'] = strToU8(`${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>甲</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="1" w:h="1"/><w:p></w:body></w:document>`)
  let caught = false
  try { verifyDocx(zipSync(files)) } catch { caught = true }
  check('verifyDocx 拒绝标签不匹配的部件', caught)
  let caughtMissing = false
  const noDoc = unzipSync(broken)
  delete noDoc['word/document.xml']
  try { verifyDocx(zipSync(noDoc)) } catch { caughtMissing = true }
  check('verifyDocx 拒绝缺少 word/document.xml', caughtMissing)
}

console.log('== D2: append_paragraph 必须把段落插在 w:sectPr 之前 ==')
{
  const empty = docxWithBody('')
  const out = await editDocx(empty, [{ op: 'append_paragraph', text: '新段' }])
  const xml = bodyOf(out.bytes)
  const sectAt = xml.indexOf('<w:sectPr')
  const paraAt = xml.indexOf('<w:p>')
  check('段落出现在 sectPr 之前', paraAt !== -1 && paraAt < sectAt, `para@${paraAt} sect@${sectAt}`)
  check('sectPr 仍是 w:body 的最后一个子元素', /<\/w:p><w:sectPr>/u.test(xml), xml)
  let wellFormed = true
  try { assertWellFormedXml(xml, 'word/document.xml') } catch (error) { wellFormed = false; console.log(`      ${error.message}`) }
  check('body 无段落时输出仍良构', wellFormed)
}

console.log('== D2b: w:sectPrChange 不得被误认为 w:sectPr ==')
{
  const body = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr><w:sectPrChange w:id="1"><w:sectPr/></w:sectPrChange></w:pPr><w:r><w:t>分节段</w:t></w:r></w:p>'
  const input = docxWithBody(body)
  const xml = bodyOf(input)
  const paras = scanParas(xml)
  check('分节符段落被识别为 1 段', paras.length === 1, `got ${paras.length}`)
  const out = await editDocx(input, [{ op: 'append_paragraph', text: '尾段' }])
  const after = bodyOf(out.bytes)
  // 正文级 sectPr 是 body 的最后一段；段落内的 <w:sectPr> / <w:sectPrChange> 都不算。
  const bodySectAt = after.indexOf('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar')
  const tailAt = after.indexOf('尾段')
  check('尾段插到正文级 sectPr 之前', tailAt !== -1 && bodySectAt !== -1 && tailAt > bodySectAt && after.indexOf('</w:sectPr>', bodySectAt) < tailAt, `tail@${tailAt} bodySect@${bodySectAt}`)
  check('原分节符段落完整保留', after.includes('<w:sectPrChange w:id="1">'), after)
}

console.log('== D3: 段落寻址契约（编辑器与读取器一致；含空段落与分页段） ==')
{
  const created = createDocx([
    { type: 'heading', text: '标题', level: 1 },
    { type: 'paragraph', text: '正文' },
    { type: 'pagebreak' },
    { type: 'paragraph', text: '尾段' },
  ])
  const audit = verifyDocx(created)
  check('verifyDocx 报 4 段（含分页空段）', audit.paragraphCount === 4, `got ${audit.paragraphCount}`)
  check('空段落下标为第 3 段', audit.emptyParagraphs.length === 1 && audit.emptyParagraphs[0] === 3, JSON.stringify(audit.emptyParagraphs))
  // 第 3 段（分页段）必须可按 index 直接寻址
  const out = await editDocx(created, [{ op: 'set_paragraph', index: 3, text: '不再是分页' }])
  check('空段落可按 index=3 寻址并改写', out.paragraphs[2] === '不再是分页', JSON.stringify(out.paragraphs))
  check('改写空段落后段落数不变', out.paragraphs.length === 4, JSON.stringify(out.paragraphs))
}

console.log('== D4: replace_text 不得摧毁命中段落里的分页符/域/书签 ==')
{
  const body = '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>甲</w:t></w:r></w:p>'
  const out = await editDocx(docxWithBody(body), [{ op: 'replace_text', old: '甲', new: '乙' }])
  const xml = bodyOf(out.bytes)
  check('分页符保留', xml.includes('<w:br w:type="page"/>'), xml)
  check('文本已替换', xml.includes('>乙<'), xml)

  const withField = '<w:p><w:r><w:t>第 </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t> 页 甲</w:t></w:r></w:p>'
  const out2 = await editDocx(docxWithBody(withField), [{ op: 'replace_text', old: '甲', new: '乙' }])
  const xml2 = bodyOf(out2.bytes)
  check('PAGE 域不被摧毁', xml2.includes('PAGE') && xml2.includes('<w:fldChar w:fldCharType="begin"/>'), xml2)
  check('域所在段落文本正确替换', xml2.includes(' 页 乙'), xml2)

  const withBookmark = '<w:p><w:bookmarkStart w:id="0" w:name="锚"/><w:r><w:t>甲</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>'
  const out3 = await editDocx(docxWithBody(withBookmark), [{ op: 'replace_text', old: '甲', new: '乙' }])
  check('书签锚点保留', bodyOf(out3.bytes).includes('w:name="锚"'), bodyOf(out3.bytes))
}

console.log('== D5: 保留段落样式与 run 级格式（非破坏性改写） ==')
{
  const body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>红色加粗标题甲</w:t></w:r></w:p>'
  const out = await editDocx(docxWithBody(body), [{ op: 'replace_text', old: '甲', new: '乙' }])
  const xml = bodyOf(out.bytes)
  check('pStyle 保留', xml.includes('<w:pStyle w:val="Heading1"/>'), xml)
  check('段落对齐保留', xml.includes('<w:jc w:val="center"/>'), xml)
  check('run 级 rPr 保留', xml.includes('<w:color w:val="FF0000"/>'), xml)
  check('只有 <w:t> 内容变化', xml.includes('红色加粗标题乙'), xml)

  // 跨 run 拆分的占位符：两个 run 分别持有 "{{ti" 与 "tle}}"
  const split = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{{ti</w:t></w:r><w:r><w:t>tle}}</w:t></w:r><w:r><w:t xml:space="preserve"> 尾</w:t></w:r></w:p>'
  const out2 = await editDocx(docxWithBody(split), [{ op: 'replace_text', old: '{{title}}', new: '跨run替换' }])
  const xml2 = bodyOf(out2.bytes)
  check('跨 run 占位符可命中', out2.paragraphs[0] === '跨run替换 尾', JSON.stringify(out2.paragraphs))
  check('两个命中 run 的 rPr 结构保持（未塌缩为单 run）', (xml2.match(/<w:r>/gu) ?? []).length === 3, xml2)
  check('保留 run 的加粗仍在', xml2.includes('<w:rPr><w:b/></w:rPr>'), xml2)
}

console.log('== D5b: set_paragraph 保留段落属性、只重写可见文本 ==')
{
  const body = '<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>旧标题</w:t></w:r></w:p>'
  const out = await editDocx(docxWithBody(body), [{ op: 'set_paragraph', index: 1, text: '新标题' }])
  const xml = bodyOf(out.bytes)
  check('pStyle 保留', xml.includes('<w:pStyle w:val="Heading2"/>'), xml)
  check('编号 numPr 保留', xml.includes('<w:numId w:val="7"/>'), xml)
  check('首个 run 的 rPr 被继承', xml.includes('<w:rPr><w:i/></w:rPr>'), xml)
  check('文本已替换', out.paragraphs[0] === '新标题', JSON.stringify(out.paragraphs))
}

console.log('== D6: 表格必须有 w:tblGrid ==')
{
  const created = createDocx([{ type: 'table', rows: [['a', 'b'], ['c', 'd']], header: true }])
  const xml = strFromU8(unzipSync(created)['word/document.xml'])
  check('输出含 w:tblGrid', xml.includes('<w:tblGrid>'), xml.slice(0, 400))
  check('gridCol 数与列数一致', (xml.match(/<w:gridCol /gu) ?? []).length === 2, xml)
  check('表格创建后良构', (() => { try { verifyDocx(created); return true } catch { return false } })())
}

console.log('== 段落文本提取：自闭合 <w:t/> 不得吞掉后续文本 ==')
{
  const xml = '<w:p><w:r><w:t/></w:r><w:r><w:t>后续文本</w:t></w:r></w:p>'
  const spans = scanParas(xml)
  check('自闭合 w:t 后文本完整', spans[0].text === '后续文本', JSON.stringify(spans[0].text))
  const r = replaceInParagraph(xml, '后续', 'X')
  check('自闭合 w:t 不影响替换', r.count === 1 && r.xml.includes('>X文本<'), r.xml)
}

console.log('== 良构性校验器：能抓住各类损坏 ==')
{
  const cases = [
    ['未闭合标签', `<a><b></a>`],
    ['多余闭合', `<a></a></b>`],
    ['根前有内容', `x<a></a>`],
    ['根后有多余元素', `<a></a><b></b>`],
    ['标签错序', `<a><b></b></a></c>`],
  ]
  for (const [name, xml] of cases) {
    let threw = false
    try { assertWellFormedXml(xml, 't.xml') } catch { threw = true }
    check(`拒绝：${name}`, threw, xml)
  }
  const okCases = [
    `<a><b/></a>`,
    `${XML_DECL}<a x="1 > 0"><b>text &amp; more</b></a>`,
    `<a><!-- <b> --><c/></a>`,
    `<a xmlns:w="urn:x"><w:p/></a>`,
  ]
  for (const xml of okCases) {
    let ok = true
    try { assertWellFormedXml(xml, 't.xml') } catch (error) { ok = false; console.log(`      ${error.message}`) }
    check(`接受合法：${xml.slice(0, 40)}`, ok)
  }
}

console.log('== bodyAppendOffset：sectPr 缺失时回落到 </w:body> ==')
{
  const xml = `<w:body><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:body>`
  const at = bodyAppendOffset(xml, scanParas(xml))
  check('无 sectPr 时插到 </w:body> 之前', at === xml.indexOf('</w:body>'), `at=${at}`)
}

console.log('== accept_revisions：无 Word 接受全部修订 ==')
{
  const body = '<w:p><w:r><w:t>保留</w:t></w:r><w:ins w:id="1" w:author="a"><w:r><w:t>插入</w:t></w:r></w:ins><w:del w:id="2" w:author="a"><w:r><w:delText>删除</w:delText></w:r></w:del></w:p>'
  const result = acceptRevisionsInPart(body)
  check('w:ins 解包保留内容', result.xml.includes('插入') && !result.xml.includes('<w:ins'), result.xml)
  check('w:del 内容丢弃', !result.xml.includes('删除'), result.xml)
  check('w:delText 转回 w:t', !result.xml.includes('delText'), result.xml)
  check('修订计数正确（ins + del 各一处）', result.count === 2, `got ${result.count}`)

  const created = createDocx([{ type: 'paragraph', text: '正文' }, { type: 'paragraph', text: '下一段' }])
  let threw = false
  try { await editDocx(created, [{ op: 'accept_revisions' }]) } catch { threw = true }
  check('无修订文档 accept_revisions 明确失败而不是静默通过', threw)
}

console.log('== 操作失败时的错误定位 ==')
{
  const created = createDocx([{ type: 'paragraph', text: '甲' }])
  let message = ''
  try { await editDocx(created, [{ op: 'set_paragraph', index: 99, text: 'x' }]) } catch (error) { message = error.message }
  check('越界段落号报「第 1 个操作失败」', message.startsWith('第 1 个操作失败') && message.includes('越界'), message)
  message = ''
  try { await editDocx(created, [{ op: 'replace_text', old: '不存在的文本', new: 'x' }]) } catch (error) { message = error.message }
  check('replace_text 未命中明确报错', message.includes('未找到文本'), message)
}

console.log(failures === 0 ? `\nALL PASS（${checks} 项）` : `\n${failures}/${checks} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
