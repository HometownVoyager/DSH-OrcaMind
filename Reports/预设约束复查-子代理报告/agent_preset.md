# cordis.patch.yml 预设/提示词审查报告（agent-3 · 配置层）

**审查对象**：`Plugins/dsh-user-presets/cordis.patch.yml`，5699 行，20 个 `preset-*` 行
**文件指纹**：revision `c888fa34ae5a34a3ac652f5c13b2af030f90755d86fc7598d983e4154e8b3617`，487586 字节
**读取方式**：Python `io.open(..., encoding='utf-8')` 全量逐行（终端 GBK 不用于取数，结论均落 UTF-8 文件）
**范围**：穷尽全部 5699 行、全部 20 个 preset，不抽样。**未修改任何被审文件**（仅新增 Dependency/tmp 下的分析脚本与本报告）
**交叉参照**：`Plugins/dsh-user-presets/README.md`、`Plugins/dsh-user-presets/VN-工作流现行规范.md`、工作区根 `VN-工作流改造施工文档.md` / `VN-工作流改造说明.md`、`Plugins/dsh-user-presets/skills/vn-shared/*`

**版本提示（来自 preset-audit 的交叉印证）**：本文件在 2026-11-10 17:03 由 6178 行改为 5699 行，17:05–17:06 又瘦身了 `vn-shared` 三份 SKILL.md，并新增 `VN-工作流现行规范.md`。本报告只针对**现行 5699 行版**；旧版备份在 `Archive/Plugins/dsh-user-presets-slim-20261110-slim/`（16:59 版）。若与其他审计结论对照，务必按版本区分，旧行号不可直接套用。

---

## 0. 清单与 Loader 方言前提

20 个 preset 行（行号 = 该行 `- id: preset-xxx` 的起始行）：

| # | preset | 行范围 | 类别 |
|---|---|---|---|
| 1 | game-design | L15–326 | 旧 13 |
| 2 | genre-fiction | L327–675 | 旧 13 |
| 3 | language-learning | L676–995 | 旧 13 |
| 4 | novel-writing | L996–1334 | 旧 13 |
| 5 | official-docs | L1335–1693 | 旧 13 |
| 6 | paper-writing | L1694–2060 | 旧 13 |
| 7 | comfyui-work | L2061–2299 | 旧 13 |
| 8 | science-learning | L2300–2606 | 旧 13 |
| 9 | screenplay-writing | L2607–2942 | 旧 13（**disabled**） |
| 10 | social-issues | L2943–3299 | 旧 13 |
| 11 | vn-design | L3300–3607 | 旧 13（**disabled**） |
| 12 | vn-staging | L3608–4030 | 旧 13（**disabled**） |
| 13 | godot-dev | L4031–4258 | 旧 13 |
| 14 | vn-bible | L4259–4469 | **VN 7** |
| 15 | vn-outline | L4470–4671 | VN 7 |
| 16 | vn-script | L4672–4874 | VN 7 |
| 17 | vn-asset-list | L4875–5077 | VN 7 |
| 18 | vn-asset-make | L5078–5285 | VN 7 |
| 19 | vn-screenplay | L5286–5502 | VN 7 |
| 20 | vn-game | L5503–5699 | VN 7 |

**Loader 前提**（据 `cordis-composition-reference` 与本文件头 L1–12）：文件是一条 `- insert:` 批量插入，20 个 `preset-<id>` 行同属一个 patch；每个 preset 的 `config.plugins` 是**该 preset 自己的** entry list，只在选中该预设的会话里挂载，**不会跨 preset 叠加**；只有同 id 的 override 才覆盖。文件头 L6 明言「每个 preset-<id> 行的 config.plugins 内容逐字来自原 .agent-presets/<id>/agent.cordis.yml」。

因此**判定标准**：跨 preset 的规则差异 → 「bundle 级规范不一致」，不是「同一会话内两套规则打架」；同一 preset 内不同段落/不同注入通道的对立要求 → 才是「会话内真矛盾」。

---

# 一、按严重度排序的结论

## 【A 级 · 真矛盾 / 需修】 —— 会话内自相矛盾

### A1. `vn-game` 的 description 仍写「必须先确认」「三道门禁」，persona 宪法段却说「除 3 条硬红线外一切可被用户显式指令覆盖」

这是**同一 preset 内**、且 description 与 persona.prefix 两个都会进入模型上下文的通道之间的实质冲突，是本文件中唯一够得上「真矛盾」的一处。

证据（同一 preset，L5508 description 与 L5517–5545 prefix）：

- **L5508（description，绝对化）**：
  > 「本预设实行**两道确认门**：第一轮为规格门，**必须先**向用户确认目标引擎…；第二轮为工程门，**只有在** implementation-spec.md 经用户明确确认且 README.md 状态机 状态=已确认 **之后，才允许**…上游…**一律只读，禁止回写；禁止创建任何计划外文档**…**严格遵循**统一六目录、目录纪律、**三道门禁**、单轮单条目七步循环、README 状态机与共用规范前置条件。」

- **L5518（宪法第 1 条）**：
  > 「【硬红线】**仅三条**：① 不跨阶段写入…② 不创建 6 编号目录 + 3 根级文档白名单之外的文件；③ 不自行把 README 状态置「已确认」。**除这三条外，一切流程、步骤、提问与确认节奏均为【默认工作节奏】，可被用户显式指令覆盖。**」

- **L5519（宪法第 2 条）**：
  > 「用户本轮指令与【默认工作节奏】冲突时，**以用户指令为准，直接执行，无需先提问确认**；用户已在同一条消息里写明范围或做法时视为已确认，不必重复提问。**可一次性授权「一次做完多个子条目 / 跳过逐轮确认」**…」

- **L5523（宪法第 6 条）**：
  > 「措辞以「默认 / 除非用户明确要求」为主，**不因未使用绝对化措辞而怀疑规则失效**。」

- **同一 preset 的 prefix 里其实已经「软化」了**（L5528–5529 用「默认」「用户显式授权跳过时按授权执行」），与 description 的「必须先 / 只有…才允许 / 三道门禁」形成**同一预设内部前后不一致**：
  > L5528「**默认**先向用户确认目标引擎…」
  > L5529「**默认**在 implementation-spec.md 经用户明确确认…用户显式授权跳过时按授权执行。」

- 另：`VN-工作流现行规范.md` L63 已把「三道锁 / 硬门禁 / 禁止出现软词」列为**已废止**；G10 全量扫描显示「三道锁 / 硬门禁 / 禁止出现软词 / T 块 5 条唯一真源 / 全链双向逐项过 / 提问后不得有任何工具调用 / 末位固定为 ask_user_question / 旧七步」在 patch 中**0 命中**，唯独「**三道门禁**」在 L5508 残留 1 次（且该词在现行规范.md 中 0 次）。

**判定**：真矛盾（语义级），且是「已废止措辞残留」。description 是 roster 展示/可能注入的元信息，prefix 是 system 通道（现行规范.md L4 称 order=0 最高）；两者对「确认是否可被用户跳过」给出相反默认。
**建议**：**需要修复**。把 L5508 的「必须先向用户确认」「只有在…之后才允许」「三道门禁」「严格遵循」改成与 prefix 一致的「默认…用户显式授权可跳过」「两道确认门」「按 vn-gate / vn-spec / vn-continuity」；或干脆把 description 缩成一句职责摘要，规则全部交给 prefix 与三份共享 skill。

### A2. `vn-asset-make` 的 description 写「每轮调用前**必须**用 ask_user_question 询问用户选择工具…未确认禁止调用任何生图工具」，与宪法第 2 条「无需先提问确认」冲突

- **L5083（description）**：
  > 「生图工具暂不绑定…**每轮调用前必须用 ask_user_question 询问用户选择工具（ComfyUI 本地 / Nano Banana 2 在线 / 其它）并确认参数，未确认禁止调用任何生图工具**」

- **L5108 / L5109（同一 preset 宪法第 1/2 条，逐字同 A1）**：「除三条硬红线外一切…可被用户显式指令覆盖」「以用户指令为准，直接执行，无需先提问确认…可一次性授权跳过逐轮确认」。
- prefix 内 L5123 已软化：「每轮调用生图工具前，**默认**用 ask_user_question 确认工具与参数；**用户已明确指定工具与参数时视为已确认，直接执行**。」

**判定**：真矛盾，性质与 A1 完全相同（description 绝对化 vs 宪法可覆盖），只是另一处。
**建议**：**需要修复**，同 A1 处理。

> 说明：其余 5 个 VN 的 description 也含「必须 / 禁止 / 一律」，但多为「唯一可写目录」「禁止创建计划外文档」这类**恰好对应 3 条硬红线**的表述（L4678–4687、L4880–4888、L5083、L5291–5309），与宪法不冲突；只有 A1/A2 涉及「确认节奏 / 提问」这类被宪法明列为【默认工作节奏】的内容。逐 preset 绝对词统计见 `p3_final.md` G6。

---

## 【B 级 · bundle 级规范不一致 / 建议修，但非会话内矛盾】

### B1. 旧 13 的 `planning` 组「exit_plan_mode 唯一且最后」vs VN 7 的宪法段 —— 明确结论：**不构成会话内矛盾，但构成 bundle 级规范不一致**

**（1）旧 13 的证据（穷尽 13 处，逐条行号）**：13 个 preset 各有一个 `id: planning` 组，组内 `plan-mode` 的 `section` 末段都含同一句：

| preset | planning 行 | 「唯一且最后」行 |
|---|---|---|
| game-design | L201 | **L219** |
| genre-fiction | L547 | **L565** |
| language-learning | L867 | **L885** |
| novel-writing | L1206 | **L1224** |
| official-docs | L1565 | **L1583** |
| paper-writing | L1932 | **L1950** |
| comfyui-work | L2164 | **L2182** |
| science-learning | L2478 | **L2496** |
| screenplay-writing | L2817 | **L2835**（该 preset 整体 disabled） |
| social-issues | L3171 | **L3189** |
| vn-design | L3482 | **L3500**（整体 disabled） |
| vn-staging | L3903 | **L3921**（整体 disabled） |
| godot-dev | L4130 | **L4148** |

典型原文（L219，game-design）：
> 「准备好后，调用 exit_plan_mode 提交完整方案，以 # 标题开头。**让 exit_plan_mode 成为该回复中唯一且最后的工具调用**：它把方案提交审批，批准后才在后续步骤开始执行。不要把最终方案以普通回复粘贴，也不要用散文或 ask_user_question 问「要不要开始」…」

plan-mode 的整段还写着（L211，game-design）：
> 「用户对话中的口头同意——包括回答确认了某个问题——**不代表批准，也不会结束规划模式**」

**（2）VN 7 一侧**：全量扫描 `4259–5699`（VN 7 区）**无 `id: planning`、无 `@deepseek-ai/dsh-plan-mode`、无 `exit_plan_mode`、无「唯一且最后」**（p3_extract.md §2c 逐 preset 核实）。7 份宪法段（起点 L4283 / L4493 / L4696 / L4899 / L5107 / L5323 / L5517）逐字相同，其中：
- L4285：「用户本轮指令与【默认工作节奏】冲突时，以用户指令为准，直接执行，无需先提问确认」
- L4309（vn-bible，其余 6 份对应 L4516 / L4719 / L4922 / L5130 / L5347 / L5545）：
  > 「README 状态登记与交付（present）在**下一轮 Read 之前**完成，**不计入上一轮收尾**。」
- L4308（默认每轮节奏）：
  > 「…Confirm（**默认**用 ask_user_question 请用户确认本轮范围，用户已写明范围时跳过）→ Do → Check → Write → **Stop**（停下，报告本轮结果并列出下一候选）。」

**（3）用户提到的那两句引号，需澄清出处（重要）**：
- 「**本轮工具调用顺序不设固定末位不变量**」——在 `cordis.patch.yml` 中 **0 命中**（全量扫描「不设固定末位」「固定末位不变量」「本轮工具调用顺序」「末位」均 0 行）。它只出现在 `Plugins/dsh-user-presets/VN-工作流现行规范.md` **L43**：
  > 「**本轮工具调用顺序不设固定末位不变量**。报告、`present` 交付、README 状态登记都是正常步骤；状态登记默认在下一轮 Read 之前完成，不存在「提问后不得写文件」的时序矛盾。」
- 「**用户指令优先**」这 5 个字在 patch 中同样 **0 命中**；但同一语义确实**进了运行时 persona.prefix**（这是 preset-audit 纠正我的点，我采纳）：即 L4285「以用户指令为准，直接执行」、L4286「由用户拍板」、L4284「可被用户显式指令覆盖」（7 份共 7 次）、L4289「措辞以『默认 / 除非用户明确要求』为主」。另外「以用户指令为准」在 patch 全文 15 次（8 处在旧 13 的「用户要求跳转或回溯时，以用户指令为准」，7 处在 VN 宪法）。
- 也就是说：**「不设末位不变量」没有写进任何运行时 persona**，它的运行时落地靠三件事：① 7 VN 移除 planning 组；② 删掉硬门禁/末位句；③ 宪法把流程降级为可覆盖的【默认工作节奏】+ L4309「present 不计入上一轮收尾」。「用户指令优先」则以实质条款（而非字面）进了 7 份 prefix。

**（4）是否同时作用在同一会话？**
**不会。** 依据 Loader 方言：每个 preset 的 `config.plugins` 只对自己生效，选中 `vn-*` 时挂载的是该 VN 的 19–21 行（其中无 planning），选中旧 13 之一时挂载的是那 13 个之一（其中有 planning）。VN 7 与旧 13 是**互斥的会话**，且 `preset-screenplay-writing` / `preset-vn-design` / `preset-vn-staging` 三个旧 VN 预设还各自带 `disabled: true`（L2609 / L3302 / L3610）。同一个会话只加载自己那套。

**结论（按题目要求明说）**：**不构成会话内矛盾，但构成 bundle 级规范不一致** —— 同一个 bundle 里，13 个预设把「exit_plan_mode 是唯一且最后的工具调用」「口头同意不代表批准」写成规划模式的硬规则，7 个 VN 预设却把「用户写明范围即视为已确认、无需先提问」「present/写 README 不计入收尾」写成最高优先级宪法；`VN-工作流现行规范.md` L62–64 还把「旧版收尾硬不变量（原 77 处）」「plan-mode 的 exit_plan_mode 唯一且最后」列为**已全部移除 / 已废止**。文档的「已全部移除」与 patch 里 13 处仍在，是**文档与配置的事实不一致**。
**建议**：**建议修（低优先级）**。两条路二选一：① 承认旧 13 是「未瘦身的历史预设」，在现行规范.md §6 把「已全部移除」改为「7 个 VN 预设已移除，旧 13 仍保留」；② 若真想统一，则把 13 个 planning 组也做同样瘦身（工作量大、且这 13 个是独立工作流，未必该动）。**不要**只改文档措辞而留着 13 处，否则下次审查还会踩。

### B2. README 索引严重过期：声明「13 个」，实际 20 个；完全没提 VN 7 与 `vn-shared`

- **README.md L3–4**：「这个 bundle 承载 **13 个**自建预设：论文撰写、小说创作、分类文学创作、剧本创作、视觉小说全栈设计、视觉小说演出设计、游戏设计、Godot 游戏开发、语言学习、理科学习、公文撰写、社会议题、ComfyUI工作。」
- **README.md L17**：「| `cordis.patch.yml` | **13 个** `preset-<id>` 声明（组合内容来自原 `agent.cordis.yml`） |」
- **实际**：20 个 preset 行（见 §0 表）。README 全文**不含** `20 个` / `7 个` / `vn-bible` / `vn-shared` / `Specifications.md` / `instructionFileCandidates` / `七预设` / `VN 工作流`（p3_deep.md B5 逐项核实）。
- README L26–34 的「写作类预设的共同基线（施工经验四支柱）」同步检查表只列 5 个预设，也不含 7 个 VN。
- README L49 写「2026-10-11 已按迁移指南从**全部 12 个 preset** 中移除该引用」「把本文件里 **12 个** persona 模板喂给 renderPrompt」——与实际 20 个不符（另一处过期计数，且 12/13/20 三个数字在同一文件里并存）。

**判定**：文档级不一致（非运行时矛盾，README 不进模型上下文，但会误导维护者）。
**建议**：**需要修复**（文档，低成本）。把 L3、L17、L49 的数字与清单同步到 20；补一节说明 7 个 VN 预设、`vn-shared` 三份 skill、`Specifications.md` / `Direction.md` 根级文档与 `instructionFileCandidates`；L26–34 的四支柱表注明「不含 VN 7」。

### B3. `instructionFileCandidates` 与现行规范/根级三文档口径对不上

- 7 个 VN 全部写同一行（L4314 / L4521 / L4724 / L4927 / L5135 / L5352 / L5550）：
  > `instructionFileCandidates: ['Specifications.md', 'README.md', 'AGENTS.md']`
- 7 个 VN 全部写（L4317 等）：
  > `projectRootMarkers: ['.git', 'Specifications.md']`
- 但 `VN-工作流现行规范.md` L29 定义的根级三文档是 **`README.md` / `Specifications.md` / `Direction.md`**；宪法段 L4308 的默认 Read 也要求「首轮另显式读一次 **Specifications.md 与 Direction.md**」。
- 于是：**`Direction.md` 不在 instructionFileCandidates 里**（靠 persona 每轮显式 Read 兜底，L4308 有「首轮另显式读一次」），而 **`AGENTS.md` 在 candidates 里却不属于现行规范定义的任何根级文档**（现行规范.md 全文 `AGENTS.md` 0 次；patch 中 8 次，7 处是这行 candidates、1 处是 godot-dev L4050 的项目规范约定）。
- L4315–4316 的注释还写着「显式 projectRootMarkers 会整体替换默认值 `['.git']`（**config.ts:11,42**）」——这是**指向上游源码的旧行号**（7 份逐字相同，L4315 / L4522 / L4725 / L4928 / L5136 / L5353 / L5551）。G2 全量扫描确认这是 patch 中唯一一类源码行号引用，共 7 处。

**判定**：配置口径不一致（轻）+ 潜在失效引用。不是矛盾（candidates 是「候选」而非「白名单」，多一个 AGENTS.md 不违规；Direction.md 靠显式 Read 补）。
**建议**：**可选修**。若追求严谨，把 `AGENTS.md` 换成 `Direction.md` 或在注释说明「AGENTS.md 为通用工程约定、Direction.md 由 Read 步显式读取」；`config.ts:11,42` 改为不带行号的描述（上游源码行号会漂移）。注意 `projectRootMarkers` 的注释本身是正确的（必须保留 `.git`），别误删。

---

## 【C 级 · 冗余重复 / 有意的一致性副本】 —— 逐条给次数与行号

### C1. 宪法段 7 份**逐字相同** —— 有意的一致性副本，但可提取

- 7 个起点：**L4283**（vn-bible）、**L4493**（vn-outline）、**L4696**（vn-script）、**L4899**（vn-asset-list）、**L5107**（vn-asset-make）、**L5323**（vn-screenplay）、**L5517**（vn-game）；每份 8 行（标题 + 6 条 + 空行）。
- md5 全部 = `ce71b8dd5223f0fddbc0ec941ce4441e`（p3_deep.md C1）；**不同版本数 = 1**，7 份逐字相同，含标点、`>`、`·`、U+00B7 全一致。
- 原文见 p3_extract.md §3（L4283–4289 全文）。

**判定**：**有意的一致性副本**（宪法必须每份自带，因为每个 preset 独立挂载、不共享 prefix；现行规范.md L6 也明说「写在每个 persona 开头」）。**不是 bug，但属于可提取的重复**：7×8=56 行完全相同的文字，任何一次改动要同步 7 处。
**建议**：**不必删**，但建议在 `VN-工作流现行规范.md` §1 标注「以下 6 条为 7 份 persona 的逐字副本，改一处须同步 7 处」，并考虑用 YAML 锚点/`cordis:include` 或生成脚本产出（当前 bundle 是纯 insert 方言，引入锚点需确认 Loader 支持 YAML merge key；若不支持，维持 7 份 + 校验脚本更稳妥）。

### C2. 「按 vn-gate / vn-spec / vn-continuity」这一句到底重复几次 —— 精确答案

题目问「这一句重复几次」，按不同口径给全：

| 口径 | 次数 | 行号 |
|---|---|---|
| 宪法第 4 条整句「引用的 vn-gate / vn-spec / vn-continuity 与本文冲突时，以本文为准；三份 skill 之间冲突时按 vn-gate（流程）> vn-spec…」 | **7 次**（VN 7 各 1） | L4287 / L4497 / L4700 / L4903 / L5111 / L5327 / L5521 |
| 【共用规范引用】整句「本预设的目录树、读写权限…按 `vn-spec`；一致性核查按 `vn-continuity`；每轮流程…按 `vn-gate`…」 | **7 次** | L4305 / L4512 / L4715 / L4918 / L5126 / L5343 / L5541（**7 份逐字相同**，p3_deep.md C3 不同版本数=1） |
| 字面「按 vn-gate」（含 `按 \`vn-gate\``） | 7 次 | 同上 7 行 |
| 字面「vn-gate」在 patch 全文 | 14 次（7 VN 各 2） | 7 份 ×（宪法第4条 1 + 共用规范引用 1） |
| 字面「vn-spec」全文 | 14 次 | 同上 |
| 字面「vn-continuity」全文 | **23 次** | 7 VN 各 3（第4条 1 + 共用引用 1 + 默认节奏 Check 1，见 L4308 等）= 21，另 L3365、L3396 在旧 vn-design 里各 1 |
| 「按 `vn-continuity` 只核查这 1 个产物」 | 7 次 | L4308 / L4515 / L4718 / L4921 / L5129 / L5346 / L5544 |
| 「三份共享 skill 与本阶段专属 skill 均由 `customSkillDirs` 提供」 | 7 次 | 同上 7 行 |
| 「与上述三份 skill 的措辞冲突时，以本文【指令裁决】段为准」 | 7 次 | 同上 7 行 |
| 「按【指令裁决】第 2 条处理」 | 7 次 | L4309 / L4516 / L4719 / L4922 / L5130 / L5347 / L5545 |

**优先级声明的重复（preset-audit 也提示的张力）**：宪法第 4 条（L4287）已说「三份 skill 与本文冲突时以本文为准」，【共用规范引用】（L4305）又说「与上述三份 skill 的措辞冲突时，以本文【指令裁决】段为准」——**同一优先级规则在同一 prefix 内写了 2 次**，且「按 `vn-spec` / `vn-gate`」与「以本文为准」并列，措辞轻微分叉。L4309 再第 3 次引用「按【指令裁决】第 2 条处理」。
**判定**：**冗余重复（自洽但啰嗦），不是矛盾**——两条指向同一个裁决段，无相反结论。
**建议**：**可选修（低成本）**。把 L4305 末句「与上述三份 skill 的措辞冲突时，以本文【指令裁决】段为准」删掉（宪法第 4 条已覆盖），7 处同步；或保留作为就近提示，但统一措辞为「冲突裁决见本段【指令裁决】第 4 条」。

### C3. 同一 preset 内 persona.prefix / suffix / agent-instructions / description 之间是否重复同一套规则

- **suffix**：全 20 个 preset **0 个** `suffix:` 行（p3_final.md G8）。不存在 prefix↔suffix 重复。
- **agent-instructions**：7 个 VN 的该块是**纯配置**，无规则文字，且 7 份逐字相同（p3_final.md G7）：
  > `maxBytes: 65536` / `instructionFileCandidates: ['Specifications.md', 'README.md', 'AGENTS.md']` / 注释 2 行 / `projectRootMarkers: ['.git', 'Specifications.md']`
  行号：L4310–4317 / L4517–4524 / L4720–4727 / L4923–4930 / L5131–5138 / L5348–5355 / L5546–5553。**不是规则重复，是有意的一致性配置副本**（同 C1 理由）。
- **description ↔ prefix 逐字重合长句**：**0 条**（p3_deep.md C4，7 个 VN 逐个比对 ≥20 字长句）。两者**语义重叠但无逐字复制**：description 讲职责/目录/边界，prefix 讲裁决/节奏/引用。A1/A2 指出的是语义冲突而非重复。
- **同一 preset 内真正的重复**：C2 的「优先级声明写 2 次」；以及 7 VN 的【默认每轮节奏】整句 + 节奏尾句**两份各自 7 份逐字相同**（L4308 / L4515 / L4718 / L4921 / L5129 / L5346 / L5544 与 L4309 / L4516 / L4719 / L4922 / L5130 / L5347 / L5545，p3_extract.md 已列全部原文）。这两句合计 14 行 ×7 份的「共用副本」，同样可提取。

### C4. 7 VN 之间的大段逐字重复（穷尽，含精确行号）

按 `difflib.SequenceMatcher` 对 7 份做两两最长公共块（p3_blocks.md H1，以 vn-bible 为基准，≥10 行）：

| 共同块 | vn-bible 行 | 对应 6 份行 | 内容 |
|---|---|---|---|
| **107 行**（最大） | L4363–4469 | outline L4565–4671 / script L4768–4874 / asset-list L4971–5077 / asset-make L5179–5285 / screenplay L5396–5502 / game **106 行** L5594–5699 | `tool-skill` → `command-goal` → `tool-goal` → `compaction` 组 → `delegation` 组 → `tool-ask-user` → `tool-todo` → `tool-web` → `present` 的**整段工具行 + 注释**（7 份逐字相同） |
| **47 行** | L4303–4349 | outline L4510–4556 / script L4713–4759 / asset-list L4916–4962 / asset-make L5124–5170 / screenplay L5341–5387 / game L5539–5585 | 【共用规范引用】+【默认每轮节奏】+ agent-instructions + time-context + bash/pwsh/fs/jobs/schedule + **7 份相同的 office 注释**（见 C5） |
| **15 行** | L4276–4290 | outline L4486–4500 / script L4689–4703 / asset-list L4892–4906 / asset-make L5100–5114 / screenplay L5316–5330 / game L5510–5524 | `plugins:` 头 + identity 注释 + persona 行 + **宪法段 8 行** |

- F 类全量统计（p3_deep.md F）：规范化后 ≥30 字、出现在 ≥2 个 preset 的重复行共 **133 行**；按份数分布 `{2:43, 3:21, 4:3, 5:7, 6:11, 7:13, 8:2, 9:1, 10:1, 11:1, 13:1, 20:29}`。其中 **20 份都有**的 29 行是 20 个 preset 共用的插件 `name:` 行与 `disabled: !!js ...` 行（结构性、无害、不可避免）。
- **7 份专属**的 13 行重复即：宪法段 7 行（标题 + 6 条）+ 共用规范引用 1 + 默认每轮节奏 1 + 节奏尾句 1 + instructionFileCandidates 1 + projectRootMarkers 1 + vn-shared 路径 1（p3_deep.md F 段 L407–432）。

**判定**：**有意的一致性副本（工具行）+ 可提取的重复（宪法/共用引用/节奏）**。工具行 107 行 ×7 是 Loader 方言决定的——每个 preset 必须自带完整 plugin list，不能跨 preset 引用，**不是冗余，不能删**。可提取的只有宪法段 8 行、共用规范引用 1 行、默认节奏 2 行、agent-instructions 配置 8 行，共约 19 行/份。

### C5. 7 份逐字相同的「office 注释」指向已留档施工文档的章节号

- 7 处（p3_blocks.md H9）：
  > `# ── office（仅 vn-bible；见 §3.1 ① 的差异注入说明与 §3.0.9.3；其余 6 预设一律不插这两行）──────`
  > **L4349 / L4556 / L4759 / L4962 / L5170 / L5387 / L5585**
- 这 7 行**内容完全一样**，却出现在**没有 office 行的 6 个 VN 预设里**（只有 vn-bible 真有 office-reader/office-editor，见 §五），属于「占位注释副本」。
- `§3.1 ①` / `§3.0.9.3` / `§2.1` / `§2.4` 这些章节号指向的是 `VN-工作流改造施工文档.md`（工作区根，2753 行）——该文件已被 `VN-工作流现行规范.md` L3 明确「取代…仅作留档」。patch 中的 § 引用共 **10 处**（G1）：L682、L2306、L4263、L4271、L4275、L4349、L4474、L4485、L4556、L4759、L4962、L5170、L5387、L5585（含 order 注释 §2.1 共 5 处、name 注释 §2.1 共 2 处、§2.4 一处 L4271、office 注释 7 处）。G2 确认 patch 中**没有** `:3307 / :2632 / :3687 / L1234` 之类的旧行号（现行规范.md L68 说这些「已失效」，patch 里确实已清干净），只有 7 处 `config.ts:11,42`（见 B3）。

**判定**：**已废弃但无害的引用**（注释不进模型上下文；§号虽指向留档文档，但注释只作人工索引）。属于「有意的一致性副本 + 过期索引」。
**建议**：**可选修**。把 7 处 § 号改为指向 `VN-工作流现行规范.md` 或直接写「见 vn-bible 的 office 注入说明」；6 个无 office 行的 preset 可直接删掉该注释（减少 6 行噪音）。

### C6. 非 VN preset 之间的大段逐字重复（题目第 6 问）

**（1）20 个 description 是否互相复制 → 否，但模板句高度复用**

- 精确解析（含 `>-` 折叠块）后 **20 个 description 两两完全不同：不同版本数 = 20/20**（p3_deep.md A1）。8-gram Jaccard ≥0.25 的只有 **2 对**（A2）：
  - `genre-fiction ↔ novel-writing` **0.455**（同构派生，genre-fiction 自述「派生自 novel-writing」，L332）
  - `vn-script ↔ vn-asset-list` **0.259**（同模板的阶段描述）
- 但**共用尾句**大量复用（A3）：
  - 「工具集与官方 standard 一致（含 web_search…）」→ **11 个** description（game-design、genre-fiction、language-learning、novel-writing、official-docs、paper-writing、science-learning、screenplay-writing、social-issues、vn-design、vn-staging）
  - 「含 web_search 检索、web_fetch 打开网页正文、present 文件卡片交付」→ **10 个**
  - 「每轮先声明并确认本轮范围，禁止一轮干完整个阶段或整份草稿」→ **6 个**（game-design L20、genre-fiction L332、novel-writing L1001、official-docs L1340、paper-writing L1699、social-issues L2948）
  - 「开工先做规范检查并落盘」→ 3 个；「全局基准事实层」→ 4 个；「起飞检查卡」→ 3 个；「排版防灾」→ 2 个

**判定**：**没有整段复制，但有模板句复用**（有意的一致性，无害）。

**（2）旧 13 之间的大段逐字重复 → 有，且量大（p3_blocks.md H2 / p3_deep.md F2）**

以 game-design 为基准，13 个旧预设两两比对：

| 共同块 | game-design 行 | 出现范围 |
|---|---|---|
| **77 行** `delegation` 组整块 | L250–326 | genre-fiction L599–675、language-learning L919–995、novel-writing L1258–1334、official-docs L1617–1693、paper-writing L1984–2060、science-learning L2530–2606、social-issues L3223–3299（**8 份逐字相同**）；comfyui-work L2206–2263 为 58 行变体 |
| **107 行**（最大） | L220–326 | screenplay-writing L2836–2942、vn-design L3501–3607（含 compaction + delegation + 尾部工具行整段） |
| **78 行** | L249–326 | vn-staging L3952–4029 |
| **25–26 行** `compaction` 组 | L225–249 / L185–210 | official-docs、paper-writing、social-issues、comfyui-work、science-learning 等 |

- 另有逐字重复的规则句（p3_deep.md F、p3_blocks.md H3/H4）：
  - 「每轮按 Read → Report → Plan → Do → Check → Write → Ask 七步循环推进：**」**11 份**：L73 / L405 / L769 / L1064 / L1404 / L1770 / L2380 / L2676 / L3022 / L3360 / L3741（旧 13 中除 comfyui-work、godot-dev 外全部）。注意 7 个 VN 用的是**新版**「Read → Report → Confirm → Do → Check → Write → Stop」（L4308 等），旧 13 用的是 **Plan/Ask** 版——这是 bundle 级两套七步并存（与 B1 同源，但不同 preset，非会话内矛盾）。
  - 「开工范围声明：在 Report 步把…」**6 份**：L84 / L416 / L1075 / L1415 / L1781 / L3033（+ godot-dev L4071 为变体）
  - 「范围红线：不得把「一个阶段」「整份草稿」…」**6 份**：L85 / L417 / L1076 / L1416 / L1782 / L3034（+ L4072 变体）
  - 「批量工具纪律：subagent / workflow / ralph / todo_write / plan-mode…」**7 份**：L87 / L419 / L1078 / L1418 / L1784 / L3036 / L4074
  - 「长项目分批复读…」**6 份**：L86 / L418 / L1077 / L1417 / L1783 / L3035
  - 「- 存在任何疑问或不确定的地方主动询问：宁可多问一句…」**10 份**；「- 发现新产出与已确认内容冲突时，主动指出冲突并请用户裁决…」**9 份**（p3_deep.md F）

**判定**：**冗余重复（旧 13 是同一母本派生的历史副本）**。文件头 L6 已说明「逐字来自原 agent.cordis.yml」，`game-design` L25 自述「派生自 vn-design」、`genre-fiction` L332 自述「派生自 novel-writing」。
**建议**：**不建议大改**。这 13 个是互不重叠的会话、且 3 个已 disabled；工作量大、收益低。若要治理，优先级最低：可把 77 行 delegation 组、25 行 compaction 组用 `cordis:group` + `cordis:include`（skill 文档提到 `cordis:include` 可加载字面 entry list）抽成共享片段，但需先验证 Loader 对 include 路径的解析；当前保持副本 + 一份校验脚本（比对 7 VN 与 13 旧的公共块是否漂移）更稳妥。

---

## 【D 级 · 已废弃但无害】

### D1. 3 个旧 VN 预设整体 disabled，但 config 全文保留（含 planning / 旧七步 / 旧 skill 名）

- **L2609**：`disabled: true   # 弃用：由 vn-script 取代；完整保留 config，删掉本行即可恢复`
- **L3302**：`disabled: true   # 弃用：由 vn-bible / vn-outline / vn-asset-list 取代；完整保留 config，删掉本行即可恢复`
- **L3610**：`disabled: true   # 弃用：由 vn-screenplay 取代（8 条核心原则与 8 个 skill 内核已平移，路径改新六目录）；删掉本行即可恢复`
- 三者仍各含 `id: planning`（L2817 / L3482 / L3903）、「唯一且最后」（L2835 / L3500 / L3921）、旧七步（L2676 / L3360 / L3741）、旧阶段 skill 名（L3396 的 `vn-project-bootstrap` / `vn-brainstorm` / `vn-character-design` / `vn-worldbuilding` / `vn-story-outline` / `vn-system-design`，以及 L3365/L3396 的 `vn-continuity` 旧引用）。p3_final.md G9 逐项核实。
- 磁盘上 `skills/` 一级目录共 22 个，其中 `vn-design`、`vn-staging`、`screenplay-writing`、`vn-bible`… 都在（p3_deep.md E2），即**旧 skill 目录也保留着**。

**判定**：**已废弃但无害**。`disabled: true` 使整行不挂载；Loader 方言明确 disabled 行「omits required config」不生效。宪法第 5 条（L4288）还专门写了「不回头逐份溯源…已 disabled 的旧预设；历史文本一律不视为现行规则」，即**运行时已显式隔离这些历史文本**。
**建议**：**不必修**。若追求整洁可另建归档 bundle，但当前「保留 config + 一行注释」是刻意的可回滚设计，删了反而失去备份价值。

### D2. 失效引用扫描结果（穷尽）

| 检查项 | patch 命中 | 结论 |
|---|---|---|
| `VN-工作流改造施工文档.md`（字面） | 0 | 无 |
| `VN-工作流改造说明.md`（字面） | 0 | 无 |
| `施工文档` / `改造说明` | 0 | 无 |
| `VN-工作流现行规范.md` | 0 | 无（patch 不引用该文档，符合其「人类可读索引」定位） |
| `:3307` / `:2632` / `:3687` / `第 N 行` / `L####` | 0 | 旧行号已清干净（与现行规范.md L68 一致） |
| `已废弃` | 0 | 无 |
| `三道锁` / `硬门禁` / `禁止出现软词` / `T 块 5 条唯一真源` / `全链双向逐项过` / `提问后不得有任何工具调用` / `末位固定为 ask_user_question` / `旧七步` | **全部 0** | 现行规范.md §6 的「已废止」清单在 patch 中确已落实 |
| `三道门禁` | **1（L5508）** | **唯一残留**，见 A1 |
| `§2.1 / §2.4 / §3.1 ① / §3.0.9.3` | 10 处（G1） | 指向已留档施工文档，见 C5（注释，无害） |
| `config.ts:11,42` | 7 处（G2） | 上游源码行号，见 B3（注释，潜在漂移） |
| 旧阶段 skill 名（`vn-project-bootstrap` 等） | 仅 `vn-design`（disabled）内 10 处（E1） | 已废弃但无害，见 D1 |
| `vn-gate` / `vn-spec` / `vn-continuity` | 14 / 14 / 23 次 | 全部有效：磁盘 `skills/vn-shared/` 下确实有 `vn-gate`、`vn-spec`、`vn-continuity` 三个目录（E2） |
| 「已废弃 skill 名」 | 7 VN 内 0 | 7 VN 只引用 vn-shared 三份 + 本阶段 skill，无失效引用 |

**`instructionFileCandidates` 与 README 索引是否对得上**：README **完全没有** `instructionFileCandidates` / `Specifications.md` / VN 7 的任何索引（B2、B3），所以严格说是「**README 没有可对照的索引**」，不是「对不上」；与 `VN-工作流现行规范.md` 的三根级文档口径有 B3 所述差异。

---

## 五、配置一致性（题目第 5 问）—— 精确结论

**（1）题目点名的 10 个插件在 7 VN 中是否齐全**：`persona` / `agent-instructions` / `tool-ask-user` / `present` / `tool-workflow` / `tool-ralph` / `skill-filesystem` / `compaction` / `delegation` / `tool-todo` —— **7 个 VN 全部齐全，无遗漏**（p3_deep.md B2；`tool-workflow` / `tool-ralph` 在 `delegation` 组内嵌套，其余为顶层行）。

**（2）顶层插件行逐项 diff（p3_extract.md §2 / p3_deep.md B1）**：

| preset | 顶层行数 | 与 vn-bible 差异 |
|---|---|---|
| vn-bible | **21** | 基准；**多 `office-reader`@L4350 + `office-editor`@L4353**（独占） |
| vn-outline | 19 | 少 office-reader / office-editor |
| vn-script | 19 | 同上 |
| vn-asset-list | 19 | 同上 |
| vn-asset-make | 19 | 同上 |
| vn-screenplay | 19 | 同上 |
| vn-game | 19 | 同上 |

- **6 个 VN 完全一致（19 行，顺序也相同）**；`vn-bible` 多 2 行 office 工具，且 **L4349 注释**、vn-bible 的 description L4272、persona L4296 三处都明说「office-reader / office-editor 仅本预设挂载」「本预设独占…挂载权」，`VN-工作流现行规范.md` 表格（L21）也把「四份固定名 `.docx`」列为 vn-bible 独有职责。
- **判定**：这**不是「漏了/多了插件」的配置错误，而是有意的、有文档依据的差异注入**（7 处 office 注释逐字相同，见 C5）。若题目期望「7 个 VN 列表完全一致」，答案是：**除 vn-bible 的 2 行 office 工具外完全一致，该差异是有意的**。
- 反过来，**没有任何 VN 多出第三个 skill dir**（见下）。

**（3）`customSkillDirs`（p3_deep.md B3，精确解析）**：

- 7 个 VN **全部恰好 2 项** = `skills/vn-shared` + 本阶段目录，无第三个、无遗漏：
  - vn-bible **L4360–4362**：vn-shared + vn-bible
  - vn-outline **L4562**：vn-shared + vn-outline
  - vn-script **L4765**：vn-shared + vn-script
  - vn-asset-list **L4968**：vn-shared + vn-asset-list
  - vn-asset-make **L5176**：vn-shared + vn-asset-make
  - vn-screenplay **L5393**：vn-shared + vn-screenplay
  - vn-game **L5591**：vn-shared + vn-game
- 磁盘核对：`skills/vn-shared/` 下确有 `vn-continuity` / `vn-gate` / `vn-spec` 三个 SKILL.md；7 个本阶段目录都存在且各有 skill（E2）。**引用全部有效**。
- 旧 13 各 1 项（自己的 `skills/<id>`），路径均存在。
- **判定**：**完全一致，无需修复**。这也正是 `VN-工作流现行规范.md` L55「锁 1 由配置保证：customSkillDirs 只挂 vn-shared + 本阶段 skill」的落地。

**（4）`instructionFileCandidates` / `projectRootMarkers`**：7 份逐字相同（B3、G7），一致性 OK；与根级三文档口径的轻量差异见 B3。

---

## 六、宪法段自身的矛盾核查（题目第 2 问）—— 逐条判定

7 份宪法段逐字相同，以 vn-bible **L4283–4289** 为代表：

> L4283 【指令裁决 · 本段优先级最高，其余各段与所引 skill 均不得与之冲突】
> L4284 1. …【硬红线】仅三条：① 不跨阶段写入…；② 不创建 6 编号目录 + 3 根级文档白名单之外的文件；③ 不自行把 README 状态置「已确认」。除这三条外，一切流程、步骤、提问与确认节奏均为【默认工作节奏】，可被用户显式指令覆盖。
> L4285 2. 用户本轮指令与【默认工作节奏】冲突时，以用户指令为准，直接执行，无需先提问确认；用户已在同一条消息里写明范围或做法时视为已确认，不必重复提问。可一次性授权「一次做完多个子条目 / 跳过逐轮确认」，按授权节奏执行。
> L4286 3. 用户指令与【硬红线】冲突时，不擅自执行、也不反复自辩：用一句话点明冲突，给「按我说的做（已知悉风险）/ 保持红线」二选一，由用户拍板。
> L4287 4. 引用的 vn-gate / vn-spec / vn-continuity 与本文冲突时，以本文为准；三份 skill 之间冲突时按 vn-gate（流程）> vn-spec（目录与格式）> vn-continuity（核查）执行，不再逐条复述比对。
> L4288 5. 不确定某条规则是否生效时，按本段裁决，不回头逐份溯源旧文档、旧行号或已 disabled 的旧预设；历史文本一律不视为现行规则。
> L4289 6. 措辞以「默认 / 除非用户明确要求」为主，不因未使用绝对化措辞而怀疑规则失效。

| 题目点名的疑点 | 判定 | 理由与证据 |
|---|---|---|
| 「3 条硬红线」第 ② 条 vs「用户指令优先」（第 2 条） | **不冲突（分层自洽）** | 第 1 条先把要求二分为【硬红线 3 条】/【默认工作节奏】；第 2 条的可覆盖范围明确限定为「与【默认工作节奏】冲突时」；第 3 条单独规定「与【硬红线】冲突时」不擅自执行、给二选一由用户拍板。三条各管一层，且第 3 条给了硬红线的合法出口（用户拍板），逻辑闭合。L4284「除这三条外…可被用户显式指令覆盖」是显式例外声明。 |
| 「已写明范围视为已确认」（L4285） vs 「两道确认门」（vn-game） | **宪法内部不冲突；跨段落有张力（并入 A1）** | 「视为已确认」在宪法内只作用于【默认工作节奏】的**本轮范围确认**；「两道确认门」是 vn-game **L5527–5529 的 prefix 段**（规格门/工程门），且 prefix 已写成「默认…用户显式授权跳过时按授权执行」，与宪法第 2 条一致。**真冲突在 description L5508**（「必须先」「只有…才允许」），不在宪法内部。 |
| 「skill 冲突按 vn-gate > vn-spec > vn-continuity」（L4287） vs「本段优先级最高」（L4283） | **自洽（两级优先级，不互斥）** | L4287 是**同一句内**分两层：前半「三份 skill 与本文冲突时，以本文为准」（宪法 > skill），后半「三份 skill **之间**冲突时按 vn-gate > vn-spec > vn-continuity」（skill 内部排序）。L4283 的「本段优先级最高」约束的是「其余各段与所引 skill」，与后半句不重叠。无自相矛盾。唯一瑕疵是 C2 所述**同一优先级声明在 L4305 又写了一次**（冗余，非矛盾）。 |
| 第 6 条「措辞以默认/除非为主」 vs prefix 内仍大量绝对词 | **有轻微张力，但第 6 条已自我豁免** | 7 VN 的 prefix 仍含「不得 / 一律 / 只写 / 只有 / 唯一 / 严禁 / 禁止」（p3_extract.md D4 逐 preset 计数，如 vn-outline「一律=1、严禁=1、唯一=2」），第 6 条明说「**不因未使用绝对化措辞而怀疑规则失效**」，即允许软化措辞不削弱效力；但没说「禁止使用绝对化措辞」，所以不构成矛盾。真正的绝对化残留是 description（A1/A2）。 |

**补充（preset-audit 交叉印证）**：`skills/vn-shared/vn-continuity/SKILL.md` 中仍有一处「效力高于 brainstorm.md、高于各阶段中间稿、高于对话记忆」的「高于」措辞，是共享 skill 层唯一残留的优先级表述；与宪法第 4 条「以本文为准」不冲突（宪法更高），但属于「软化不彻底」，可记一笔（不属本文件范围）。

**结论**：**宪法段 6 条内部自洽，无互斥表述**。题目点名的三处疑点均不成立或已被条文本身化解。唯一实质矛盾在 **description（A1/A2）** 与 **bundle 级两套规则（B1）**。

---

## 七、修复建议汇总（按优先级）

| 级别 | 条目 | 是否需修 | 建议动作 |
|---|---|---|---|
| **A1** | vn-game description L5508「必须先 / 只有…才允许 / 三道门禁」vs 宪法 | **需要** | 改为「默认…用户显式授权可跳过」「两道确认门」，删「三道门禁」；或直接把 description 缩为职责摘要 |
| **A2** | vn-asset-make description L5083「每轮调用前必须用 ask_user_question…未确认禁止调用」vs 宪法 | **需要** | 同 A1，与 prefix L5123「默认…视为已确认，直接执行」对齐 |
| **B1** | 旧 13 的 planning「唯一且最后」vs VN 7 宪法 / 现行规范.md §6「已全部移除」 | **建议（文档优先）** | 二选一：① 现行规范.md §6 改口径为「7 VN 已移除、旧 13 保留」；② 真要统一则瘦身 13 个 planning（工作量大，需评估） |
| **B2** | README 声明 13 个、实际 20 个；L49 又写 12 个；无 VN 7 索引 | **需要（低成本）** | 同步 L3 / L17 / L49 的数字与清单；补 VN 7、`vn-shared`、三根级文档、`instructionFileCandidates` 的说明 |
| **B3** | `instructionFileCandidates` 含 AGENTS.md、缺 Direction.md；7 处 `config.ts:11,42` 旧行号 | **可选** | 统一口径或加注释；源码行号改为不带行号的描述 |
| **C1/C2/C3/C4** | 宪法段 7 份副本、共用引用句、优先级声明重复 2 次、107 行工具行副本 | **不必删 / 可选提取** | 工具行（107 行）是 Loader 要求，保留；宪法/共用引用可抽为共享片段或至少在现行规范.md 标注「7 份逐字副本，改一同步七」；C2 的 L4305 末句可删（7 处同步） |
| **C5** | 7 份 office 注释（6 份是占位）+ §号指向留档施工文档 | **可选** | 6 个无 office 行的 preset 删注释；§号改指现行规范.md |
| **C6** | 旧 13 之间 77 行 delegation / 107 行整段 / 10 处七步 / 6 处范围声明 | **不建议大改** | 历史派生副本，会话互不重叠、3 个已 disabled；如治理优先做校验脚本而非重构 |
| **D1/D2** | 3 个 disabled 旧 VN 预设保留完整 config；旧 skill 目录保留；旧行号已清 | **不必修** | 刻意的可回滚设计，宪法第 5 条已显式隔离历史文本 |

---

## 八、题目六问速答

1. **跨 preset 矛盾**：13 个旧 preset 的 `planning`「exit_plan_mode 唯一且最后」（13 处行号见 B1 表）与 7 VN 宪法（L4285 等）**不会同时作用在同一会话**——每个 preset 只加载自己那套 `config.plugins`；其中 3 个旧 VN 预设还 `disabled: true`。**明确结论：不构成会话内矛盾，但构成 bundle 级规范不一致**（且 `VN-工作流现行规范.md` L62/L64 声称「已全部移除 / 已废止」与 patch 中 13 处仍在，是文档与配置的事实不一致）。另需澄清：「本轮工具调用顺序不设固定末位不变量」只在现行规范.md L43，patch 中 0 命中；「用户指令优先」字面 0 命中，但语义以 L4285/L4286/L4284 进了 7 份运行时 prefix。
2. **宪法段自身矛盾**：**无互斥表述**。3 条硬红线 / 用户指令优先是分层自洽（第 1 条二分、第 2 条只管默认节奏、第 3 条给硬红线拍板出口）；「已写明范围视为已确认」与「两道确认门」在宪法内不冲突（确认门在 vn-game prefix L5527–5529，已写「默认…可跳过」）；「vn-gate > vn-spec > vn-continuity」与「本段优先级最高」是两级优先级，自洽。真冲突在 description（A1/A2）。
3. **重复**：宪法段 **7 份逐字相同**（md5 一致，起点 L4283/4493/4696/4899/5107/5323/5517）——**有意的一致性副本，可提取**；同一 preset 内 prefix 与 suffix（0 个 suffix）/ agent-instructions（纯配置）/ description（0 条逐字重合长句）**不重复同一套规则**，只有 C2 的优先级声明重复 2 次；「按 vn-gate / vn-spec / vn-continuity」按口径为 **7 次（宪法第 4 条整句）/ 7 次（共用规范引用整句）/ 14、14、23 次（三个名字全文）**，详见 C2 表。
4. **失效引用**：两份旧施工文档名、旧行号 `:3307/:2632/:3687`、已废止 skill 名、现行规范.md §6 的 8 项废止措辞在 patch 中**全部 0 命中**（唯「三道门禁」残留 L5508）；仅存 10 处 § 章节号（指向已留档施工文档）与 7 处 `config.ts:11,42`；`vn-shared` 三份 skill 磁盘存在、引用有效。`instructionFileCandidates` 7 份一致，但 **README 没有任何可对照的索引**（README 只讲 13 个旧预设），与现行规范.md 的三根级文档口径有 B3 差异。
5. **配置一致性**：10 个点名插件 **7 VN 全齐**；`customSkillDirs` **7 VN 全部恰好 2 项（vn-shared + 本阶段），无第三个、无遗漏**；**唯一差异是 vn-bible 多 `office-reader`/`office-editor` 两行**（L4350/L4353），且 description、persona、7 份注释、现行规范.md 均有依据 → **有意的差异注入，不是漏/多**。
6. **其他 preset 重复**：20 个 description **两两完全不同（20/20）**，只有模板句复用（11 处「工具集与官方 standard 一致…」、6 处「每轮先声明并确认本轮范围…」）与 2 对高相似（genre-fiction↔novel-writing 0.455、vn-script↔vn-asset-list 0.259）；非 VN preset 之间**有大段逐字重复**：77 行 delegation 组 ×8 份、107 行整段 ×3 份、旧七步 ×11 份、范围声明/范围红线/批量工具纪律各 6–7 份（行号见 C6）。属历史派生副本，优先级最低。

---

## 附：本次生成的分析文件（均为 UTF-8，未修改任何被审文件）

- `Dependency/tmp/agent_preset.md` —— 本报告
- `Dependency/tmp/p3_extract.py` / `p3_extract.md` —— 初轮全量提取（20 preset 范围、字段、插件行、关键词逐行定位 1033 行）
- `Dependency/tmp/p3_deep.py` / `p3_deep.md` —— 精确 YAML 块标量解析、description 去重、插件 diff、宪法段 md5、跨 preset 重复行统计（578 行）
- `Dependency/tmp/p3_final.py` / `p3_final.md` —— §/行号引用、vn-game prefix 全文、agent-instructions 配置、废止措辞残留、README 计数（221 行）
- `Dependency/tmp/p3_blocks.py` / `p3_blocks.md` —— `difflib` 最长公共块的精确行号映射（222 行）
