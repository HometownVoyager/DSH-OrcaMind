/**
 * 段落寻址契约测试：dsh-office-editor 与 dsh-office-reader 必须对「第 N 段」给出同一答案。
 *
 * 两个插件在构建期互相独立（各自只 link dsh 检出，没有彼此的依赖），所以遍历逻辑是**镜像实现**：
 * `office-editor/src/docx.ts` 的 `scanParas` 与 `office-reader/src/ooxml.ts` 的
 * `splitWordParagraphs`。本测试是唯一把它们钉在一起的东西——任何一侧改了遍历规则而另一侧没跟，
 * 这里必须红。
 *
 * 读取器路径按 Plugins/ 同级目录解析；缺失时跳过并明确报告（不静默通过）。
 * 用法：node tests/paragraph-contract.mjs（在 dsh-office-editor 目录下）
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createDocx, editDocx, scanParas } from '../lib/docx.js'

const here = dirname(fileURLToPath(import.meta.url))
const readerLib = join(here, '..', '..', 'dsh-office-reader', 'lib', 'ooxml.js')
const readerDocxLib = join(here, '..', '..', 'dsh-office-reader', 'lib', 'docx.js')

let failures = 0
let checks = 0
const check = (name, condition, detail = '') => {
  checks++
  if (condition) console.log(`  ok   - ${name}`)
  else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
}

if (!existsSync(readerLib) || !existsSync(readerDocxLib)) {
  console.log(`SKIP - 找不到 dsh-office-reader 的构建产物：${readerLib}`)
  console.log('       先构建 reader（Plugins/dsh-office-reader 下 bash scripts/build.sh）再跑本测试。')
  process.exit(2)
}
const { splitWordParagraphs } = await import(new URL(`file://${readerLib.replace(/\\/gu, '/')}`).href)
const { readDocx } = await import(new URL(`file://${readerDocxLib.replace(/\\/gu, '/')}`).href)

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function docxWithBody(bodyXml) {
  return zipSync({
    '[Content_Types].xml': strToU8(`${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    '_rels/.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`),
  })
}

/** Compare the editor's spans with the reader's paragraphs for one document.xml. */
function assertAgreement(label, documentXml, bytes) {
  const editorSpans = scanParas(documentXml)
  const readerSpans = splitWordParagraphs(documentXml)
  check(`${label}：段数一致`, editorSpans.length === readerSpans.length, `editor ${editorSpans.length} vs reader ${readerSpans.length}`)
  check(`${label}：每段文本一致`, editorSpans.every((s, i) => s.text === readerSpans[i]?.text), JSON.stringify({ editor: editorSpans.map((s) => s.text), reader: readerSpans.map((s) => s.text) }))
  check(`${label}：空段落位置一致`, editorSpans.every((s, i) => s.empty === readerSpans[i]?.empty), JSON.stringify(editorSpans.map((s) => s.empty)))
  check(`${label}：span 起止一致`, editorSpans.every((s, i) => s.start === readerSpans[i]?.start && s.end === readerSpans[i]?.end), JSON.stringify(editorSpans.map((s) => [s.start, s.end])))
  if (bytes !== undefined) {
    const doc = readDocx(bytes)
    check(`${label}：reader.readDocx 的 index 1..N 与编辑器 index 一致`, doc.paragraphs.length === editorSpans.length && doc.paragraphs.every((p, i) => p.index === i + 1 && p.text === editorSpans[i].text), JSON.stringify(doc.paragraphs.map((p) => [p.index, p.text])))
  }
}

console.log('== 契约 1：office_create 产出的文档 ==')
{
  const bytes = createDocx([
    { type: 'heading', text: '标题', level: 1 },
    { type: 'paragraph', text: '正文段落' },
    { type: 'list', items: ['甲', '乙'], ordered: true },
    { type: 'pagebreak' },
    { type: 'table', rows: [['r1c1', 'r1c2'], ['r2c1', 'r2c2']], header: true },
    { type: 'paragraph', text: '尾段' },
  ])
  const xml = strFromU8(unzipSync(bytes)['word/document.xml'])
  assertAgreement('create 输出', xml, bytes)
  // 表格单元格段落必须可寻址：标题1 + 正文1 + 列表2 + 分页1 + 单元格4 + 尾段1 = 10
  check('表格单元格段落计入编号', scanParas(xml).length === 10, `got ${scanParas(xml).length}`)
}

console.log('== 契约 2：文本框内嵌段落不计入编号 ==')
{
  const body = '<w:p><w:r><w:t>宿主段</w:t></w:r><w:r><w:pict><v:shape><v:textbox><w:txbxContent>'
    + '<w:p><w:r><w:t>框内一</w:t></w:r></w:p><w:p><w:r><w:t>框内二</w:t></w:r></w:p>'
    + '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p><w:p><w:r><w:t>末段</w:t></w:r></w:p>'
  const documentXml = `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  assertAgreement('文本框', documentXml, docxWithBody(body))
  check('文本框：只有 2 个顶层段落', scanParas(documentXml).length === 2, `got ${scanParas(documentXml).length}`)
}

console.log('== 契约 3：空段落 / 自闭合段落 / 分节符段落都占位 ==')
{
  const body = '<w:p/><w:p><w:r><w:t>甲</w:t></w:r></w:p><w:p></w:p>'
    + '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr><w:r><w:t>分节段</w:t></w:r></w:p>'
    + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  const documentXml = `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  assertAgreement('空段落', documentXml, docxWithBody(body))
  check('空段落：共 5 段', scanParas(documentXml).length === 5, `got ${scanParas(documentXml).length}`)
}

console.log('== 契约 4：编辑后契约仍然成立（含空段落插入） ==')
{
  const created = createDocx([{ type: 'heading', text: '第一章', level: 1 }, { type: 'paragraph', text: '甲' }, { type: 'pagebreak' }, { type: 'paragraph', text: '乙' }])
  const edited = await editDocx(created, [
    { op: 'append_paragraph', text: '新尾段' },
    { op: 'set_paragraph', index: 3, text: '分页段改成文字' },
    { op: 'replace_text', old: '甲', new: '甲改' },
  ])
  const xml = strFromU8(unzipSync(edited.bytes)['word/document.xml'])
  assertAgreement('编辑后', xml, edited.bytes)
}

console.log('== 契约 5：run 拆分与实体转义不影响寻址 ==')
{
  const body = '<w:p><w:r><w:t xml:space="preserve">跨 run </w:t></w:r><w:r><w:t>拼接 &amp; 实体</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>制表</w:t><w:tab/><w:t>符</w:t></w:r></w:p>'
  const documentXml = `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  assertAgreement('run 拆分', documentXml, docxWithBody(body))
  check('跨 run 文本按 run 顺序拼接', scanParas(documentXml)[0].text === '跨 run 拼接 & 实体', JSON.stringify(scanParas(documentXml)[0].text))
  check('制表符归一为 \\t', scanParas(documentXml)[1].text === '制表\t符', JSON.stringify(scanParas(documentXml)[1].text))
}

console.log(failures === 0 ? `\nALL PASS（${checks} 项）` : `\n${failures}/${checks} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
