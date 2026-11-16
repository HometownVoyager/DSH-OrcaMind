/**
 * .xlsx create/edit engine on SheetJS: build workbooks from structured sheet specs, apply
 * ordered cell/row/sheet operations to existing workbooks, and serialize back to .xlsx.
 * Community SheetJS preserves data and formulas but drops cell styles on rewrite.
 *
 * Three things this module does itself, because SheetJS 0.18.5 either cannot express them or
 * would corrupt the file silently:
 *
 * 1. **Structural ranges move with their rows.** `shiftRows` re-keys `!merges`, `!autofilter` and
 *    `!rows` alongside the data cells; SheetJS only moves cells, which used to leave a merge
 *    covering the wrong cells and an autofilter pointing at stale rows.
 * 2. **Formula drift fails loudly.** SheetJS does not translate formula references when rows move,
 *    so a formula that used to read the inserted region would silently keep reading the old
 *    coordinates. Any affected formula aborts the operation unless the caller opts in.
 * 3. **Post-write XML patching** for the two things SheetJS accepts but never writes: freeze panes
 *    (`<pane>` inside `<sheetView>`) and `<calcPr fullCalcOnLoad="1"/>` (`wb.Workbook.CalcPr` is
 *    accepted by the 0.18 type declarations and ignored by its writer).
 *
 * @module dsh-office-editor/src/xlsx
 */

import { strFromU8, strToU8, unzipSync } from 'fflate'
import XLSX from 'xlsx'
import { assertWellFormedXml } from './xml.js'
import { packOoxml, partsToMap, type MtimeSource } from './zip.js'

/** One sheet definition for workbook creation. */
export interface SheetSpec {
  /** Sheet name (1-31 chars, no []:*?/\ characters). */
  name: string
  /** Row matrix; each cell is a string, number, boolean, or null. Formulas are strings starting with "=". */
  rows: unknown[][]
  /** Optional A1-addressed formulas (e.g. `{ "D2": "=SUM(B2:C2)" }`); the leading "=" is optional. */
  formulas?: Record<string, string>
  /** Optional column widths in characters. */
  widths?: number[]
}

const SHEET_NAME_RE = /^[^\[\]:*?/\\]{1,31}$/
const A1_RE = /^[A-Za-z]{1,3}[1-9][0-9]*$/

/**
 * Convert one supported scalar into a SheetJS cell object.
 *
 * `"=SUM(A1:A2)"` is a formula; `"'=SUM(A1:A2)"` (leading apostrophe, Excel's own escape) is the
 * *literal* text `=SUM(A1:A2)`, which is otherwise impossible to write — the alternative would be
 * a stored apostrophe that shows up in the cell.
 */
function valueToCell(value: unknown): XLSX.CellObject {
  if (typeof value === 'number') return { t: 'n', v: value }
  if (typeof value === 'boolean') return { t: 'b', v: value }
  if (typeof value === 'string') {
    if (value.startsWith("'=")) return { t: 's', v: value.slice(1) }
    if (value.startsWith('=')) return { t: 'n', f: value.slice(1) }
    return { t: 's', v: value }
  }
  if (value === null || value === undefined) return { t: 'z' }
  throw new Error(`不支持的单元格值类型：${typeof value}（仅支持 字符串/数字/布尔/null；公式写成以 = 开头的字符串，字面量以 '= 开头）`)
}

/** Validate a sheet name against the Excel character and length rules. */
function assertSheetName(name: string): void {
  if (typeof name !== 'string' || !SHEET_NAME_RE.test(name)) {
    throw new Error(`非法工作表名："${String(name)}"（1-31 字符，不能包含 [ ] : * ? / \\）`)
  }
}

/** Validate one row matrix: every cell must be a supported scalar. */
function assertRows(rows: unknown, label: string, maxRows: number): asserts rows is unknown[][] {
  if (!Array.isArray(rows)) throw new Error(`${label} 必须是二维数组（每行一个数组）`)
  if (rows.length > maxRows) throw new Error(`${label} 行数 ${rows.length} 超过单次上限 ${maxRows}`)
  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row)) throw new Error(`${label} 第 ${index + 1} 行不是数组`)
  }
}

/** Recompute the used range (`!ref`) from the actual cell keys of a worksheet. */
function recalcRange(ws: XLSX.WorkSheet): void {
  let minR = Number.POSITIVE_INFINITY
  let minC = Number.POSITIVE_INFINITY
  let maxR = -1
  let maxC = -1
  for (const key of Object.keys(ws)) {
    if (!/^[A-Z]+[0-9]+$/.test(key)) continue
    const cell = XLSX.utils.decode_cell(key)
    minR = Math.min(minR, cell.r)
    minC = Math.min(minC, cell.c)
    maxR = Math.max(maxR, cell.r)
    maxC = Math.max(maxC, cell.c)
  }
  if (maxR < 0) {
    delete ws['!ref']
    return
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } })
}

/** Extend the used range of a worksheet to include one cell. */
function extendRange(ws: XLSX.WorkSheet, r: number, c: number): void {
  const range = ws['!ref'] !== undefined
    ? XLSX.utils.decode_range(ws['!ref'])
    : { s: { r, c }, e: { r, c } }
  range.s.r = Math.min(range.s.r, r)
  range.s.c = Math.min(range.s.c, c)
  range.e.r = Math.max(range.e.r, r)
  range.e.c = Math.max(range.e.c, c)
  ws['!ref'] = XLSX.utils.encode_range(range)
}

/** Re-key every data cell through a mapping; returning null drops the cell. */
function remapCells(ws: XLSX.WorkSheet, map: (cell: { r: number; c: number }) => { r: number; c: number } | null): void {
  const entries = (Object.keys(ws) as Array<keyof XLSX.WorkSheet>)
    .filter((key): key is string => typeof key === 'string' && /^[A-Z]+[0-9]+$/.test(key))
    .map((key) => ({ key, cell: XLSX.utils.decode_cell(key), value: ws[key] as XLSX.CellObject }))
  for (const { key } of entries) delete ws[key]
  for (const { cell, value } of entries) {
    const next = map(cell)
    if (next !== null) ws[XLSX.utils.encode_cell(next)] = value
  }
  recalcRange(ws)
}

/**
 * Shift data cells at or below `fromRow` down by `delta` rows (negative shifts up), together with
 * every structural range that describes those rows.
 *
 * SheetJS's `shiftRows` helper only re-keys cells. Leaving `!merges` in place produced overlapping
 * merges after an insert, and leaving `!autofilter` in place made the filter cover the wrong rows
 * once the data moved (report 3.2.4 #5). A merge that the shift would have to cut in half is
 * refused rather than silently made inconsistent.
 */
function shiftRows(ws: XLSX.WorkSheet, fromRow: number, delta: number): void {
  remapCells(ws, (cell) => cell.r >= fromRow ? { r: cell.r + delta, c: cell.c } : { r: cell.r, c: cell.c })
  shiftStructural(ws, fromRow, delta)
}

/**
 * Move every structural range that describes rows at or below `fromRow`.
 *
 * Kept separate from the cell re-keying because row *deletion* remaps cells and structure in the
 * same pass, while insertion remaps cells first and then puts the new rows in the freed space.
 */
function shiftStructural(ws: XLSX.WorkSheet, fromRow: number, delta: number): void {
  const merges = ws['!merges']
  if (Array.isArray(merges)) {
    for (const merge of merges) {
      const label = XLSX.utils.encode_range(merge)
      if (merge.s.r >= fromRow) {
        merge.s.r += delta
        merge.e.r += delta
      } else if (merge.e.r >= fromRow) {
        throw new Error(`插入/删除的行落在合并区域 ${label} 内部，无法整体位移；请先 unmerge_cells 取消该合并区再操作`)
      }
    }
  }
  const filter = ws['!autofilter']
  if (filter !== undefined && typeof filter.ref === 'string' && filter.ref !== '') {
    const decoded = XLSX.utils.decode_range(filter.ref)
    if (decoded.s.r >= fromRow) {
      decoded.s.r += delta
      decoded.e.r += delta
      filter.ref = XLSX.utils.encode_range(decoded)
    } else if (decoded.e.r >= fromRow) {
      decoded.e.r += delta
      filter.ref = XLSX.utils.encode_range(decoded)
    }
  }
  const rowInfo = ws['!rows'] as Array<XLSX.RowInfo | undefined> | undefined
  if (Array.isArray(rowInfo)) {
    const next: Array<XLSX.RowInfo | undefined> = []
    rowInfo.forEach((entry, index) => {
      if (entry === undefined) return
      const target = index >= fromRow ? index + delta : index
      if (target >= 0) next[target] = entry
    })
    ws['!rows'] = next as XLSX.RowInfo[]
  }
}

/** Shift data cells at or right of `fromCol` right by `delta` columns (negative shifts left). */
function shiftCols(ws: XLSX.WorkSheet, fromCol: number, delta: number): void {
  remapCells(ws, (cell) => cell.c >= fromCol ? { r: cell.r, c: cell.c + delta } : { r: cell.r, c: cell.c })
}

/** Write a row matrix starting at `baseRow`, extending the used range. */
function writeRows(ws: XLSX.WorkSheet, rows: unknown[][], baseRow: number): void {
  for (const [i, row] of rows.entries()) {
    for (const [c, value] of row.entries()) {
      if (value === null || value === undefined) continue
      const addr = XLSX.utils.encode_cell({ r: baseRow + i, c })
      ws[addr] = valueToCell(value)
      extendRange(ws, baseRow + i, c)
    }
  }
}

/** Apply formula overrides to a worksheet after the base rows are in place. */
function applyFormulas(ws: XLSX.WorkSheet, formulas: Record<string, string> | undefined): void {
  if (formulas === undefined) return
  for (const [addr, raw] of Object.entries(formulas)) {
    if (!A1_RE.test(addr)) throw new Error(`非法单元格地址："${addr}"（应为 A1 样式，如 D2）`)
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`公式内容为空：${addr}`)
    const cellAddr = XLSX.utils.decode_cell(addr.toUpperCase())
    ws[addr.toUpperCase()] = { t: 'n', f: raw.replace(/^=/, '') }
    extendRange(ws, cellAddr.r, cellAddr.c)
  }
}

// ---------- formula reference bookkeeping ----------

/** One A1 reference token inside a formula: the sheet it names (when qualified) and its last row. */
interface FormulaRef {
  sheet?: string
  row: number
}

const REF_TOKEN_RE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/gu

/** Undo Excel's doubled single quotes in a quoted sheet name. */
function normalizeSheetName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return raw.replace(/''/gu, "'").trim()
}

/**
 * Every cell reference a formula reads, each reduced to the last row it covers.
 *
 * Whole-column references (`B:B`) and structured references (`表1[列]`) deliberately produce no
 * entry: those are the formulations that survive a row shift unchanged, which is exactly the
 * mitigation the caller is told to use.
 */
function formulaRefs(formula: string): FormulaRef[] {
  const out: FormulaRef[] = []
  for (const match of formula.matchAll(REF_TOKEN_RE)) {
    const text = match[0]
    const at = match.index ?? 0
    const before = at > 0 ? formula[at - 1] : ''
    const after = formula.slice(at + text.length, at + text.length + 1)
    // `LOG10(`/`ATAN2(` are functions, `1E5` is a number, `[A1]`/`.A1` are table references.
    if (after === '(' || /[\w.$[]/u.test(before)) continue
    const row = Number(match[10] ?? match[6])
    if (!Number.isFinite(row)) continue
    const sheet = normalizeSheetName(match[1] ?? match[2])
    out.push({ ...(sheet !== undefined && sheet !== '' ? { sheet } : {}), row })
  }
  return out
}

/**
 * Refuse a row shift that would leave formulas reading the wrong cells.
 *
 * SheetJS re-keys cells but never rewrites formula text, so `=SUM(B2:B5)` keeps its coordinates
 * while the data moves — the workbook still opens, and every dependent total is quietly wrong.
 * That is a silent-corruption class, so it aborts unless the caller explicitly accepts it.
 */
function assertNoFormulaDrift(wb: XLSX.WorkBook, sheetName: string, fromRow: number, allow: boolean, what: string): void {
  if (allow) return
  const target = sheetName.toLowerCase()
  const offenders: string[] = []
  const inspect = (label: string, formula: string): void => {
    for (const ref of formulaRefs(formula)) {
      if (ref.sheet !== undefined && ref.sheet.toLowerCase() !== target) continue
      if (ref.row < fromRow + 1) continue
      offenders.push(`${label} =${formula}`)
      return
    }
  }
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (ws === undefined) continue
    for (const key of Object.keys(ws)) {
      if (!/^[A-Z]+[0-9]+$/u.test(key)) continue
      const cell = ws[key] as XLSX.CellObject
      if (typeof cell?.f !== 'string' || cell.f === '') continue
      inspect(`${name}!${key}`, cell.f)
    }
  }
  for (const defined of (wb.Workbook?.Names ?? []) as XLSX.DefinedName[]) {
    if (typeof defined.Ref !== 'string' || defined.Ref === '') continue
    // `_xlnm._FilterDatabase` mirrors `!autofilter`, which the shift already moves
    // (`syncFilterDatabases` keeps the name in step), so it is not a drift candidate.
    if (defined.Name === '_xlnm._FilterDatabase') continue
    inspect(`定义名 ${defined.Name}`, defined.Ref.replace(/^=/u, ''))
  }
  if (offenders.length === 0) return
  const shown = offenders.slice(0, 5).join('；')
  const more = offenders.length > 5 ? ` 等共 ${offenders.length} 处` : ''
  throw new Error(`${what}会让公式引用失效：${shown}${more}。SheetJS 不随行列位移改写公式，继续写入会得到「文件能打开、合计却算错」的静默损坏。可改用整列引用（如 =SUM(B:B)）或先把公式改成不随位移变化的写法；确认引用确实不受影响时，可显式传 allow_formula_drift=true 跳过本检查。`)
}

/**
 * Build the whole workbook and serialize to .xlsx bytes.
 * @param sheets - sheet specifications in order.
 * @param maxRowsPerSheet - row cap applied to every sheet.
 * @param mtime - entry timestamp policy; `fixed` (default) keeps the archive reproducible.
 */
export function createXlsx(sheets: SheetSpec[], maxRowsPerSheet: number, mtime?: MtimeSource): Uint8Array {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error('sheets 不能为空：至少需要一个工作表')
  const wb = XLSX.utils.book_new()
  // SheetJS writes `<calcPr fullCalcOnLoad="1"/>` from `wb.Workbook.CalcPr`, which is what makes
  // freshly written formulas evaluate when Excel opens the file. The 0.18 type declarations omit
  // the property, hence the assertion.
  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } } as unknown as XLSX.WBProps
  for (const spec of sheets) {
    if (spec === null || typeof spec !== 'object') throw new Error('sheets 的每一项必须是对象 { name, rows, formulas?, widths? }')
    assertSheetName(spec.name)
    assertRows(spec.rows, `工作表 "${spec.name}" 的 rows`, maxRowsPerSheet)
    // Built through `valueToCell` rather than `aoa_to_sheet`: the latter stores "=SUM(...)" as
    // literal text, so the documented "rows 里的 = 开头字符串写公式" contract only held for the
    // `formulas` map. One cell rule for create and edit is also what makes `'=` escaping work.
    const ws: XLSX.WorkSheet = {}
    writeRows(ws, spec.rows, 0)
    applyFormulas(ws, spec.formulas)
    if (spec.widths !== undefined) {
      if (!Array.isArray(spec.widths)) throw new Error(`工作表 "${spec.name}" 的 widths 必须是数字数组`)
      ws['!cols'] = spec.widths.map((w) => ({ wch: w }))
    }
    XLSX.utils.book_append_sheet(wb, ws, spec.name)
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  return patchWorkbookXml(new Uint8Array(out), { freeze: new Map(), fullCalcOnLoad: true, mtime })
}

/** Ordered edit operations supported on an existing workbook. */
export type XlsxOp =
  | { op: 'set_cells'; sheet?: string; cells: Record<string, unknown> }
  | { op: 'add_rows'; sheet?: string; rows: unknown[][]; at?: number; allow_formula_drift?: boolean }
  | { op: 'add_sheet'; name: string; rows?: unknown[][] }
  | { op: 'remove_rows'; sheet?: string; from: number; to?: number; allow_formula_drift?: boolean }
  | { op: 'rename_sheet'; from: string; to: string }
  | { op: 'remove_sheet'; name: string }
  | { op: 'move_sheet'; name: string; to: number }
  | { op: 'set_sheet_state'; name: string; state: 'visible' | 'hidden' | 'veryHidden' }
  | { op: 'merge_cells'; sheet?: string; range: string }
  | { op: 'unmerge_cells'; sheet?: string; range: string }
  | { op: 'freeze_panes'; sheet?: string; cell: string }
  | { op: 'set_defined_name'; name: string; refers_to?: string | null; sheet?: string }
  | { op: 'set_hyperlink'; sheet?: string; cell: string; url: string; tooltip?: string }
  | { op: 'set_cell_comment'; sheet?: string; cell: string; text: string; author?: string }

/** Result of applying operations to a workbook. */
export interface XlsxEditResult {
  /** Serialized .xlsx bytes. */
  bytes: Uint8Array
  /** One human-readable line per applied operation. */
  applied: string[]
}

/** Resolve a sheet by name (default: the first sheet) with a clear error when missing. */
function getSheet(wb: XLSX.WorkBook, name: string | undefined): XLSX.WorkSheet {
  const target = (name ?? wb.SheetNames[0] ?? '').trim()
  if (target === '') throw new Error('工作簿中没有工作表')
  const sheetName = /^\d+$/.test(target) ? wb.SheetNames[Number(target) - 1] : target
  if (sheetName === undefined || wb.Sheets[sheetName] === undefined) {
    throw new Error(`找不到工作表："${target}"（现有：${wb.SheetNames.join('、')}）`)
  }
  return wb.Sheets[sheetName]
}

/** Parse "B2"-style values and write cells; null deletes the cell, "=..." writes a formula. */
function opSetCells(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'set_cells' }>): string {
  if (op.cells === null || typeof op.cells !== 'object' || Array.isArray(op.cells)) {
    throw new Error('set_cells 的 cells 必须是对象（A1 地址 → 值）')
  }
  const ws = getSheet(wb, op.sheet)
  const written: string[] = []
  for (const [addr, value] of Object.entries(op.cells)) {
    if (!A1_RE.test(addr)) throw new Error(`非法单元格地址："${addr}"（应为 A1 样式，如 B2）`)
    const upper = addr.toUpperCase()
    if (value === null) {
      delete ws[upper]
      written.push(`${upper}=空`)
    } else {
      ws[upper] = valueToCell(value)
      const cell = XLSX.utils.decode_cell(upper)
      extendRange(ws, cell.r, cell.c)
      written.push(`${upper}=${typeof value === 'string' && value.startsWith('=') ? `公式${value}` : JSON.stringify(value)}`)
    }
  }
  return `set_cells(${op.sheet ?? '首个工作表'}): ${written.join(', ')}`
}

function opAddRows(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'add_rows' }>, maxRowsPerSheet: number): string {
  assertRows(op.rows, 'add_rows 的 rows', maxRowsPerSheet)
  const sheetName = resolveSheetName(wb, op.sheet)
  const ws = getSheet(wb, op.sheet)
  const range = ws['!ref'] !== undefined ? XLSX.utils.decode_range(ws['!ref']) : null
  if (range === null) {
    writeRows(ws, op.rows, 0)
    return `add_rows(${op.sheet ?? '首个工作表'}): 空表写入 ${op.rows.length} 行`
  }
  let insertRow: number
  if (op.at !== undefined) {
    if (!Number.isInteger(op.at) || op.at < 1) throw new Error('add_rows 的 at 必须是正整数（1-based 行号）')
    insertRow = Math.min(Math.max(op.at - 1, range.s.r), range.e.r + 1)
    if (insertRow <= range.e.r) {
      assertNoFormulaDrift(wb, sheetName, insertRow, op.allow_formula_drift === true, `在第 ${insertRow + 1} 行前插入 ${op.rows.length} 行`)
      shiftRows(ws, insertRow, op.rows.length)
    }
  } else {
    insertRow = range.e.r + 1
  }
  writeRows(ws, op.rows, insertRow)
  return `add_rows(${op.sheet ?? '首个工作表'}): ${op.at !== undefined ? `第 ${op.at} 行前插入` : '追加'} ${op.rows.length} 行`
}

function opAddSheet(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'add_sheet' }>, maxRowsPerSheet: number): string {
  assertSheetName(op.name)
  if (wb.SheetNames.includes(op.name)) throw new Error(`工作表已存在："${op.name}"`)
  if (op.rows !== undefined) assertRows(op.rows, `新工作表 "${op.name}" 的 rows`, maxRowsPerSheet)
  const ws: XLSX.WorkSheet = {}
  if (op.rows !== undefined) writeRows(ws, op.rows, 0)
  XLSX.utils.book_append_sheet(wb, ws, op.name)
  // `book_append_sheet` only touches `SheetNames`, so the positional metadata array has to be
  // re-sized here — otherwise every existing sheet after the new one loses its visibility state.
  writeSheetMeta(wb, sheetMeta(wb))
  return `add_sheet: "${op.name}"（${op.rows?.length ?? 0} 行）`
}

function opRemoveRows(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'remove_rows' }>): string {
  if (!Number.isInteger(op.from) || op.from < 1) throw new Error('remove_rows 的 from 必须是正整数（1-based 行号）')
  const sheetName = resolveSheetName(wb, op.sheet)
  const ws = getSheet(wb, op.sheet)
  if (ws['!ref'] === undefined) throw new Error('该工作表为空，无可删除的行')
  const range = XLSX.utils.decode_range(ws['!ref'])
  const fromRow = range.s.r + op.from - 1
  const toRow = range.s.r + (op.to ?? op.from) - 1
  if (toRow < fromRow) throw new Error('remove_rows 的 to 不能小于 from')
  if (toRow > range.e.r + 1) throw new Error(`remove_rows 超出已用范围（最多到第 ${range.e.r - range.s.r + 1} 行）`)
  const count = toRow - fromRow + 1
  assertNoFormulaDrift(wb, sheetName, fromRow, op.allow_formula_drift === true, `删除第 ${op.from}${op.to !== undefined && op.to !== op.from ? `-${op.to}` : ''} 行`)
  remapCells(ws, (cell) => {
    if (cell.r >= fromRow && cell.r <= toRow) return null
    return cell.r > toRow ? { r: cell.r - count, c: cell.c } : { r: cell.r, c: cell.c }
  })
  shiftStructural(ws, toRow + 1, -count)
  return `remove_rows(${op.sheet ?? '首个工作表'}): 删除第 ${op.from}${op.to !== undefined && op.to !== op.from ? `-${op.to}` : ''} 行`
}

function opRenameSheet(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'rename_sheet' }>): string {
  assertSheetName(op.to)
  if (!wb.SheetNames.includes(op.from)) throw new Error(`找不到工作表："${op.from}"（现有：${wb.SheetNames.join('、')}）`)
  if (wb.SheetNames.includes(op.to)) throw new Error(`目标名称已存在："${op.to}"`)
  const index = wb.SheetNames.indexOf(op.from)
  wb.SheetNames[index] = op.to
  wb.Sheets[op.to] = wb.Sheets[op.from]
  delete wb.Sheets[op.from]
  const meta = sheetMeta(wb)
  meta[index] = { ...meta[index], name: op.to }
  writeSheetMeta(wb, meta)
  // Renaming does not rewrite references: every formula and defined name that spells the old sheet
  // name out loud now points at a sheet that no longer exists. Reporting it is the honest move —
  // silently rewriting someone's formulas is not this tool's call.
  const quoted = `'${op.from.replace(/'/gu, "''")}'!`
  const bare = `${op.from}!`
  const stale = (text: string): boolean => text.includes(quoted) || text.includes(bare)
  const affected: string[] = []
  for (const [name, ws] of Object.entries(wb.Sheets)) {
    for (const key of Object.keys(ws)) {
      if (!/^[A-Z]+[0-9]+$/u.test(key)) continue
      const cell = (ws as XLSX.WorkSheet)[key] as XLSX.CellObject
      if (typeof cell?.f === 'string' && stale(cell.f)) affected.push(`${name}!${key}`)
    }
  }
  for (const defined of (wb.Workbook?.Names ?? []) as XLSX.DefinedName[]) {
    if (typeof defined.Ref === 'string' && stale(defined.Ref)) affected.push(`定义名 ${defined.Name}`)
  }
  const warning = affected.length === 0
    ? ''
    : `；⚠ ${affected.length} 处引用仍写着旧表名（${affected.slice(0, 5).join('、')}${affected.length > 5 ? ' 等' : ''}），需用 set_cells 重写公式或 set_defined_name 重新指向`
  return `rename_sheet: "${op.from}" → "${op.to}"${warning}`
}

function opRemoveSheet(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'remove_sheet' }>): string {
  if (wb.SheetNames.length <= 1) throw new Error('至少要保留一个工作表，不能删除')
  if (!wb.SheetNames.includes(op.name)) throw new Error(`找不到工作表："${op.name}"（现有：${wb.SheetNames.join('、')}）`)
  const index = wb.SheetNames.indexOf(op.name)
  wb.SheetNames.splice(index, 1)
  delete wb.Sheets[op.name]
  // Per-sheet metadata (`wb.Workbook.Sheets`) is positional: dropping the entry keeps visibility
  // and the filter database attached to the right sheet instead of shifting every later sheet.
  const meta = wb.Workbook?.Sheets
  if (Array.isArray(meta) && index < meta.length) meta.splice(index, 1)
  return `remove_sheet: "${op.name}"`
}

/** Parse an A1 range like "A1:C3" (or a single cell, meaning one cell) with a clear error. */
function parseA1Range(raw: string, label: string): XLSX.Range {
  const text = String(raw ?? '').trim().toUpperCase()
  if (!/^[A-Z]{1,3}[1-9][0-9]*(?::[A-Z]{1,3}[1-9][0-9]*)?$/u.test(text)) {
    throw new Error(`${label} 区域格式无效："${String(raw)}"（应为 A1:C3 或单格 A1）`)
  }
  return XLSX.utils.decode_range(text.includes(':') ? text : `${text}:${text}`)
}

/** True when two A1 ranges share at least one cell. */
function rangesOverlap(a: XLSX.Range, b: XLSX.Range): boolean {
  return a.s.r <= b.e.r && b.s.r <= a.e.r && a.s.c <= b.e.c && b.s.c <= a.e.c
}

/** The workbook-level metadata array, sized to the sheet list. */
function sheetMeta(wb: XLSX.WorkBook): Array<Record<string, unknown>> {
  const existing = Array.isArray(wb.Workbook?.Sheets) ? (wb.Workbook?.Sheets as unknown as Array<Record<string, unknown>>) : []
  return wb.SheetNames.map((name, index) => ({ ...(existing[index] ?? {}), name }))
}

function writeSheetMeta(wb: XLSX.WorkBook, meta: Array<Record<string, unknown>>): void {
  wb.Workbook = { ...(wb.Workbook ?? {}), Sheets: meta as unknown as XLSX.SheetProps[] } as unknown as XLSX.WBProps
}

function opMergeCells(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'merge_cells' }>): string {
  const ws = getSheet(wb, op.sheet)
  const range = parseA1Range(op.range, 'merge_cells 的 range')
  if (range.s.r === range.e.r && range.s.c === range.e.c) throw new Error('merge_cells 的区域至少需要两个单元格')
  const existing = Array.isArray(ws['!merges']) ? ws['!merges'] : []
  for (const other of existing) {
    if (rangesOverlap(other, range)) {
      const label = XLSX.utils.encode_range(other)
      if (label === XLSX.utils.encode_range(range)) throw new Error(`区域 ${label} 已经是合并单元格`)
      throw new Error(`区域 ${XLSX.utils.encode_range(range)} 与既有合并区 ${label} 重叠`)
    }
  }
  ws['!merges'] = [...existing, range]
  extendRange(ws, range.s.r, range.s.c)
  extendRange(ws, range.e.r, range.e.c)
  return `merge_cells(${op.sheet ?? '首个工作表'} ${XLSX.utils.encode_range(range)})`
}

function opUnmergeCells(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'unmerge_cells' }>): string {
  const ws = getSheet(wb, op.sheet)
  const range = parseA1Range(op.range, 'unmerge_cells 的 range')
  const existing = Array.isArray(ws['!merges']) ? ws['!merges'] : []
  const kept = existing.filter((merge) => !rangesOverlap(merge, range))
  if (kept.length === existing.length) {
    throw new Error(`区域 ${XLSX.utils.encode_range(range)} 内没有合并单元格（该表现有合并区 ${existing.length} 个）`)
  }
  if (kept.length === 0) delete ws['!merges']
  else ws['!merges'] = kept
  return `unmerge_cells(${op.sheet ?? '首个工作表'} ${XLSX.utils.encode_range(range)}，解除 ${existing.length - kept.length} 个合并区)`
}

function opFreezePanes(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'freeze_panes' }>, freeze: Map<string, string>): string {
  // Resolve through getSheet first so a typo in `sheet` fails here rather than at patch time.
  getSheet(wb, op.sheet)
  const name = resolveSheetName(wb, op.sheet)
  const at = String(op.cell ?? '').trim().toUpperCase()
  if (at === '' || at === 'A1' || at === 'NONE') {
    freeze.set(name, 'A1')
    return `freeze_panes(${name}：取消冻结)`
  }
  const range = parseA1Range(at, 'freeze_panes 的 cell')
  if (range.s.r !== range.e.r || range.s.c !== range.e.c) throw new Error('freeze_panes 的 cell 必须是单个单元格（如 "A2" 冻结首行，"B2" 冻结首行首列）')
  if (range.s.r === 0 && range.s.c === 0) {
    freeze.set(name, 'A1')
    return `freeze_panes(${name}：取消冻结)`
  }
  freeze.set(name, at)
  return `freeze_panes(${name}：冻结至 ${at} 左上，即上方 ${range.s.r} 行、左侧 ${range.s.c} 列)`
}

function opMoveSheet(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'move_sheet' }>): string {
  const index = wb.SheetNames.indexOf(op.name)
  if (index === -1) throw new Error(`找不到工作表："${op.name}"（现有：${wb.SheetNames.join('、')}）`)
  if (!Number.isInteger(op.to) || op.to < 1 || op.to > wb.SheetNames.length) {
    throw new Error(`move_sheet 的 to 越界：${String(op.to)}（应为 1-${wb.SheetNames.length} 的目标位置）`)
  }
  const meta = sheetMeta(wb)
  const order = [...wb.SheetNames]
  const [moved] = order.splice(index, 1)
  order.splice(op.to - 1, 0, moved)
  const byName = new Map(meta.map((entry) => [String(entry.name), entry]))
  wb.SheetNames = order
  writeSheetMeta(wb, order.map((name) => byName.get(name) ?? { name }))
  return `move_sheet("${op.name}" → 第 ${op.to} 位；新顺序：${order.join('、')})`
}

const SHEET_STATES: Record<string, number> = { visible: 0, hidden: 1, veryHidden: 2 }

function opSetSheetState(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'set_sheet_state' }>): string {
  const index = wb.SheetNames.indexOf(op.name)
  if (index === -1) throw new Error(`找不到工作表："${op.name}"（现有：${wb.SheetNames.join('、')}）`)
  const hidden = SHEET_STATES[op.state]
  if (hidden === undefined) throw new Error(`set_sheet_state 的 state 无效："${String(op.state)}"（取 visible/hidden/veryHidden）`)
  const meta = sheetMeta(wb)
  meta[index] = { ...meta[index], name: op.name, Hidden: hidden }
  if (hidden !== 0 && meta.every((entry) => Number(entry.Hidden ?? 0) !== 0)) {
    throw new Error('不能隐藏全部工作表：Excel 要求至少保留一个可见工作表')
  }
  writeSheetMeta(wb, meta)
  return `set_sheet_state("${op.name}" → ${op.state})`
}

function opSetDefinedName(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'set_defined_name' }>): string {
  const name = String(op.name ?? '').trim()
  if (!/^[\w.\u4e00-\u9fff\\]{1,255}$/u.test(name)) throw new Error(`定义名无效："${name}"（字母/数字/下划线/点/中文，不以数字开头）`)
  const names = Array.isArray(wb.Workbook?.Names) ? ([...(wb.Workbook?.Names as XLSX.DefinedName[])]) : []
  let sheetIndex: number | undefined
  if (op.sheet !== undefined && String(op.sheet).trim() !== '') {
    const resolved = resolveSheetName(wb, op.sheet)
    sheetIndex = wb.SheetNames.indexOf(resolved)
  }
  const at = names.findIndex((entry) => entry.Name === name && (entry.Sheet ?? undefined) === sheetIndex)
  const scope = sheetIndex === undefined ? '工作簿级' : `工作表级（${wb.SheetNames[sheetIndex]}）`
  const raw = op.refers_to === null || op.refers_to === undefined ? '' : String(op.refers_to).trim()
  if (raw === '') {
    if (at === -1) throw new Error(`找不到要删除的定义名："${name}"（${scope}）`)
    names.splice(at, 1)
    wb.Workbook = { ...(wb.Workbook ?? {}), Names: names } as unknown as XLSX.WBProps
    return `set_defined_name(删除 ${scope} "${name}")`
  }
  const ref = raw.replace(/^=/u, '')
  const record: XLSX.DefinedName = { Name: name, Ref: ref, ...(sheetIndex !== undefined ? { Sheet: sheetIndex } : {}) }
  if (at === -1) names.push(record)
  else names[at] = record
  wb.Workbook = { ...(wb.Workbook ?? {}), Names: names } as unknown as XLSX.WBProps
  return `set_defined_name(${scope} "${name}" → ${ref})`
}

function opSetHyperlink(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'set_hyperlink' }>): string {
  const ws = getSheet(wb, op.sheet)
  const cell = parseA1Range(String(op.cell ?? ''), 'set_hyperlink 的 cell')
  const url = String(op.url ?? '').trim()
  if (url === '') throw new Error('set_hyperlink 的 url 不能为空')
  const addr = XLSX.utils.encode_cell({ r: cell.s.r, c: cell.s.c })
  const target = ws[addr] ?? (ws[addr] = { t: 's', v: '' })
  target.l = { Target: url, ...(op.tooltip !== undefined && op.tooltip !== '' ? { Tooltip: String(op.tooltip) } : {}) }
  extendRange(ws, cell.s.r, cell.s.c)
  return `set_hyperlink(${op.sheet ?? '首个工作表'}!${addr} → ${url})`
}

function opSetCellComment(wb: XLSX.WorkBook, op: Extract<XlsxOp, { op: 'set_cell_comment' }>): string {
  const ws = getSheet(wb, op.sheet)
  const cell = parseA1Range(String(op.cell ?? ''), 'set_cell_comment 的 cell')
  const text = String(op.text ?? '')
  if (text.trim() === '') throw new Error('set_cell_comment 的 text 不能为空（删除批注请用空字符串以外的显式操作）')
  const addr = XLSX.utils.encode_cell({ r: cell.s.r, c: cell.s.c })
  const target = ws[addr] ?? (ws[addr] = { t: 's', v: '' })
  const author = op.author === undefined || String(op.author).trim() === '' ? 'dsh-office-editor' : String(op.author).trim()
  const comments = Array.isArray(target.c) ? target.c : []
  comments.push({ a: author, t: text })
  target.c = comments
  extendRange(ws, cell.s.r, cell.s.c)
  return `set_cell_comment(${op.sheet ?? '首个工作表'}!${addr} 由「${author}」标注：${text.slice(0, 40)}${text.length > 40 ? '…' : ''})`
}

/** Quote a sheet name the way a formula spells it. */
function quoteSheetName(name: string): string {
  return /^[\w.\u4e00-\u9fff]+$/u.test(name) ? name : `'${name.replace(/'/gu, "''")}'`
}

/**
 * Keep `_xlnm._FilterDatabase` in step with every sheet's `!autofilter`.
 *
 * The two are the same fact written twice: SheetJS parses the name into `!autofilter` but writes
 * the *name* back out, so a shifted filter that only updates `!autofilter` would be re-read (by
 * Excel and by us) with its old range.
 */
function syncFilterDatabases(wb: XLSX.WorkBook): void {
  const names = Array.isArray(wb.Workbook?.Names) ? ([...(wb.Workbook?.Names as XLSX.DefinedName[])]) : []
  const kept = names.filter((entry) => entry.Name !== '_xlnm._FilterDatabase')
  const rebuilt: XLSX.DefinedName[] = []
  wb.SheetNames.forEach((name, index) => {
    const filter = wb.Sheets[name]?.['!autofilter']
    if (filter === undefined || typeof filter.ref !== 'string' || filter.ref === '') return
    rebuilt.push({ Name: '_xlnm._FilterDatabase', Ref: `${quoteSheetName(name)}!${filter.ref}`, Sheet: index })
  })
  if (kept.length === 0 && rebuilt.length === 0) return
  wb.Workbook = { ...(wb.Workbook ?? {}), Names: [...kept, ...rebuilt] } as unknown as XLSX.WBProps
}

/** Resolve a sheet selector to its real name (same rules as {@link getSheet}). */
function resolveSheetName(wb: XLSX.WorkBook, name: string | undefined): string {
  const target = (name ?? wb.SheetNames[0] ?? '').trim()
  if (target === '') throw new Error('工作簿中没有工作表')
  const sheetName = /^\d+$/u.test(target) ? wb.SheetNames[Number(target) - 1] : target
  if (sheetName === undefined || wb.Sheets[sheetName] === undefined) {
    throw new Error(`找不到工作表："${target}"（现有：${wb.SheetNames.join('、')}）`)
  }
  return sheetName
}

/**
 * Load an existing workbook, apply the ordered operations, and serialize back to .xlsx.
 *
 * Read options that matter, each verified by a round-trip probe rather than assumed:
 * - `cellFormula` keeps formulas;
 * - `sheetStubs` keeps "exists but empty" cells, so a blank styled cell is not dropped;
 * - `cellNF` populates `cell.z`, which is how the number format reaches the model;
 * - `cellStyles` parses `!cols`/`!rows`, so column widths and row heights survive the round trip.
 *
 * Fidelity: SheetJS rebuilds `xl/styles.xml` from scratch when writing (one font, two fills, one
 * border), and only the number format is derivable into a cell style index. Fonts, fills, borders
 * and alignment are therefore genuinely lost; number formats survive as cell metadata; column
 * widths and row heights survive. `office_edit`'s description states exactly this.
 *
 * @param bytes - raw .xlsx bytes.
 * @param ops - operations applied in order; an op index accompanies any failure message.
 * @param maxRowsPerSheet - per-sheet row cap for newly written matrices.
 * @param mtime - entry timestamp policy for the re-pack; defaults to reproducible fixed stamps.
 * @returns the rewritten bytes plus one line per applied operation.
 */
export function editXlsx(bytes: Uint8Array, ops: XlsxOp[], maxRowsPerSheet: number, mtime?: MtimeSource): XlsxEditResult {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(bytes, { type: 'buffer', cellFormula: true, sheetStubs: true, cellNF: true, cellStyles: true })
  } catch (error) {
    throw new Error(`无法解析该 xlsx 文件（${error instanceof Error ? error.message : String(error)}）`)
  }
  const applied: string[] = []
  const freeze = new Map<string, string>()
  for (const [index, op] of ops.entries()) {
    try {
      switch (op.op) {
        case 'set_cells': applied.push(opSetCells(wb, op)); break
        case 'add_rows': applied.push(opAddRows(wb, op, maxRowsPerSheet)); break
        case 'add_sheet': applied.push(opAddSheet(wb, op, maxRowsPerSheet)); break
        case 'remove_rows': applied.push(opRemoveRows(wb, op)); break
        case 'rename_sheet': applied.push(opRenameSheet(wb, op)); break
        case 'remove_sheet': applied.push(opRemoveSheet(wb, op)); break
        case 'move_sheet': applied.push(opMoveSheet(wb, op)); break
        case 'set_sheet_state': applied.push(opSetSheetState(wb, op)); break
        case 'merge_cells': applied.push(opMergeCells(wb, op)); break
        case 'unmerge_cells': applied.push(opUnmergeCells(wb, op)); break
        case 'freeze_panes': applied.push(opFreezePanes(wb, op, freeze)); break
        case 'set_defined_name': applied.push(opSetDefinedName(wb, op)); break
        case 'set_hyperlink': applied.push(opSetHyperlink(wb, op)); break
        case 'set_cell_comment': applied.push(opSetCellComment(wb, op)); break
        default: throw new Error(`未知操作：${JSON.stringify(op)}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`第 ${index + 1} 个操作失败：${message}`)
    }
  }
  // `CalcPr` is accepted by the 0.18 type declarations and ignored by its writer, so it is applied
  // as a post-write XML patch together with the freeze panes (see `patchWorkbookXml`).
  wb.Workbook = { ...(wb.Workbook ?? {}), CalcPr: { fullCalcOnLoad: true } } as unknown as XLSX.WBProps
  syncFilterDatabases(wb)
  const written = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
  return { bytes: patchWorkbookXml(written, { freeze, fullCalcOnLoad: true, mtime }), applied }
}

// ---------- post-write XML patching ----------

/** The two workbook features SheetJS accepts in its object model but never writes out. */
interface WorkbookPatch {
  /** Sheet name → frozen top-left cell ("A1" means unfreeze). */
  freeze: Map<string, string>
  /** Insert `<calcPr fullCalcOnLoad="1"/>` when the workbook has no `<calcPr>` yet. */
  fullCalcOnLoad: boolean
  /** Entry timestamp policy for the re-pack; `source` stamps each part's real mtime. */
  mtime?: MtimeSource
}

/** Map sheet names to the worksheet part that holds them, via workbook.xml + its rels. */
function sheetPartPaths(files: Record<string, Uint8Array>): Map<string, string> {
  const out = new Map<string, string>()
  const workbook = files['xl/workbook.xml']
  const rels = files['xl/_rels/workbook.xml.rels']
  if (workbook === undefined || rels === undefined) return out
  const relXml = strFromU8(rels)
  const targets = new Map<string, string>()
  for (const match of relXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>|<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"[^>]*\/>/gu)) {
    const id = match[1] ?? match[4]
    const target = match[2] ?? match[3]
    if (id === undefined || target === undefined) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//u, '')}`
    targets.set(id, path)
  }
  for (const match of strFromU8(workbook).matchAll(/<sheet\b[^>]*\/>/gu)) {
    const name = /name="([^"]*)"/u.exec(match[0])?.[1]
    const id = /r:id="([^"]+)"/u.exec(match[0])?.[1]
    if (name === undefined || id === undefined) continue
    const path = targets.get(id)
    if (path !== undefined) out.set(name.replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'"), path)
  }
  return out
}

/** The `<pane>` + `<selection>` pair that expresses `at` as a frozen window. */
function freezePaneXml(at: string): string {
  const decoder = /^([A-Z]{1,3})([0-9]+)$/u.exec(at) as RegExpExecArray
  const col = XLSX.utils.decode_col(decoder[1])
  const row = Number(decoder[2]) - 1
  const xSplit = col
  const ySplit = row
  if (xSplit === 0 && ySplit === 0) return ''
  const topLeft = XLSX.utils.encode_cell({ r: ySplit, c: xSplit })
  const activePane = xSplit > 0 && ySplit > 0 ? 'bottomRight' : (xSplit > 0 ? 'topRight' : 'bottomLeft')
  const pane = `<pane${xSplit > 0 ? ` xSplit="${xSplit}"` : ''}${ySplit > 0 ? ` ySplit="${ySplit}"` : ''} topLeftCell="${topLeft}" activePane="${activePane}" state="frozen"/>`
  return `${pane}<selection pane="${activePane}" activeCell="${topLeft}" sqref="${topLeft}"/>`
}

/** Insert (or replace) the freeze pane inside a worksheet part's `<sheetView>`. */
function injectFreezePane(sheetXml: string, paneXml: string): string {
  const existingPane = /<pane\b[^>]*\/>/u.exec(sheetXml)
  if (existingPane !== null) {
    let next = sheetXml.replace(existingPane[0], paneXml === '' ? '' : paneXml.slice(0, paneXml.indexOf('<selection')))
    if (paneXml !== '' && !/<selection\b/u.test(next)) {
      const open = /<sheetView\b[^>]*>/u.exec(next)
      if (open !== null) next = next.slice(0, open.index + open[0].length) + paneXml.slice(paneXml.indexOf('<selection')) + next.slice(open.index + open[0].length)
    }
    return next
  }
  if (paneXml === '') return sheetXml
  const selfClosing = /<sheetView\b[^>]*\/>/u.exec(sheetXml)
  if (selfClosing !== null) return sheetXml.replace(selfClosing[0], `${selfClosing[0].replace(/\/>$/u, '>')}${paneXml}</sheetView>`)
  const open = /<sheetView\b[^>]*>/u.exec(sheetXml)
  if (open !== null) return sheetXml.slice(0, open.index + open[0].length) + paneXml + sheetXml.slice(open.index + open[0].length)
  const emptyViews = /<sheetViews\b[^>]*\/>/u.exec(sheetXml)
  if (emptyViews !== null) return sheetXml.replace(emptyViews[0], `<sheetViews><sheetView workbookViewId="0">${paneXml}</sheetView></sheetViews>`)
  const views = /<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/u.exec(sheetXml)
  if (views !== null) return sheetXml.replace(views[0], `<sheetViews><sheetView workbookViewId="0">${paneXml}</sheetView></sheetViews>`)
  // CT_Worksheet order: sheetPr, dimension, sheetViews, sheetFormatPr, cols, sheetData…
  const anchor = /<sheetFormatPr\b|<cols\b|<sheetData\b|<mergeCells\b|<hyperlinks\b|<pageMargins\b|<\/worksheet>/u.exec(sheetXml)
  const block = `<sheetViews><sheetView workbookViewId="0">${paneXml}</sheetView></sheetViews>`
  return anchor === null ? sheetXml : sheetXml.slice(0, anchor.index) + block + sheetXml.slice(anchor.index)
}

/**
 * Apply the workbook patches SheetJS cannot express, then re-zip.
 *
 * Both patches are plain string work on parts SheetJS just produced, so each touched part is
 * re-checked for well-formedness before it goes back into the container — the same standard the
 * docx engine holds itself to.
 */
function patchWorkbookXml(bytes: Uint8Array, patch: WorkbookPatch): Uint8Array {
  const wanted = [...patch.freeze.entries()].filter(([, at]) => at !== 'A1')
  // SheetJS emits its own zip, whose entry order and per-entry timestamps are not reproducible;
  // the parts always go back through `packOoxml`, patched or not, so identical content yields
  // identical bytes either way.
  const files = unzipSync(bytes)
  if (wanted.length > 0) {
    const parts = sheetPartPaths(files)
    for (const [name, at] of wanted) {
      const path = parts.get(name)
      if (path === undefined || files[path] === undefined) {
        throw new Error(`冻结窗格写入失败：在生成的 xlsx 中找不到工作表"${name}"对应的部件`)
      }
      const patched = injectFreezePane(strFromU8(files[path]), freezePaneXml(at))
      assertWellFormedXml(patched, path)
      files[path] = strToU8(patched)
    }
  }
  if (patch.fullCalcOnLoad) {
    const workbookPath = 'xl/workbook.xml'
    const workbookXml = files[workbookPath] === undefined ? null : strFromU8(files[workbookPath])
    if (workbookXml !== null && !/<calcPr\b/u.test(workbookXml)) {
      // CT_Workbook order puts calcPr after definedNames, i.e. immediately before the close tag.
      const patched = workbookXml.replace('</workbook>', '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>')
      assertWellFormedXml(patched, workbookPath)
      files[workbookPath] = strToU8(patched)
    }
  }
  return packOoxml(partsToMap(files), patch.mtime === 'source' ? { mtime: 'source' } : {})
}

// ---------- CSV / TSV export ----------

/** Export request for {@link exportXlsx}. */
export interface XlsxExportOptions {
  /** `csv` (comma) or `tsv` (tab). */
  format: 'csv' | 'tsv'
  /** Sheet name or 1-based index; omitted means the first sheet (or all sheets when `allSheets`). */
  sheet?: string
  /** Export every sheet; `output` is then a directory and each sheet becomes one file. */
  allSheets?: boolean
  /** Prefix a UTF-8 BOM so Excel on Windows reads non-ASCII text correctly (default true). */
  bom?: boolean
}

/** One produced file. */
export interface XlsxExportFile {
  /** Sheet name the file came from. */
  sheet: string
  /** Sanitized file name (no directory). */
  file: string
  /** Text written, BOM excluded. */
  text: string
  /** Data rows written (header row included). */
  rows: number
}

/** Replace the characters Windows forbids in a file name. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').replace(/[. ]+$/gu, '').trim()
  return cleaned === '' ? 'sheet' : cleaned.slice(0, 80)
}

/**
 * Render one workbook as CSV/TSV text per sheet.
 *
 * Values are the *displayed* values (`cell.w` when SheetJS computed one, otherwise the raw value):
 * a spreadsheet export is a data interchange, and a formula the recipient cannot evaluate is less
 * useful than the number it currently evaluates to.
 */
export function exportXlsx(bytes: Uint8Array, options: XlsxExportOptions): { files: XlsxExportFile[] } {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(bytes, { type: 'buffer', cellNF: true, cellText: true, cellDates: false })
  } catch (error) {
    throw new Error(`无法解析该 xlsx 文件（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (wb.SheetNames.length === 0) throw new Error('该工作簿没有工作表')
  let names: string[]
  if (options.allSheets === true) {
    names = [...wb.SheetNames]
  } else if (options.sheet !== undefined && String(options.sheet).trim() !== '') {
    const target = String(options.sheet).trim()
    const resolved = /^\d+$/u.test(target) ? wb.SheetNames[Number(target) - 1] : target
    if (resolved === undefined || wb.Sheets[resolved] === undefined) {
      throw new Error(`找不到工作表："${target}"（现有：${wb.SheetNames.join('、')}）`)
    }
    names = [resolved]
  } else if (wb.SheetNames.length === 1) {
    names = [wb.SheetNames[0]]
  } else {
    throw new Error(`该工作簿有 ${wb.SheetNames.length} 个工作表（${wb.SheetNames.join('、')}），请用 sheet 指定其一，或设 all_sheets=true 逐表导出`)
  }
  const fs = options.format === 'tsv' ? '\t' : ','
  const bom = options.bom !== false ? '\uFEFF' : ''
  const files = names.map((name) => {
    const ws = wb.Sheets[name]
    if (ws === undefined) throw new Error(`工作表"${name}"内容缺失`)
    // `blankrows: false` drops the empty spacer rows a used-range read tends to produce; the
    // separator/quote handling is SheetJS's (it quotes any field containing FS, a quote or a
    // newline), which is what makes TSV with embedded tabs still parseable.
    const body = XLSX.utils.sheet_to_csv(ws, { FS: fs, blankrows: false, strip: false })
    const text = body.endsWith('\n') ? body.slice(0, -1) : body
    const rows = text === '' ? 0 : text.split('\n').length
    return { sheet: name, file: `${sanitizeFileName(name)}.${options.format}`, text: `${bom}${text}`, rows }
  })
  return { files }
}

/**
 * Verify candidate .xlsx bytes without reusing the writer that produced them: unzip (fflate checks
 * every entry CRC), required parts, tag-stack well-formedness of every `.xml`/`.rels` part, and a
 * SheetJS re-parse.
 *
 * The XML walk matters because freeze panes and `<calcPr>` are patched into already-serialized
 * parts; re-reading with SheetJS alone would not notice a splice that produced a second root.
 *
 * @param bytes - candidate .xlsx bytes.
 * @throws an Error describing the first structural problem found.
 */
export function verifyXlsx(bytes: Uint8Array): { sheetCount: number; sheetNames: string[]; entryCount: number } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new Error(`生成的 xlsx 不是有效的 zip 容器（${error instanceof Error ? error.message : String(error)}）`)
  }
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml']) {
    if (files[required] === undefined) throw new Error(`生成的 xlsx 缺少必需部件：${required}`)
  }
  for (const [name, data] of Object.entries(files)) {
    if (name === '[Content_Types].xml' || !/\.(?:xml|rels)$/u.test(name)) continue
    assertWellFormedXml(strFromU8(data), name)
  }
  const wb = XLSX.read(bytes, { type: 'buffer' })
  return { sheetCount: wb.SheetNames.length, sheetNames: [...wb.SheetNames], entryCount: Object.keys(files).length }
}
