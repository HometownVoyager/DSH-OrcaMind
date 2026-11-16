/**
 * pdf_stamp 工具测试：水印、文字/线段/矩形/图片叠加、坐标换算与 y 翻转、绘制前 lint、红框预览。
 * 用法：node tests/marks.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { loadEditorTools, makeChecker } from './harness.mjs'
import { makePdf, tempDir, writeTinyPng } from './fixtures.mjs'

const { check, done } = makeChecker('pdf-editor · pdf_stamp')
const dir = tempDir('marks')
const env = await loadEditorTools()
const path = (name) => join(dir, name)
const pageCount = async (file) => (await PDFDocument.load(new Uint8Array(readFileSync(file)), { updateMetadata: false })).getPageCount()

console.log('== 水印：每页居中半透明旋转文字 ==')
{
  await makePdf(path('wm.pdf'), { pages: 3, size: [400, 600] })
  const result = await env.call('pdf_stamp', { source: path('wm.pdf'), watermark: { text: 'CONFIDENTIAL' }, output: path('wm-out.pdf') })
  check('水印画在 3 页上', result.marks_drawn === 3 && result.pages_affected.join(',') === '1,2,3', JSON.stringify(result))
  check('verified=true（含内容流指纹变化校验）', result.verified === true, JSON.stringify(result.problems))
  check('内容变化校验在 checks 里', result.checks.some((entry) => entry.name.includes('内容流指纹')), JSON.stringify(result.checks))
  check('纯拉丁水印用标准字体', result.font.source === 'standard', JSON.stringify(result.font))
  const limited = await env.call('pdf_stamp', { source: path('wm.pdf'), watermark: { text: 'DRAFT', pages: '2-' }, output: path('wm-2.pdf') })
  check('pages 选择器限制水印页数', limited.marks_drawn === 2 && limited.pages_affected.join(',') === '2,3', JSON.stringify(limited.pages_affected))
}

console.log('== 水印：中文必须自备字体（探测到 simhei） ==')
{
  const result = await env.call('pdf_stamp', { source: path('wm.pdf'), watermark: { text: '内部资料 请勿外传' }, output: path('wm-cjk.pdf') })
  check('中文水印绘制成功', result.marks_drawn === 3, JSON.stringify(result.issues))
  check('字体来源为探测并报出路径', result.font.source === 'probed' && /simhei\.ttf$/u.test(result.font.path ?? ''), JSON.stringify(result.font))
  const ttc = 'C:\\Windows\\Fonts\\msyh.ttc'
  if (existsSync(ttc)) {
    const blocked = await env.call('pdf_stamp', { source: path('wm.pdf'), watermark: { text: '中文' }, font_path: ttc, output: path('wm-ttc.pdf') })
    check('指定 TTC 时 lint 直接拦下（error 级）', blocked.marks_drawn === 0 && blocked.issues.some((issue) => issue.severity === 'error' && issue.message.includes('无法嵌入')), JSON.stringify(blocked.issues))
    check('被拦下时不写文件', !existsSync(path('wm-ttc.pdf')))
  }
}

console.log('== 各种 mark：文字 / 线段 / 矩形 / 图片 ==')
{
  await makePdf(path('marks.pdf'), { pages: 2, size: [400, 600] })
  writeTinyPng(path('dot.png'))
  const result = await env.call('pdf_stamp', {
    source: path('marks.pdf'),
    marks: [
      { page: 1, kind: 'text', box: { x: 40, y: 500 }, text: 'baseline text', font_size: 14 },
      { page: 1, kind: 'text', box: { x: 40, y: 400, width: 120, height: 60 }, text: 'boxed text that should wrap inside the box', font_size: 10 },
      { page: 1, kind: 'rect', box: { x: 300, y: 300, width: 60, height: 40 }, thickness: 2, color: '#0000ff' },
      { page: 2, kind: 'rect', box: { x: 20, y: 20, width: 100, height: 50 }, filled: true, color: [255, 200, 0] },
      { page: 2, kind: 'line', box: { x: 20, y: 100, width: 200, height: 100 }, thickness: 3 },
      { page: 'all', kind: 'image', box: { x: 340, y: 540, width: 40, height: 40 }, path: path('dot.png') },
    ],
    output: path('marks-out.pdf'),
  })
  check('6 个 mark 全部绘制（image 用 page=all 命中 2 页 → 共 7 次）', result.marks_drawn === 7, JSON.stringify(result.issues))
  check('pages_affected 为 1,2', result.pages_affected.join(',') === '1,2')
  check('verified=true', result.verified === true, JSON.stringify(result.problems))
  check('resolved 报告换算后的 PDF 坐标', result.resolved[0].placement === 'x=40 y=500 w=0 h=0', JSON.stringify(result.resolved[0]))
  check('渲染文案说明绘制页', env.render('pdf_stamp', result)[0].text.includes('绘制 7 个标记'))
}

console.log('== image_pixels：换算 + y 轴翻转 ==')
{
  await makePdf(path('geo.pdf'), { pages: 1, size: [600, 800] })
  const result = await env.call('pdf_stamp', {
    source: path('geo.pdf'),
    geometry: 'image_pixels',
    page_size: { width: 600, height: 800 },
    image_size: { width: 1200, height: 1600 },
    marks: [{ page: 1, kind: 'rect', box: { x: 100, y: 200, width: 200, height: 100 } }],
    output: path('geo-out.pdf'),
  })
  check('半比例换算：x 100→50、宽 200→100', result.resolved[0].placement.includes('x=50') && result.resolved[0].placement.includes('w=100'), JSON.stringify(result.resolved))
  check('y 翻转：顶部 200px→底部 650pt（800-(200+100)*0.5）', result.resolved[0].placement.includes('y=650'), JSON.stringify(result.resolved))
  const missingSizes = await env.call('pdf_stamp', {
    source: path('geo.pdf'),
    geometry: 'image_pixels',
    marks: [{ page: 1, kind: 'rect', box: { x: 10, y: 10, width: 10, height: 10 } }],
  })
  check('缺 page_size/image_size 时 lint 报错（并给出原因）', missingSizes.issues.some((issue) => issue.message.includes('page_size 与 image_size')), JSON.stringify(missingSizes.issues))
}

console.log('== 绘制前 lint：各类 error 与 warning ==')
{
  await makePdf(path('lint.pdf'), { pages: 1, size: [400, 600] })
  const outside = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'rect', box: { x: 900, y: 900, width: 50, height: 50 } }], output: path('lint-out.pdf') })
  check('完全落在页外 → error 且不画', outside.marks_drawn === 0 && outside.issues.some((issue) => issue.message.includes('完全落在第 1 页之外')), JSON.stringify(outside.issues))
  check('未写文件', !existsSync(path('lint-out.pdf')))
  const zero = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'rect', box: { x: 10, y: 10, width: 0, height: 10 } }] })
  check('矩形零面积 → error', zero.issues.some((issue) => issue.message.includes('面积为 0')), JSON.stringify(zero.issues))
  const dotLine = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'line', box: { x: 10, y: 10, width: 0, height: 0 } }] })
  check('线段起终点重合 → error（但水平/垂直线段合法）', dotLine.issues.some((issue) => issue.message.includes('起点与终点重合')), JSON.stringify(dotLine.issues))
  const flatLine = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'line', box: { x: 10, y: 10, width: 100, height: 0 } }], output: path('lint-line.pdf') })
  check('水平线段（height=0）不是错误', flatLine.marks_drawn === 1 && !flatLine.issues.some((issue) => issue.severity === 'error'), JSON.stringify(flatLine.issues))
  const noText = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'text', box: { x: 10, y: 10 } }] })
  check('text 缺 text → error', noText.issues.some((issue) => issue.message.includes('没有 text')), JSON.stringify(noText.issues))
  const noPath = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'image', box: { x: 10, y: 10, width: 10, height: 10 } }] })
  check('image 缺 path → error', noPath.issues.some((issue) => issue.message.includes('没有 path')), JSON.stringify(noPath.issues))
  const badOpacity = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'text', box: { x: 10, y: 10 }, text: 'x', opacity: 3 }] })
  check('opacity 越界 → error', badOpacity.issues.some((issue) => issue.message.includes('opacity 必须在 0..1')), JSON.stringify(badOpacity.issues))
  const badPage = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 'r9', kind: 'text', box: { x: 10, y: 10 }, text: 'x' }] })
  check('页码越界 → error（沿用统一语法）', badPage.issues.some((issue) => issue.message.includes('超出文档页数')), JSON.stringify(badPage.issues))
  const warn = await env.call('pdf_stamp', {
    source: path('lint.pdf'),
    marks: [
      { page: 1, kind: 'line', box: { x: 10, y: 10, width: 100, height: 0 }, rotate: 45 },
      { page: 1, kind: 'rect', box: { x: 10, y: 300, width: 500, height: 50 }, filled: true, thickness: 2 },
    ],
    output: path('lint-warn.pdf'),
  })
  check('线段给 rotate → warning（不阻止）', warn.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('rotate 被忽略')), JSON.stringify(warn.issues))
  check('filled 与 thickness 冲突 → warning', warn.issues.some((issue) => issue.message.includes('thickness 被忽略')), JSON.stringify(warn.issues))
  check('有 warning 仍然画出来', warn.marks_drawn === 2 && existsSync(path('lint-warn.pdf')), JSON.stringify(warn))
  const oversize = await env.call('pdf_stamp', { source: path('lint.pdf'), marks: [{ page: 1, kind: 'rect', box: { x: 380, y: 10, width: 100, height: 20 } }], output: path('lint-oversize.pdf') })
  check('部分超出页面 → warning（不阻止）', oversize.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('超出第 1 页边界')), JSON.stringify(oversize.issues))
}

console.log('== dry_run 与红框预览 ==')
{
  await makePdf(path('dry.pdf'), { pages: 2, size: [400, 600] })
  const dry = await env.call('pdf_stamp', { source: path('dry.pdf'), marks: [{ page: 1, kind: 'text', box: { x: 20, y: 500 }, text: 'preview me', font_size: 16 }], dry_run: true })
  check('dry_run 不写文件', dry.dry_run === true && dry.output === undefined && !existsSync(path('dry-stamped.pdf')))
  check('dry_run 也报告换算后的坐标', dry.resolved.length === 1 && dry.resolved[0].placement.includes('x=20'), JSON.stringify(dry.resolved))
  const preview = await env.call('pdf_stamp', {
    source: path('dry.pdf'),
    marks: [{ page: 1, kind: 'text', box: { x: 20, y: 500 }, text: 'preview me', font_size: 16 }, { page: 2, kind: 'rect', box: { x: 30, y: 30, width: 80, height: 40 } }],
    dry_run: true,
    preview: true,
  })
  check('preview 另存红框文件', preview.preview_output !== undefined && existsSync(preview.preview_output), JSON.stringify(preview))
  check('预览文件是有效 PDF 且页数一致', (await pageCount(preview.preview_output)) === 2)
  check('预览文案提示可用 pdf_render 查看', env.render('pdf_stamp', preview)[0].text.includes('pdf_render'))
  check('dry_run 不产生正式输出', !existsSync(path('dry-stamped.pdf')))
}

console.log('== 输出策略与参数校验 ==')
{
  await makePdf(path('out.pdf'), { pages: 1, size: [300, 400] })
  const derived = await env.call('pdf_stamp', { source: path('out.pdf'), watermark: { text: 'W' } })
  check('缺省输出名 <原名>-stamped.pdf', derived.output.endsWith('out-stamped.pdf'), derived.output)
  const both = await env.call('pdf_stamp', {
    source: path('out.pdf'),
    watermark: { text: 'WM' },
    marks: [{ page: 1, kind: 'text', box: { x: 10, y: 10 }, text: 'stamp' }],
    output: path('both.pdf'),
  })
  check('watermark 与 marks 可同时使用（水印先画）', both.marks_requested === 2 && both.marks_drawn === 2, JSON.stringify(both))
  const empty = await env.fail('pdf_stamp', { source: path('out.pdf') })
  check('既无 marks 也无 watermark → 报错', empty.includes('marks 或 watermark'), empty)
  const badColor = await env.fail('pdf_stamp', { source: path('out.pdf'), marks: [{ page: 1, kind: 'rect', box: { x: 1, y: 1, width: 5, height: 5 }, color: 'red' }] })
  check('颜色格式非法 → 报错说明可用格式', badColor.includes('颜色格式无效'), badColor)
  const small = await loadEditorTools(undefined, { maxMarks: 2 })
  const tooMany = await small.fail('pdf_stamp', { source: path('out.pdf'), marks: Array.from({ length: 3 }, () => ({ page: 1, kind: 'text', box: { x: 1, y: 1 }, text: 'x' })) })
  check('超过 maxMarks 上限时报错（Config 可调）', tooMany.includes('超过单次上限 2'), tooMany)
}

process.exit(done())
