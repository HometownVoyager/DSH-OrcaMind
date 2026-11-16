/**
 * @dsh-external/dsh-office-editor — Office 文档编辑与制造工具集（.xlsx/.docx/.pptx）。
 *
 * 提供五个模型可见工具，与 dsh-office-reader 的坐标语言对齐：
 * - `office_create`：从结构化 JSON 造新文档——xlsx 用 sheets=[{name, rows, formulas?, widths?}]，
 *   docx 用 content=[{type: heading|paragraph|list|table|pagebreak, ...}]，可带 page/metadata/toc/
 *   header/footer；
 * - `office_edit`：对现有文档按顺序执行操作——xlsx 按 A1 坐标改单元格/增删行列/增删改与重排工作表/
 *   合并单元格/冻结窗格/定义名/超链接/批注，docx 按 office_read 的 1-based 段落号增删改段落、按文本
 *   替换、插图、题注、页眉页脚页码域、目录域、占位符批量填充、页面设置与元数据；
 * - `office_export`：xlsx → CSV/TSV（显示值、自动加引号、可选 BOM、可整簿逐表导出）；
 * - `office_explode` / `office_assemble`：把文档展开成部件目录、直接改 XML、再装回去——用于
 *   ops 表达不了的深层改动（母版/版式/自定义 XML 部件）。装配可复现、可选 prune 清孤儿部件，
 *   并在写盘前用本插件的校验器查一遍。
 *
 * 段落编号契约：docx 的 `index` 与 `office_read` 的「段落 N」完全一致——document.xml 顶层
 * `<w:p>` 按文档序计数，空段落与表格单元格内段落都占位，文本框内嵌段落不计入。改一处必须改两处，
 * `dsh-office-editor/tests/paragraph-contract.mjs` 会同时跑两个实现并断言结果一致。
 *
 * 写入策略：默认写新文件；`in_place: true` 原地覆盖并自动备份 `.bak`（写失败自动还原）。
 * 生成字节在落盘前经独立校验（zip CRC + 必需部件 + 逐部件 XML 良构性）。打包走 `src/zip.ts`
 * 一套策略：固定条目顺序与时间戳，因此同样的内容两次写出逐字节相同（`mtime="source"` 可退出）。
 * xlsx 编辑保留数据、公式、合并、筛选、定义名、超链接与批注，另用写盘后 XML 补丁写入冻结窗格与
 * fullCalcOnLoad；字体/填充/边框/对齐/条件格式/数据验证/图表/图片/透视表/宏不保留。docx 编辑保留
 * 段落样式与 run 级格式，只有被改动的 `<w:t>` 文本节点会变化；`set_paragraph` 会重写该段可见文本
 * （保留段落属性与首个 run 的格式）。
 */
import { basename, extname, join } from 'node:path'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { strToU8 } from 'fflate'
import type { Context } from 'cordis'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { readInput, resolveLocal, writeOutput, type EditorCaps } from './io.js'
import { createDocx, editDocx, verifyDocx, type DocxBlock, type DocxMetadata, type DocxOp, type PageSetup } from './docx.js'
import { createPptx, editPptx, verifyPptx, type PptxMetadata, type PptxOp, type SlideSpec } from './pptx.js'
import { createXlsx, editXlsx, exportXlsx, verifyXlsx, type SheetSpec, type XlsxOp } from './xlsx.js'
import { assemblePackage, explodePackage, PackageError } from './package.js'
import type { MtimeSource } from './zip.js'

export const name = '@dsh-external/dsh-office-editor'
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

/** Deployment caps for the editor tools (all changeable from cordis.yml). */
export interface Config {
  /** Maximum input document size in bytes. */
  maxInputBytes: number
  /** Maximum written document size in bytes. */
  maxOutputBytes: number
  /** Maximum rows in one sheet matrix per call. */
  maxRowsPerSheet: number
  /** Maximum operations in one office_edit call. */
  maxOpsPerCall: number
  /** Maximum image size accepted by insert_image/insert_figure, in bytes. */
  maxImageBytes: number
  /** Maximum parts one `office_explode` call writes to disk. */
  maxExplodeParts: number
  /** Maximum total uncompressed bytes one `office_explode` call writes to disk. */
  maxExplodeBytes: number
}

export const Config = z.object({
  maxInputBytes: z.number().default(100 * 1024 * 1024),
  maxOutputBytes: z.number().default(50 * 1024 * 1024),
  maxRowsPerSheet: z.number().default(10_000),
  maxOpsPerCall: z.number().default(50),
  maxImageBytes: z.number().default(20 * 1024 * 1024),
  maxExplodeParts: z.number().default(5000),
  maxExplodeBytes: z.number().default(256 * 1024 * 1024),
})

/** The xlsx edit op discriminant values, shared by schema and docs. */
const XLSX_OPS = [
  'set_cells', 'add_rows', 'add_sheet', 'remove_rows', 'rename_sheet', 'remove_sheet',
  'move_sheet', 'set_sheet_state', 'merge_cells', 'unmerge_cells', 'freeze_panes',
  'set_defined_name', 'set_hyperlink', 'set_cell_comment',
] as const
/** The docx edit op discriminant values, shared by schema and docs. */
const DOCX_OPS = [
  'set_paragraph', 'set_style', 'insert_before', 'insert_after', 'append_paragraph', 'delete_paragraph',
  'replace_text', 'insert_image', 'insert_figure', 'insert_table', 'fill_placeholders',
  'set_page_setup', 'set_metadata', 'insert_toc', 'insert_page_number_footer', 'insert_header', 'accept_revisions',
  'add_comment',
] as const
/** The pptx edit op discriminant values, shared by schema and docs. */
const PPTX_OPS = ['fill_placeholders', 'reorder_slides', 'remove_slide', 'duplicate_slide', 'set_notes'] as const

/** Capability boundary shown verbatim in the tool descriptions. */
const XLSX_FIDELITY = 'xlsx 编辑：值、公式、共享公式、合并单元格、自动筛选、定义名称、超链接、传统批注、工作表可见性与顺序、数字格式与列宽行高保留（读盘已开 cellNF/cellStyles），冻结窗格与 fullCalcOnLoad 由写盘后的 XML 补丁写入。SheetJS 写盘时从零重建 xl/styles.xml，因此字体、填充、边框、对齐、条件格式、数据验证、表格对象、图表、图片、透视表、工作表保护与 VBA 宏不保留。公式不重算：写盘置 fullCalcOnLoad 让 Excel 打开时重算，缓存值以写入时读到的为准；序号位移不会改写公式引用，因此跨位移的公式会让 add_rows/remove_rows 直接报错而不是静默算错（确认无碍时用 allow_formula_drift=true）。'

const DOCX_FIDELITY = 'docx 编辑：段落样式（w:pPr）与 run 级格式（w:rPr）保留，只有被命中的 w:t 文本节点变化；分页符、域、书签、批注锚点、超链接、图片不会因改字而丢失。set_paragraph 会重写该段可见文本（保留段落属性与首个 run 的格式）。'

const PPTX_FIDELITY = 'pptx：新建走 4 个内置版式（标题/标题+内容/节标题/空白），不做逐页摆几何；编辑按 sldIdLst 的演示顺序寻址（不是文件名编号），模板填充保留 run 级格式，复制幻灯会连同备注一起复制（不共享备注部件）。图片、表格、图表、SmartArt 的创建与形状几何编辑不提供。'

/** The metadata keys `set_metadata` writes, matching {@link DocxMetadata}. */
const METADATA_KEYS = ['title', 'subject', 'creator', 'keywords', 'description'] as const

/**
 * Entry-timestamp parameter, shared by every tool that produces an archive.
 *
 * It is model-visible deliberately: a reproducible file is a real deliverable property (content
 * addressing, "did anything actually change", diffing two exports), and the caller is the only one
 * who knows whether the archive should record when the parts were edited.
 */
const MTIME_PARAM = {
  type: 'string' as const,
  enum: ['fixed', 'source'],
  description: 'zip 条目时间戳：fixed（默认）固定为 1980-01-01，同样的内容两次写出逐字节相同；source 取磁盘/当时的真实修改时间',
}

/** A `string[][]` matrix, or an array of cell objects for mixed-typed writes. */
const ROW_MATRIX = {
  type: 'json' as const,
  description: '二维数组（每行一个数组；单元格为 字符串/数字/布尔/null），或行对象数组（对象按列序取同名键）',
}

/** The xlsx/docx/pptx edit op discriminants, shared by the schema and the tool description. */
const OP_DISCRIMINANTS = [...new Set<string>([...XLSX_OPS, ...DOCX_OPS, ...PPTX_OPS])] as const

/**
 * Operation item schema.
 *
 * `op` is the discriminant of a closed union, but the Tool DSL supports `enum` only on scalar
 * nodes, so the union is expressed as `enum` on `op` plus per-field descriptions. Per-op
 * required fields are therefore not enforced by the schema; the engine rejects an op whose
 * fields are missing with a message naming that op's index.
 */
const XLSX_OP_ITEM = {
  op: { type: 'string', required: true, enum: [...OP_DISCRIMINANTS], description: `操作名；xlsx 取 ${XLSX_OPS.join('/')}，docx 取 ${DOCX_OPS.join('/')}` },
  sheet: { type: 'string', description: 'xlsx：工作表名（或序号如 "2"）；缺省为首个工作表' },
  cells: { type: 'json', description: 'set_cells：A1 地址 → 值 的对象；值可为 字符串/数字/布尔/null（null 删格），"=SUM(...)" 写公式，"\'=..." 写字面量' },
  rows: { ...ROW_MATRIX, description: 'add_rows/add_sheet/insert_table：二维数组或行对象数组' },
  at: { type: 'integer', description: 'add_rows：插入位置的 1-based 行号；缺省追加到末尾' },
  from: { type: 'json', description: 'remove_rows：起始 1-based 行号（整数）；rename_sheet：原工作表名（字符串）' },
  to: { type: 'json', description: 'remove_rows：结束行号（整数，缺省只删一行）；rename_sheet：新工作表名（字符串，1-31 字符）；move_sheet：目标位置（1-based 整数）' },
  name: { type: 'string', description: 'add_sheet/remove_sheet/move_sheet/set_sheet_state：工作表名；set_defined_name：定义名' },
  range: { type: 'string', description: 'merge_cells/unmerge_cells：A1 区域，如 "A1:C3"' },
  cell: { type: 'string', description: 'freeze_panes：冻结分界的单元格（"A2" 冻结首行，"B2" 冻结首行首列，"A1"/"none" 取消）；set_hyperlink/set_cell_comment：目标单元格' },
  state: { type: 'string', enum: ['visible', 'hidden', 'veryHidden'], description: 'set_sheet_state：工作表可见性' },
  refers_to: { type: 'json', description: 'set_defined_name：指向的引用（如 "Sheet1!$A$1:$B$9" 或 "=SUM(...)"）；传 null 或空串删除该定义名' },
  url: { type: 'string', description: 'set_hyperlink：链接地址（http(s):// 或 #Sheet1!A1 形式的内部链接）' },
  tooltip: { type: 'string', description: 'set_hyperlink：鼠标悬停提示' },
  author: { type: 'string', description: 'set_cell_comment：批注作者（缺省 dsh-office-editor）' },
  allow_formula_drift: { type: 'boolean', description: 'add_rows/remove_rows：确认公式引用不受影响时跳过「公式会失效」的拦截（默认 false，即遇跨位移公式直接报错）' },
  index: { type: 'integer', description: 'docx：段落号（与 office_read 的「段落 N」一致的 1-based 序号，含空段落）' },
  text: { type: 'string', description: 'docx：段落新文本 / 插入文本 / 页脚页码前缀（拼在页码之前，如"第 " → "第 1 页"）/ 页眉文字' },
  style: { type: 'string', description: 'docx：段落样式名或 styleId——Normal/Title/Subtitle/Quote/Caption/Heading 1-4/List Paragraph/List Bullet/List Number' },
  old: { type: 'string', description: 'replace_text：要替换的原文（未命中则报错）' },
  new: { type: 'string', description: 'replace_text：替换后的文本；缺省替换为空' },
  values: { type: 'json', description: 'fill_placeholders：占位符名 → 文本 的对象；同时匹配 {{名}} 与 {名}，跨 run 拆分也能命中' },
  order: { type: 'json', description: 'reorder_slides：幻灯片新顺序——全部当前页码（1-based）的完整排列，如 [2,1]' },
  position: { type: 'integer', description: 'duplicate_slide：副本插入位置（1-based，插到该页之前）；缺省追加到末尾' },
  notes: { type: 'string', description: 'set_notes：幻灯片备注文本（空串清空备注并移除备注部件）' },
  page: { type: 'json', description: 'set_page_setup/office_create：{ size?: "A4"|"Letter", orientation?: "portrait"|"landscape", margins?: "normal"|"narrow"|"wide"|"thesis"|{top,right,bottom,left}(twips) }' },
  metadata: {
    type: 'object',
    additionalProperties: false,
    description: 'set_metadata：写入 docProps/core.xml 的文档属性',
    properties: Object.fromEntries(METADATA_KEYS.map((key) => [key, { type: 'string' as const }])),
  },
  path: { type: 'string', description: 'insert_image/insert_figure：本地图片路径（.png/.jpg/.gif）' },
  alt: { type: 'string', description: 'insert_image/insert_figure：图片替代文本（必填，供无障碍与检索）' },
  caption: { type: 'string', description: 'insert_figure/insert_table：图表题注文字（用 Caption 样式）' },
  caption_position: { type: 'string', enum: ['above', 'below'], description: 'insert_figure：题注在图上方还是下方（默认 above）' },
  width_emu: { type: 'integer', description: 'insert_image/insert_figure：可选宽度（EMU，1 px = 9525 EMU）；缺省按图片原始像素' },
  height_emu: { type: 'integer', description: 'insert_image：可选高度（EMU）' },
  anchor: { type: 'string', description: 'add_comment：批注锚定的原文片段（须在该段内出现）；省略则整段为锚' },
  initials: { type: 'string', description: 'add_comment：作者缩写（缺省取作者前 3 字）' },
  header: { type: 'boolean', description: 'insert_table：首行为表头（加粗并重复标题行）' },
  title: { type: 'string', description: 'insert_toc：目录标题（默认「目录」）' },
} as const

export function apply(ctx: Context, config: Config): void {
  const caps: EditorCaps = {
    maxInputBytes: config.maxInputBytes,
    maxOutputBytes: config.maxOutputBytes,
  }
  /** Read an image with the size cap applied; shared by insert_image/insert_figure. */
  const readImage = async (absolute: string): Promise<Uint8Array> => {
    const bytes = await readInput(absolute, { maxInputBytes: config.maxImageBytes, maxOutputBytes: config.maxOutputBytes })
    return bytes
  }

  // ---------- office_create：造新文档 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'office_create',
    description: [
      '创建新的 Office 文档（.xlsx/.docx/.pptx）：',
      'xlsx 用 sheets=[{name, rows, formulas?, widths?}]，rows 为二维数组，"=SUM(...)" 形式的字符串写公式；',
      'docx 用 content=[{type: "heading"|"paragraph"|"list"|"table"|"pagebreak", ...}]（heading 带 level 1-4；paragraph 可带 style；list 带 items/ordered/level；table 带 rows/header），',
      '并可用 page 指定纸张与页边距、用 metadata 写标题作者、用 toc=true 插入目录域、用 header/footer 加页眉页脚。',
      'pptx 用 slides=[{title, bullets?, layout?, notes?}]（bullets 每项一个要点，layout 取 title/titleContent/section/blank），',
      '一页一意、用版式而不是逐页摆几何；讲稿写进 notes（备注不占版面）。',
      'docx 已内置 Word 同名命名样式（Normal/Title/Subtitle/Quote/Caption/Heading 1-4/List Bullet/List Number），',
      '标题请用 heading 块而不是加粗放大——只有命名样式才能让导航窗格、目录域与交叉引用生效。',
      '默认写新文件，目标已存在时需 in_place=true（自动备份 .bak）。创建后建议用 office_inspect/office_read 校验内容。',
    ].join(''),
    parameters: {
      format: { type: 'string', required: true, enum: ['xlsx', 'docx', 'pptx'], description: '目标格式' },
      output: { type: 'string', required: true, description: '输出路径（.xlsx/.docx/.pptx，绝对路径或相对会话工作目录）' },
      sheets: {
        type: 'array',
        description: 'xlsx：工作表定义数组（与 content/slides 三选一）',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: '工作表名（1-31 字符）' },
            rows: { type: 'array', required: true, description: '二维数组：字符串/数字/布尔/null', items: { type: 'json' } },
            formulas: { type: 'json', description: 'A1 地址 → 公式 的对象，如 {"D2": "=SUM(B2:C2)"}' },
            widths: { type: 'array', description: '列宽（字符数）数组', items: { type: 'number' } },
          },
        },
      },
      content: {
        type: 'array',
        description: 'docx：内容块数组（与 sheets/slides 三选一）',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            type: { type: 'string', required: true, enum: ['heading', 'paragraph', 'list', 'table', 'pagebreak'] },
          },
        },
      },
      slides: {
        type: 'array',
        description: 'pptx：幻灯片定义数组（与 sheets/content 三选一）',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string', description: '本页标题' },
            bullets: { type: 'array', description: '要点列表；每项为字符串（一级要点），或 { text, level?, size?, bold?, bullet? }', items: { type: 'json' } },
            layout: { type: 'string', enum: ['title', 'titleContent', 'section', 'blank'], description: '版式（缺省：有要点用 titleContent，无要点用 title）' },
            notes: { type: 'string', description: '演讲者备注（写进备注部件，不占版面）' },
          },
        },
      },
      page: { type: 'json', description: 'docx：页面设置 { size?: "A4"|"Letter", orientation?, margins?: "normal"|"narrow"|"wide"|"thesis"|{top,right,bottom,left} }（缺省 A4 + normal）' },
      metadata: { type: 'json', description: 'docx/pptx：文档属性 { title?, subject?, creator?, keywords?, description? }' },
      size: { type: 'string', enum: ['16:9', '4:3'], description: 'pptx：幻灯片尺寸（缺省 16:9）' },
      toc: { type: 'boolean', description: 'docx：在正文前插入「目录」标题与 TOC 域，并置 w:updateFields 让 Word 打开时自动生成目录' },
      header: { type: 'string', description: 'docx：页眉文字（居中，缺省不建页眉部件）' },
      footer: { type: 'string', description: 'docx：页脚文字（居中，缺省不建页脚部件）' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的目标文件（自动备份 .bak）；默认 false' },
      mtime: MTIME_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
          format: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          backup: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWrite(value) }],
    },
    async execute(rawArgs, exec) {
      const args = coerceJsonFields(rawArgs as unknown as Record<string, unknown>, ['page', 'metadata']) as typeof rawArgs
      const outputAbs = resolveLocal(exec, args.output, 'output')
      const ext = extname(outputAbs).toLowerCase()
      if (ext !== `.${args.format}`) {
        throw new Error(`output 扩展名 ${ext} 与 format=${args.format} 不符（应为 .${args.format}）`)
      }
      let bytes: Uint8Array
      let summary: string
      const mtime: MtimeSource | undefined = args.mtime === 'source' ? 'source' : undefined
      if (args.format === 'xlsx') {
        if (args.sheets === undefined) throw new Error('format=xlsx 需要提供 sheets 参数')
        bytes = createXlsx(args.sheets as SheetSpec[], config.maxRowsPerSheet, mtime)
        const verified = verifyXlsx(bytes)
        summary = `${verified.sheetCount} 个工作表：${verified.sheetNames.join('、')}`
      } else if (args.format === 'pptx') {
        if (args.slides === undefined) throw new Error('format=pptx 需要提供 slides 参数')
        bytes = createPptx(args.slides as SlideSpec[], {
          ...(args.metadata !== undefined && args.metadata !== null ? { metadata: args.metadata as PptxMetadata } : {}),
          ...(args.size === '4:3' || args.size === '16:9' ? { size: args.size } : {}),
          ...(mtime !== undefined ? { mtime } : {}),
        })
        const verified = verifyPptx(bytes)
        summary = `${verified.slideCount} 页幻灯片：${verified.slideTitles.join('、')}；部件 ${verified.entryCount} 个`
      } else {
        if (args.content === undefined) throw new Error('format=docx 需要提供 content 参数')
        // `page`/`metadata` cross the tool boundary as generic JSON; the engine validates the shape
        // and reports a user-facing error for anything it cannot interpret.
        bytes = createDocx(args.content as DocxBlock[], {
          ...(args.page !== undefined && args.page !== null ? { page: args.page as PageSetup } : {}),
          ...(args.metadata !== undefined && args.metadata !== null ? { metadata: args.metadata as DocxMetadata } : {}),
          ...(args.toc === true ? { toc: true } : {}),
          ...(typeof args.header === 'string' && args.header !== '' ? { header: centeredParagraph(args.header) } : {}),
          ...(typeof args.footer === 'string' && args.footer !== '' ? { footer: centeredParagraph(args.footer) } : {}),
          ...(mtime !== undefined ? { mtime } : {}),
        })
        const verified = verifyDocx(bytes)
        summary = `共 ${verified.paragraphCount} 个段落（含 ${verified.emptyParagraphs.length} 个空段落）；部件 ${verified.entryCount} 个`
      }
      const outcome = await writeOutput(outputAbs, bytes, args.in_place === true, config.maxOutputBytes)
      // Omit `backup` when absent: undefined-valued keys break the harness lossless-JSON result channel.
      return {
        output: outcome.target,
        format: args.format,
        summary,
        ...(outcome.backup !== undefined ? { backup: outcome.backup } : {}),
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Create ${basename(args.output)}`,
      kind: 'edit',
    }),
  })), '@dsh-external/dsh-office-editor: office_create')

  // ---------- office_edit：编辑现有文档 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'office_edit',
    description: [
      `编辑现有 Office 文档（.xlsx/.docx/.pptx），按顺序执行 ops（单次最多 ${config.maxOpsPerCall} 个）：`,
      `xlsx 操作：${XLSX_OPS.join('/')}——set_cells 按 A1 坐标赋值（"=..." 写公式，"'=..." 写字面量、null 删格）、add_rows 可用 at 指定 1-based 插入行、remove_rows 用 from/to（整数行号）、rename_sheet 用 from/to（字符串工作表名）、move_sheet 用 name+to 重排、set_sheet_state 设可见性、merge_cells/unmerge_cells 用 range、freeze_panes 用 cell（如 "A2" 冻结首行）、set_defined_name/set_hyperlink/set_cell_comment 分别写定义名/超链接/单元格批注；`,
      `docx 操作：${DOCX_OPS.join('/')}——index 为 office_read 的 1-based 段落号（含空段落），replace_text 未命中原文则报错；`,
      'docx 排版类操作用 fill_placeholders（{{占位符}} 批量填充，保留 run 格式）、insert_toc/insert_page_number_footer/insert_header（域与页眉页脚部件）、set_page_setup（A4/Letter/页边距）、insert_figure/insert_table（带题注），',
      'accept_revisions 可在无 Word 的情况下接受全部修订；add_comment 以 author/anchor 在指定段落加批注（生成 word/comments.xml 并挂 commentRangeStart/End 与引用 run）。',
      `pptx 操作：${PPTX_OPS.join('/')}——index 一律为 office_read 的「幻灯片 N」（演示顺序，不是文件名编号）；fill_placeholders 同时覆盖幻灯片与备注，reorder_slides 的 order 列出全部页码的新顺序，duplicate_slide 用 position 指定插入位置（复制会连同备注一起复制）。`,
      '默认写新文件（需 output，扩展名须与源文件一致）；in_place=true 时原地修改并自动备份 .bak。',
      XLSX_FIDELITY,
      DOCX_FIDELITY,
      PPTX_FIDELITY,
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: '现有文档路径（.xlsx/.xls/.xlsm、.docx 或 .pptx）' },
      ops: {
        type: 'array',
        required: true,
        description: '按顺序执行的操作列表',
        items: { type: 'object', additionalProperties: false, properties: { ...XLSX_OP_ITEM } },
      },
      output: { type: 'string', description: '输出路径（默认写新文件时必填，扩展名须与源文件一致）' },
      in_place: { type: 'boolean', description: '原地修改 source（自动备份 .bak）；默认 false' },
      mtime: MTIME_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
          format: { type: 'string', required: true },
          applied: { type: 'array', required: true, items: { type: 'string' } },
          summary: { type: 'string', required: true },
          backup: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderEdit(value) }],
    },
    async execute(args, exec) {
      if (args.ops.length === 0) throw new Error('ops 不能为空：至少一个操作')
      if (args.ops.length > config.maxOpsPerCall) {
        throw new Error(`操作数 ${args.ops.length} 超过单次上限 ${config.maxOpsPerCall}（可拆分多次调用）`)
      }
      const sourceAbs = resolveLocal(exec, args.source, 'source')
      const ext = extname(sourceAbs).toLowerCase()
      const inPlace = args.in_place === true
      const bytes = await readInput(sourceAbs, caps)
      const mtime: MtimeSource | undefined = args.mtime === 'source' ? 'source' : undefined
      let resultBytes: Uint8Array
      let applied: string[]
      let summary: string
      if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
        if (inPlace && ext !== '.xlsx') {
          throw new Error(`原地修改仅支持 .xlsx（${ext} 为旧版格式，请写出到新的 .xlsx 文件）`)
        }
        const edited = editXlsx(bytes, args.ops as XlsxOp[], config.maxRowsPerSheet, mtime)
        const verified = verifyXlsx(edited.bytes)
        resultBytes = edited.bytes
        applied = edited.applied
        summary = `${verified.sheetCount} 个工作表：${verified.sheetNames.join('、')}`
      } else if (ext === '.docx') {
        const edited = await editDocx(bytes, args.ops as DocxOp[], {
          readFile: async (path) => readImage(resolveLocal(exec, path, 'path')),
          ...(mtime !== undefined ? { mtime } : {}),
        })
        const verified = verifyDocx(edited.bytes)
        resultBytes = edited.bytes
        applied = edited.applied
        summary = `共 ${verified.paragraphCount} 个段落（含 ${verified.emptyParagraphs.length} 个空段落）；部件 ${verified.entryCount} 个`
      } else if (ext === '.pptx') {
        const edited = await editPptx(bytes, args.ops as PptxOp[], mtime !== undefined ? { mtime } : {})
        const verified = verifyPptx(edited.bytes)
        resultBytes = edited.bytes
        applied = edited.applied
        summary = `${verified.slideCount} 页幻灯片：${verified.slideTitles.join('、')}；部件 ${verified.entryCount} 个`
      } else {
        throw new Error(`不支持的编辑格式：${ext}（仅支持 .xlsx/.xls/.xlsm、.docx 与 .pptx）`)
      }
      let targetAbs: string
      if (inPlace) {
        targetAbs = sourceAbs
      } else {
        if (args.output === undefined) throw new Error('需要提供 output 参数（新文件路径），或设 in_place=true 原地修改')
        targetAbs = resolveLocal(exec, args.output, 'output')
        if (extname(targetAbs).toLowerCase() !== ext) {
          throw new Error(`output 扩展名 ${extname(targetAbs)} 与源文件 ${ext} 不一致`)
        }
      }
      const outcome = await writeOutput(targetAbs, resultBytes, inPlace, config.maxOutputBytes)
      // Omit `backup` when absent: undefined-valued keys break the harness lossless-JSON result channel.
      return {
        output: outcome.target,
        format: ext.slice(1),
        applied,
        summary,
        ...(outcome.backup !== undefined ? { backup: outcome.backup } : {}),
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Edit ${basename(args.source)} (${args.ops.length} ops)`,
      kind: 'edit',
      ...args.in_place === true ? { locations: [{ path: args.source }] } : {},
    }),
  })), '@dsh-external/dsh-office-editor: office_edit')

  // ---------- office_export：xlsx → CSV/TSV ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'office_export',
    description: [
      '把 .xlsx/.xlsm/.xls 工作表导出为 CSV/TSV 文本文件：值取「显示值」（有缓存值的公式导出其数值，不导出公式本身），',
      '含分隔符/引号/换行的单元格自动加引号，默认带 UTF-8 BOM（Excel for Windows 打开中文 CSV 不乱码）。',
      '单表导出用 sheet（名称或序号）配 output（文件路径）；多表用 all_sheets=true 配 output（目录，每表一个文件，文件名取工作表名并清洗 Windows 非法字符）。',
      '默认写新文件；同名文件已存在时需 in_place=true（自动备份 .bak）。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: '源工作簿路径（绝对路径或相对会话工作目录）' },
      format: { type: 'string', required: true, enum: ['csv', 'tsv'], description: 'csv 用逗号分隔，tsv 用制表符分隔' },
      output: { type: 'string', required: true, description: '输出文件路径（单表）或目录路径（all_sheets=true）' },
      sheet: { type: 'string', description: '要导出的工作表（名称或序号如 "2"）；缺省为唯一工作表' },
      all_sheets: { type: 'boolean', description: '导出全部工作表，每表一个文件写入 output 目录' },
      bom: { type: 'boolean', description: '是否写 UTF-8 BOM（默认 true）' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的输出文件（自动备份 .bak）；默认 false' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
          format: { type: 'string', required: true },
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sheet: { type: 'string', required: true },
                path: { type: 'string', required: true },
                rows: { type: 'integer', required: true },
                chars: { type: 'integer', required: true },
              },
            },
          },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderExport(value) }],
    },
    async execute(args, exec) {
      const sourceAbs = resolveLocal(exec, args.source, 'source')
      const ext = extname(sourceAbs).toLowerCase()
      if (ext !== '.xlsx' && ext !== '.xlsm' && ext !== '.xls') {
        throw new Error(`office_export 只支持 xlsx/xlsm/xls（当前 ${ext}）；docx/pptx 的文本导出请用 office_read`)
      }
      const bytes = await readInput(sourceAbs, caps)
      const exported = exportXlsx(bytes, {
        format: args.format,
        ...(args.sheet !== undefined ? { sheet: args.sheet } : {}),
        ...(args.all_sheets === true ? { allSheets: true } : {}),
        ...(args.bom !== undefined ? { bom: args.bom } : {}),
      })
      const outputAbs = resolveLocal(exec, args.output, 'output')
      const inPlace = args.in_place === true
      const files: Array<{ sheet: string; path: string; rows: number; chars: number }> = []
      if (args.all_sheets === true) {
        const dir = outputAbs
        const listed = await mkdir(dir, { recursive: true }).then(() => dir).catch((error: unknown) => {
          throw new Error(`无法创建输出目录 ${dir}：${error instanceof Error ? error.message : String(error)}`)
        })
        const used = new Set<string>()
        for (const file of exported.files) {
          // Two sheets can sanitize to the same name (`A/B` and `A:B`); the later one gets a suffix.
          let name = file.file
          for (let i = 2; used.has(name); i++) name = file.file.replace(/(\.[^.]+)?$/u, `-${i}$1`)
          used.add(name)
          const target = join(listed, name)
          const outcome = await writeOutput(target, strToU8(file.text), inPlace, config.maxOutputBytes)
          files.push({ sheet: file.sheet, path: outcome.target, rows: file.rows, chars: file.text.length })
        }
      } else {
        const file = exported.files[0]
        const expected = `.${args.format}`
        if (extname(outputAbs).toLowerCase() !== expected) {
          throw new Error(`output 扩展名应为 ${expected}（当前 ${extname(outputAbs)}）`)
        }
        const outcome = await writeOutput(outputAbs, strToU8(file.text), inPlace, config.maxOutputBytes)
        files.push({ sheet: file.sheet, path: outcome.target, rows: file.rows, chars: file.text.length })
      }
      const summary = `${files.length} 个文件：${files.map((f) => `${f.sheet}(${f.rows} 行)`).join('、')}`
      return { output: files[0]?.path ?? outputAbs, format: args.format, files, summary }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Export ${basename(args.source)} → ${args.format.toUpperCase()}`,
      kind: 'edit',
      ...args.all_sheets !== true ? { locations: [{ path: args.output }] } : {},
    }),
  })), '@dsh-external/dsh-office-editor: office_export')

  // ---------- office_explode：展开成可编辑的部件目录 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'office_explode',
    description: [
      '把一个 Office 文件（.docx/.xlsx/.pptx）展开成目录树，每个 OOXML 部件一个文件，供直接编辑 XML 后再用 office_assemble 装回。',
      '用于 office_edit 的 ops 表达不了的深层结构改动：改母版/版式、加自定义 XML 部件、改 sheetMaster 之类的冷门部件。',
      '缺省对每个 .xml/.rels 做**结构缩进**（只在元素之间加换行与空格，属性、命名空间、实体引用、元素顺序一字不改；正文与子元素混排的元素——如 <w:t>/<a:t>——保持逐字节原样），因此可以直接 diff 与手改；verbatim=true 则原样落盘。',
      `部件数上限 ${config.maxExplodeParts}、解压总量上限 ${Math.round(config.maxExplodeBytes / 1024 / 1024)}MB；目标目录必须为空（或不存在），force=true 会先清空。`,
      '二进制部件（媒体/字体）原样写出。装回时必须用 office_assemble。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: '要展开的文档路径（.docx/.xlsx/.pptx）' },
      target: { type: 'string', required: true, description: '目标目录（包内相对结构会在这里重建；须为空或不存在）' },
      verbatim: { type: 'boolean', description: '跳过结构缩进，按压缩包里的原字节落盘（默认 false）' },
      force: { type: 'boolean', description: '目标目录非空时先清空再展开（默认 false：直接拒绝）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true },
          format: { type: 'string', required: true },
          part_count: { type: 'integer', required: true },
          formatted_count: { type: 'integer', required: true },
          total_bytes: { type: 'integer', required: true },
          parts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
              },
            },
          },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderExplode(value) }],
    },
    async execute(args, exec) {
      const sourceAbs = resolveLocal(exec, args.source, 'source')
      const targetAbs = resolveLocal(exec, args.target, 'target')
      const bytes = await readInput(sourceAbs, caps)
      const result = await explodePackage(bytes, targetAbs, {
        maxParts: config.maxExplodeParts,
        maxTotalBytes: config.maxExplodeBytes,
        maxEntryBytes: caps.maxInputBytes,
        ...(args.verbatim === true ? { verbatim: true } : {}),
        ...(args.force === true ? { force: true } : {}),
      })
      return {        target: result.target,
        format: result.format,
        part_count: result.partCount,
        formatted_count: result.formattedCount,
        total_bytes: result.totalBytes,
        parts: result.parts,
        summary: `${result.partCount} 个部件（${result.formattedCount} 个已缩进），共 ${Math.round(result.totalBytes / 1024)}KB`,
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Explode ${basename(args.source)}`,
      kind: 'edit',
      locations: [{ path: args.target }],
    }),
  })), '@dsh-external/dsh-office-editor: office_explode')

  // ---------- office_assemble：把部件目录装回文档 ----------
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'office_assemble',
    description: [
      '把 office_explode 展开出的目录树装回一个 Office 文件（.docx/.xlsx/.pptx），格式由目录里的主部件决定（word/document.xml / xl/workbook.xml / ppt/presentation.xml）。',
      '装配是**可复现**的：[Content_Types].xml 为首个成员且不压缩，其余部件按 content-type Override 声明序再按名字排序，每个条目时间戳固定为 1980-01-01，因此同样的目录两次装配得到逐字节相同的文件（mtime="source" 可改为取磁盘时间戳）。',
      'prune="orphans" 会在装配前清掉孤儿部件（pptx：不在 sldIdLst 里的幽灵幻灯片、只被已删幻灯片引用的备注与媒体；docx/xlsx：无人引用的媒体），并同步删掉它们的 content-type Override 与悬空关系；只动 ppt/slides、ppt/notesSlides、ppt/media 这几类，主题/母版/版式/docProps 一律不碰。',
      '写盘前用本插件自己的校验器查一遍（zip 条目 CRC、必需部件、逐部件 XML 良构，pptx 另查 sldIdLst 与 content-type），手改坏的 XML 会直接报错而不是写出一个 Office 要修复的文件。',
      '默认写新文件；目标已存在时需 in_place=true（自动备份 .bak）。',
    ].join(''),
    parameters: {
      source: { type: 'string', required: true, description: 'office_explode 展开出的目录路径' },
      output: { type: 'string', required: true, description: '输出文件路径（扩展名须与目录里的格式一致：.docx/.xlsx/.pptx）' },
      prune: { type: 'string', enum: ['none', 'orphans'], description: '装配前清理孤儿部件（默认 none，保持目录原样往返）' },
      verbatim: { type: 'boolean', description: '跳过结构缩进，把目录里的字节原样装包（默认 false：与 explode 对称地缩进 XML 部件）' },
      mtime: { type: 'string', enum: ['fixed', 'source'], description: '条目时间戳：fixed（默认）固定为 1980-01-01 保证可复现；source 取磁盘上的修改时间' },
      in_place: { type: 'boolean', description: '允许覆盖已存在的输出文件（自动备份 .bak）；默认 false' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
          format: { type: 'string', required: true },
          part_count: { type: 'integer', required: true },
          byte_size: { type: 'integer', required: true },
          verification: { type: 'string', required: true },
          pruned: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
          dropped_overrides: { type: 'array', required: true, items: { type: 'string' } },
          dropped_relationships: { type: 'array', required: true, items: { type: 'string' } },
          summary: { type: 'string', required: true },
          backup: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderAssemble(value) }],
    },
    async execute(args, exec) {
      const sourceAbs = resolveLocal(exec, args.source, 'source')
      let volume: { isDirectory(): boolean }
      try {
        volume = await stat(sourceAbs)
      } catch {
        throw new Error(`找不到目录：${sourceAbs}（请确认路径正确，且已用 office_explode 展开过）`)
      }
      if (!volume.isDirectory()) throw new Error(`source 必须是目录（office_explode 的产物）：${sourceAbs}`)
      const assembled = await assemblePackage(sourceAbs, {
        ...(args.prune === 'orphans' ? { prune: 'orphans' as const } : {}),
        ...(args.verbatim === true ? { verbatim: true } : {}),
        ...(args.mtime === 'source' ? { mtime: 'source' as MtimeSource } : {}),
        maxOutputBytes: config.maxOutputBytes,
      })
      const outputAbs = resolveLocal(exec, args.output, 'output')
      if (extname(outputAbs).toLowerCase() !== `.${assembled.format}`) {
        throw new Error(`output 扩展名 ${extname(outputAbs)} 与目录内容（${assembled.format}）不符（应为 .${assembled.format}）`)
      }
      const outcome = await writeOutput(outputAbs, assembled.bytes, args.in_place === true, config.maxOutputBytes)
      const summary = [
        `装回 ${assembled.partCount} 个部件，${Math.round(assembled.byteSize / 1024)}KB`,
        assembled.pruned.length > 0 ? `清理孤儿部件 ${assembled.pruned.length} 个` : '',
        `校验：${assembled.verification}`,
      ].filter((bit) => bit !== '').join('；')
      return {
        output: outcome.target,
        format: assembled.format,
        part_count: assembled.partCount,
        byte_size: assembled.byteSize,
        verification: assembled.verification,
        pruned: assembled.pruned,
        dropped_overrides: assembled.droppedOverrides,
        dropped_relationships: assembled.droppedRelationships,
        summary,
        ...(outcome.backup !== undefined ? { backup: outcome.backup } : {}),
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Assemble ${basename(args.output)}`,
      kind: 'edit',
      locations: [{ path: args.output }],
    }),
  })), '@dsh-external/dsh-office-editor: office_assemble')
}

/** One centered paragraph, for the create-time header/footer seed. */
function centeredParagraph(text: string): string {
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`
}

// ---------- result renderers ----------

interface WriteResult {
  output: string
  format: string
  summary: string
  backup?: string
}

interface EditResult {
  output: string
  format: string
  applied: string[]
  summary: string
  backup?: string
}

function renderWrite(value: WriteResult): string {
  const lines = [
    `✓ 已创建 ${value.format.toUpperCase()}：${value.output}`,
    `内容：${value.summary}`,
  ]
  if (value.backup !== undefined) lines.push(`原文件已备份：${value.backup}`)
  return lines.join('\n')
}

function renderEdit(value: EditResult): string {
  const lines = [
    `✓ 已编辑 ${value.format.toUpperCase()}：${value.output}`,
    ...value.applied.map((op, index) => `${index + 1}. ${op}`),
    `结果：${value.summary}`,
  ]
  if (value.backup !== undefined) lines.push(`原文件已备份：${value.backup}`)
  return lines.join('\n')
}

interface ExportResult {
  output: string
  format: string
  files: Array<{ sheet: string; path: string; rows: number; chars: number }>
  summary: string
}

function renderExport(value: ExportResult): string {
  const lines = [`✓ 已导出 ${value.format.toUpperCase()}：${value.files.length} 个文件`]
  for (const file of value.files) lines.push(`- ${file.path}（工作表「${file.sheet}」，${file.rows} 行，${file.chars} 字符）`)
  return lines.join('\n')
}

interface ExplodeResultView {
  target: string
  format: string
  part_count: number
  formatted_count: number
  total_bytes: number
  summary: string
}

function renderExplode(value: ExplodeResultView): string {
  return [
    `✓ 已展开 ${value.format.toUpperCase()} → ${value.target}`,
    `部件：${value.part_count} 个（${value.formatted_count} 个 XML 已缩进），共 ${Math.round(value.total_bytes / 1024)}KB`,
    '改完 XML 后用 office_assemble 装回（source 传这个目录）。',
  ].join('\n')
}

interface AssembleResultView {
  output: string
  format: string
  part_count: number
  byte_size: number
  verification: string
  pruned: Array<{ name: string; reason: string }>
  dropped_overrides: string[]
  dropped_relationships: string[]
  backup?: string
}

function renderAssemble(value: AssembleResultView): string {
  const lines = [
    `✓ 已装回 ${value.format.toUpperCase()}：${value.output}`,
    `部件：${value.part_count} 个，${Math.round(value.byte_size / 1024)}KB`,
    `写后校验：${value.verification}`,
  ]
  if (value.pruned.length > 0) {
    lines.push(`清理孤儿部件 ${value.pruned.length} 个：`)
    for (const part of value.pruned) lines.push(`- ${part.name}（${part.reason}）`)
  }
  if (value.dropped_overrides.length > 0) lines.push(`同步删除 content-type Override ${value.dropped_overrides.length} 条`)
  if (value.dropped_relationships.length > 0) {
    lines.push(`同步删除悬空关系 ${value.dropped_relationships.length} 条：`)
    for (const rel of value.dropped_relationships) lines.push(`- ${rel}`)
  }
  if (value.backup !== undefined) lines.push(`原文件已备份：${value.backup}`)
  return lines.join('\n')
}
