# @dsh-external/dsh-office-editor

Office 文档编辑与制造工具集（.docx/.xlsx/.pptx）：从结构化 JSON 造新文档、按坐标定向编辑、模板占位符批量填充与排版，与 `dsh-office-reader` 的坐标语言对齐。

## 工具一览

| 工具 | 用途 |
|---|---|
| `office_create` | 造新文档：`xlsx` 用 `sheets`；`docx` 用 `content`（可带 `page`/`metadata`/`toc`/`header`/`footer`）；`pptx` 用 `slides`（4 个内置版式） |
| `office_edit` | 编辑现有文档，按顺序执行 `ops`；默认写新文件（需 `output`），`in_place: true` 原地覆盖并自动备份 `.bak` |
| `office_export` | xlsx → CSV/TSV：值取显示值、自动加引号、默认带 UTF-8 BOM，可整簿逐表导出 |
| `office_explode` | 把文档展开成部件目录（每个 OOXML 部件一个文件），供直接编辑 XML；默认对 `.xml`/`.rels` 做结构缩进 |
| `office_assemble` | 把部件目录装回文档：可复现打包、可选 `prune` 清孤儿部件、写盘前用本插件校验器查一遍 |

### 可复现打包（`mtime`）

`office_create`/`office_edit`/`office_assemble` 都接受 `mtime`：

- `fixed`（默认）——每个 zip 条目的时间戳固定为 **1980-01-01 00:00 本地时间**，加上固定的条目顺序（`[Content_Types].xml` 首位且 **stored** 不压缩，其余按 content-type Override 声明序、再按名字排序、一律 deflate），因此**同样的内容两次写出逐字节相同**。可用于内容寻址、"这次到底改了没有"、两次导出的 diff。
- `source`——取磁盘上的真实时间戳，代价是失去可复现性。

时间戳取本地零点而不是 `1980-01-01T00:00:00Z`：fflate 用 `getFullYear()/getHours()` 这类**本地时间**取数编码 DOS 时间，UTC 零点在 UTC+8 机器上会写成 `08:00`（同一份文档跨时区哈希不同），在 UTC 以西更会落到 1979-12-31 直接触发 fflate 的越界报错。

### explode → 改 XML → assemble

`office_explode` 面向 `office_edit` 的 ops 表达不了的深层改动：改母版/版式、加自定义 XML 部件、改 `sheetMaster` 这类冷门部件。

- **缩进是结构性的，不是重新序列化。** 只在元素之间插入换行与两个空格：不解包成 DOM、不重排属性、不动命名空间声明、不碰实体引用。**正文与子元素混排**的元素（`<w:p>` 里夹文本与 `<w:br/>`）以及纯文本叶节点（`<w:t>总则</w:t>`）**逐字节原样保留**，因此缩进不会把换行塞进 Word 的文本 run 里。`verbatim=true` 完全跳过缩进。
- **装回前先校验。** `office_assemble` 装配完立刻跑本插件自己的 `verifyDocx`/`verifyXlsx`/`verifyPptx`（zip 条目 CRC、必需部件、逐部件良构，pptx 另查 `sldIdLst` 与 content-type），手改坏的 XML 会直接报错，而不是写出一个 Office 打开时要修复的文件。
- **往返的字节行为（两种模式都是确定的）**：`verbatim=true` 两侧都跳过缩进，因此「展开 → 不改 → 装回」与原文件**逐字节相同**；默认的缩进路径因为改了 XML 的空白，与原文件不同，但它是**不动点**——缩进过的内容再走一遍「展开 → 装回」不再变化。两条都由 `p3-package.mjs` §8 钉住。
- **`prune="orphans"`** 清掉孤儿部件并同步删除它们的 content-type Override 与悬空关系：pptx 是不在 `sldIdLst` 里的幽灵幻灯片、只被已删幻灯片引用的备注、无人引用的媒体；docx/xlsx 是无人引用的媒体。**只动这几类**——主题、母版、版式、`docProps`、`customXml` 一律不碰（判断它们的可达性需要远超本工具的上下文）。默认 `none`，保持目录到文件的字节级往返。
- 安全边界：目标目录须为空（`force=true` 才清空）、拒绝 `../` 这类越出目标目录的部件名、部件数与解压总量有上限（`maxExplodeParts`/`maxExplodeBytes`）。

### 段落编号契约（docx）

`office_edit` 的 `index` 与 `office_read` 的「段落 N」**完全一致**：`word/document.xml` 的**顶层** `<w:p>` 按文档序计数——空段落（分页符/空行/分节符段落）与表格单元格内段落都占位，文本框内嵌段落不计入。

两个插件在构建期互相独立（各自只 link dsh 检出），所以遍历逻辑是**镜像实现**：本插件的 `src/docx.ts#scanParas` 与 reader 的 `src/ooxml.ts#splitWordParagraphs`。`tests/paragraph-contract.mjs` 同时跑两个实现并断言结果一致——改一侧必须改另一侧，否则该测试会红。

### 单元格值规则（xlsx）

`set_cells`/`sheets[].rows` 共用一套规则：数字/布尔原样写；`"=SUM(B2:C3)"` 写**公式**（不写缓存值，靠 `fullCalcOnLoad` 让 Excel 打开时重算）；`"'=SUM(B2:C3)"`（前置撇号，Excel 自己的转义）写**字面文本** `=SUM(B2:C3)`；`null` 删格。

### 编辑的保真范围（如实清单）

**docx**：段落样式（`w:pPr`）与 run 级格式（`w:rPr`）保留，只有被命中的 `<w:t>` 文本节点变化；分页符、域（PAGE/TOC/REF）、书签、批注锚点、超链接、图片不会因改字而丢失。`set_paragraph` 的契约就是「替换该段可见文本」，因此会丢弃旧文本 run，但保留段落属性并复用首个 run 的格式。

**xlsx**：值/公式/共享公式/合并单元格/自动筛选/定义名称/超链接/传统批注/工作表可见性与顺序、以及数字格式与列宽行高（读盘已开 `cellNF`/`cellStyles`）保留；冻结窗格与 `<calcPr fullCalcOnLoad="1"/>` 由写盘后的 XML 补丁写入（SheetJS 0.18.5 接受这两个设置却从不输出）。**不保留**字体、填充、边框、对齐、条件格式、数据验证、表格对象、图表、图片、透视表、工作表保护、VBA 宏。

**区间位移**：`add_rows`/`remove_rows` 会同步搬 `!merges`、`!autofilter`、`!rows` 与 `_xlnm._FilterDatabase`；插入落在合并区内部、或位移会让**公式引用失效**时直接报错（SheetJS 不改写公式文本，继续写会得到「文件能打开、合计却算错」的静默损坏）。确认无碍时用 `allow_formula_drift: true` 跳过。`rename_sheet` 不重写引用，但会在结果里点出仍写着旧表名的公式与定义名。

**pptx**：新建走 4 个内置版式（标题/标题+内容/节标题/空白），不做逐页摆几何；编辑按 `sldIdLst` 的**演示顺序**寻址（不是文件名编号），模板填充保留 run 级格式，复制幻灯会连同备注一起复制（不共享备注部件）。图片、表格、图表、SmartArt 的创建与形状几何编辑不提供。

### docx 排版操作

`set_style`、`fill_placeholders`（`{{名}}`/`{名}`，跨 run 拆分也命中，同时覆盖页眉页脚脚注尾注）、`insert_toc`（TOC 域 + `w:updateFields`）、`insert_page_number_footer`（PAGE 域）、`insert_header`、`set_page_setup`（A4/Letter/页边距/方向）、`set_metadata`（`docProps/core.xml`）、`insert_figure`（图片 + alt text + 题注）、`insert_table`（`w:tblGrid` + 表题）、`accept_revisions`（无需 Word 接受全部修订）、`add_comment`（生成 `word/comments.xml`、补批注样式、挂 `commentRangeStart/End` 与引用 run；`anchor` 只用于定位，批注区间会扩到包含该片段的整个 run，不改动 run 结构）。

内置 Word 同名命名样式：`Normal`/`Title`/`Subtitle`/`Quote`/`Caption`/`Heading 1-4`/`List Paragraph`/`List Bullet`/`List Number`，带 `w:name`/`w:qFormat`/`w:outlineLvl`，因此导航窗格、TOC 域与交叉引用可用。

### xlsx 工作表操作

`move_sheet`（重排，可见性跟着表走）、`set_sheet_state`（visible/hidden/veryHidden，不允许隐藏全部）、`merge_cells`/`unmerge_cells`、`freeze_panes`（`cell="A2"` 冻结首行，`"B2"` 冻结首行首列，`"A1"`/`"none"` 取消）、`set_defined_name`（工作簿级或工作表级，`refers_to=null` 删除）、`set_hyperlink`、`set_cell_comment`。

### 写入前校验

生成的字节在落盘前经 `verifyDocx`/`verifyXlsx`/`verifyPptx` 校验，**不复用产出这些字节的同一个扫描器**：zip 条目 CRC（fflate 解压时校验）、必需部件存在性、逐 `.xml`/`.rels` 的标签栈良构性，以及（pptx）`sldIdLst` 引用可解析、每个部件有 content-type Override。旧实现用同一套正则重跑自证，因此抓不到 `replace_text` 曾静默产出的畸形 XML。xlsx 的校验尤其重要：冻结窗格与 `<calcPr>` 是写盘后补进已序列化部件的，只靠 SheetJS 重读发现不了拼接事故。

## 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `maxInputBytes` | 104857600 (100MB) | 输入文档体积上限 |
| `maxOutputBytes` | 52428800 (50MB) | 写出文档体积上限 |
| `maxRowsPerSheet` | 10000 | 单次写入的行数上限 |
| `maxOpsPerCall` | 50 | 单次 `office_edit` 的操作数上限 |
| `maxImageBytes` | 20971520 (20MB) | `insert_image`/`insert_figure` 的图片体积上限 |
| `maxExplodeParts` | 5000 | 单次 `office_explode` 落盘的部件数上限 |
| `maxExplodeBytes` | 268435456 (256MB) | 单次 `office_explode` 解压总量上限 |

## 已知限制

- **不引入外部程序**：没有 LibreOffice / pandoc / qpdf / tesseract，因此没有 docx→PDF 渲染、`.doc`→`.docx` 转码、xlsx→PDF、可视 QA 渲染。xlsx 公式不重算（无公式引擎），导出的 CSV 取的是写入时读到的缓存值。
- **纯 Node 实现的速度**：docx/pptx 的编辑是字符串级手术而非 DOM 往返，好处是保真（不改的东西一个字节都不动），代价是复杂嵌套结构的支持以「顶层 `<w:p>`」为界。
- **`office_explode` 的缩进不是「格式化器」**：它不重排属性、不换行混排元素，因此产出的 XML 是「每个元素一行」而不是教科书写法。需要逐字节原样时用 `verbatim=true`。
- **`prune="orphans"` 不处理 docx/pptx 的全部孤儿类别**：只覆盖幻灯片/备注/媒体三类（与参考实现同界）；主题、母版、版式、`customXml` 即使看起来不可达也保留。
- **pptx 形状几何**：只能改文本与幻灯片顺序，不提供形状/图片/表格/图表的创建与几何编辑。
- **xlsx 样式**：字体、填充、边框、对齐、条件格式、数据验证等在编辑往返中丢失（SheetJS 社区版写盘时从零重建 `styles.xml`）。xlsx 的写出口因此是「SheetJS 产出 → 补丁 → 重新按固定顺序打包」，比 docx/pptx 多一次解压/压缩。
- **xlsx 公式位移**：SheetJS 不改写公式文本，跨位移的公式会被 `add_rows`/`remove_rows` 拦下（见上），需要确切知道引用为何不受影响时才用 `allow_formula_drift`。

## 构建、测试与注入

```bash
# 构建（需要 DSH_CHECKOUT 指向 dsh 源码树；脚本会自动探测）
bash scripts/build.sh

# 测试
node tests/p0-regression.mjs       # 比对报告 D1-D6 的回归（56 项）
node tests/paragraph-contract.mjs  # 与 dsh-office-reader 的段落寻址契约（30 项，需先构建 reader）
node tests/pptx-regression.mjs     # pptx 编辑与 writer↔reader 闭链（46 项）
node tests/e2e-paper-export.mjs    # 论文分节稿 → 规范 .docx 的端到端验收（49 项）
node tests/p2-xlsx.mjs             # P2 xlsx：位移正确性/公式漂移/合并/冻结窗格/定义名/超链接/批注/CSV 导出（75 项）
node tests/p3-package.mjs          # P3：可复现打包/条目顺序/indentXml/explode/assemble/prune（89 项，需先构建 reader）

# 装载：由预设以绝对 file: URL 随身携带（见 Plugins/dsh-user-presets/cordis.patch.yml），改动后重启 DSH 生效
```

`tests/out/` 与 `tests/tmp/` 是用例的产物目录，可随时删除。
