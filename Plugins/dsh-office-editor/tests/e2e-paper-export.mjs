/**
 * 端到端验收：用编译产物跑一遍「论文分节稿 → 规范 .docx」的完整链路。
 *
 * 覆盖 P1 的每一项：命名样式、页面设置、页眉页脚 + PAGE 域、TOC 域 + w:updateFields、
 * 图片 + alt text、三线表 + 图表题注、占位符批量填充、元数据、修订接受。
 * 产出落 tests/out/（.gitignore 之外的临时目录），并逐项用 verifyDocx / office_read 复核。
 *
 * 用法：node tests/e2e-paper-export.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { createDocx, editDocx, verifyDocx, scanParas } from '../lib/docx.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })

const readerLib = join(here, '..', '..', 'dsh-office-reader', 'lib', 'docx.js')
const { readDocx } = await import(new URL(`file://${readerLib.replace(/\\/gu, '/')}`).href)

let failures = 0
let checks = 0
const check = (name, condition, detail = '') => {
  checks++
  if (condition) console.log(`  ok   - ${name}`)
  else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
}

const partText = (bytes, name) => {
  const entry = unzipSync(bytes)[name]
  return entry === undefined ? null : strFromU8(entry)
}

// ---- 一张极小的真实 PNG（1×1 红点），用于插图与 alt text ----
const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))
const imagePath = join(outDir, 'figure.png')
writeFileSync(imagePath, PNG_1X1)

console.log('== 1. 造一份带规范骨架的学位论文草稿 ==')
let bytes = createDocx([
  { type: 'paragraph', text: '{{title}}', style: 'Title' },
  { type: 'paragraph', text: '{{author}}　{{school}}', style: 'Subtitle' },
  { type: 'heading', text: '摘要', level: 1 },
  { type: 'paragraph', text: '本文研究 {{topic}}，采用 {{method}} 方法。' },
  { type: 'paragraph', text: '关键词：{{keywords}}' },
  { type: 'heading', text: '第一章 绪论', level: 1 },
  { type: 'paragraph', text: '本章说明研究背景与问题。' },
  { type: 'heading', text: '1.1 研究背景', level: 2 },
  { type: 'paragraph', text: '相关研究见 {{cite1}}。' },
  { type: 'list', items: ['研究缺口一', '研究缺口二'], ordered: true },
  { type: 'heading', text: '第二章 方法', level: 1 },
  { type: 'paragraph', text: '方法详见下文。' },
], {
  page: { size: 'A4', orientation: 'portrait', margins: 'thesis' },
  metadata: { title: '学位论文草稿', creator: '论文撰写模式', subject: 'GB/T 7713.1' },
  toc: true,
  header: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">{{title}}</w:t></w:r></w:p>',
})

const audit0 = verifyDocx(bytes)
check('创建后良构且部件齐全', audit0.parts.includes('docProps/core.xml') && audit0.parts.includes('word/settings.xml') && audit0.parts.includes('word/header1.xml'))
check('docProps/app.xml 已写出', audit0.parts.includes('docProps/app.xml'))
const styles = partText(bytes, 'word/styles.xml')
for (const name of ['Title', 'Subtitle', 'Quote', 'Caption', 'ListBullet', 'ListNumber']) {
  check(`styles.xml 含命名样式 ${name}`, styles.includes(`w:styleId="${name}"`), name)
}
check('标题样式声明了 outlineLvl（导航窗格/目录域的前提）', /w:styleId="Heading1"[\s\S]*?<w:outlineLvl w:val="0"\/>/u.test(styles))
check('标题样式带 w:qFormat（Word 内置样式识别）', /w:styleId="Heading1"[\s\S]*?<w:qFormat\/>/u.test(styles))
check('CJK 字体走 w:eastAsia', styles.includes('w:eastAsia="等线"'))
check('TOC 域已插入', partText(bytes, 'word/document.xml').includes('TOC \\o &quot;1-3&quot;'))
check('w:updateFields 已置（Word 打开时生成目录）', partText(bytes, 'word/settings.xml').includes('w:updateFields'))
check('页眉部件已建并被 sectPr 引用', /w:headerReference/u.test(partText(bytes, 'word/document.xml')))
check('页眉引用有对应关系项', partText(bytes, 'word/_rels/document.xml.rels').includes('/header"'))
check('页面设置为 thesis 页边距', partText(bytes, 'word/document.xml').includes('w:left="1701"'))
check('元数据写入 core.xml', partText(bytes, 'docProps/core.xml').includes('<dc:title>学位论文草稿</dc:title>'))

console.log('== 2. 按院校模板占位符批量填充 + 排版 ==')
const filled = await editDocx(bytes, [
  {
    op: 'fill_placeholders',
    values: {
      title: '面向异构数据的检索增强生成方法研究',
      author: '张三',
      school: '计算机科学与技术学院',
      topic: '异构数据下的检索增强生成',
      method: '对比实验与消融分析',
      keywords: '检索增强生成；异构数据；对比实验',
      cite1: '（李四, 2025）',
      // 故意给一个文档里不存在的键，验证「未找到」会被如实报告而不是静默通过
      not_present: 'X',
    },
  },
  { op: 'insert_page_number_footer', text: '第 ' },
  // toc=true 会在正文最前面插入「目录」标题与 TOC 域，所以标题段落不再是第 1 段——
  // 这里按内容定位而不是写死序号，正是为了让编号契约（含空段落）在测试里也被真实使用。
  // 标题本身由 fill_placeholders 填充，跑完仍是 Title 样式（填充保留段落属性与 run 格式）。
  ...(() => {
    const spans = scanParas(partText(bytes, 'word/document.xml'))
    const abstractIndex = spans.findIndex((span) => span.text === '摘要') + 1
    return [
      { op: 'set_paragraph', index: abstractIndex, text: '摘要（中文）', style: 'Heading 1' },
      { op: 'set_metadata', metadata: { title: '面向异构数据的检索增强生成方法研究', creator: '张三' } },
    ]
  })(),
])

console.log('   填充结果：')
for (const line of filled.applied) console.log(`     ${line}`)
check('占位符全部填充（含页眉里的 {{title}}）', !filled.paragraphs.some((p) => p.includes('{{')))
check('标题占位符已替换', filled.paragraphs.includes('面向异构数据的检索增强生成方法研究'), JSON.stringify(filled.paragraphs.slice(0, 5)))
check('填充后标题仍是 Title 命名样式', /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">面向异构数据的检索增强生成方法研究/u.test(partText(filled.bytes, 'word/document.xml').replace(/\n/gu, '')), partText(filled.bytes, 'word/document.xml').slice(0, 400))
check('未找到的占位符被如实报告', filled.applied.some((line) => line.includes('not_present')), JSON.stringify(filled.applied))
check('目录段落仍在位（toc 与正文并存）', filled.paragraphs.includes('目录'), JSON.stringify(filled.paragraphs.slice(0, 3)))
const filledXml = partText(filled.bytes, 'word/document.xml')
check('页脚部件含 PAGE 域', /PAGE/u.test(partText(filled.bytes, 'word/footer1.xml') ?? ''))
check('页脚被 sectPr 引用', /w:footerReference/u.test(filledXml))
check('填充后仍良构', (() => { try { verifyDocx(filled.bytes); return true } catch (error) { console.log(`      ${error.message}`); return false } })())
check('页眉里的占位符也被填充（跨部件）', partText(filled.bytes, 'word/header1.xml').includes('面向异构数据的检索增强生成方法研究'))
check('元数据可增量更新（保留原有 created）', partText(filled.bytes, 'docProps/core.xml').includes('dcterms:created'))

// 无修订的文档：accept_revisions 必须明确失败，避免「以为处理了其实什么也没做」。
let acceptThrew = false
try { await editDocx(filled.bytes, [{ op: 'accept_revisions' }]) } catch { acceptThrew = true }
check('无修订时 accept_revisions 明确报错', acceptThrew)

console.log('== 3. 插图 + 图表题注 + 三线表 ==')
// 图片读取通过宿主钩子注入，引擎本身保持纯函数（工具层传的是会话工作目录解析后的绝对路径）。
const withFigure = await editDocx(filled.bytes, [
  { op: 'insert_figure', path: imagePath, alt: '图 2-1 方法总览：三阶段流水线，输入为异构语料', caption: '图 2-1　方法总览', caption_position: 'below' },
  { op: 'insert_table', rows: [['变量', '均值', '标准差'], ['基线', '0.712', '0.031'], ['本文', '0.798', '0.024']], header: true, caption: '表 2-1　主实验结果' },
], { readFile: async (absolute) => new Uint8Array(readFileSync(absolute)) })
const figureXml = partText(withFigure.bytes, 'word/document.xml')
check('media 部件已写入', Object.keys(unzipSync(withFigure.bytes)).some((n) => /^word\/media\/image\d+\.png$/u.test(n)))
check('alt text 写入 wp:docPr@descr', /wp:docPr[^>]*descr="图 2-1 方法总览/u.test(figureXml), figureXml.slice(figureXml.indexOf('wp:docPr'), figureXml.indexOf('wp:docPr') + 160))
check('图片有 EMU 尺寸', /wp:extent cx="9525" cy="9525"/u.test(figureXml))
check('图片关系已登记', partText(withFigure.bytes, 'word/_rels/document.xml.rels').includes('/image"'))
check('图片 content-type 已登记', partText(withFigure.bytes, '[Content_Types].xml').includes('Extension="png"'))
check('题注使用 Caption 样式', /<w:pStyle w:val="Caption"\/>/u.test(figureXml))
check('题注在图下方（顺序）', figureXml.indexOf('w:drawing') < figureXml.indexOf('图 2-1'), 'drawing 应在题注前')
check('三线表有 tblGrid', (figureXml.match(/<w:tblGrid>/gu) ?? []).length >= 1)
check('表格有 gridCol', (figureXml.match(/<w:gridCol /gu) ?? []).length >= 3)
check('表题已写入', figureXml.includes('表 2-1　主实验结果'))
check('插图后仍良构', (() => { try { verifyDocx(withFigure.bytes); return true } catch (error) { console.log(`      ${error.message}`); return false } })())

console.log('== 4. office_read 复核导出的 .docx ==')
const readerDoc = readDocx(withFigure.bytes)
check('读取器能打开导出文件', readerDoc.paragraphs.length > 0)
check('读取器看到标题层级', readerDoc.paragraphs.some((p) => p.level === 1))
check('读取器段落编号与编辑器一致', readerDoc.paragraphs.length === scanParas(partText(withFigure.bytes, 'word/document.xml')).length, JSON.stringify({ reader: readerDoc.paragraphs.length, editor: scanParas(partText(withFigure.bytes, 'word/document.xml')).length }))
check('读取器能看到题注文本', readerDoc.paragraphs.some((p) => p.text.includes('图 2-1　方法总览')))
check('元数据可读（set_metadata 已更新标题）', readerDoc.metadata.title === '面向异构数据的检索增强生成方法研究', JSON.stringify(readerDoc.metadata))
check('元数据 set_metadata 只改传入字段（subject 保留）', readerDoc.metadata.subject === 'GB/T 7713.1', JSON.stringify(readerDoc.metadata))
check('空段落被保留为单元而不是被吞掉', readerDoc.paragraphs.some((p) => p.empty === true))

console.log('== 5. 交付前四项校验（提示词层清单的代码部分） ==')
const finalText = readerDoc.paragraphs.map((p) => p.text).join('\n')
check('无占位符残留', !/\{\{|\}\}/u.test(finalText))
const leftovers = ['TODO', 'TBD', 'XXX', 'lorem'].filter((token) => finalText.toLowerCase().includes(token.toLowerCase()))
check('无 TODO/TBD/XXX/lorem 残留', leftovers.length === 0, leftovers.join(','))
check('参考文献标注在位', finalText.includes('（李四, 2025）'))

const finalPath = join(outDir, '论文-定稿.docx')
writeFileSync(finalPath, withFigure.bytes)
console.log(`\n产出：${finalPath}（${withFigure.bytes.byteLength} 字节）`)
console.log(`     段落 ${readerDoc.paragraphs.length} 个（含空段落 ${readerDoc.paragraphs.filter((p) => p.empty).length} 个）`)
console.log(`     部件：${verifyDocx(withFigure.bytes).parts.join(', ')}`)

console.log(failures === 0 ? `\nALL PASS（${checks} 项）` : `\n${failures}/${checks} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
