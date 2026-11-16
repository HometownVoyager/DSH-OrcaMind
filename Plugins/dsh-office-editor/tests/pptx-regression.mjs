/**
 * pptx 回归测试：既有 deck 的编辑能力（比对报告 §3.3.3 与 §4.2 第 25-29 条）。
 *
 * 覆盖：按 sldIdLst 寻址（不是文件名编号）、模板填充保留 run 格式、重排、删除、复制（备注一起
 * 复制且不共享）、备注写回、结构校验，以及「我们写出的 deck 能被我们自己的读取器正确读回」。
 *
 * 用法：node tests/pptx-regression.mjs
 */
import { unzipSync, strFromU8 } from 'fflate'
import { createPptx, editPptx, verifyPptx, replaceAcrossRuns, splitElements } from '../lib/pptx.js'

const readerLib = new URL('../../dsh-office-reader/lib/pptx.js', import.meta.url).href
const { readPptx } = await import(readerLib)

let failures = 0
let checks = 0
const check = (name, condition, detail = '') => {
  checks++
  if (condition) console.log(`  ok   - ${name}`)
  else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
}
const part = (bytes, name) => {
  const entry = unzipSync(bytes)[name]
  return entry === undefined ? null : strFromU8(entry)
}

console.log('== 1. 从结构化输入造 deck ==')
let bytes = createPptx([
  { title: '{{title}}', layout: 'title', notes: '开场：说明研究问题。' },
  { title: '研究背景', bullets: ['{{背景1}}', '{{背景2}}'], notes: '{{讲稿}}' },
  { title: '方法与结果', bullets: [{ text: '主线结论', level: 0 }, { text: '支撑证据', level: 1 }] },
  { title: '谢谢', layout: 'section' },
], { metadata: { title: '汇报稿', creator: '测试' } })

const audit = verifyPptx(bytes)
check('4 页幻灯片且顺序正确', audit.slideCount === 4 && audit.slideTitles[0] === '{{title}}' && audit.slideTitles[3] === '谢谢', JSON.stringify(audit.slideTitles))
check('部件结构完整', audit.parts.includes('ppt/slideMasters/slideMaster1.xml') && audit.parts.includes('ppt/theme/theme1.xml'))
check('每个 layout 都有 content-type Override', ['slideLayout1', 'slideLayout2', 'slideLayout3', 'slideLayout4'].every((n) => part(bytes, '[Content_Types].xml').includes(`/ppt/slideLayouts/${n}.xml`)))
check('备注部件已建', audit.parts.includes('ppt/notesSlides/notesSlide1.xml'))
check('presentation.xml 的 sldId 递增且 ≥256', /<p:sldId id="256"[^>]*\/><p:sldId id="257"[^>]*\/><p:sldId id="258"[^>]*\/><p:sldId id="259"/u.test(part(bytes, 'ppt/presentation.xml')))
check('CJK run 的 a:latin/a:ea/a:cs 按 schema 顺序出现', /<a:latin [^>]*\/><a:ea [^>]*\/><a:cs [^>]*\/>/u.test(part(bytes, 'ppt/slides/slide2.xml')))
check('字号是百分之一磅', /<a:sz val="2000"\/>/u.test(part(bytes, 'ppt/slides/slide3.xml')))
check('要点层级写成 lvl', /<a:pPr lvl="1">/u.test(part(bytes, 'ppt/slides/slide3.xml')))
check('写出的 deck 良构', (() => { try { verifyPptx(bytes); return true } catch (error) { console.log(`      ${error.message}`); return false } })())

console.log('== 2. 我们写出的 deck 能被我们自己的读取器读回（writer↔reader 闭链） ==')
{
  const read = readPptx(bytes)
  check('读取器页数与写入一致', read.slides.length === 4, `got ${read.slides.length}`)
  check('读取器按 sldIdLst 顺序读出标题', read.slides.map((s) => s.title).join('|') === '{{title}}|研究背景|方法与结果|谢谢', JSON.stringify(read.slides.map((s) => s.title)))
  check('读取器能读到备注', read.slides[0].notes === '开场：说明研究问题。', JSON.stringify(read.slides[0].notes))
  check('读取器能读到要点层级后的文本', read.slides[2].text.includes('支撑证据'), JSON.stringify(read.slides[2].text))
}

console.log('== 3. 模板填充：跨 run 拆分也命中，且保留 run 级格式 ==')
{
  // 把 {{背景1}} 拆到两个 run（各持一半 token），第二个 run 挂加粗 rPr：
  // 填充后整串必须被替换，且加粗 run 的 rPr 必须还在（不塌缩成单 run）。
  const presentation = unzipSync(bytes)
  const slide2 = strFromU8(presentation['ppt/slides/slide2.xml'])
  const split = slide2.replace(
    '<a:r><a:rPr lang="zh-CN" altLang="en-US"><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/><a:sz val="2000"/></a:rPr><a:t>{{背景1}}</a:t></a:r>',
    '<a:r><a:t>{{背</a:t></a:r><a:r><a:rPr b="1"/><a:t>景1}}</a:t></a:r>',
  )
  check('测试构造：token 确实被拆到两个 run', split.includes('<a:t>{{背</a:t>') && split.includes('<a:t>景1}}</a:t>'), '字符串手术未命中')
  presentation['ppt/slides/slide2.xml'] = new TextEncoder().encode(split)
  const { zipSync } = await import('fflate')
  const broken = zipSync(presentation)

  const filled = await editPptx(broken, [{
    op: 'fill_placeholders',
    values: { title: '异构数据检索增强生成', 背景1: '检索增强生成的既有工作', 背景2: '异构数据带来的挑战', 讲稿: '这一页讲背景。' },
  }])
  const filledSlide2 = part(filled.bytes, 'ppt/slides/slide2.xml')
  // 替换被**分摊**到承载命中的两个 run 上（每个 run 保留自己的 rPr），所以整串不会落在单个 run 里。
  check('跨 run 拆分的占位符被填上', /<a:t>检索增强生<\/a:t>/u.test(filledSlide2) && /<a:rPr b="1"\/><a:t>成的既有工作<\/a:t>/u.test(filledSlide2), filledSlide2.slice(filledSlide2.indexOf('Content'), filledSlide2.indexOf('Content') + 700))
  check('填充后不留占位符', !filledSlide2.includes('{{') && !filledSlide2.includes('}}'), filledSlide2)
  check('全部占位符都被找到（无「未找到」）', !filled.applied[0].includes('未找到'), filled.applied[0])
  check('备注里的占位符也被填充', part(filled.bytes, 'ppt/notesSlides/notesSlide2.xml').includes('这一页讲背景。'))
  check('填充后仍良构', (() => { try { verifyPptx(filled.bytes); return true } catch (error) { console.log(`      ${error.message}`); return false } })())
  check('填充保留命中的加粗 run（未塌缩为单 run）', /<a:r><a:rPr b="1"\/><a:t>成的既有工作<\/a:t><\/a:r>/u.test(filledSlide2), filledSlide2.slice(filledSlide2.indexOf('Content'), filledSlide2.indexOf('Content') + 700))

  console.log('== 4. 重排 / 删除 / 复制 ==')
  const beforeReorder = verifyPptx(filled.bytes).slideParts
  // 演示顺序 [谢谢, 标题, 方法与结果, 研究背景]
  const reordered = await editPptx(filled.bytes, [{ op: 'reorder_slides', order: [4, 1, 3, 2] }])
  check('重排后顺序正确（标题顺序）', reordered.slides.join('|') === '谢谢|异构数据检索增强生成|方法与结果|研究背景', JSON.stringify(reordered.slides))
  check('重排后部件顺序跟着 sldIdLst 走（未重命名部件）', JSON.stringify(verifyPptx(reordered.bytes).slideParts) === JSON.stringify([beforeReorder[3], beforeReorder[0], beforeReorder[2], beforeReorder[1]]), JSON.stringify(verifyPptx(reordered.bytes).slideParts))
  // 只比对 p:sldId 的 id（≥256），不要去匹配 sldMasterId 的 2147483648。
  check('重排只换顺序、不动 sldId 值（每页身份不变）', (part(reordered.bytes, 'ppt/presentation.xml').match(/<p:sldId id="(\d+)"/gu) ?? []).join(',') === '<p:sldId id="259",<p:sldId id="256",<p:sldId id="258",<p:sldId id="257"', JSON.stringify((part(reordered.bytes, 'ppt/presentation.xml').match(/<p:sldId id="(\d+)"/gu) ?? [])))

  const removed = await editPptx(reordered.bytes, [{ op: 'remove_slide', index: 1 }])
  check('删除后剩 3 页', removed.slides.length === 3, JSON.stringify(removed.slides))
  check('删除后首屏是被删页的原下一页', removed.slides[0] === '异构数据检索增强生成', JSON.stringify(removed.slides))
  check('删除后 presentation rels 无悬空 rId', !part(removed.bytes, 'ppt/_rels/presentation.xml.rels').includes('rIdSlide4'), part(removed.bytes, 'ppt/_rels/presentation.xml.rels'))
  check('删除后部件真被清掉（不留幽灵幻灯片）', Object.keys(unzipSync(removed.bytes)).filter((n) => /^ppt\/slides\/slide\d+\.xml$/u.test(n)).length === 3, JSON.stringify(Object.keys(unzipSync(removed.bytes)).filter((n) => n.startsWith('ppt/slides/slide'))))
  check('删除后 content-type 无残留 Override', !/PartName="\/ppt\/slides\/slide4\.xml"/u.test(part(removed.bytes, '[Content_Types].xml')))
  check('删除后仍良构', (() => { try { verifyPptx(removed.bytes); return true } catch (error) { console.log(`      ${error.message}`); return false } })())

  const duplicated = await editPptx(removed.bytes, [{ op: 'duplicate_slide', index: 2, position: 1 }])
  // removed 的顺序是 [异构数据检索增强生成, 方法与结果, 研究背景]，index=2 即"方法与结果"，
  // 插到第 1 位后它自己出现在第 1 位、原第 1 页顺延到第 2 位——这正是「复制」的语义。
  check('复制后 4 页且插到第 1 位', duplicated.slides.length === 4 && duplicated.slides[0] === '方法与结果' && duplicated.slides[1] === '异构数据检索增强生成', JSON.stringify(duplicated.slides))
  const dupFiles = Object.keys(unzipSync(duplicated.bytes))
  check('复制后幻灯片部件数 = 页数（无幽灵部件）', dupFiles.filter((n) => /^ppt\/slides\/slide\d+\.xml$/u.test(n)).length === 4, JSON.stringify(dupFiles.filter((n) => n.startsWith('ppt/slides/slide'))))
  check('复制生成了独立备注部件（不共享）', dupFiles.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(n)).length >= 2, JSON.stringify(dupFiles.filter((n) => n.includes('notesSlide'))))
  check('复制的备注是副本而不是引用同一部件', new Set([part(duplicated.bytes, 'ppt/notesSlides/notesSlide1.xml'), part(duplicated.bytes, 'ppt/notesSlides/notesSlide2.xml')]).size === 2)
  check('复制后的 deck 良构', (() => { try { verifyPptx(duplicated.bytes); return true } catch (error) { console.log(`      ${error.message}`); return false } })())

  console.log('== 5. 备注写回与清空 ==')
  const noted = await editPptx(duplicated.bytes, [{ op: 'set_notes', index: 1, notes: '第一行\n第二行' }])
  const readBack = readPptx(noted.bytes)
  check('备注写回后可读', readBack.slides[0].notes === '第一行\n第二行', JSON.stringify(readBack.slides[0].notes))
  const cleared = await editPptx(noted.bytes, [{ op: 'set_notes', index: 1, notes: '' }])
  check('备注清空后关系被解除', readPptx(cleared.bytes).slides[0].notes === undefined, JSON.stringify(readPptx(cleared.bytes).slides[0].notes))

  console.log('== 6. 错误路径明确 ==')
  const cases = [
    ['越界页码', { op: 'remove_slide', index: 99 }, '越界'],
    ['重排缺页', { op: 'reorder_slides', order: [1, 2] }, '必须列出全部'],
    ['重排页数过多', { op: 'reorder_slides', order: [1, 2, 3, 4] }, '必须列出全部'],
    ['重排重复页（页数正确）', { op: 'reorder_slides', order: [1, 2, 2] }, '重复'],
    ['空占位符表', { op: 'fill_placeholders', values: {} }, '不能为空'],
  ]
  for (const [label, op, expect] of cases) {
    let message = ''
    try { await editPptx(removed.bytes, [op]) } catch (error) { message = error.message }
    check(`${label} → 明确报错`, message.startsWith('第 1 个操作失败') && message.includes(expect), message)
  }
}

console.log('== 7. replaceAcrossRuns 的边界 ==')
{
  const xml = '<a:p><a:r><a:t>{{a}}</a:t></a:r></a:p>'
  check('单 run 替换', replaceAcrossRuns(xml, '{{a}}', 'X').xml.includes('>X<'))
  check('未命中返回原样', replaceAcrossRuns(xml, '{{zzz}}', 'X').count === 0 && replaceAcrossRuns(xml, '{{zzz}}', 'X').xml === xml)
  check('实体解码后匹配', replaceAcrossRuns('<a:p><a:r><a:t>a&amp;b</a:t></a:r></a:p>', 'a&b', 'c').xml.includes('>c<'))
  check('尾部空格加 xml:space', replaceAcrossRuns(xml, '{{a}}', 'X ').xml.includes('xml:space="preserve"'))
  check('splitElements 嵌套感知', splitElements('<a:p>x</a:p><a:p><a:p>y</a:p></a:p>', 'a:p').length === 2)
}

console.log(failures === 0 ? `\nALL PASS（${checks} 项）` : `\n${failures}/${checks} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
