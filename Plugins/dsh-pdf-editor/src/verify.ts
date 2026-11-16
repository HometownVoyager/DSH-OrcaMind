/**
 * Post-write verification for the editor: the written bytes are read back and compared against what
 * the operation claimed to do. Page count alone proves nothing — a reorder that silently dropped the
 * requested order still has the right count — so page identity is compared through the content-stream
 * fingerprints captured from the source documents before any modification.
 * @module dsh-pdf-editor/src/verify
 */

import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, type PDFField } from 'pdf-lib'
import { loadPdf, structuralCheck, type Box, type PageFacts } from './pdfedit.js'
import { readMetadata, type InfoField } from './metadata.js'

/** One verification result. */
export interface Check {
  /** What was checked, in the model's vocabulary. */
  name: string
  /** Whether it held. */
  ok: boolean
  /** Extra detail for a failure or a notable pass. */
  detail?: string
}

/**
 * Build one check.
 *
 * A `detail` key is omitted rather than set to `undefined`: the tool result crosses the harness's
 * lossless-JSON boundary, where a present-but-undefined property is rejected outright.
 */
function makeCheck(name: string, ok: boolean, detail?: string): Check {
  return detail === undefined || detail === '' ? { name, ok } : { name, ok, detail }
}

/** Aggregate outcome of a verification run. */
export interface VerificationResult {
  /** Every check performed. */
  checks: Check[]
  /** Failed checks only. */
  problems: string[]
  /** Whether every check passed. */
  verified: boolean
}

/** Turn checks into the aggregate result. */
export function summarize(checks: Check[]): VerificationResult {
  const problems = checks.filter((check) => !check.ok).map((check) => `${check.name}：${check.detail ?? '未通过'}`)
  return { checks, problems, verified: problems.length === 0 }
}

/** Structural checks that need only the written bytes. */
export function checkStructure(bytes: Uint8Array): Check[] {
  const problems = structuralCheck(bytes)
  return [makeCheck('PDF 结构（%PDF- 文件头 / %%EOF 结束标记 / 无 /Encrypt）', problems.length === 0, problems.join('；'))]
}

/**
 * Re-read the written bytes with the plugin's own loader.
 * @param bytes - written PDF bytes.
 * @returns the reloaded per-page facts.
 * @throws a PdfEditorError when the written file cannot be read back.
 */
export async function loadFacts(bytes: Uint8Array): Promise<PageFacts[]> {
  const loaded = await loadPdf(bytes, 'verify', null)
  return loaded.pages
}

/** The reload check itself, so a write that produces an unreadable file is reported as such. */
export async function checkReload(bytes: Uint8Array): Promise<{ check: Check; facts: PageFacts[] }> {
  try {
    const facts = await loadFacts(bytes)
    return { check: makeCheck('重新打开（本插件自己的加载路径）', true, `${facts.length} 页`), facts }
  } catch (error) {
    return {
      check: makeCheck('重新打开（本插件自己的加载路径）', false, error instanceof Error ? error.message : String(error)),
      facts: [],
    }
  }
}

/** Compare the written page count. */
export function checkPageCount(facts: readonly PageFacts[], expected: number): Check {
  return makeCheck('页数', facts.length === expected, `期望 ${expected} 页，实际 ${facts.length} 页`)
}

/** Compare page identity and order through content fingerprints. */
export function checkFingerprints(facts: readonly PageFacts[], expected: readonly string[]): Check {
  if (facts.length !== expected.length) {
    return makeCheck('页面顺序（内容指纹）', false, `页数不一致：期望 ${expected.length}，实际 ${facts.length}`)
  }
  const mismatch = expected.findIndex((fingerprint, index) => facts[index].fingerprint !== fingerprint)
  return makeCheck(
    '页面顺序（内容指纹）',
    mismatch === -1,
    mismatch === -1 ? undefined : `第 ${mismatch + 1} 页内容不符（期望 ${expected[mismatch]}，实际 ${facts[mismatch].fingerprint}）`,
  )
}

/** Compare `/Rotate` values. */
export function checkRotations(facts: readonly PageFacts[], expected: ReadonlyArray<{ page: number; angle: number }>): Check {
  const bad = expected.find((entry) => facts[entry.page - 1]?.rotation !== entry.angle)
  return makeCheck('旋转角', bad === undefined, bad === undefined ? undefined : `第 ${bad.page} 页期望 ${bad.angle}°，实际 ${facts[bad.page - 1]?.rotation}°`)
}

/** Compare crop boxes with a tolerance of one point (pdf-lib stores numbers as written). */
export function checkCropBoxes(facts: readonly PageFacts[], expected: ReadonlyArray<{ page: number; box: Box }>): Check {
  const same = (a: Box, b: Box): boolean => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1
  const bad = expected.find((entry) => facts[entry.page - 1] === undefined || !same(facts[entry.page - 1].cropBox, entry.box))
  return makeCheck('裁剪框', bad === undefined, bad === undefined ? undefined : `第 ${bad.page} 页裁剪框不符（期望 ${JSON.stringify(bad.box)}）`)
}

/** Compare form field values in a written document. */
export async function checkFieldValues(bytes: Uint8Array, expected: ReadonlyArray<{ name: string; value: string | boolean | string[] }>): Promise<Check> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  const problems: string[] = []
  for (const entry of expected) {
    const field = form.getFieldMaybe(entry.name)
    if (field === undefined) {
      problems.push(`字段 ${entry.name} 丢失`)
      continue
    }
    const actual = readFieldValue(field)
    if (!sameValue(entry.value, actual)) problems.push(`字段 ${entry.name} 期望 ${JSON.stringify(entry.value)}，实际 ${JSON.stringify(actual)}`)
  }
  return { name: '表单字段值', ok: problems.length === 0, detail: problems.join('；') }
}

/**
 * Compare a written value with what the document reads back.
 *
 * Choice fields report their selection as a list — a single-select dropdown reads back as
 * `["Three"]` — while the caller writes the scalar `"Three"`. That is the same fact, so a
 * one-element list and its element compare equal.
 */
function sameValue(expected: string | boolean | string[], actual: string | boolean | string[] | null): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => value === actual[index])
  }
  if (Array.isArray(actual)) return actual.length === 1 && actual[0] === expected
  return actual === expected
}

/** Read a field's current value in the tool's own vocabulary. */
export function readFieldValue(field: PDFField): string | boolean | string[] | null {
  if (field instanceof PDFTextField) return field.getText() ?? ''
  if (field instanceof PDFCheckBox) return field.isChecked()
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? ''
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected()
  return null
}

/** Compare information-dictionary metadata after a write. */
export async function checkMetadata(bytes: Uint8Array, expected: Partial<Record<InfoField, string>>): Promise<Check> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const snapshot = readMetadata(doc)
  const problems: string[] = []
  for (const [field, value] of Object.entries(expected) as Array<[InfoField, string]>) {
    const actual = snapshot.info[field]
    if (actual !== value) problems.push(`${field} 期望「${value}」，实际「${actual ?? '空'}」`)
  }
  return makeCheck('元数据', problems.length === 0, problems.join('；'))
}

/** Check that the XMP packet still carries the expected strings after a write. */
export async function checkXmp(bytes: Uint8Array, expected: readonly string[]): Promise<Check> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const snapshot = readMetadata(doc)
  const missing = expected.filter((needle) => !Object.values(snapshot.xmp).some((value) => value.includes(needle)))
  return makeCheck('XMP 保留', missing.length === 0, missing.length === 0 ? undefined : `XMP 中找不到：${missing.join('、')}`)
}

/** Check that page content grew (a stamp actually drew something). */
export function checkContentGrew(before: readonly PageFacts[], after: readonly PageFacts[], pages: readonly number[]): Check {
  const unchanged = pages.filter((page) => {
    const beforeFacts = before[page - 1]
    const afterFacts = after[page - 1]
    return beforeFacts === undefined || afterFacts === undefined ? true : beforeFacts.fingerprint === afterFacts.fingerprint
  })
  return makeCheck('叠加内容已写入（受影响页的内容流指纹应变化）', unchanged.length === 0, unchanged.length === 0 ? undefined : `以下页内容未变化：${unchanged.join('、')}`)
}
