/**
 * @dsh-external/dsh-pdf-editor — PDF 文档编辑工具集（纯 Node，基于 pdf-lib）。
 *
 * 四个模型可见工具：
 * - `pdf_pages`：页面操作套件——合并 / 拆分 / 抽页 / 删页 / 重排 / 增量旋转 / 裁剪 / 插入；
 * - `pdf_form`：AcroForm 探测 → 校验（先校验后写）→ 填写 → 扁平化；
 * - `pdf_stamp`：叠加/盖章/水印，带坐标三体系契约、绘制前 lint 与红框预览；
 * - `pdf_metadata`：元数据读/写/删除 + XMP 保留与可选同步。
 *
 * 纪律（对应用户侧比对报告的整改项）：
 * - 加密文档明确拒绝而不是忽略加密标志：pdf-lib 不解密，强行写会把密文搬进新文件；
 * - 写盘后回读校验（页数、页面内容指纹、旋转角、裁剪框、字段值、元数据），指纹取自内容流字节，
 *   能证明「重排真的按请求顺序」而不只是页数对得上；
 * - 中文（一切非 WinAnsi 字符）必须自备可嵌入字体，绝不静默回退到 Helvetica 产出豆腐块；
 * - 表单填写先校验：pdf-lib 的下拉框会静默接受不在选项里的值，把它当错误报出是本插件的责任。
 */

import { basename, join } from 'node:path'
import type { Context } from 'cordis'
import { defineTool, type GenericCallView, type ToolExecution } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import {
  deriveOutput, dirOf, readImageFile, resolveOutDir, resolveOutput, sanitizeFileName, stemOf, writeOutput, type WriteOutcome,
} from './io.js'
import { localPath, resolveSource, type SourceCaps } from './source.js'
import {
  PdfEditorError, cropPages, insertPages, loadPdf, rebuildFromPages, removePages, reorderPages, rotatePages,
  type Box, type LoadedPdf, type PageFacts,
} from './pdfedit.js'
import { parsePages, pagesToken } from './pages.js'
import { applyMetadata, canonicalKeywords, parsePdfDate, readMetadata, INFO_FIELDS, type InfoField } from './metadata.js'
import { applyValues, flattenForm, probeFields, validateValues, type FieldInfo, type FieldValue, type FillIssue } from './forms.js'
import { resolveTextFont, type FontRequest } from './fonts.js'
import {
  drawMarks, lintMarks, toPdfPoints, watermarkMarks, type GeometrySpec, type MarkIssue, type MarkSpec, type WatermarkSpec,
} from './marks.js'
import {
  checkContentGrew, checkCropBoxes, checkFieldValues, checkFingerprints, checkMetadata, checkPageCount, checkReload,
  checkRotations, checkStructure, checkXmp, summarize, type Check,
} from './verify.js'

export const name = '@dsh-external/dsh-pdf-editor'
export const inject = ['tools']

/**
 * Top-level `type: 'json'` parameters cross the model boundary as raw JSON text
 * on some gateways (nested fields inside parsed arrays/objects are unaffected),
 * so declared-object params can arrive as strings. Parse JSON-looking strings
 * back into values; anything else passes through unchanged.
 * @param value - the raw parameter value as dispatched.
 * @returns the parsed JSON value when the text denotes an object or array, otherwise the input.
 */
function coerceJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

/**
 * Normalize the declared top-level `json` fields of one tool call's arguments.
 * @param args - raw dispatched arguments.
 * @param fields - parameter names declared `type: 'json'` on this tool.
 * @returns a shallow copy with those fields parsed from JSON text when applicable.
 */
function coerceJsonFields<T extends Record<string, unknown>>(args: T, fields: readonly string[]): T {
  const out: Record<string, unknown> = { ...args }
  for (const field of fields) {
    if (field in out) out[field] = coerceJsonText(out[field])
  }
  return out as T
}

/** Deployment caps and defaults for the PDF editor (changeable from cordis.yml). */
export interface Config {
  /** Maximum input PDF size in bytes. */
  maxFileBytes: number
  /** Maximum downloaded body size in bytes. */
  maxDownloadBytes: number
  /** Download timeout in milliseconds. */
  downloadTimeoutMs: number
  /** Regex list of allowed URL hosts for inputs; empty allows any host. */
  allowedHosts: string[]
  /** Maximum written PDF size in bytes. */
  maxOutputBytes: number
  /** Maximum documents one merge/insert call may read. */
  maxSources: number
  /** Maximum pages one written document may have. */
  maxOutputPages: number
  /** Maximum marks one stamp call may draw. */
  maxMarks: number
  /** CJK font file used when text needs glyphs outside WinAnsi; empty disables it. */
  cjkFontPath: string
  /** Extra font candidates tried before the built-in platform list. */
  fontCandidates: string[]
  /** Whether writes are verified by re-reading the result. */
  verifyWrites: boolean
}

export const Config = z.object({
  maxFileBytes: z.number().default(200 * 1024 * 1024),
  maxDownloadBytes: z.number().default(100 * 1024 * 1024),
  downloadTimeoutMs: z.number().default(30000),
  allowedHosts: z.array(z.string()).default([]),
  maxOutputBytes: z.number().default(400 * 1024 * 1024),
  maxSources: z.number().default(32),
  maxOutputPages: z.number().default(5000),
  maxMarks: z.number().default(500),
  cjkFontPath: z.string().default(''),
  fontCandidates: z.array(z.string()).default([]),
  verifyWrites: z.boolean().default(true),
})

const SOURCE_DESC = 'PDF 来源：本地文件路径（绝对路径或相对会话工作目录）、file:// 链接或 http(s) 网址'
const PAGE_GRAMMAR = '页码语法：12 单页、12-35 区间、12- 到末页、-35 从首页、r2 倒数第 2 页、z 末页，可逗号组合如 "3,7,10-"'
const BOX_DESC = 'PDF 坐标（单位 point，原点在页面左下角，与 /MediaBox 同体系）：{x, y, width, height}'
const FONT_DESC = '非拉丁文本（如中文）所需字体路径（.ttf/.otf；.ttc/.otc 字体集合不受支持）；缺省用 Config 的 cjkFontPath，再退到系统字体探测'

/**
 * Any JSON value, structurally identical to the harness's own alias.
 *
 * Declared locally because this plugin's build links only the packages its tools need; the value
 * never crosses a runtime boundary — it is the type of the schema-derived fields the tool layer
 * hands to the renderers.
 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Verification findings shared by every tool's output schema. */
const CHECKS_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', required: true },
      ok: { type: 'boolean', required: true },
      detail: { type: 'string' },
    },
  },
} as const

/** Font provenance, shared by the form and stamp results. */
const FONT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    path: { type: 'string' },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** One field value: text, checked state, selection(s), or none for kinds without a value. */
const FIELD_VALUE_SCHEMA = {
  oneOf: [
    { type: 'string' },
    { type: 'boolean' },
    { type: 'array', items: { type: 'string' } },
    { type: 'null' },
  ],
} as const

/** A widget rectangle in PDF points. */
const RECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
  },
} as const

/** A string-keyed JSON map (metadata dictionaries). */
const JSON_MAP_SCHEMA = { type: 'object', additionalProperties: true } as const

/** The metadata snapshot shape used for `before`/`after`. */
const METADATA_SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    info: { ...JSON_MAP_SCHEMA, required: true },
    xmp: { ...JSON_MAP_SCHEMA, required: true },
    xmp_present: { type: 'boolean', required: true },
    xmp_compressed: { type: 'boolean', required: true },
    xmp_bytes: { type: 'integer', required: true },
  },
} as const

/** Everything one call needs from the deployment. */
interface CallEnv {
  exec: ToolExecution
  config: Config
  caps: SourceCaps
}

export function apply(ctx: Context, config: Config): void {
  const caps: SourceCaps = {
    maxFileBytes: config.maxFileBytes,
    maxDownloadBytes: config.maxDownloadBytes,
    downloadTimeoutMs: config.downloadTimeoutMs,
    allowedHosts: config.allowedHosts,
  }

  // ---------- pdf_pages：页面操作套件 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'pdf_pages',
    description: [
      'PDF 页面操作：merge 合并、split 拆分、extract 抽页、remove 删页、reorder 重排、rotate 增量旋转、crop 裁剪、insert 插入。',
      `merge 以 source 为第一部分、sources 依次接上；split 用 ranges/every/each 切成多文件写出到 out_dir；${PAGE_GRAMMAR}。`,
      '原地类操作（remove/reorder/rotate/crop/insert）默认输出 <原名>-edited.pdf；给 output 或 in_place=true（覆盖源文件并备份 .bak）。',
      `rotate 在页面现有 /Rotate 上叠加；crop 的 box 用 PDF 坐标（左下原点）：${BOX_DESC}。`,
      'merge/split/extract/reorder 以页面为单位重建文档，不携带表单域定义，默认剥掉落在外来页上的控件注解并报告数量（keep_widgets=true 保留）。',
      '写盘后回读校验页数、页面内容指纹、旋转角与裁剪框；verified=false 时看 problems。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: SOURCE_DESC },
      op: {
        type: 'string',
        required: true,
        enum: ['merge', 'split', 'extract', 'remove', 'reorder', 'rotate', 'crop', 'insert'],
        description: '要执行的操作',
      },
      sources: { type: 'array', description: 'merge/insert 的其它文档（merge 时接在 source 之后，按数组顺序）', items: { type: 'string' } },
      range: { type: 'string', description: `extract/remove/rotate/crop 的页面选择（${PAGE_GRAMMAR}）` },
      ranges: { type: 'array', description: 'split：分组选择器数组，如 ["1-3","4-","z"]，每组一个输出文件', items: { type: 'string' } },
      every: { type: 'number', description: 'split：每 N 页一个文件' },
      each: { type: 'boolean', description: 'split：每页一个文件' },
      pages: { type: 'array', description: 'reorder：新的页面顺序，须是 1..页数 的完整排列，如 [3,1,2]', items: { type: 'number' } },
      at: { type: 'number', description: 'insert：插入位置（1-based：插到第 N 页之前；缺省追加到末尾）' },
      degrees: { type: 'number', description: 'rotate：增量角度（90 的整数倍，可为负，如 -90）' },
      box: { type: 'json', description: `crop：裁剪框 ${BOX_DESC}` },
      keep_widgets: { type: 'boolean', description: '重建类操作保留外来页上的控件注解（默认 false：剥掉无主控件并报告数量）' },
      output: { type: 'string', description: '输出路径（单文件操作；缺省 <原名>-edited.pdf）' },
      out_dir: { type: 'string', description: 'split：输出目录（缺省与源文件同目录）' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的输出文件（自动备份 .bak）；改写源文件本身也用它' },
      verify: { type: 'boolean', description: `写后回读校验（默认 ${config.verifyWrites}）` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          op: { type: 'string', required: true },
          page_count_before: { type: 'integer', required: true },
          outputs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                pages: { type: 'integer', required: true },
                widgets_dropped: { type: 'integer', required: true },
                backup: { type: 'string' },
              },
            },
          },
          summary: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          verified: { type: 'boolean', required: true, description: '是否做了写后校验并通过；verify=false 时为 false 且 checks 为空' },
          checks: CHECKS_SCHEMA,
          problems: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPages(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return runPages(coerceJsonFields(args as unknown as Record<string, unknown>, ['box']) as unknown as PagesArgs, { exec, config, caps })
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `PDF ${args.op} ${basename(args.source)}`,
      kind: 'edit',
      ...isLocalPath(args.source) ? { locations: [{ path: args.source }] } : {},
    }),
  })), 'pdf_pages')

  // ---------- pdf_form：表单探测 / 填写 / 扁平化 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'pdf_form',
    description: [
      'PDF AcroForm：不带 values 只探测（字段名、类型、当前值、可选项、只读/必填、所在页与控件矩形）；带 values 则填写。',
      'values 是「字段名 → 值」：文本域字符串、复选框 true/false、下拉框/单选组字符串、多选列表字符串数组。',
      '先校验后写：未知字段、类型不符、值不在选项里、只读、超长、中文没有可用字体都逐条报出；dry_run=true 只返回问题清单。',
      'pdf-lib 的下拉框会静默接受不在选项里的值（并把字段变成可编辑），这里在写之前当作错误报出；确实要写自定义值才传 allow_custom=true。',
      '中文值必须自备可嵌入字体（font_path 或 Config 的 cjkFontPath）：外观域用该字体重建，否则部分阅读器显示空白或直接抛错。',
      'flatten=true 填写后扁平化（字段变静态内容）。写盘后回读校验字段值。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: SOURCE_DESC },
      values: { type: 'json', description: '要写入的字段值 {字段名: 字符串|布尔|字符串数组}；省略则只探测' },
      flatten: { type: 'boolean', description: '填写后扁平化表单（字段不可再编辑）' },
      allow_custom: { type: 'boolean', description: '允许写入不在选项列表里的选择值（默认 false，视为错误）' },
      dry_run: { type: 'boolean', description: '只校验并返回问题清单，不写文件' },
      font_path: { type: 'string', description: FONT_DESC },
      output: { type: 'string', description: '输出路径（缺省 <原名>-filled.pdf）' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的输出文件（自动备份 .bak）；改写源文件本身也用它' },
      verify: { type: 'boolean', description: `写后回读校验（默认 ${config.verifyWrites}）` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          has_form: { type: 'boolean', required: true },
          field_count: { type: 'integer', required: true },
          fields: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                value: { ...FIELD_VALUE_SCHEMA, required: true },
                options: { type: 'array', items: { type: 'string' } },
                read_only: { type: 'boolean', required: true },
                required: { type: 'boolean', required: true },
                max_length: { type: 'integer' },
                page: { type: 'integer' },
                rect: RECT_SCHEMA,
                widgets: { type: 'integer', required: true },
              },
            },
          },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string', required: true },
                severity: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
          dry_run: { type: 'boolean', required: true },
          applied: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                value: { ...FIELD_VALUE_SCHEMA, required: true },
              },
            },
          },
          flattened: { type: 'boolean', required: true },
          font: FONT_SCHEMA,
          output: { type: 'string' },
          backup: { type: 'string' },
          summary: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          verified: { type: 'boolean', required: true },
          checks: CHECKS_SCHEMA,
          problems: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderForm(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return runForm(coerceJsonFields(args as unknown as Record<string, unknown>, ['values']) as unknown as FormArgs, { exec, config, caps })
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `${args.values === undefined ? 'Probe form in' : 'Fill form in'} ${basename(args.source)}`,
      kind: args.values === undefined ? 'read' : 'edit',
      ...isLocalPath(args.source) ? { locations: [{ path: args.source }] } : {},
    }),
  })), 'pdf_form')

  // ---------- pdf_stamp：叠加 / 盖章 / 水印 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'pdf_stamp',
    description: [
      '在 PDF 上叠加文字 text、线段 line、矩形 rect（可填充）、图片 image（PNG/JPEG）；watermark 是「每页居中旋转半透明文字」的快捷方式（先画水印再画 marks，盖章压在水印上）。',
      '坐标体系必须显式声明：geometry="pdf_points" 时 box 就是 PDF 坐标（左下原点，point）；geometry="image_pixels" 时必须给 page_size（页面 point 尺寸）与 image_size（量取坐标的像素尺寸），本插件换算并翻转 y 轴（左上→左下）。混用这两套是「差几个点」错误的根源。',
      'text 的 box：给 height 表示框内垂直居中、给 width 表示按此宽度换行，都不给则 (x,y) 是基线起点；line/rect/image 必须有 width 与 height。',
      '绘制前 lint：页面选择无效、box 无面积、mark 完全在页外、filled 与 thickness 冲突、线段给了 rotate、中文没有可用字体都逐条报出（error 阻止写盘）。',
      'dry_run=true 只返回 lint 结果与换算后的 PDF 坐标；再加 preview=true 另存红框预览文件，可用 pdf_render 渲染后目视检查位置。',
      '中文同样必须自备可嵌入字体（font_path 或 Config 的 cjkFontPath），绝不静默回退到 Helvetica。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: SOURCE_DESC },
      marks: {
        type: 'array',
        description: '要绘制的标记数组',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'json', required: true, description: '页码：数字、选择器字符串（同 pdf_pages 语法）或 "all"' },
            kind: { type: 'string', required: true, enum: ['text', 'line', 'rect', 'image'] },
            box: { type: 'json', required: true, description: '位置盒 {x, y, width?, height?}（坐标系由 geometry 声明）' },
            text: { type: 'string', description: 'kind=text 的文字' },
            font_size: { type: 'number', description: 'kind=text 字号（point，缺省 12）' },
            color: { type: 'json', description: '颜色 "#rrggbb" 或 [r,g,b]（0-255，可加第 4 位透明度 0-1）' },
            opacity: { type: 'number', description: '不透明度 0-1' },
            rotate: { type: 'number', description: '顺时针旋转角度（text/rect/image）' },
            thickness: { type: 'number', description: 'line 线宽 / rect 边框宽（point）' },
            filled: { type: 'boolean', description: 'rect 填充而非描边' },
            path: { type: 'string', description: 'kind=image 的图片路径（PNG/JPEG，本地路径）' },
          },
        },
      },
      watermark: { type: 'json', description: '水印快捷方式 { text, font_size?, color?, opacity?, angle?, pages? }（缺省 48pt 灰 0.12 透明度 45° 全页）' },
      geometry: { type: 'string', enum: ['pdf_points', 'image_pixels'], description: 'box 的坐标系（缺省 pdf_points）' },
      page_size: { type: 'json', description: 'image_pixels：参考页面尺寸（point）{width, height}' },
      image_size: { type: 'json', description: 'image_pixels：量取坐标的像素尺寸 {width, height}' },
      font_path: { type: 'string', description: FONT_DESC },
      dry_run: { type: 'boolean', description: '只 lint 并回换算结果，不写文件' },
      preview: { type: 'boolean', description: 'dry_run 时另存红框预览 PDF（用 pdf_render 渲染查看）' },
      output: { type: 'string', description: '输出路径（缺省 <原名>-stamped.pdf）' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的输出文件（自动备份 .bak）；改写源文件本身也用它' },
      verify: { type: 'boolean', description: `写后回读校验（默认 ${config.verifyWrites}）` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          marks_requested: { type: 'integer', required: true },
          marks_drawn: { type: 'integer', required: true },
          pages_affected: { type: 'array', required: true, items: { type: 'integer' } },
          resolved: {
            type: 'array',
            required: true,
            description: '每个 mark 换算到 PDF 坐标后的位置',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                page: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                placement: { type: 'string', required: true },
              },
            },
          },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mark: { type: 'integer', required: true },
                severity: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
          dry_run: { type: 'boolean', required: true },
          font: FONT_SCHEMA,
          output: { type: 'string' },
          preview_output: { type: 'string' },
          backup: { type: 'string' },
          summary: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          verified: { type: 'boolean', required: true },
          checks: CHECKS_SCHEMA,
          problems: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStamp(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return runStamp(coerceJsonFields(args as unknown as Record<string, unknown>, ['watermark', 'page_size', 'image_size']) as unknown as StampArgs, { exec, config, caps })
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `${args.watermark !== undefined ? 'Watermark' : 'Stamp'} ${basename(args.source)}`,
      kind: 'edit',
      ...isLocalPath(args.source) ? { locations: [{ path: args.source }] } : {},
    }),
  })), 'pdf_stamp')

  // ---------- pdf_metadata：元数据与 XMP ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'pdf_metadata',
    description: [
      'PDF 元数据：只给 source 时读取（信息字典 + XMP 包），给 set/delete 时写入/删除。',
      `可写字段：${INFO_FIELDS.join('、')}。日期接受 ISO 8601（2026-01-02T03:04:05Z）或 PDF 形式（D:20260102030405+08'00'）。`,
      'XMP 包默认原样保留并在结果里报告它与信息字典的值；sync_xmp=true 把信息字典的值写回 XMP 中已存在的元素（dc:title/dc:creator/dc:description/pdf:Keywords/pdf:Producer/xmp:CreateDate/xmp:ModifyDate）。',
      'XMP 同步是对已存在元素的定点文本改写：包里没有的元素不会凭空插入（RDF 结构不能靠字符串拼接正确生成），会列在 xmp.skipped 里。',
      '加载不会改写 Producer/ModDate（pdf-lib 默认会，这里显式关掉），「只读取」是真正的只读。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: SOURCE_DESC },
      set: { type: 'json', description: `要写入的字段：{${INFO_FIELDS.join('?, ')}?}` },
      delete: { type: 'array', description: '要删除的信息字典字段名，如 ["producer","creator"]', items: { type: 'string' } },
      sync_xmp: { type: 'boolean', description: '把信息字典值同步写回 XMP 中已存在的元素（默认 false，仅保留）' },
      output: { type: 'string', description: '输出路径（缺省 <原名>-meta.pdf）' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的输出文件（自动备份 .bak）；改写源文件本身也用它' },
      verify: { type: 'boolean', description: `写后回读校验（默认 ${config.verifyWrites}）` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          before: { ...METADATA_SNAPSHOT_SCHEMA, required: true },
          after: { ...METADATA_SNAPSHOT_SCHEMA, required: true },
          applied: { type: 'array', required: true, items: { type: 'string' } },
          deleted: { type: 'array', required: true, items: { type: 'string' } },
          xmp: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              present: { type: 'boolean', required: true },
              updated: { type: 'array', required: true, items: { type: 'string' } },
              skipped: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          output: { type: 'string' },
          backup: { type: 'string' },
          summary: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          verified: { type: 'boolean', required: true },
          checks: CHECKS_SCHEMA,
          problems: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderMetadata(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return runMetadata(coerceJsonFields(args as unknown as Record<string, unknown>, ['set']) as unknown as MetadataArgs, { exec, config, caps })
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `${args.set === undefined && args.delete === undefined ? 'Read metadata of' : 'Write metadata of'} ${basename(args.source)}`,
      kind: args.set === undefined && args.delete === undefined ? 'read' : 'edit',
      ...isLocalPath(args.source) ? { locations: [{ path: args.source }] } : {},
    }),
  })), 'pdf_metadata')
}

// ---------- argument and result types ----------

interface PagesArgs {
  source: string
  op: 'merge' | 'split' | 'extract' | 'remove' | 'reorder' | 'rotate' | 'crop' | 'insert'
  sources?: string[]
  range?: string
  ranges?: string[]
  every?: number
  each?: boolean
  pages?: number[]
  at?: number
  degrees?: number
  box?: Box
  keep_widgets?: boolean
  output?: string
  out_dir?: string
  in_place?: boolean
  verify?: boolean
}

interface FormArgs {
  source: string
  values?: Record<string, FieldValue>
  flatten?: boolean
  allow_custom?: boolean
  dry_run?: boolean
  font_path?: string
  output?: string
  in_place?: boolean
  verify?: boolean
}

interface StampArgs {
  source: string
  marks?: MarkSpec[]
  watermark?: WatermarkSpec
  geometry?: 'pdf_points' | 'image_pixels'
  page_size?: { width: number; height: number }
  image_size?: { width: number; height: number }
  font_path?: string
  dry_run?: boolean
  preview?: boolean
  output?: string
  in_place?: boolean
  verify?: boolean
}

interface MetadataArgs {
  source: string
  set?: Partial<Record<InfoField, string | string[]>>
  delete?: string[]
  sync_xmp?: boolean
  output?: string
  in_place?: boolean
  verify?: boolean
}

// ---------- pdf_pages ----------

async function runPages(args: PagesArgs, env: CallEnv): Promise<PagesValue> {
  const base = await loadOne(args.source, env)
  const warnings: string[] = [...base.notes]
  const checks: Check[] = []
  const outputs: Array<{ path: string; pages: number; widgets_dropped: number; backup?: string }> = []
  const verify = args.verify ?? env.config.verifyWrites
  let summary = ''

  const emit = async (bytes: Uint8Array, options: { output?: string; suffix: string; inPlace: boolean }): Promise<WriteOutcome> =>
    writeOutput(
      targetPath(base, options.output, options.suffix, env, options.inPlace),
      bytes,
      options.inPlace,
      env.config.maxOutputBytes,
    )
  const push = (outcome: WriteOutcome, pages: number, widgetsDropped: number): void => {
    outputs.push({ path: outcome.target, pages, widgets_dropped: widgetsDropped, ...(outcome.backup === undefined ? {} : { backup: outcome.backup }) })
  }

  switch (args.op) {
    case 'merge': {
      const donors = await loadSources(args.sources ?? [], env, 'sources')
      if (donors.length === 0) throw new PdfEditorError('merge 需要 sources 参数（至少再给一个 PDF；source 作为合并结果的第一部分）')
      const docs = [base, ...donors]
      const plan = docs.flatMap((doc) => doc.pages.map((_facts, index) => ({ source: doc.doc, index })))
      assertPageBudget(plan.length, env.config.maxOutputPages, 'merge')
      const rebuilt = await rebuildFromPages(plan, args.keep_widgets === true)
      const bytes = await saveDoc(rebuilt.doc)
      push(await emit(bytes, { output: args.output, suffix: '-merged', inPlace: args.in_place === true }), rebuilt.doc.getPageCount(), rebuilt.widgetsDropped)
      summary = `合并 ${docs.length} 个文档（${docs.map((doc) => doc.pageCount).join(' + ')} 页）→ ${rebuilt.doc.getPageCount()} 页`
      if (rebuilt.widgetsDropped > 0) warnings.push(`剥离了 ${rebuilt.widgetsDropped} 个表单控件注解（重建文档不携带表单域定义；keep_widgets=true 可保留）`)
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        checks.push(checkPageCount(facts, plan.length))
        checks.push(checkFingerprints(facts, docs.flatMap((doc) => doc.pages.map((entry) => entry.fingerprint))))
      }
      break
    }
    case 'split': {
      const groups = splitGroups(args, base.pageCount)
      const outDir = args.out_dir === undefined || args.out_dir.trim() === ''
        ? (base.localPath === null ? undefined : dirOf(base.localPath))
        : await resolveOutDir(env.exec, args.out_dir, 'out_dir')
      if (outDir === undefined) throw new PdfEditorError('split 需要 out_dir 参数（来源是 http(s) 链接时无法推导输出目录）')
      const used = new Set<string>()
      const baseName = sanitizeFileName(stemOf(base.localPath ?? 'document'))
      for (const group of groups) {
        const rebuilt = await rebuildFromPages(group.pages.map((page) => ({ source: base.doc, index: page - 1 })), args.keep_widgets === true)
        const bytes = await saveDoc(rebuilt.doc)
        const name = uniqueName(`${baseName}-p${group.token}`, used)
        const outcome = await writeOutput(join(outDir, `${name}.pdf`), bytes, args.in_place === true, env.config.maxOutputBytes)
        push(outcome, rebuilt.doc.getPageCount(), rebuilt.widgetsDropped)
        if (verify) {
          const facts = await appendReloadChecks(bytes, checks, `${name}.pdf`)
          checks.push(checkPageCount(facts, group.pages.length))
          checks.push(checkFingerprints(facts, group.pages.map((page) => base.pages[page - 1].fingerprint)))
        }
      }
      summary = `按 ${groups.length} 组拆分 → ${outputs.map((entry) => basename(entry.path)).join('、')}`
      break
    }
    case 'extract': {
      const pages = requireRange(args.range, base.pageCount, 'extract')
      const rebuilt = await rebuildFromPages(pages.map((page) => ({ source: base.doc, index: page - 1 })), args.keep_widgets === true)
      const bytes = await saveDoc(rebuilt.doc)
      push(await emit(bytes, { output: args.output, suffix: `-p${pagesToken(pages, base.pageCount)}`, inPlace: args.in_place === true }), rebuilt.doc.getPageCount(), rebuilt.widgetsDropped)
      summary = `抽取第 ${args.range} 页 → ${rebuilt.doc.getPageCount()} 页`
      if (rebuilt.widgetsDropped > 0) warnings.push(`剥离了 ${rebuilt.widgetsDropped} 个表单控件注解（重建文档不携带表单域定义）`)
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        checks.push(checkPageCount(facts, pages.length))
        checks.push(checkFingerprints(facts, pages.map((page) => base.pages[page - 1].fingerprint)))
      }
      break
    }
    case 'remove': {
      const pages = requireRange(args.range, base.pageCount, 'remove')
      if (pages.length >= base.pageCount) throw new PdfEditorError(`remove 不能删掉全部 ${base.pageCount} 页（PDF 至少要有一页）`)
      const removed = removePages(base, pages)
      const bytes = await saveDoc(base.doc)
      push(await emit(bytes, { output: args.output, suffix: '-removed', inPlace: args.in_place === true }), base.doc.getPageCount(), removed.widgetsRemoved)
      summary = `删除第 ${args.range} 页（${removed.pagesRemoved} 页）→ 余 ${base.doc.getPageCount()} 页`
      if (removed.fieldsRemoved > 0) warnings.push(`顺带移除了 ${removed.fieldsRemoved} 个字段定义与 ${removed.widgetsRemoved} 个控件（它们的控件都落在被删页上）`)
      else if (removed.widgetsRemoved > 0) warnings.push(`顺带移除了 ${removed.widgetsRemoved} 个控件（字段定义保留，因为仍有控件存活）`)
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        const survivors = [...Array(base.pageCount)].map((_, index) => index + 1).filter((page) => !pages.includes(page))
        checks.push(checkPageCount(facts, survivors.length))
        checks.push(checkFingerprints(facts, survivors.map((page) => base.pages[page - 1].fingerprint)))
      }
      break
    }
    case 'reorder': {
      const order = args.pages ?? []
      if (order.length === 0) throw new PdfEditorError('reorder 需要 pages 参数（1..页数的完整排列）')
      reorderPages(base, order)
      const bytes = await saveDoc(base.doc)
      push(await emit(bytes, { output: args.output, suffix: '-reordered', inPlace: args.in_place === true }), base.doc.getPageCount(), 0)
      summary = `页面重排为 ${order.join('、')}`
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        checks.push(checkPageCount(facts, order.length))
        checks.push(checkFingerprints(facts, order.map((page) => base.pages[page - 1].fingerprint)))
      }
      break
    }
    case 'rotate': {
      const pages = requireRange(args.range, base.pageCount, 'rotate')
      const angle = args.degrees ?? 90
      const rotations = rotatePages(base, pages, angle)
      const bytes = await saveDoc(base.doc)
      push(await emit(bytes, { output: args.output, suffix: '-rotated', inPlace: args.in_place === true }), base.doc.getPageCount(), 0)
      summary = `第 ${args.range} 页增量旋转 ${angle}°：${rotations.map((entry) => `第 ${entry.page} 页 ${entry.from}°→${entry.to}°`).join('、')}`
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        checks.push(checkPageCount(facts, base.pageCount))
        checks.push(checkRotations(facts, rotations.map((entry) => ({ page: entry.page, angle: entry.to }))))
      }
      break
    }
    case 'crop': {
      const pages = requireRange(args.range, base.pageCount, 'crop')
      const box = args.box
      if (box === undefined) throw new PdfEditorError(`crop 需要 box 参数（${BOX_DESC}）`)
      const outside = pages.filter((page) => {
        const facts = base.pages[page - 1]
        return box.x < 0 || box.y < 0 || box.x + box.width > facts.mediaBox.width + 0.5 || box.y + box.height > facts.mediaBox.height + 0.5
      })
      if (outside.length > 0) warnings.push(`裁剪框超出第 ${outside.join('、')} 页的媒体框（pdf-lib 不裁剪裁剪框本身，超出部分由阅读器处理）`)
      const crops = cropPages(base, pages, box)
      const bytes = await saveDoc(base.doc)
      push(await emit(bytes, { output: args.output, suffix: '-cropped', inPlace: args.in_place === true }), base.doc.getPageCount(), 0)
      summary = `第 ${args.range} 页裁剪框设为 ${round(box.x)},${round(box.y)} ${round(box.width)}×${round(box.height)}pt`
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        checks.push(checkPageCount(facts, base.pageCount))
        checks.push(checkCropBoxes(facts, crops.map((entry) => ({ page: entry.page, box: entry.to }))))
      }
      break
    }
    case 'insert': {
      const donors = await loadSources(args.sources ?? [], env, 'sources')
      if (donors.length === 0) throw new PdfEditorError('insert 需要 sources 参数（要插入的 PDF）')
      const at = args.at ?? base.pageCount + 1
      assertPageBudget(base.pageCount + donors.reduce((sum, donor) => sum + donor.pageCount, 0), env.config.maxOutputPages, 'insert')
      const inserted = await insertPages(
        base,
        donors.map((donor) => ({ doc: donor.doc, indices: donor.pages.map((_facts, index) => index) })),
        at,
        args.keep_widgets === true,
      )
      const bytes = await saveDoc(base.doc)
      push(await emit(bytes, { output: args.output, suffix: '-inserted', inPlace: args.in_place === true }), base.doc.getPageCount(), inserted.widgetsDropped)
      summary = `在第 ${at} 页前插入 ${inserted.inserted} 页 → 共 ${base.doc.getPageCount()} 页`
      if (inserted.widgetsDropped > 0) warnings.push(`剥离了 ${inserted.widgetsDropped} 个外来页上的表单控件注解（keep_widgets=true 可保留）`)
      if (verify) {
        const facts = await appendReloadChecks(bytes, checks)
        const before = base.pages.map((entry) => entry.fingerprint)
        const incoming = donors.flatMap((donor) => donor.pages.map((entry) => entry.fingerprint))
        const spliced = [...before.slice(0, at - 1), ...incoming, ...before.slice(at - 1)]
        checks.push(checkPageCount(facts, spliced.length))
        checks.push(checkFingerprints(facts, spliced))
      }
      break
    }
  }

  const result = summarize(checks)
  return {
    source: base.displayName,
    op: args.op,
    page_count_before: base.pageCount,
    outputs,
    summary,
    warnings,
    verified: verify ? result.verified : false,
    checks: verify ? result.checks : [],
    problems: verify ? result.problems : [],
  }
}

/** Split the page selection into groups, one output file each. */
function splitGroups(args: PagesArgs, pageCount: number): Array<{ pages: number[]; token: string }> {
  if (args.ranges !== undefined && args.ranges.length > 0) {
    return args.ranges.map((selector) => {
      const pages = [...parsePages(selector, pageCount)].sort((a, b) => a - b)
      if (pages.length === 0) throw new PdfEditorError(`split 的分组 ${selector} 没有选中任何页`)
      return { pages, token: pagesToken(pages, pageCount) }
    })
  }
  if (args.each === true) {
    return [...Array(pageCount)].map((_, index) => ({ pages: [index + 1], token: pagesToken([index + 1], pageCount) }))
  }
  if (args.every !== undefined) {
    const size = Math.trunc(args.every)
    if (!(size > 0)) throw new PdfEditorError(`split 的 every 必须是正整数（收到 ${args.every}）`)
    const groups: Array<{ pages: number[]; token: string }> = []
    for (let start = 1; start <= pageCount; start += size) {
      const pages = [...Array(Math.min(size, pageCount - start + 1))].map((_, index) => start + index)
      groups.push({ pages, token: pagesToken(pages, pageCount) })
    }
    return groups
  }
  throw new PdfEditorError('split 需要 ranges / every / each 之一来指定怎么切')
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = base
  let counter = 2
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`
    counter++
  }
  used.add(candidate)
  return candidate
}

function requireRange(range: string | undefined, pageCount: number, op: string): number[] {
  if (range === undefined || range.trim() === '') throw new PdfEditorError(`${op} 需要 range 参数（${PAGE_GRAMMAR}）`)
  const pages = parsePages(range, pageCount)
  if (pages.length === 0) throw new PdfEditorError(`${op} 的 range=${range} 没有选中任何页`)
  return pages
}

function assertPageBudget(pages: number, budget: number, op: string): void {
  if (pages > budget) throw new PdfEditorError(`${op} 会生成 ${pages} 页，超过单次上限 ${budget} 页（可在 Config 的 maxOutputPages 调整）`)
}

// ---------- pdf_form ----------

async function runForm(args: FormArgs, env: CallEnv): Promise<FormValue> {
  const loaded = await loadOne(args.source, env)
  const warnings: string[] = [...loaded.notes]
  const fields = probeFields(loaded)
  const values = args.values ?? {}
  const wantFill = args.values !== undefined
  const dryRun = args.dry_run === true
  const allowCustom = args.allow_custom === true
  const issues: FillIssue[] = []
  if (!loaded.hasAcroForm) issues.push({ field: '', severity: 'warning', message: '该文档没有 /AcroForm：没有可填写的表单字段' })
  if (wantFill) {
    issues.push(...validateValues(fields, values, { allowCustom }))
    const texts = collectionTexts(values)
    if (texts.length > 0 && !issues.some((issue) => issue.severity === 'error')) {
      try {
        // A dry run never saves, so probing the font here cannot leak into a written file.
        await resolveTextFont(loaded.doc, texts, fontRequest(env.config, args.font_path))
      } catch (error) {
        issues.push({ field: '', severity: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  const blocked = issues.filter((issue) => issue.severity === 'error')
  const common = {
    source: loaded.displayName,
    has_form: loaded.hasAcroForm,
    field_count: fields.length,
    fields: fields.map(fieldJson),
    issues: issues.map((issue) => ({ field: issue.field === '' ? '(整体)' : issue.field, severity: issue.severity, message: issue.message })),
    warnings,
  }

  if (!wantFill || dryRun) {
    const summary = !wantFill
      ? `探测到 ${fields.length} 个字段${loaded.hasAcroForm ? '' : '（文档无 /AcroForm）'}`
      : blocked.length > 0
        ? `校验未通过：${blocked.length} 项错误，未写文件`
        : `校验通过：${Object.keys(values).length} 个字段可写入（dry_run 未写文件）`
    return { ...common, dry_run: true, applied: [], flattened: false, summary, verified: false, checks: [], problems: [] }
  }
  if (blocked.length > 0) {
    // The exit-3 discipline: report every problem, write nothing.
    throw new PdfEditorError([
      `表单填写被拒绝（${blocked.length} 项错误），未写任何文件：`,
      ...blocked.map((issue) => `  - ${issue.field === '' ? '' : `${issue.field}: `}${issue.message}`),
    ].join('\n'))
  }

  const outcome = await applyValues(loaded, fields, values, { allowCustom, font: fontRequest(env.config, args.font_path) })
  warnings.push(...outcome.warnings)
  if (args.flatten === true) flattenForm(loaded)
  const bytes = await saveDoc(loaded.doc)
  const written = await writeOutput(
    targetPath(loaded, args.output, '-filled', env, args.in_place === true),
    bytes,
    args.in_place === true,
    env.config.maxOutputBytes,
  )
  const checks: Check[] = []
  const verify = args.verify ?? env.config.verifyWrites
  if (verify) {
    const facts = await appendReloadChecks(bytes, checks)
    checks.push(checkPageCount(facts, loaded.pageCount))
    if (args.flatten !== true) checks.push(await checkFieldValues(bytes, outcome.applied.map((entry) => ({ name: entry.name, value: entry.value }))))
    else checks.push({ name: '扁平化后不再有表单字段', ok: (await countFields(bytes)) === 0, detail: `剩余 ${await countFields(bytes)} 个字段` })
  }
  const result = summarize(checks)
  return {
    ...common,
    dry_run: false,
    applied: outcome.applied,
    flattened: args.flatten === true,
    font: { source: outcome.font.source, ...(outcome.font.path === undefined ? {} : { path: outcome.font.path }), notes: outcome.font.notes },
    output: written.target,
    ...(written.backup === undefined ? {} : { backup: written.backup }),
    summary: `写入 ${outcome.applied.length} 个字段${args.flatten === true ? '并扁平化' : ''} → ${written.target}`,
    verified: verify ? result.verified : false,
    checks: verify ? result.checks : [],
    problems: verify ? result.problems : [],
  }
}

function collectionTexts(values: Readonly<Record<string, FieldValue>>): string[] {
  return Object.values(values).flatMap((value) => {
    if (typeof value === 'string') return [value]
    if (typeof value === 'number') return [String(value)]
    if (Array.isArray(value)) return value
    return []
  })
}

/** One probed field, as it appears in the tool result. */
interface FieldJson {
  name: string
  kind: string
  value: string | boolean | string[] | null
  options?: string[]
  read_only: boolean
  required: boolean
  max_length?: number
  page?: number
  rect?: { x: number; y: number; width: number; height: number }
  widgets: number
}

function fieldJson(field: FieldInfo): FieldJson {
  return {
    name: field.name,
    kind: field.kind,
    value: field.value,
    ...(field.options === undefined ? {} : { options: field.options }),
    read_only: field.readOnly,
    required: field.required,
    ...(field.maxLength === undefined ? {} : { max_length: field.maxLength }),
    ...(field.page === undefined ? {} : { page: field.page }),
    ...(field.rect === undefined ? {} : { rect: field.rect }),
    widgets: field.widgets,
  }
}

async function countFields(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return doc.getForm().getFields().length
}

// ---------- pdf_stamp ----------

async function runStamp(args: StampArgs, env: CallEnv): Promise<StampValue> {
  const loaded = await loadOne(args.source, env)
  const warnings: string[] = [...loaded.notes]
  const geometry: GeometrySpec = { system: args.geometry ?? 'pdf_points' }
  if (args.page_size !== undefined) geometry.pageSize = args.page_size
  if (args.image_size !== undefined) geometry.imageSize = args.image_size
  const parse = (selector: string): number[] => parsePages(selector, loaded.pageCount)
  const marks: MarkSpec[] = [
    ...(args.watermark === undefined ? [] : watermarkMarks(loaded, args.watermark, parse).marks),
    ...(args.marks ?? []),
  ]
  if (marks.length === 0) throw new PdfEditorError('pdf_stamp 需要 marks 或 watermark 至少其一')
  if (marks.length > env.config.maxMarks) {
    throw new PdfEditorError(`本次要画 ${marks.length} 个标记，超过单次上限 ${env.config.maxMarks}（可在 Config 的 maxMarks 调整）`)
  }

  const texts = marks.filter((mark) => mark.kind === 'text').map((mark) => mark.text ?? '')
  let fontUsable = true
  let fontProbeError: string | undefined
  try {
    // Probing the font does not draw; the probe keeps lint able to say "no font can render this".
    await resolveTextFont(loaded.doc, texts, fontRequest(env.config, args.font_path))
  } catch (error) {
    fontUsable = false
    fontProbeError = error instanceof Error ? error.message : String(error)
  }
  const issues: MarkIssue[] = [
    ...(fontUsable ? [] : [{ mark: 0, severity: 'error' as const, message: fontProbeError ?? '没有可用字体' }]),
    ...lintMarks(loaded, marks, geometry, parse, fontUsable),
  ]
  const blocked = issues.filter((issue) => issue.severity === 'error')
  const resolved = marks.map((mark, index) => {
    const box = toPdfPointsSafe(mark, geometry)
    return {
      index: index + 1,
      page: String(mark.page),
      kind: mark.kind,
      placement: mark.centre === true ? '页面居中（水印）' : `x=${round(box.x)} y=${round(box.y)} w=${round(box.width)} h=${round(box.height)}`,
    }
  })
  const common = {
    source: loaded.displayName,
    marks_requested: marks.length,
    resolved,
    issues: issues.map((issue) => ({ mark: issue.mark, severity: issue.severity, message: issue.message })),
    warnings,
  }

  if (blocked.length > 0) {
    return {
      ...common,
      marks_drawn: 0,
      pages_affected: [],
      dry_run: true,
      summary: `lint 未通过：${blocked.length} 项错误，未画任何标记（未写文件）`,
      verified: false,
      checks: [],
      problems: [],
    }
  }
  if (args.dry_run === true) {
    let previewOutput: string | undefined
    if (args.preview === true) {
      const preview = await loadPdf(await saveDoc(loaded.doc), 'preview', null)
      const font = await resolveTextFont(preview.doc, texts, fontRequest(env.config, args.font_path))
      const boxes = previewMarks(marks, geometry, font.font)
      await drawMarks(boxes, geometry, { loaded: preview, font: font.font, readImage: async () => { throw new PdfEditorError('预览只画红框，不读取图片') } }, (selector) => parsePages(selector, preview.pageCount))
      const written = await writeOutput(targetPath(loaded, undefined, '-preview', env, false), await saveDoc(preview.doc), false, env.config.maxOutputBytes)
      previewOutput = written.target
    }
    return {
      ...common,
      marks_drawn: 0,
      pages_affected: [],
      dry_run: true,
      ...(previewOutput === undefined ? {} : { preview_output: previewOutput }),
      summary: `lint 通过：${marks.length} 个标记可绘制（dry_run 未写文件）${previewOutput === undefined ? '' : `；红框预览：${previewOutput}`}`,
      verified: false,
      checks: [],
      problems: [],
    }
  }

  const font = await resolveTextFont(loaded.doc, texts, fontRequest(env.config, args.font_path))
  const before = loaded.pages
  const drawn = await drawMarks(marks, geometry, {
    loaded,
    font: font.font,
    readImage: async (absolute) => readImageFile(localPath(env.exec, absolute), env.config.maxFileBytes),
  }, parse)
  const bytes = await saveDoc(loaded.doc)
  const written = await writeOutput(
    targetPath(loaded, args.output, '-stamped', env, args.in_place === true),
    bytes,
    args.in_place === true,
    env.config.maxOutputBytes,
  )
  const checks: Check[] = []
  const verify = args.verify ?? env.config.verifyWrites
  if (verify) {
    const facts = await appendReloadChecks(bytes, checks)
    checks.push(checkPageCount(facts, loaded.pageCount))
    checks.push(checkContentGrew(before, facts, drawn.pages))
  }
  const result = summarize(checks)
  if (font.notes.length > 0) warnings.push(...font.notes)
  return {
    ...common,
    marks_drawn: drawn.drawn,
    pages_affected: drawn.pages,
    dry_run: false,
    font: { source: font.source, ...(font.path === undefined ? {} : { path: font.path }), notes: font.notes },
    output: written.target,
    ...(written.backup === undefined ? {} : { backup: written.backup }),
    summary: `绘制 ${drawn.drawn} 个标记（第 ${drawn.pages.join('、')} 页）→ ${written.target}`,
    verified: verify ? result.verified : false,
    checks: verify ? result.checks : [],
    problems: verify ? result.problems : [],
  }
}

/** Red-box stand-ins for a dry-run preview: rects where marks would land, no text or images drawn. */
function previewMarks(marks: readonly MarkSpec[], geometry: GeometrySpec, font: { widthOfTextAtSize(text: string, size: number): number }): MarkSpec[] {
  return marks.map((mark) => {
    const box = toPdfPointsSafe(mark, geometry)
    const width = box.width > 0 ? box.width : mark.kind === 'text' ? font.widthOfTextAtSize(mark.text ?? '', mark.fontSize ?? 12) : 0
    const height = box.height > 0 ? box.height : mark.kind === 'text' ? (mark.fontSize ?? 12) * 1.2 : 0
    return {
      page: mark.page,
      kind: 'rect',
      box: { x: box.x, y: box.y, width: Math.max(width, 1), height: Math.max(height, 1) },
      color: '#ff0000',
      opacity: 1,
      thickness: 1.5,
      ...(mark.centre === true ? { centre: true } : {}),
    }
  })
}

function toPdfPointsSafe(mark: MarkSpec, geometry: GeometrySpec): { x: number; y: number; width: number; height: number } {
  try {
    return toPdfPoints(mark.box, geometry)
  } catch {
    return { x: mark.box.x, y: mark.box.y, width: mark.box.width ?? 0, height: mark.box.height ?? 0 }
  }
}

// ---------- pdf_metadata ----------

async function runMetadata(args: MetadataArgs, env: CallEnv): Promise<MetadataValue> {
  const loaded = await loadOne(args.source, env)
  const warnings: string[] = [...loaded.notes]
  const before = readMetadata(loaded.doc)
  const beforeJson = {
    info: before.info,
    xmp: before.xmp,
    xmp_present: before.xmpPresent,
    xmp_compressed: before.xmpCompressed,
    xmp_bytes: before.xmpBytes,
  }
  const wantsWrite = args.set !== undefined || args.delete !== undefined
  if (!wantsWrite) {
    return {
      source: loaded.displayName,
      before: beforeJson,
      after: beforeJson,
      applied: [],
      deleted: [],
      xmp: { present: before.xmpPresent, updated: [], skipped: [] },
      summary: Object.keys(before.info).length === 0
        ? '该文档没有信息字典元数据'
        : `元数据：${Object.entries(before.info).map(([key, value]) => `${key}=${value}`).join('；')}`,
      warnings,
      verified: false,
      checks: [],
      problems: [],
    }
  }
  const unknown = [...Object.keys(args.set ?? {}), ...(args.delete ?? [])].filter((field) => !(INFO_FIELDS as readonly string[]).includes(field))
  if (unknown.length > 0) throw new PdfEditorError(`未知的元数据字段：${unknown.join('、')}（可写：${INFO_FIELDS.join('、')}）`)
  const patch = applyMetadata(loaded.doc, {
    ...(args.set === undefined ? {} : { set: args.set }),
    ...(args.delete === undefined ? {} : { delete: args.delete as InfoField[] }),
    syncXmp: args.sync_xmp === true,
  })
  warnings.push(...patch.warnings)
  const bytes = await saveDoc(loaded.doc)
  const written = await writeOutput(
    targetPath(loaded, args.output, '-meta', env, args.in_place === true),
    bytes,
    args.in_place === true,
    env.config.maxOutputBytes,
  )
  const after = readMetadata((await loadPdf(bytes, 'verify', null)).doc)
  const checks: Check[] = []
  const verify = args.verify ?? env.config.verifyWrites
  if (verify) {
    await appendReloadChecks(bytes, checks)
    const expected: Partial<Record<InfoField, string>> = {}
    for (const [field, value] of Object.entries(args.set ?? {}) as Array<[InfoField, string | string[]]>) {
      // Keywords are compared in the exact form the writer stores (see canonicalKeywords), so the
      // expectation cannot drift from what actually landed in the document.
      const text = field === 'keywords' ? canonicalKeywords(value) : Array.isArray(value) ? value.join(' ') : value
      // Dates are compared in ISO form; the caller may have written either ISO or the PDF-native
      // `D:…` form, so parse with the same function the writer used instead of `new Date()`.
      expected[field] = field === 'creation_date' || field === 'modification_date' ? parsePdfDate(text).toISOString() : text
    }
    if (Object.keys(expected).length > 0) checks.push(await checkMetadata(bytes, expected))
    for (const field of patch.deleted) {
      checks.push({ name: `字段 ${field} 已删除`, ok: after.info[field] === undefined, detail: `仍读到 ${after.info[field] ?? ''}` })
    }
    if (before.xmpPresent) {
      // XMP survives by default; with sync_xmp the patched elements are expected to differ instead.
      const kept = args.sync_xmp === true ? [] : Object.values(before.xmp).map((value) => value.slice(0, 24)).filter((value) => value !== '')
      checks.push(await checkXmp(bytes, kept))
    }
  }
  const result = summarize(checks)
  return {
    source: loaded.displayName,
    before: beforeJson,
    after: {
      info: after.info,
      xmp: after.xmp,
      xmp_present: after.xmpPresent,
      xmp_compressed: after.xmpCompressed,
      xmp_bytes: after.xmpBytes,
    },
    applied: patch.applied,
    deleted: patch.deleted,
    xmp: { present: before.xmpPresent, updated: patch.xmpUpdated, skipped: patch.xmpSkipped },
    output: written.target,
    ...(written.backup === undefined ? {} : { backup: written.backup }),
    summary: `写入 ${patch.applied.length} 个字段、删除 ${patch.deleted.length} 个字段${args.sync_xmp === true ? `；XMP 同步 ${patch.xmpUpdated.length} 个元素` : ''} → ${written.target}`,
    warnings,
    verified: verify ? result.verified : false,
    checks: verify ? result.checks : [],
    problems: verify ? result.problems : [],
  }
}

// ---------- shared helpers ----------

async function loadOne(source: string, env: CallEnv): Promise<LoadedPdf> {
  const resolved = await resolveSource(source, env.exec, env.caps)
  env.exec.signal.throwIfAborted()
  return loadPdf(resolved.bytes, resolved.displayName, resolved.localPath)
}

async function loadSources(sources: readonly string[], env: CallEnv, label: string): Promise<LoadedPdf[]> {
  if (sources.length > env.config.maxSources) {
    throw new PdfEditorError(`${label} 有 ${sources.length} 个文档，超过单次上限 ${env.config.maxSources}（可在 Config 的 maxSources 调整）`)
  }
  const loaded: LoadedPdf[] = []
  for (const source of sources) loaded.push(await loadOne(source, env))
  return loaded
}

async function saveDoc(doc: { save(options?: { updateFieldAppearances?: boolean }): Promise<Uint8Array> }): Promise<Uint8Array> {
  // The form path rebuilds appearances explicitly with a font that can encode the values; letting
  // pdf-lib redo it here would use the standard font and throw on any CJK value.
  return doc.save({ updateFieldAppearances: false })
}

function fontRequest(config: Config, explicit?: string): FontRequest {
  return {
    ...(explicit === undefined || explicit.trim() === '' ? {} : { explicit }),
    ...(config.cjkFontPath === '' ? {} : { configured: config.cjkFontPath }),
    candidates: config.fontCandidates,
  }
}

/** Where a single-file result goes: explicit `output`, in-place, or a derived sibling name. */
function targetPath(loaded: LoadedPdf, output: string | undefined, suffix: string, env: CallEnv, inPlace: boolean): string {
  if (output !== undefined && output.trim() !== '') return resolveOutput(env.exec, output, 'output')
  if (inPlace) {
    if (loaded.localPath === null) throw new PdfEditorError('in_place=true 只适用于本地文件（http(s) 来源必须显式给 output）')
    return loaded.localPath
  }
  if (loaded.localPath === null) throw new PdfEditorError('来源是 http(s) 链接，必须显式给 output（或 out_dir）才能写文件')
  return deriveOutput(loaded.localPath, suffix)
}

async function appendReloadChecks(bytes: Uint8Array, checks: Check[], label?: string): Promise<PageFacts[]> {
  checks.push(...checkStructure(bytes))
  const reloaded = await checkReload(bytes)
  checks.push(label === undefined ? reloaded.check : { ...reloaded.check, name: `${label}：${reloaded.check.name}` })
  return reloaded.facts
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function isLocalPath(source: string): boolean {
  return !/^(?:https?|file):/i.test(source)
}

// ---------- renderers ----------

interface PagesValue {
  source: string; op: string; page_count_before: number
  outputs: Array<{ path: string; pages: number; widgets_dropped: number; backup?: string }>
  summary: string; warnings: string[]
  verified: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; problems: string[]
}

function renderPages(value: PagesValue): string {
  const lines = [`PDF 页面操作（${value.op}）：${value.source}`, value.summary]
  for (const entry of value.outputs) {
    lines.push(`输出：${entry.path}（${entry.pages} 页${entry.widgets_dropped > 0 ? `，剥离 ${entry.widgets_dropped} 个控件` : ''}${entry.backup === undefined ? '' : `，备份 ${entry.backup}`}）`)
  }
  for (const warning of value.warnings) lines.push(`注意：${warning}`)
  lines.push(...renderChecks(value))
  return lines.join('\n')
}

interface FormValue {
  source: string; has_form: boolean; field_count: number
  fields: FieldJson[]
  issues: Array<{ field: string; severity: string; message: string }>
  dry_run: boolean
  applied: Array<{ name: string; kind: string; value: string | boolean | string[] | null }>
  flattened: boolean
  font?: { source: string; path?: string; notes: string[] }
  output?: string; backup?: string; summary: string; warnings: string[]
  verified: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; problems: string[]
}

function renderForm(value: FormValue): string {
  const lines = [`PDF 表单：${value.source}`, value.summary]
  if (value.field_count > 0) {
    lines.push(`字段（${value.field_count}）：`)
    for (const field of value.fields) {
      const bits = [
        `${field.name}（${field.kind}）`,
        `当前值 ${JSON.stringify(field.value)}`,
        field.options === undefined ? undefined : `可选 ${field.options.join('|')}`,
        field.read_only ? '只读' : undefined,
        field.required ? '必填' : undefined,
        field.max_length === undefined ? undefined : `限长 ${field.max_length}`,
        field.page === undefined ? undefined : `第 ${field.page} 页`,
        field.widgets > 1 ? `${field.widgets} 个控件` : undefined,
      ].filter((bit): bit is string => bit !== undefined)
      lines.push(`  - ${bits.join('，')}`)
    }
  }
  for (const issue of value.issues) lines.push(`${issue.severity === 'error' ? '错误' : '警告'}：${issue.field} ${issue.message}`)
  if (value.applied.length > 0) {
    lines.push(`已写入 ${value.applied.length} 个字段：${value.applied.map((entry) => `${entry.name}=${JSON.stringify(entry.value)}`).join('、')}${value.flattened ? '；已扁平化' : ''}`)
  }
  if (value.font !== undefined) lines.push(`字体：${value.font.source}${value.font.path === undefined ? '' : `（${value.font.path}）`}`)
  if (value.output !== undefined) lines.push(`输出：${value.output}${value.backup === undefined ? '' : `（备份 ${value.backup}）`}`)
  for (const warning of value.warnings) lines.push(`注意：${warning}`)
  lines.push(...renderChecks(value))
  return lines.join('\n')
}

interface StampValue {
  source: string; marks_requested: number; marks_drawn: number; pages_affected: number[]
  resolved: Array<{ index: number; page: string; kind: string; placement: string }>
  issues: Array<{ mark: number; severity: string; message: string }>
  dry_run: boolean
  font?: { source: string; path?: string; notes: string[] }
  output?: string; preview_output?: string; backup?: string
  summary: string; warnings: string[]
  verified: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; problems: string[]
}

function renderStamp(value: StampValue): string {
  const lines = [`PDF 叠加：${value.source}`, value.summary]
  for (const issue of value.issues) lines.push(`${issue.severity === 'error' ? '错误' : '警告'}：marks[${issue.mark}] ${issue.message}`)
  if (value.font !== undefined) lines.push(`字体：${value.font.source}${value.font.path === undefined ? '' : `（${value.font.path}）`}`)
  if (value.output !== undefined) lines.push(`输出：${value.output}${value.backup === undefined ? '' : `（备份 ${value.backup}）`}`)
  if (value.preview_output !== undefined) lines.push(`红框预览：${value.preview_output}（可用 pdf_render 渲染后目视检查位置）`)
  for (const warning of value.warnings) lines.push(`注意：${warning}`)
  lines.push(...renderChecks(value))
  return lines.join('\n')
}

interface MetadataValue {
  source: string
  before: { info: Record<string, JsonValue>; xmp: Record<string, JsonValue>; xmp_present: boolean; xmp_compressed: boolean; xmp_bytes: number }
  after: { info: Record<string, JsonValue>; xmp: Record<string, JsonValue>; xmp_present: boolean; xmp_compressed: boolean; xmp_bytes: number }
  applied: string[]; deleted: string[]
  xmp: { present: boolean; updated: string[]; skipped: string[] }
  output?: string; backup?: string; summary: string; warnings: string[]
  verified: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; problems: string[]
}

function renderMetadata(value: MetadataValue): string {
  const lines = [`PDF 元数据：${value.source}`, value.summary]
  const show = (label: string, info: Record<string, JsonValue>, xmp: Record<string, JsonValue>, present: boolean): void => {
    lines.push(`${label}信息字典：${describeMap(info)}`)
    lines.push(`${label}XMP：${present ? (Object.keys(xmp).length === 0 ? '存在但无可识别字段' : describeMap(xmp)) : '无 /Metadata 包'}`)
  }
  show('', value.before.info, value.before.xmp, value.before.xmp_present)
  if (value.output !== undefined) {
    show('写入后 ', value.after.info, value.after.xmp, value.after.xmp_present)
    lines.push(`输出：${value.output}${value.backup === undefined ? '' : `（备份 ${value.backup}）`}`)
  }
  if (value.xmp.present) {
    lines.push(`XMP ${value.xmp.updated.length > 0 ? `已同步：${value.xmp.updated.join('、')}` : '未同步'}${value.xmp.skipped.length === 0 ? '' : `；包中不存在（未插入）：${value.xmp.skipped.join('、')}`}`)
  }
  for (const warning of value.warnings) lines.push(`注意：${warning}`)
  lines.push(...renderChecks(value))
  return lines.join('\n')
}

function renderChecks(value: { verified: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; problems: string[] }): string[] {
  if (value.checks.length === 0) return value.verified ? [] : ['（本次未做写后校验）']
  if (value.verified) return [`写后校验通过（${value.checks.length} 项）：${value.checks.map((check) => check.name).join('；')}`]
  return ['写后校验未通过：', ...value.problems.map((problem) => `  - ${problem}`)]
}

/** Render a JSON map as `key=value` pairs, tolerating non-string values from the schema boundary. */
function describeMap(map: Record<string, JsonValue>): string {
  const entries = Object.entries(map)
  if (entries.length === 0) return '（空）'
  return entries.map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join('；')
}
