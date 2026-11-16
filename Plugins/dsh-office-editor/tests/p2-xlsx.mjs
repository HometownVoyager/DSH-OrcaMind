/**
 * P2 回归（xlsx）：比对报告 §4.2 第 16-24 条与 §6 P2「按域」xlsx 清单。
 *
 * 覆盖：区间位移正确性（合并/筛选随行移动）、公式漂移拦截、合并与取消合并、冻结窗格 XML 补丁、
 * 工作表可见性与重排、定义名、超链接、单元格批注、CSV/TSV 导出、`'=` 字面量转义、create 里的公式、
 * fullCalcOnLoad 补丁。
 *
 * 用法：node tests/p2-xlsx.mjs（在 dsh-office-editor 目录下）
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createXlsx, editXlsx, exportXlsx, verifyXlsx, sanitizeFileName } from '../lib/xlsx.js'
import XLSX from 'xlsx'

let failures = 0
let checks = 0
const check = (name, condition, detail = '') => {
  checks++
  if (condition) console.log(`  ok   - ${name}`)
  else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
}
const part = (bytes, name) => {
  const files = unzipSync(bytes)
  return files[name] === undefined ? '' : strFromU8(files[name])
}
const roundtrip = (bytes) => XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellNF: true, cellStyles: true, sheetStubs: true })
const edit = (bytes, ops) => editXlsx(bytes, ops, 10_000)

console.log('== 1. create：rows 里的 "=..." 是公式（旧实现写成字面文本），"\'=" 是字面量 ==')
{
  const bytes = createXlsx([{ name: '数据', rows: [['项目', '金额'], ['甲', 10], ['乙', 20], ['合计', '=SUM(B2:B3)'], ['字面量', "'=SUM(B2:B3)"]] }], 100)
  const wb = roundtrip(bytes)
  const ws = wb.Sheets['数据']
  check('create 的 = 字符串写成了公式单元格', typeof ws.B4?.f === 'string' && ws.B4.f === 'SUM(B2:B3)', JSON.stringify(ws.B4))
  check("'= 前缀写成字面文本（不带撇号）", ws.B5?.v === '=SUM(B2:B3)' && ws.B5?.f === undefined, JSON.stringify(ws.B5))
  check('sheet XML 里 B4 是 <f> 元素', /<c r="B4"[^>]*><f>SUM\(B2:B3\)<\/f>/u.test(part(bytes, 'xl/worksheets/sheet1.xml')), part(bytes, 'xl/worksheets/sheet1.xml'))
  check('写盘带 <calcPr fullCalcOnLoad="1"/>', /<calcPr[^>]*fullCalcOnLoad="1"/u.test(part(bytes, 'xl/workbook.xml')), part(bytes, 'xl/workbook.xml'))
  check('verifyXlsx 通过', (() => { try { verifyXlsx(bytes); return true } catch { return false } })())
}

console.log('== 2. set_cells："=..." 公式 / "\'=" 字面量 / null 删格 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['a', 1], ['b', 2], ['c', null]] }], 100)
  const out = edit(base, [{ op: 'set_cells', sheet: 'S', cells: { C1: '=SUM(B1:B2)', C2: "'=1+1", B3: null } }])
  const ws = roundtrip(out.bytes).Sheets['S']
  check('set_cells 写公式', ws.C1?.f === 'SUM(B1:B2)', JSON.stringify(ws.C1))
  check("set_cells 的 '= 写字面量", ws.C2?.v === '=1+1' && ws.C2?.f === undefined, JSON.stringify(ws.C2))
  check('null 删格生效', ws.B3 === undefined)
}

console.log('== 3. 区间位移：合并区与自动筛选随行移动（报告 3.2.4 第 5 条） ==')
{
  const base = createXlsx([{ name: 'S', rows: [['表头', null, 'x'], ['甲', 1, 'y'], ['乙', 2, 'z']] }], 100)
  const merged = edit(base, [
    { op: 'merge_cells', sheet: 'S', range: 'A1:B1' },
    { op: 'set_cells', sheet: 'S', cells: { D1: '筛选' } },
  ])
  const withFilter = XLSX.read(merged.bytes, { type: 'buffer' })
  const ws = withFilter.Sheets['S']
  ws['!autofilter'] = { ref: 'A1:D3' }
  const filtered = new Uint8Array(XLSX.write(withFilter, { bookType: 'xlsx', type: 'buffer' }))
  // 在筛选区之上插入两行：整块结构都必须下移。
  const shifted = edit(filtered, [{ op: 'add_rows', sheet: 'S', rows: [[], []], at: 1 }])
  const after = XLSX.read(shifted.bytes, { type: 'buffer' })
  const ws2 = after.Sheets['S']
  check('合并区随插入下移', ws2['!merges']?.[0]?.s?.r === 2 && ws2['!merges']?.[0]?.e?.r === 2, JSON.stringify(ws2['!merges']))
  check('自动筛选范围随插入下移', ws2['!autofilter']?.ref === 'A3:D5', JSON.stringify(ws2['!autofilter']))
  check('原第 1 行数据仍在合并区起始行', ws2.A3?.v === '表头', JSON.stringify(ws2.A3))
}

console.log('== 4. 插入落在合并区内部时明确报错而不是产出重叠合并 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['a'], ['b'], ['c'], ['d']] }], 100)
  const merged = edit(base, [{ op: 'merge_cells', sheet: 'S', range: 'A2:A4' }])
  let message = ''
  try { edit(merged.bytes, [{ op: 'add_rows', sheet: 'S', rows: [['x']], at: 3 }]) } catch (error) { message = error.message }
  check('中途插入被拒绝', message.includes('合并区域'), message)
}

console.log('== 5. 公式漂移：跨位移的公式让行操作大声失败（可显式跳过） ==')
{
  const base = createXlsx([{ name: 'S', rows: [['表头', '值']] }], 100)
  const withData = edit(base, [
    { op: 'add_rows', sheet: 'S', rows: [['甲', 1], ['乙', 2]] },
    { op: 'set_cells', sheet: 'S', cells: { B5: '=SUM(B2:B4)' } },
  ])
  let message = ''
  try { edit(withData.bytes, [{ op: 'add_rows', sheet: 'S', rows: [['丙', 3]], at: 3 }]) } catch (error) { message = error.message }
  check('插入跨越被引用行 → 报错', message.includes('公式引用失效'), message)
  check('报错信息点出具体单元格与公式', message.includes('S!B5') && message.includes('SUM(B2:B4)'), message)
  let forced = ''
  try {
    const relaxed = edit(withData.bytes, [{ op: 'add_rows', sheet: 'S', rows: [['丙', 3]], at: 3, allow_formula_drift: true }])
    forced = relaxed.applied.join('；')
  } catch (error) { forced = `FAILED: ${error.message}` }
  check('allow_formula_drift=true 时放行', !forced.startsWith('FAILED'), forced)
  // 整列引用的写法不受位移影响，因此不该被拦。
  const withFullColumn = edit(withData.bytes, [{ op: 'set_cells', sheet: 'S', cells: { C1: '=SUM(B:B)' } }])
  let blocked = ''
  try { edit(withFullColumn.bytes, [{ op: 'add_rows', sheet: 'S', rows: [['丙', 3]], at: 3 }]) } catch (error) { blocked = error.message }
  check('整列引用 =SUM(B:B) 不触发拦截', blocked.includes('S!B5') || blocked === '', blocked)
}

console.log('== 6. remove_rows：筛选范围收缩、被删区间内的合并被拒绝 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['h1', 'h2'], ['a', 1], ['b', 2], ['c', 3], ['d', 4]] }], 100)
  const withFilter = XLSX.read(base, { type: 'buffer' })
  withFilter.Sheets['S']['!autofilter'] = { ref: 'A1:B5' }
  const filtered = new Uint8Array(XLSX.write(withFilter, { bookType: 'xlsx', type: 'buffer' }))
  const trimmed = edit(filtered, [{ op: 'remove_rows', sheet: 'S', from: 3, to: 4 }])
  const ws = XLSX.read(trimmed.bytes, { type: 'buffer' }).Sheets['S']
  check('筛选范围收缩到 A1:B3', ws['!autofilter']?.ref === 'A1:B3', JSON.stringify(ws['!autofilter']))
  check('删除后数据上移', ws.A3?.v === 'd' && ws.A2?.v === 'a', JSON.stringify([ws.A2, ws.A3]))
  const merged = edit(base, [{ op: 'merge_cells', sheet: 'S', range: 'A3:A5' }])
  let message = ''
  try { edit(merged.bytes, [{ op: 'remove_rows', sheet: 'S', from: 2, to: 3 }]) } catch (error) { message = error.message }
  check('跨越合并区的删除被拒绝', message.includes('合并区域'), message)
}

console.log('== 7. 合并 / 取消合并 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['a', 'b', 'c'], ['d', 'e', 'f']] }], 100)
  const merged = edit(base, [{ op: 'merge_cells', sheet: 'S', range: 'A1:C1' }])
  check('写入 !merges', JSON.stringify(roundtrip(merged.bytes).Sheets['S']['!merges']) === JSON.stringify([{ s: { c: 0, r: 0 }, e: { c: 2, r: 0 } }]))
  check('sheet XML 有 mergeCell', /<mergeCell ref="A1:C1"\/>/u.test(part(merged.bytes, 'xl/worksheets/sheet1.xml')))
  let overlap = ''
  try { edit(merged.bytes, [{ op: 'merge_cells', sheet: 'S', range: 'B1:D1' }]) } catch (error) { overlap = error.message }
  check('重叠合并被拒绝', overlap.includes('重叠'), overlap)
  let single = ''
  try { edit(base, [{ op: 'merge_cells', sheet: 'S', range: 'A1:A1' }]) } catch (error) { single = error.message }
  check('单格合并被拒绝', single.includes('至少需要两个单元格'), single)
  const unmerged = edit(merged.bytes, [{ op: 'unmerge_cells', sheet: 'S', range: 'A1:C1' }])
  check('取消合并后无 !merges', roundtrip(unmerged.bytes).Sheets['S']['!merges'] === undefined, JSON.stringify(roundtrip(unmerged.bytes).Sheets['S']['!merges']))
  let none = ''
  try { edit(base, [{ op: 'unmerge_cells', sheet: 'S', range: 'A1:C1' }]) } catch (error) { none = error.message }
  check('无合并区时取消合并报错', none.includes('没有合并单元格'), none)
}

console.log('== 8. 冻结窗格：SheetJS 不写，由写盘后 XML 补丁写入 ==')
{
  const base = createXlsx([{ name: '数据', rows: [['h', 'v'], ['a', 1]] }, { name: '另一表', rows: [['x']] }], 100)
  const frozen = edit(base, [{ op: 'freeze_panes', sheet: '数据', cell: 'B2' }])
  const sheet1 = part(frozen.bytes, 'xl/worksheets/sheet1.xml')
  const sheet2 = part(frozen.bytes, 'xl/worksheets/sheet2.xml')
  check('目标表写入 <pane> 冻结', /<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/>/u.test(sheet1), sheet1)
  check('配套 <selection> 写入', /<selection pane="bottomRight" activeCell="B2" sqref="B2"\/>/u.test(sheet1), sheet1)
  check('未指定的表不受影响', !/<pane\b/u.test(sheet2), sheet2)
  check('冻结后仍良构且可解析', (() => { try { verifyXlsx(frozen.bytes); return true } catch { return false } })())
  const thawed = edit(frozen.bytes, [{ op: 'freeze_panes', sheet: '数据', cell: 'A1' }])
  check('A1 取消冻结', !/<pane\b/u.test(part(thawed.bytes, 'xl/worksheets/sheet1.xml')), part(thawed.bytes, 'xl/worksheets/sheet1.xml'))
  const rowsOnly = edit(base, [{ op: 'freeze_panes', sheet: '数据', cell: 'A2' }])
  check('仅冻结首行（ySplit）', /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/u.test(part(rowsOnly.bytes, 'xl/worksheets/sheet1.xml')))
  let badSheet = ''
  try { edit(base, [{ op: 'freeze_panes', sheet: '不存在', cell: 'A2' }]) } catch (error) { badSheet = error.message }
  check('表名写错时明确报错', badSheet.includes('找不到工作表'), badSheet)
}

console.log('== 9. 工作表可见性 / 重排（含元数据随表移动） ==')
{
  const base = createXlsx([{ name: 'A', rows: [['a']] }, { name: 'B', rows: [['b']] }, { name: 'C', rows: [['c']] }], 100)
  const hidden = edit(base, [{ op: 'set_sheet_state', name: 'B', state: 'hidden' }])
  const wb = XLSX.read(hidden.bytes, { type: 'buffer' })
  check('工作簿 XML 写入 state="hidden"', /<sheet name="B"[^>]*state="hidden"\/>/u.test(part(hidden.bytes, 'xl/workbook.xml')), part(hidden.bytes, 'xl/workbook.xml'))
  check('可见性在往返后保留', wb.Workbook?.Sheets?.[1]?.Hidden === 1, JSON.stringify(wb.Workbook?.Sheets))
  const moved = edit(hidden.bytes, [{ op: 'move_sheet', name: 'C', to: 1 }])
  const wb2 = XLSX.read(moved.bytes, { type: 'buffer' })
  check('重排后顺序为 C、A、B', JSON.stringify(wb2.SheetNames) === JSON.stringify(['C', 'A', 'B']), JSON.stringify(wb2.SheetNames))
  check('可见性跟着工作表走（B 仍是 hidden）', wb2.Workbook?.Sheets?.[2]?.Hidden === 1 && wb2.Workbook?.Sheets?.[0]?.Hidden === 0, JSON.stringify(wb2.Workbook?.Sheets))
  let allHidden = ''
  try { edit(base, [{ op: 'set_sheet_state', name: 'A', state: 'hidden' }, { op: 'set_sheet_state', name: 'B', state: 'hidden' }, { op: 'set_sheet_state', name: 'C', state: 'hidden' }]) } catch (error) { allHidden = error.message }
  check('不允许隐藏全部工作表', allHidden.includes('至少保留一个可见'), allHidden)
  let badTo = ''
  try { edit(base, [{ op: 'move_sheet', name: 'A', to: 9 }]) } catch (error) { badTo = error.message }
  check('move_sheet 越界报错', badTo.includes('越界'), badTo)
}

console.log('== 10. 定义名 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['税率', 0.06]] }], 100)
  const named = edit(base, [
    { op: 'set_defined_name', name: '税率', refers_to: 'S!$B$1' },
    { op: 'set_defined_name', name: '本表税', refers_to: '=S!$A$1', sheet: 'S' },
  ])
  const wb = XLSX.read(named.bytes, { type: 'buffer' })
  check('工作簿级定义名写入', wb.Workbook?.Names?.some((n) => n.Name === '税率' && n.Ref === 'S!$B$1'), JSON.stringify(wb.Workbook?.Names))
  check('工作表级定义名带 localSheetId', wb.Workbook?.Names?.some((n) => n.Name === '本表税' && n.Sheet === 0), JSON.stringify(wb.Workbook?.Names))
  check('工作簿 XML 有 definedNames', /<definedName name="税率">S!\$B\$1<\/definedName>/u.test(part(named.bytes, 'xl/workbook.xml')), part(named.bytes, 'xl/workbook.xml'))
  const removed = edit(named.bytes, [{ op: 'set_defined_name', name: '税率', refers_to: null }])
  check('refers_to=null 删除定义名', !XLSX.read(removed.bytes, { type: 'buffer' }).Workbook?.Names?.some((n) => n.Name === '税率'))
  let missing = ''
  try { edit(base, [{ op: 'set_defined_name', name: '没这个名', refers_to: null }]) } catch (error) { missing = error.message }
  check('删除不存在的定义名报错', missing.includes('找不到要删除的定义名'), missing)
}

console.log('== 11. 超链接与单元格批注 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['站点'], ['甲']] }], 100)
  const out = edit(base, [
    { op: 'set_hyperlink', sheet: 'S', cell: 'A2', url: 'https://example.com/甲', tooltip: '示例站点' },
    { op: 'set_cell_comment', sheet: 'S', cell: 'A1', text: '这里要填中文站点名', author: '张三' },
  ])
  // SheetJS 的读取路径会把非 ASCII 的关系目标当 latin1 解出乱码（与批注作者同一处 bug），
  // 所以超链接断言直接看写出的部件字节——那才是 Word/Excel 读到的东西。
  check('超链接 XML 指向正确的 r:id', /<hyperlinks><hyperlink ref="A2" r:id="rId1" tooltip="示例站点"\/><\/hyperlinks>/u.test(part(out.bytes, 'xl/worksheets/sheet1.xml')), part(out.bytes, 'xl/worksheets/sheet1.xml'))
  check('超链接关系保留 UTF-8 目标', part(out.bytes, 'xl/worksheets/_rels/sheet1.xml.rels').includes('Target="https://example.com/甲"'), part(out.bytes, 'xl/worksheets/_rels/sheet1.xml.rels'))
  check('超链接关系是 External', /TargetMode="External"/u.test(part(out.bytes, 'xl/worksheets/_rels/sheet1.xml.rels')))
  const wb = XLSX.read(out.bytes, { type: 'buffer' })
  check('超链接往返后仍是链接（目标由 XML 断言）', wb.Sheets['S'].A2?.l !== undefined, JSON.stringify(wb.Sheets['S'].A2))
  check('批注文本写入 comments.xml', part(out.bytes, 'xl/comments1.xml').includes('这里要填中文站点名'), part(out.bytes, 'xl/comments1.xml'))
  check('批注作者按 UTF-8 写入部件', part(out.bytes, 'xl/comments1.xml').includes('<author>张三</author>'), part(out.bytes, 'xl/comments1.xml'))
  check('批注挂到正确的单元格', /<comment ref="A1"/u.test(part(out.bytes, 'xl/comments1.xml')), part(out.bytes, 'xl/comments1.xml'))
  check('批注在往返后仍可读（文本）', wb.Sheets['S'].A1?.c?.[0]?.t === '这里要填中文站点名', JSON.stringify(wb.Sheets['S'].A1?.c))
  let empty = ''
  try { edit(base, [{ op: 'set_cell_comment', sheet: 'S', cell: 'A1', text: '   ' }]) } catch (error) { empty = error.message }
  check('空批注文本被拒绝', empty.includes('不能为空'), empty)
  let badUrl = ''
  try { edit(base, [{ op: 'set_hyperlink', sheet: 'S', cell: 'A1', url: '' }]) } catch (error) { badUrl = error.message }
  check('空 url 被拒绝', badUrl.includes('不能为空'), badUrl)
}

console.log('== 12. rename_sheet 会报告仍写着旧表名的引用（不静默改写） ==')
{
  const base = createXlsx([{ name: '数据', rows: [['a', 1], ['b', '=SUM(数据!B1:B1)']] }], 100)
  const renamed = edit(base, [{ op: 'rename_sheet', from: '数据', to: '数据2' }])
  check('提示存在旧表名引用', renamed.applied[0].includes('旧表名') && renamed.applied[0].includes('数据2!B2'), renamed.applied[0])
  const sheetXml = part(renamed.bytes, 'xl/worksheets/sheet1.xml')
  check('公式本身未被改写（交由调用者决定）', sheetXml.includes('<f>SUM(数据!B1:B1)</f>'), sheetXml)
  check('重命名后 sheet 元素用新名', /<sheet name="数据2"/u.test(part(renamed.bytes, 'xl/workbook.xml')), part(renamed.bytes, 'xl/workbook.xml'))
  const clean = edit(createXlsx([{ name: '数据', rows: [['a', 1]] }], 100), [{ op: 'rename_sheet', from: '数据', to: '新名' }])
  check('无旧表名引用时不出现警告', !clean.applied[0].includes('旧表名'), clean.applied[0])
}

console.log('== 13. CSV / TSV 导出 ==')
{
  // 工作表名里能出现、但 Windows 文件名禁止的字符是 | < > "（: / \ * ? [ ] 在 Excel 里也不合法）。
  const bytes = createXlsx([
    { name: '销售|数据', rows: [['名称', '数量'], ['甲', 1], ['乙,丙', 2], ['引"号', 3]] },
    { name: '备注"表', rows: [['含\t制表符', 'x']] },
  ], 100)
  const single = exportXlsx(bytes, { format: 'csv', sheet: '销售|数据' })
  check('单表导出返回一个文件', single.files.length === 1 && single.files[0].sheet === '销售|数据')
  check('CSV 默认带 BOM', single.files[0].text.startsWith('\uFEFF'), JSON.stringify(single.files[0].text.slice(0, 6)))
  check('文件名清洗了 | 字符', single.files[0].file === '销售_数据.csv', single.files[0].file)
  const body = single.files[0].text.slice(1)
  check('含逗号的字段被引号包裹', body.includes('"乙,丙"'), body)
  check('含引号的字段被转义', body.includes('"引""号"'), body)
  check('行数统计正确', single.files[0].rows === 4, String(single.files[0].rows))
  const all = exportXlsx(bytes, { format: 'tsv', allSheets: true })
  check('allSheets 导出两个文件', all.files.length === 2, JSON.stringify(all.files.map((f) => f.file)))
  check('TSV 文件名清洗了 " 字符', all.files[1].file === '备注_表.tsv', all.files[1].file)
  const tsvBody = all.files[1].text.slice(1)
  check('TSV 用制表符分隔且内嵌制表符被引号包裹', tsvBody.includes('"含\t制表符"\tx'), JSON.stringify(tsvBody))
  const noBom = exportXlsx(bytes, { format: 'csv', sheet: 1, bom: false })
  check('bom=false 不写 BOM', !noBom.files[0].text.startsWith('\uFEFF'))
  check('sheet 支持序号', noBom.files[0].sheet === '销售|数据', noBom.files[0].sheet)
  let ambiguous = ''
  try { exportXlsx(bytes, { format: 'csv' }) } catch (error) { ambiguous = error.message }
  check('多表未指定 sheet 时明确报错', ambiguous.includes('all_sheets'), ambiguous)
  check('sanitizeFileName 兜底空名', sanitizeFileName('***') === '___', sanitizeFileName('***'))
}

console.log('== 14. 导出取显示值：公式导出缓存值而不是公式本身 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['a', 1], ['b', 2]] }], 100)
  const withFormula = edit(base, [{ op: 'set_cells', sheet: 'S', cells: { C1: '=B1+B2' } }])
  const csv = exportXlsx(withFormula.bytes, { format: 'csv' }).files[0].text.slice(1)
  check('CSV 不含公式文本', !csv.includes('B1+B2'), csv)
  check('CSV 保持数据行', csv.split('\n').length === 2, csv)
}

console.log('== 15. 写盘后校验：patch 过的部件仍良构 ==')
{
  const base = createXlsx([{ name: 'S', rows: [['a']] }], 100)
  const patched = edit(base, [{ op: 'freeze_panes', sheet: 'S', cell: 'B2' }])
  const audited = verifyXlsx(patched.bytes)
  check('verifyXlsx 返回条目数', audited.entryCount > 5, String(audited.entryCount))
  const files = unzipSync(patched.bytes)
  files['xl/worksheets/sheet1.xml'] = strToU8('<worksheet><sheetData></worksheet>')
  let caught = false
  try { verifyXlsx(zipSync(files)) } catch { caught = true }
  check('verifyXlsx 拒绝标签错序的部件', caught)
  const missing = unzipSync(patched.bytes)
  delete missing['xl/workbook.xml']
  let caughtMissing = false
  try { verifyXlsx(zipSync(missing)) } catch { caughtMissing = true }
  check('verifyXlsx 拒绝缺少 xl/workbook.xml', caughtMissing)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES'}（${checks} 项）`)
if (failures > 0) process.exit(1)
