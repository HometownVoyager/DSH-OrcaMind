/**
 * pdf_form 工具测试：探测、先校验后写（dry_run）、填写、扁平化、CJK 外观域与各条错误路径。
 * 用法：node tests/forms.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { loadEditorTools, makeChecker } from './harness.mjs'
import { makeFormPdf, makePdf, tempDir } from './fixtures.mjs'

const { check, done } = makeChecker('pdf-editor · pdf_form')
const dir = tempDir('forms')
const env = await loadEditorTools()
const path = (name) => join(dir, name)

const reload = async (file) => PDFDocument.load(new Uint8Array(readFileSync(file)), { updateMetadata: false })

console.log('== 探测：字段类型、当前值、可选项、标志、位置 ==')
{
  await makeFormPdf(path('form.pdf'))
  const result = await env.call('pdf_form', { source: path('form.pdf') })
  check('has_form=true 且字段数 7', result.has_form === true && result.field_count === 7, JSON.stringify(result.fields.map((f) => f.name)))
  const byName = new Map(result.fields.map((field) => [field.name, field]))
  check('文本域 name 当前值为 Ada', byName.get('name').kind === 'text' && byName.get('name').value === 'Ada')
  check('复选框 agree 未勾选', byName.get('agree').kind === 'checkbox' && byName.get('agree').value === false)
  check('下拉框 choice 可选三项且当前 Two', byName.get('choice').options.join(',') === 'One,Two,Three' && byName.get('choice').value[0] === 'Two')
  check('单选组 color 有两个选项', byName.get('color').kind === 'radio' && byName.get('color').options.join(',') === 'red,blue')
  check('多选列表 tags 三个选项', byName.get('tags').kind === 'optionlist' && byName.get('tags').options.length === 3)
  check('只读字段标记 read_only', byName.get('locked').read_only === true)
  check('限长字段报出 max_length=10', byName.get('notes').max_length === 10)
  check('字段带所在页与控件矩形', byName.get('name').page === 1 && byName.get('name').rect.width > 0, JSON.stringify(byName.get('name').rect))
  check('单选组的控件数为 2', byName.get('color').widgets === 2)
  check('dry_run=true 且未写文件', result.dry_run === true && result.output === undefined)
  check('探测时不做写后校验（没有输出可校验）', result.verified === false && result.checks.length === 0)
  check('渲染文案列出字段', env.render('pdf_form', result)[0].text.includes('name（text）'))
}

console.log('== dry_run：校验通过时不落盘 ==')
{
  const result = await env.call('pdf_form', {
    source: path('form.pdf'),
    values: { name: 'Grace', agree: true, choice: 'One', color: 'blue', tags: ['alpha', 'gamma'] },
    dry_run: true,
  })
  check('无 error 级问题', !result.issues.some((issue) => issue.severity === 'error'), JSON.stringify(result.issues))
  check('摘要说明校验通过且未写文件', result.summary.includes('校验通过') && result.summary.includes('未写文件'), result.summary)
  check('dry_run 不产生输出文件', !existsSync(path('form-filled.pdf')))
}

console.log('== dry_run：下拉框值不在选项里 → 报错并解释 pdf-lib 的静默行为 ==')
{
  const result = await env.call('pdf_form', { source: path('form.pdf'), values: { choice: 'Four' }, dry_run: true })
  const issue = result.issues.find((entry) => entry.field === 'choice')
  check('报出「不在选项里」并给出可选值', issue !== undefined && issue.message.includes('不在选项里') && issue.message.includes('One、Two、Three'), JSON.stringify(result.issues))
  check('提示 pdf-lib 会静默接受、需显式 allow_custom', issue.message.includes('静默接受') && issue.message.includes('allow_custom'), issue.message)
  check('这是 error 级（会阻止写入）', issue.severity === 'error')
}

console.log('== 先校验后写：有 error 时拒绝写盘（exit-3 纪律） ==')
{
  const message = await env.fail('pdf_form', { source: path('form.pdf'), values: { choice: 'Four', nope: 'x' } })
  check('抛出的消息列出全部问题', message.includes('表单填写被拒绝') && message.includes('未知字段：nope'), message)
  check('消息说明未写任何文件', message.includes('未写任何文件'), message)
  check('确实没有生成输出文件', !existsSync(path('form-filled.pdf')))
}

console.log('== 填写：文本/复选/下拉/单选/多选 + 回读校验 ==')
{
  const result = await env.call('pdf_form', {
    source: path('form.pdf'),
    values: { name: 'Grace Hopper', agree: true, choice: 'Three', color: 'blue', tags: ['beta'] },
  })
  check('写入 5 个字段', result.applied.length === 5, JSON.stringify(result.applied))
  check('verified=true 且含字段值回读校验', result.verified === true && result.checks.some((entry) => entry.name === '表单字段值'), JSON.stringify(result.problems))
  check('缺省输出名为 <原名>-filled.pdf', result.output.endsWith('form-filled.pdf'), result.output)
  const back = await reload(result.output)
  const form = back.getForm()
  check('重读：文本值', form.getTextField('name').getText() === 'Grace Hopper')
  check('重读：复选框已勾选', form.getCheckBox('agree').isChecked() === true)
  check('重读：下拉框', form.getDropdown('choice').getSelected()[0] === 'Three')
  check('重读：单选组', form.getRadioGroup('color').getSelected() === 'blue')
  check('重读：多选列表', form.getOptionList('tags').getSelected().join(',') === 'beta')
  check('未填写的字段保持原值', form.getTextField('locked').getText() === 'sealed')
  check('渲染文案包含「已写入」', env.render('pdf_form', result)[0].text.includes('已写入 5 个字段'))
}

console.log('== allow_custom：确实要写自定义值时显式放行 ==')
{
  const result = await env.call('pdf_form', { source: path('form.pdf'), values: { choice: 'Four' }, allow_custom: true, output: path('custom.pdf') })
  check('自定义值写入成功', result.applied[0].value === 'Four')
  const back = await reload(path('custom.pdf'))
  check('重读自定义值（pdf-lib 会把它变成可编辑字段）', back.getForm().getDropdown('choice').getSelected()[0] === 'Four')
  check('回读校验通过', result.verified === true, JSON.stringify(result.problems))
}

console.log('== 类型与约束校验 ==')
{
  const readonly = await env.call('pdf_form', { source: path('form.pdf'), values: { locked: 'x' }, dry_run: true })
  check('只读字段报错', readonly.issues.some((issue) => issue.message.includes('只读')), JSON.stringify(readonly.issues))
  const wrongType = await env.call('pdf_form', { source: path('form.pdf'), values: { agree: 'yes' }, dry_run: true })
  check('复选框收到字符串报错', wrongType.issues.some((issue) => issue.message.includes('复选框，值必须是 true/false')), JSON.stringify(wrongType.issues))
  const tooLong = await env.call('pdf_form', { source: path('form.pdf'), values: { notes: '一二三四五六七八九十十一' }, dry_run: true })
  check('超过 max_length 报错', tooLong.issues.some((issue) => issue.message.includes('限长 10 字符')), JSON.stringify(tooLong.issues))
  const unknown = await env.call('pdf_form', { source: path('form.pdf'), values: { missing: 'x' }, dry_run: true })
  check('未知字段报错并列出可用字段', unknown.issues.some((issue) => issue.message.includes('现有字段：name、notes')), JSON.stringify(unknown.issues))
  const radioMissing = await env.call('pdf_form', { source: path('form.pdf'), values: { color: 'green' }, dry_run: true })
  check('单选组未知值在写之前就被拦下', radioMissing.issues.some((issue) => issue.message.includes('不在选项里')), JSON.stringify(radioMissing.issues))
}

console.log('== CJK 值：必须自备字体，外观域用该字体重建 ==')
{
  const result = await env.call('pdf_form', { source: path('form.pdf'), values: { name: '张三', notes: '中文备注' }, output: path('cjk.pdf') })
  check('中文值写入成功', result.applied.length === 2, JSON.stringify(result.applied))
  check('字体来自探测（本机 simhei）且报告了路径', result.font.source === 'probed' && /simhei\.ttf$/u.test(result.font.path ?? ''), JSON.stringify(result.font))
  const back = await reload(path('cjk.pdf'))
  check('重读中文值', back.getForm().getTextField('name').getText() === '张三')
  check('回读校验通过', result.verified === true, JSON.stringify(result.problems))
  const ttc = 'C:\\Windows\\Fonts\\msyh.ttc'
  if (existsSync(ttc)) {
    const bad = await env.call('pdf_form', { source: path('form.pdf'), values: { name: '张三' }, dry_run: true, font_path: ttc })
    check('显式指定的 .ttc 字体无法嵌入 → 报错（不静默回退）', bad.issues.some((issue) => issue.severity === 'error' && issue.message.includes('无法嵌入')), JSON.stringify(bad.issues))
    const missing = await env.call('pdf_form', { source: path('form.pdf'), values: { name: '张三' }, dry_run: true, font_path: 'C:\\Windows\\Fonts\\nope.ttf' })
    check('显式指定的字体不存在 → 报错指出路径', missing.issues.some((issue) => issue.message.includes('font_path 不存在')), JSON.stringify(missing.issues))
  }
  const latin = await env.call('pdf_form', { source: path('form.pdf'), values: { name: 'Plain ASCII' }, output: path('latin.pdf') })
  check('纯拉丁文本用标准字体（不嵌字体）', latin.font.source === 'standard', JSON.stringify(latin.font))
}

console.log('== 扁平化：字段消失且校验声明这一点 ==')
{
  const result = await env.call('pdf_form', { source: path('form.pdf'), values: { name: 'Filled' }, flatten: true, output: path('flat.pdf') })
  check('flattened=true', result.flattened === true)
  check('校验包含「扁平化后不再有表单字段」', result.checks.some((entry) => entry.name.includes('扁平化后不再有表单字段')), JSON.stringify(result.checks))
  const back = await reload(path('flat.pdf'))
  check('重读字段数为 0', back.getForm().getFields().length === 0)
  check('页面内容比原文件大（外观域已画到页上）', readFileSync(path('flat.pdf')).length > readFileSync(path('form.pdf')).length)
}

console.log('== 没有表单的文档 ==')
{
  await makePdf(path('plain.pdf'), { pages: 1 })
  const probe = await env.call('pdf_form', { source: path('plain.pdf') })
  check('has_form=false 且字段数为 0', probe.has_form === false && probe.field_count === 0)
  check('有 warning 说明没有 /AcroForm', probe.warnings.length === 0 && probe.issues.some((issue) => issue.message.includes('没有 /AcroForm')), JSON.stringify(probe.issues))
  const fill = await env.call('pdf_form', { source: path('plain.pdf'), values: { anything: 'x' }, dry_run: true })
  check('往无表单文档写值时明确报错', fill.issues.some((issue) => issue.message.includes('文档没有表单字段')), JSON.stringify(fill.issues))
}

process.exit(done())
