# @dsh-external/dsh-pdf-editor

PDF 文档编辑工具集：页面操作（合并 / 拆分 / 抽页 / 删页 / 重排 / 增量旋转 / 裁剪 / 插入）、AcroForm 探测-校验-填写-扁平化、叠加 / 盖章 / 水印、元数据写与 XMP 保留。纯 Node，基于 **pdf-lib 1.17.1**（不引入外部程序：无 qpdf / LibreOffice / Ghostscript）。

阅读（提取 / 搜索 / 渲染成图）在姊妹插件 `dsh-pdf-reader` 里，两个插件共用同一套页码语法（有测试逐项比对）。

## 工具一览

| 工具 | 用途 |
|---|---|
| `pdf_pages` | 页面操作套件：`merge` / `split` / `extract` / `remove` / `reorder` / `rotate` / `crop` / `insert`。原地类操作缺省输出 `<原名>-edited.pdf`；给 `output` 或 `in_place=true`（覆盖源文件并自动备份 `.bak`） |
| `pdf_form` | 不带 `values` 只探测（字段名 / 类型 / 当前值 / 可选项 / 只读 / 必填 / 所在页与控件矩形）；带 `values` 则**先校验后写**，`dry_run=true` 只返回问题清单，`flatten=true` 填写后扁平化 |
| `pdf_stamp` | 文字 / 线段 / 矩形 / 图片叠加与 `watermark` 水印快捷方式；坐标体系显式声明（`pdf_points` 或 `image_pixels` + y 轴翻转），绘制前 lint，`dry_run` 可另存红框预览 |
| `pdf_metadata` | 元数据读取（真只读）/ 写入 / 删除，外加 XMP 保留与可选 `sync_xmp` 同步 |

## 三条贯彻全插件的行为准则

### 1. 加密文档明确拒绝，不静默搬密文

pdf-lib 不解密。用 `ignoreEncryption: true` 强行打开只会把密文当作字符串/流原样搬进新文件——这是「文件能打开、内容却坏了」的典型来源。因此本插件直接拒绝加密输入，并给出可行动的路：取得口令后解密/另存为无加密副本；**只读查看**可用 `dsh-pdf-reader` 的 `pdf_read` / `pdf_inspect` 的 `password` 参数。

### 2. 写盘后回读校验，用页面内容指纹证明顺序

每次写入后重新读回，逐项核对：文件头/结束标记/无 `/Encrypt`、能重新打开、页数、**页面内容指纹**、旋转角、裁剪框、表单字段值、元数据。指纹取自页面内容流字节（`sha1` 前 12 位），实测在 `copyPages` 重组、保存、重读之后逐字节稳定，所以它能证明「重排真的把第 4 页放到了第 1 页」，而不只是页数对得上。`verified=false` 时 `problems` 里是具体不符项；`verify=false` 跳过校验时结果如实说明没有校验。

### 3. 中文（一切非 WinAnsi 字符）必须自备字体

pdf-lib 的标准字体（Helvetica 等）用 WinAnsi 编码，遇到中文**直接抛错**；更危险的是表单外观域生成器内部也会用它量文本宽度，所以「看着没事、写出来是空白」的另一面是「在某个阅读器里才炸」。本插件的做法是：用 pdf-lib 自己的编码器判定文本能否被标准字体承载；不能就按 `font_path` → `Config.cjkFontPath` → 平台候选路径（Windows 上 `simhei.ttf` / `Deng.ttf` / `simkai.ttf` / `simfang.ttf`…）逐个**真的嵌入一次**（`.ttc`/`.otc` 字体集合会失败：pdf-lib 调 `createSubset`，字体集合对象没有这个方法），并把用了哪个字体、哪些候选失败了如实回报；一个都没有就报错，绝不静默回退。

## 各工具的细节

### pdf_pages

- `merge`：`source` 作为第一部分，`sources` 依次接上；总页数受 `Config.maxOutputPages` 约束。
- `split`：`ranges`（分组，如 `["1-3","4-","z"]`）/ `every`（每 N 页）/ `each`（逐页）三选一，输出到 `out_dir`（缺省与源文件同目录），文件名带范围标记如 `report-p1-3.pdf`、`report-pz.pdf`。
- `rotate`：**增量**旋转（在页面现有 `/Rotate` 上叠加），页面树里的继承值也计入。
- `crop`：`box` 用 PDF 坐标（单位 point，原点在页面左下角，与 `/MediaBox` 同体系）；超出媒体框只警告（pdf-lib 不裁剪裁剪框本身）。
- `reorder`：直接改写页面树 `/Kids`（不重建文档），因此 `/AcroForm`、大纲、命名目标都保留；嵌套页面树会明确报错并建议改用 `extract` 重建。
- `remove`：同步清理落在被删页上的表单控件——字段的全部控件都没了就删字段，还有存活控件就只删控件。不做这一步的话，`/Fields` 会留下指向已删页的控件，正是「这个查看器能开、那个不能」的典型结构性损坏。
- `merge` / `split` / `extract` / `reorder`（以及 `insert` 的外来页）以页面为单位重建文档，而 pdf-lib 的 `copyPages` **不搬运表单域定义**，只把控件注解复制过来。因此这些操作默认剥掉落在外来页上的控件注解并报告数量（`keep_widgets=true` 可保留，代价是无主控件）。

### pdf_form

- 校验清单（全部在写之前）：未知字段（并列出可用字段）、类型不符、值不在选项列表里、只读字段、超长、签名/按钮、含非拉丁字符但没有可用字体。
- **pdf-lib 的下拉框会静默接受不在选项里的值**（并顺手把字段切成「可编辑」），单选组则会抛错。本插件把这个静默行为变成一条 error，要写自定义值必须显式 `allow_custom=true`。
- 填写后统一用解析出的字体调用 `form.updateFieldAppearances(font)` 重建外观域，并以 `save({ updateFieldAppearances: false })` 落盘——否则 pdf-lib 会用标准字体再生成一次，中文值直接抛错。
- 有 error 时**不写任何文件**并抛出逐条清单。

### pdf_stamp

- `geometry="pdf_points"` 时 `box` 就是 PDF 坐标；`geometry="image_pixels"` 时必须给 `page_size` 与 `image_size`，按比例换算并把 y 轴翻过来（图像左上原点 → PDF 左下原点）。
- `text` 的 `box`：给 `height` 表示框内垂直居中，给 `width` 表示按此宽度换行，都不给则 `(x, y)` 是基线起点。
- lint 在绘制之前跑：页面选择无效、矩形/图片零面积、mark 完全落在页外、`opacity` 越界、文本缺 `text`、图片缺 `path`、`filled` 与 `thickness` 冲突、线段给了 `rotate`、中文没有可用字体——error 阻止写盘，warning 只提示（如部分超出页面边界）。
- `watermark` 是「每页居中、旋转、半透明文字」的快捷方式，先画水印再画 `marks`，所以盖章压在水印之上。旋转文字的居中用字体自身的宽度做换算（旋转是绕文本原点发生的）。
- `dry_run=true` 返回 lint 结果与换算后的 PDF 坐标；再加 `preview=true` 会另存一个红框预览 PDF，可用阅读器的 `pdf_render` 渲染出来目视核对位置。

### pdf_metadata

- 加载时显式 `updateMetadata: false`：pdf-lib 默认会在加载时把 Producer/ModDate 刷成自己，从而让「只读取」变成一次静默改写。
- 日期接受 ISO 8601（`2026-01-02T03:04:05Z`）或 PDF 原生形式（`D:20260102030405+08'00'`），写出 ISO 往返可验。
- XMP 包默认**原样保留**（pdf-lib 不碰它），结果里同时给出信息字典与 XMP 的值，便于发现「字典改了、XMP 还是旧的」这种查看器各选其一的局面。
- `sync_xmp=true` 会把信息字典的值写回 XMP 中**已存在**的元素（`dc:title` / `dc:creator` / `dc:description` / `pdf:Keywords` / `pdf:Producer` / `xmp:CreateDate` / `xmp:ModifyDate`）。这是定点文本改写：包里没有的元素会列进 `xmp.skipped` 而不是凭空插入（正确插入 RDF 结构不是字符串拼接能做的事）。压缩（FlateDecode）的 XMP 会先解压再改写并保持压缩。
- `delete` 支持删除任意信息字典字段，并逐字段回读校验。

## 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `maxFileBytes` | 209715200 (200MB) | 单个输入 PDF 上限 |
| `maxDownloadBytes` | 104857600 (100MB) | URL 输入下载上限 |
| `downloadTimeoutMs` | 30000 | URL 下载超时 |
| `allowedHosts` | 空（全部允许） | URL 主机白名单正则列表 |
| `maxOutputBytes` | 419430400 (400MB) | 单个输出文件上限 |
| `maxSources` | 32 | 单次 `merge`/`insert` 读取的文档数上限 |
| `maxOutputPages` | 5000 | 单个输出文档的页数上限 |
| `maxMarks` | 500 | 单次 `pdf_stamp` 的标记数上限 |
| `cjkFontPath` | 空 | 非拉丁文本使用的字体路径（优先级低于 `font_path` 参数） |
| `fontCandidates` | 空 | 额外候选字体路径，排在平台内置候选之前 |
| `verifyWrites` | true | 是否默认做写后回读校验 |

## 构建、测试与注入

```bash
# 构建（需要 DSH_CHECKOUT 指向 dsh 源码树）
DSH_CHECKOUT=D:/Tools/DeepSeek Harness/source bash scripts/build.sh

# 第三方契约：pdf-lib 1.17.1 的行为假设（加载语义 / 加密异常 / 字体 / 表单 / 指纹稳定性 / XMP）
node tests/contract.mjs

# 页面操作：合并/拆分/抽页/删页/重排/旋转/裁剪/插入 + 表单清理 + 覆盖策略 + 错误路径
node tests/pages.mjs

# 表单：探测、先校验后写、填写、扁平化、CJK 外观域
node tests/forms.mjs

# 叠加：水印、文字/线段/矩形/图片、坐标换算、lint、红框预览
node tests/marks.mjs

# 元数据：读取、写入、删除、日期、XMP 保留与同步
node tests/metadata.mjs

# 跨解析器往返：用 pdfjs（阅读器的引擎）重读本插件写出的每个文件
node tests/roundtrip.mjs

# 装载：由预设以绝对 file: URL 随身携带（见 Plugins/dsh-user-presets/cordis.patch.yml），改动后重启 DSH 生效
```

## 已知限制与后续方向

- **加密文档不能编辑**（pdf-lib 不支持 AES 加解密）。AES-256 加密、权限设置、线性化、结构修复都需要 qpdf 一类外部程序，按本轮决策不移植；本插件的选择是明确拒绝并指路，而不是产出一个坏文件。
- **XFA 表单不能填写**：XFA 是 XML 表单描述，本插件只按 AcroForm 字段名填写；`pdf_inspect` 的 `xfa` 字段会提前告知。
- **签名域不填写**（需要证书），按钮域不触发（那是动作）。
- 重建类操作（merge/split/extract/reorder/insert）**不保留源文档的表单域定义、大纲、命名目标**——这是 pdf-lib `copyPages` 的边界，插件把「剥掉了几个控件」如实报告；需要保留表单时用 `flatten` 先固化外观域，或用原地类操作（remove/rotate/crop）。
- 叠加之后的页面内容流是「原始压缩流 + 新算子流」两段，页面指纹随之改变——这正是 `pdf_stamp` 用「内容增长」而不是「指纹相等」做校验的原因。
- 页面渲染不在本插件（在 `dsh-pdf-reader` 的 `pdf_render`），本插件不写图片。
- OCR、脱敏、数字签名、PDF/A 均不做（Side A 的对应能力依赖外部程序或本就不做）。
