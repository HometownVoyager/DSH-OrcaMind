/**
 * AcroForm support: probing fields, validating values *before* writing, filling with a font that can
 * actually render the values, and flattening.
 *
 * Two pdf-lib behaviours shape this module. `PDFDropdown.select()` silently accepts a value that is
 * not among the field's options (it switches the field into editable mode), so a typo becomes a
 * silently wrong document unless the caller validates first — that validation is what `dry_run`
 * returns. And `save()`/`flatten()` regenerate appearance streams with the *standard* font by
 * default, which throws the moment a value contains CJK; appearances are therefore always rebuilt
 * explicitly with a font that can encode the values, and the default pass is switched off.
 * @module dsh-pdf-editor/src/forms
 */

import {
  PDFButton, PDFCheckBox, PDFDropdown, PDFField, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField,
} from 'pdf-lib'
import type { Box, LoadedPdf } from './pdfedit.js'
import { resolveTextFont, type FontRequest, type ResolvedFont } from './fonts.js'

/** Field kind in the tool's own vocabulary. */
export type FieldKind = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionlist' | 'button' | 'signature' | 'unknown'

/** One probed form field. */
export interface FieldInfo {
  /** Fully qualified field name. */
  name: string
  /** Field kind. */
  kind: FieldKind
  /** Current value: text, checked state, selection(s), or null for kinds that carry no value. */
  value: string | boolean | string[] | null
  /** Selectable options for choice fields. */
  options?: string[]
  /** `/Ff` read-only flag. */
  readOnly: boolean
  /** `/Ff` required flag. */
  required: boolean
  /** Maximum text length when the field declares one. */
  maxLength?: number
  /** Whether a text field accepts multiple lines. */
  multiline?: boolean
  /** 1-based page holding the field's first widget. */
  page?: number
  /** First widget's rectangle in PDF points. */
  rect?: Box
  /** Number of widgets (radio groups have one per option). */
  widgets: number
}

/** One validation finding for a proposed fill. */
export interface FillIssue {
  /** Field the issue belongs to. */
  field: string
  /** `error` blocks the write; `warning` is reported but allowed. */
  severity: 'error' | 'warning'
  /** What is wrong and what to do instead. */
  message: string
}

/** A value the caller wants written into a field. */
export type FieldValue = string | number | boolean | string[]

/** Probe every field in the document. */
export function probeFields(loaded: LoadedPdf): FieldInfo[] {
  if (!loaded.hasAcroForm) return []
  const pageOfRef = new Map<string, number>()
  loaded.doc.getPages().forEach((page, index) => pageOfRef.set(`${page.ref.objectNumber}:${page.ref.generationNumber}`, index + 1))
  const fields: FieldInfo[] = []
  for (const field of loaded.doc.getForm().getFields()) {
    const widgets = field.acroField.getWidgets()
    const first = widgets[0]
    const parent = first?.P()
    const rect = first?.getRectangle()
    const info: FieldInfo = {
      name: field.getName(),
      kind: kindOf(field),
      value: valueOf(field),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      widgets: widgets.length,
    }
    const options = optionsOf(field)
    if (options !== undefined) info.options = options
    const maxLength = field instanceof PDFTextField ? field.getMaxLength() : undefined
    if (maxLength !== undefined) info.maxLength = maxLength
    if (field instanceof PDFTextField && field.isMultiline()) info.multiline = true
    if (parent !== undefined) {
      const pageNumber = pageOfRef.get(`${parent.objectNumber}:${parent.generationNumber}`)
      if (pageNumber !== undefined) info.page = pageNumber
    }
    if (rect !== undefined) info.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    fields.push(info)
  }
  return fields
}

function kindOf(field: PDFField): FieldKind {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFOptionList) return 'optionlist'
  if (field instanceof PDFButton) return 'button'
  if (field instanceof PDFSignature) return 'signature'
  return 'unknown'
}

function valueOf(field: PDFField): string | boolean | string[] | null {
  if (field instanceof PDFTextField) return field.getText() ?? ''
  if (field instanceof PDFCheckBox) return field.isChecked()
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? ''
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected()
  return null
}

function optionsOf(field: PDFField): string[] | undefined {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) return field.getOptions()
  return undefined
}

/**
 * Validate proposed values against the probed fields, without touching the document.
 *
 * @param fields - probed fields.
 * @param values - field name to proposed value.
 * @param options - `allowCustom` permits choice values outside the option list (pdf-lib switches an
 *   editable dropdown into editing mode for those, which is a deliberate choice, not a typo).
 * @returns every finding, errors and warnings alike.
 */
export function validateValues(fields: readonly FieldInfo[], values: Readonly<Record<string, FieldValue>>, options: { allowCustom: boolean }): FillIssue[] {
  const issues: FillIssue[] = []
  const byName = new Map(fields.map((field) => [field.name, field]))
  for (const [name, raw] of Object.entries(values)) {
    const field = byName.get(name)
    if (field === undefined) {
      const names = fields.map((entry) => entry.name)
      issues.push({
        field: name,
        severity: 'error',
        message: names.length === 0 ? `文档没有表单字段，无法填写 ${name}` : `未知字段：${name}（现有字段：${names.join('、')}）`,
      })
      continue
    }
    if (field.readOnly) {
      issues.push({ field: name, severity: 'error', message: `字段 ${name} 是只读字段（/Ff ReadOnly），无法填写` })
      continue
    }
    switch (field.kind) {
      case 'text': {
        if (typeof raw !== 'string' && typeof raw !== 'number') {
          issues.push({ field: name, severity: 'error', message: `字段 ${name} 是文本域，值必须是字符串（收到 ${typeof raw}）` })
          break
        }
        const text = String(raw)
        if (field.maxLength !== undefined && text.length > field.maxLength) {
          issues.push({ field: name, severity: 'error', message: `字段 ${name} 限长 ${field.maxLength} 字符，值有 ${text.length} 字符` })
        }
        break
      }
      case 'checkbox':
        if (typeof raw !== 'boolean') {
          issues.push({ field: name, severity: 'error', message: `字段 ${name} 是复选框，值必须是 true/false（收到 ${JSON.stringify(raw)}）` })
        }
        break
      case 'dropdown':
      case 'radio': {
        if (typeof raw !== 'string') {
          issues.push({ field: name, severity: 'error', message: `字段 ${name} 是${field.kind === 'radio' ? '单选组' : '下拉框'}，值必须是字符串（收到 ${JSON.stringify(raw)}）` })
          break
        }
        if (!options.allowCustom && field.options !== undefined && !field.options.includes(raw)) {
          issues.push({
            field: name,
            severity: 'error',
            message: `字段 ${name} 的值「${raw}」不在选项里（可选：${field.options.join('、')}）；pdf-lib 会静默接受并把它变成「可编辑」状态，需要这样做时请显式传 allow_custom=true`,
          })
        }
        break
      }
      case 'optionlist': {
        const list = Array.isArray(raw) ? raw : [String(raw)]
        if (Array.isArray(raw) && raw.length === 0) {
          issues.push({ field: name, severity: 'warning', message: `字段 ${name} 收到空数组：将清空选择` })
          break
        }
        const missing = options.allowCustom ? [] : list.filter((value) => field.options !== undefined && !field.options.includes(value))
        if (missing.length > 0) {
          issues.push({ field: name, severity: 'error', message: `字段 ${name} 的值「${missing.join('、')}」不在选项里（可选：${(field.options ?? []).join('、')}）` })
        }
        break
      }
      case 'button':
      case 'signature':
        issues.push({ field: name, severity: 'error', message: `字段 ${name} 是${field.kind === 'signature' ? '签名域' : '按钮'}，本插件不填写（签名需证书，按钮是动作触发）` })
        break
      default:
        issues.push({ field: name, severity: 'error', message: `字段 ${name} 的类型不受支持，无法填写` })
    }
  }
  return issues
}

/** Outcome of applying values. */
export interface FillOutcome {
  /** Values written, in input order. */
  applied: Array<{ name: string; kind: FieldKind; value: string | boolean | string[] }>
  /** The font used for appearance streams and where it came from. */
  font: Pick<ResolvedFont, 'source' | 'path' | 'notes'>
  /** Non-fatal observations. */
  warnings: string[]
}

/**
 * Apply validated values and rebuild every dirty field's appearance with a font that can render them.
 *
 * @param loaded - the loaded document (modified in place).
 * @param fields - probed fields (used for kinds and options).
 * @param values - field name to value.
 * @param options - `allowCustom` and the font request.
 * @returns what was written plus the font provenance.
 * @throws an Error when no font can render the values (nothing is written in that case).
 */
export async function applyValues(
  loaded: LoadedPdf,
  fields: readonly FieldInfo[],
  values: Readonly<Record<string, FieldValue>>,
  options: { allowCustom: boolean; font: FontRequest },
): Promise<FillOutcome> {
  const form = loaded.doc.getForm()
  const texts = Object.values(values).flatMap((value) => (typeof value === 'string' ? [value] : typeof value === 'number' ? [String(value)] : Array.isArray(value) ? value : []))
  const resolved = await resolveTextFont(loaded.doc, texts, options.font)
  const warnings: string[] = [...resolved.notes]
  const applied: FillOutcome['applied'] = []
  const byName = new Map(fields.map((field) => [field.name, field]))
  for (const [name, raw] of Object.entries(values)) {
    const kind = byName.get(name)?.kind ?? 'unknown'
    switch (kind) {
      case 'text': {
        const value = String(raw)
        form.getTextField(name).setText(value)
        applied.push({ name, kind, value })
        break
      }
      case 'checkbox': {
        const value = raw === true
        const box = form.getCheckBox(name)
        if (value) box.check()
        else box.uncheck()
        applied.push({ name, kind, value })
        break
      }
      case 'dropdown': {
        const value = String(raw)
        const dropdown = form.getDropdown(name)
        dropdown.select(value)
        applied.push({ name, kind, value })
        break
      }
      case 'radio': {
        const value = String(raw)
        form.getRadioGroup(name).select(value)
        applied.push({ name, kind, value })
        break
      }
      case 'optionlist': {
        const value = Array.isArray(raw) ? raw : [String(raw)]
        form.getOptionList(name).select(value)
        applied.push({ name, kind, value })
        break
      }
      default:
        throw new Error(`字段 ${name} 的类型不支持填写`)
    }
  }
  // Rebuild appearances with the resolved font: the default pass would use Helvetica and throw on
  // any non-WinAnsi value.
  form.updateFieldAppearances(resolved.font)
  return { applied, font: { source: resolved.source, ...(resolved.path === undefined ? {} : { path: resolved.path }), notes: resolved.notes }, warnings }
}

/**
 * Flatten every field, leaving no interactive controls behind.
 *
 * `updateFieldAppearances` stays off because the caller has already rebuilt appearances with a font
 * that can render the values; letting pdf-lib redo it here would throw on CJK values.
 *
 * @param loaded - the loaded document (modified in place).
 */
export function flattenForm(loaded: LoadedPdf): void {
  loaded.doc.getForm().flatten({ updateFieldAppearances: false })
}
