# 非 VN 系列 Skill 审查报告（自相矛盾 / 重复）

审查对象：`D:\Tools\DeepSeek Harness\Plugins\dsh-user-presets\skills\` 下 12 棵非 VN tree 的**全部**文件。
穷尽范围，无抽样。**未修改任何被审查文件**（只写了本目录的分析脚本与结果文件）。

* 12 棵 tree：`game-design / genre-fiction / language-learning / novel-writing / official-docs / paper-writing / comfyui-work / science-learning / screenplay-writing / social-issues / godot-dev / prompt-writing`
* 文件总数 **113**：SKILL.md **109**、references/*.md **1**、scripts/*.py **2**、agents/*.yaml **1**；合计 615,389 字节，全部按 UTF-8 解码读取（解码替换字符计数 0，未出现乱码）。
* 方法：Python 逐字节 `md5` 分组、逐行 `difflib.SequenceMatcher` / `unified_diff`、归一化段落与长行重复统计、正则交叉引用存在性校验、mtime 比对、以及与 `cordis.patch.yml` 的挂载映射比对。
* 中间证据：`Dependency/tmp/analysis1.json`、`analysis1.txt` ~ `analysis7.txt`。

---

## 0. 先给结论数字

| 指标 | 数字 |
|---|---|
| 逐字节完全相同的文件组 | **11 组 / 24 个文件** |
| 其中 10 组 = genre-fiction ↔ novel-writing 同名 SKILL.md | **10 对 / 20 文件**，全部 0 行差异 |
| spec-common 四份 | **4/4 完全相同**（md5 `7c0ac33e…`，2724 字节，28 行），mtime 全部 `2026-09-12 14:07:25` |
| genre-fiction ↔ novel-writing 的 `novel-project-bootstrap` | **不同**：169 行 vs 162 行，29 行 diff，5 个 opcode 块 |
| 同名但内容不同的 SKILL 名（跨 tree） | **6 组**：`novel-project-bootstrap`(2 变体)、`search-query-craft`(5 变体)、`character-voice`/`continuity`/`research-materials`/`story-bible`/`writing-craft`(各含 screenplay 变体) |
| screenplay-writing ↔ vn-script 同名 | **10/10 全部不同**，无一相同（详见 §5） |
| screenplay-writing ↔ vn-screenplay / vn-staging / vn-design 同名 | **0** |
| 跨文件逐字重复段落（≥80 字符归一化，≥2 文件） | **122 段**；其中 19 段跨 ≥3 棵 tree |
| 跨文件重复长行（≥40 字符，≥3 文件） | **80 行** |
| 非 VN skill 文件内的「最后一个/末位/收尾工具调用必须是某工具」 | **0 处**（该表述只存在于 yml 及 VN 侧 skill） |
| 失效/悬空指向 | **3 处路径**（2 处家族母本路径 + 1 处 comfyui 脚本路径）+ **1 棵孤儿 tree**（`prompt-writing` 9 个 SKILL.md 无 preset 挂载，见 §11b） |
| 与 preset 挂载策略冲突的维护政策 | **1 处**（真矛盾） |

---

## 1. 【真矛盾 · 高】YNC 维护政策与 preset 按 tree 独立加载互斥

**证据**

* `Plugins/dsh-user-presets/cordis.patch.yml:337-338`：
  > `# 共享 novel-writing 的 11 个通用写作 skills（novel-project-bootstrap 另有「开题类型判定」增补，见该 skill 头部；原预设完整保留、一律不动）`
* `cordis.patch.yml:184, 530, 1189`：`customSkillDirs` 分别**只**指向
  `skills/game-design` / `skills/genre-fiction` / `skills/novel-writing` —— 即每个 preset 是**独立加载单棵 tree**，运行时**看不到**另一棵 tree 的 skill。
* 但两份 SKILL.md 互相要求「改动须同时回改」：
  * `genre-fiction/novel-project-bootstrap/SKILL.md:8`：`本文件派生自家族母本 novel-writing/skills/novel-project-bootstrap/SKILL.md … 改动须同时回改母本`
  * `novel-writing/novel-project-bootstrap/SKILL.md:8`：`本文件是家族母本 … 改动须同时回改派生版`
* 同时 yml 明确宣称 `原预设完整保留、一律不动`（L338）——与「改动须同时回改母本」直接冲突：一边禁止改母本，一边要求改母本。

**判定：真矛盾（3 方互斥）**。同一个 `name: novel-project-bootstrap`（两文件 L2 相同）在两棵独立 tree 上各有一份；yml 注释说 genre-fiction「共享」novel-writing 的 skills，但实际是**物理复制**，且两份内容已不同（见 §2），「共享」不成立。

**修复建议**：二选一，不可兼得。
1. 若确实按 tree 独立加载（现状）：**必须保留两份**，删掉「共享」措辞，把 yml L337-338 与两份 L8 改成「同源副本，各自独立演进；修改需人工同步两份并同时更新本说明」；或
2. 若想真正共享：让 `preset-genre-fiction` 的 `customSkillDirs` 同时挂 `skills/novel-writing` 与 `skills/genre-fiction`（需处理同名 skill 覆盖顺序），此时才允许只留一份母本。当前架构下**不能删任何一份**。

---

## 2. 【冗余重复 · 高】genre-fiction ↔ novel-writing 十个 SKILL.md 逐字节相同

脚本穷尽比对（md5 + `SequenceMatcher` 全 opcode），**10/10 完全相同，0 行差异**：

| # | skill | 行数(两树) | 字节 | md5 前 8 | 差异行数 |
|---|---|---|---|---|---|
| 1 | character-voice | 46 / 46 | 2639 | 2356ae48 | 0 |
| 2 | continuity | 55 / 55 | 5248 | 086e492a | 0 |
| 3 | novel-chapter-writing | 88 / 88 | 7101 | 32404bf4 | 0 |
| 4 | novel-outlining | 56 / 56 | 3635 | 92ccfb83 | 0 |
| 5 | novel-revision | 41 / 41 | 3103 | 65cc0e0f | 0 |
| 6 | novel-structure | 72 / 72 | 4186 | 5034b555 | 0 |
| 7 | pov-craft | 78 / 78 | 6111 | a5307294 | 0 |
| 8 | research-materials | 50 / 50 | 2662 | b4c02731 | 0 |
| 9 | story-bible | 92 / 92 | 8344 | 5f355119 | 0 |
| 10 | writing-craft | 69 / 69 | 7819 | bda6b227 | 0 |

mtime 亦几乎一致（10 对均 `2026-10-04 03:14~03:22`，delta ≤1 秒）→ 一次性复制产物，不是独立演进。
这 10 对贡献了 **103 / 122** 段跨文件逐字重复段落（归一化 ≥80 字符，如 `## 检查清单`、`## 修改轮次（每轮只做一件事）`、`## 禁忌`、`## 交付` 等整段）。

**判定：冗余重复**（不是规则冲突——内容相同，不存在互斥要求）。
**但按 preset 独立加载，这 10 对不能单方面删除**：`customSkillDirs` 各指单棵 tree，删掉任一侧会让该 preset 缺 10 个 skill。

**修复建议**：
* 短期：**保留**，但把两树共用的 10 个 SKILL.md 头部加一行「同源副本」声明，避免误以为可以单边修改（现在没有任何声明，最易发生单边改 → 两边规则漂移）。
* 长期：把 10 份抽到 `skills/_shared/`（或 `vn-shared` 式共享 tree），两 preset 都加该目录到 `customSkillDirs`，物理上只留一份；`genre-fiction` 只保留 13 个 `genre-*` + 1 个增补版 bootstrap。这不动语义，只消冗余。

---

## 3. 【真矛盾 · 中】`novel-project-bootstrap` 同名两份、内容不同且互相指认母本

`genre-fiction/novel-project-bootstrap/SKILL.md`（169 行 / 15878 字节 / `c43f3c2a`）vs `novel-writing/novel-project-bootstrap/SKILL.md`（162 行 / 14077 字节 / `c22bea32`）。

精确 diff（`unified_diff` 共 29 行，5 个 opcode 块）：

| opcode | genre 行 | novel 行 | 内容 |
|---|---|---|---|
| replace | 8 | 8 | 互相指认的家族母本声明（措辞相反） |
| replace | 11 | 11 | genre：`先判定作品类型、与用户确认类型/题材/篇幅`；novel：`先与用户确认类型/题材/篇幅`（**无类型判定**） |
| delete | 15-19 | — | genre 独有整节 `## 开题类型判定`（含 13 个 genre skill 加载规则），novel 无 |
| delete | 134-135 | — | genre README 模板多 `类型判定` / `已加载 genre skill` 两字段 |
| replace | 156 | 149 | 执行步骤 1：genre 要求「判定作品类型」并写入 README，novel 无 |

两文件 frontmatter 的 `name`（L2）与 `description`（L3）**完全相同**，但正文对「开题第一步」要求不同：genre 版要求先判定类型再确认，novel 版只要求确认。这构成**同一 skill 名下的规则分歧**（不是硬性互斥，但同一名称两种流程）。

更严重的是 L8 的**悬空路径**（见 §7）：`novel-writing/skills/novel-project-bootstrap/SKILL.md` 与 `genre-fiction/skills/novel-project-bootstrap/SKILL.md` 在磁盘上**都不存在**（真实路径是 `skills/novel-writing/novel-project-bootstrap/SKILL.md`，中间多了 `/skills/`）。

**判定：真矛盾（同名异规则 + 悬空引用）/ 部分属可接受的设计副本**（genre 增补是有意的域内扩展）。
**修复建议**：保留两份（preset 独立加载，且 genre 的 13 个类型 skill 判定不可删），但
1. 修正 L8 为真实相对路径，或直接写「另一棵 tree 的同名 skill」而不写路径；
2. 明确「共性部分若修改，必须同步两份」并给出 diff 基线；
3. 若担心同名混淆，把 genre 版的 `name` 改为 `genre-novel-project-bootstrap`（需同步 yml 描述与 skill 引用）——但这会改变 skill 发现名，谨慎。

---

## 4. 【可接受的设计副本 / 冗余重复 · 需说明】spec-common 四份完全相同

`official-docs/spec-common/SKILL.md`、`paper-writing/spec-common/SKILL.md`、`prompt-writing/spec-common/SKILL.md`、`social-issues/spec-common/SKILL.md`：

* 4/4 逐字节相同：2724 字节、28 行、md5 `7c0ac33ebd526b5e92d951b0d059503e`，mtime 全部 `2026-09-12 14:07:25`。
* 6 组两两组合全部 `IDENTICAL`（脚本穷尽 `itertools.combinations` 验证）。
* 四棵树各自的 `spec-*` 文件在 L8 都写「四节骨架、写法通则与执行要求的纳入方式见 spec-common」，即**本 tree 内自洽引用**（`official-docs/spec-corporate-admin/SKILL.md:8` 等，共 12 处引用，全部落在本 tree 内）。
* `spec-common/SKILL.md:8` 自称「各预设 spec-* 规范集的共用底座」，`L3`「加载任一 spec-* 时必须与本 skill 一并加载」；`:27`「本文件只写跨域共用的部分」。

**判定：可接受的设计副本（按 tree 分发）+ 冗余重复**。原因：`cordis.patch.yml` 中四个 preset 的 `customSkillDirs` 各自只挂本 tree（L1548 / 1915 / 2461? / 3154），**不能跨 tree 解析** `spec-common`，所以每个有 spec-\* 的 tree 必须自带一份。这是「按 tree 独立加载」的必然结果，**不是可以随手删的冗余**。

**但有两处措辞问题（见 §10）**：spec-common L8/§AB 显示 12 个 `spec-*` 文件里都含有「四节骨架」「写法通则」「执行要求（写入」字样，而 spec-common L8 明言「各 spec-* 不重复这些部分」——核对后这些只是**回指引文**（`见 spec-common`）与小节标题，并未复制定义，属**措辞易误读**，不是真冲突。

**修复建议**：**四份必须全部保留**。建议把四份的 L8 补一句「本文件按 tree 分发，四棵树各持一份相同副本；修改需四处同步」，并在 yml 里加注释说明，防止单边修改造成 4 份漂移。若要彻底消除，需引入共享 `customSkillDirs`（同 §2 长期方案）。

---

## 5. 【真矛盾 · 高】screenplay-writing 与 vn-script 10 个同名 skill 全部不同，且规则硬互斥

`screenplay-writing` 全部 10 个 skill 名 **100% 与 `vn-script` 重叠**（脚本 `set` 交集验证），但 **10/10 内容不同**（0 个相同），diff 规模 114–214 行/对：

| skill | screenplay 字节 | vn-script 字节 | 变更块 | 关键互斥 |
|---|---|---|---|---|
| character-voice | 2219 | 10707 | 8 | SP：`维护 character-voices.md`；VN：`不另建声音档案`、只读 `00-Bible/` |
| continuity | 5241 | 13348 | 11 | SP：`00-设定/anchors.md`；VN：`00-Bible/anchors.md` + `01-Plan/` 只读 |
| research-materials | 2462 | 10899 | 4 | SP：`记入 00-设定/inspirations.md`；VN：`旧值 00-设定/inspirations.md 不创建、不写入、不引用为事实源` |
| story-bible | 7277 | 11368 | 17 | SP：`建立与维护设定集 / 00-设定/`；VN：`禁止写入 00-Bible/、禁止自创设定`、只读上游 |
| writing-craft | 6848 | 13821 | 10 | SP：通用方法论；VN：`只读 00-Bible/style.md 与 Specifications.md ③节` |
| vn-script-format | 9667 | 16152 | 214 diff 行 | SP：`02-剧本/`；VN：`旧值 02-剧本/ 不作为产出落点、不创建、不写入`，统一 `02-Script/` |
| vn-script-outline | 2939 | 11285 | 126 | SP：抽象大纲禁止场景/台词；VN：`写死 02-Script/剧情精述.md 与 scene-list.md` |
| vn-script-project-bootstrap | 11566 | 12097 | 206 | SP：`00-设定/01-规划/02-剧本/03-修订`；VN：**逐一点名禁止创建这些目录**，`写死 6 个编号目录 00-Bible/…/05-Game/` |
| vn-script-revision | 2515 | 11756 | 115 | SP：`03-修订/revision-log.md`；VN：`不写 03-修订/revision-log.md、continuity-log.md`，并入 README |
| vn-script-structure | 3413 | 11179 | 123 | SP：`拍板后写入 structure.md`；VN：`只读 01-Plan/ 三份规划文档，不落盘` |

**判定：真矛盾（硬互斥）**——「禁止写 × 必须写」「必须先建 A 目录 × 禁止创建 A 目录」「记入 X × X 不作为落点」在同一 skill 名下成对出现。
**缓解事实**：二者在**运行时互不加载**。`cordis.patch.yml:2800` 把 `preset-screenplay-writing` 挂到 `skills/screenplay-writing`；`preset-vn-script`（L4765-4767）挂的是 `vn-shared` + `vn-script`，**不挂 screenplay-writing**。因此不会在同一会话里同时生效，属「两代实现并存」。

**修复建议**：
* 若 `screenplay-writing` 是**已废弃的旧版**（其目录 `00-设定/02-剧本/03-修订` 正是 vn-script 明令禁止的「旧值」），建议**整树删除或归档**（改名为 `screenplay-writing-legacy` 并从 yml 移除 preset），同时删 `preset-screenplay-writing`；这是最干净的消歧。
* 若仍需保留两套：必须给两边加显式「本预设/本代际」标注与 yml 注释说明互斥关系，并把 skill 名改名（如 `vn-legacy-*`），避免同名不同规则。
* **不能**只删其中一份而不动 yml（会丢 preset 的 skill 集）。

（附带：`vn-screenplay` 与 `vn-staging` 另有 8 个同名 `staging-*` 文件全部不同、0 相同，diff 10–17 块；这属于 VN 系列，超出本次范围，仅备查。）

---

## 6. 【末位工具调用门禁】——核实结论：非 VN skill 文件内 0 处

对 113 个非 VN 文件全量正则扫描（模式含 `最后一个.{0,12}工具` / `末位.{0,12}工具` / `收尾.{0,12}工具` / `唯一且最后` / `最后.{0,6}工具调用` / `exit_plan_mode` / `ask_user_question` / `plan mode` / `计划模式` / `收尾调用` 等）：

* **非 VN 的 109 个 SKILL.md + 4 个附属文件中，「最后一个/末位/收尾工具调用必须是某工具」= 0 处，`exit_plan_mode` = 0 处，`plan mode/计划模式` = 0 处。**
* 唯一命中的是 `ask_user_question` 的**正常使用**（非门禁）：`language-learning/language-teaching-flow/SKILL.md` L3/83/87/102/107/132/135（7 处）、`science-learning/science-teaching-flow/SKILL.md` L3/68/90/118/120/130/132（7 处）。

**门禁实际位置（在本次范围外的 `cordis.patch.yml`）**：

* 当前 `cordis.patch.yml`：`exit_plan_mode` 共 39 处；`唯一且最后` 共 **13 处**，分布在 13 个非 VN + vn-design/vn-staging presets 的 plan-mode `section` 中（L219 / 565 / 885 / 1224 / 1583 / 1950 / 2182 / 2496 / 2835 / 3189 / 3500 / 3921 / 4148）。原文：
  > `让 exit_plan_mode 成为该回复中唯一且最后的工具调用`
* 当前 `cordis.patch.yml` 中 `最后一个工具调用必须是 ask_user_question` = **0 处**（该门禁已被移除）。
* 历史备份中二者**曾同时存在**（真矛盾，现已修复，备查）：
  * `cordis.patch.yml.bak-20261107-VN-order` 与 `cordis.patch.yml.bak-before-scope-guard`：`最后一个工具调用必须是 ask_user_question` 各 **13 处**，`唯一且最后` 各 **20 处**；脚本按 preset 分段核对，**7 个 preset 同一段内同时含两种互斥末位门禁**（`preset-vn-bible` L4203、`vn-outline` L4487、`vn-script` L4760、`vn-asset-list` L5030、`vn-asset-make` L5295、`vn-screenplay` L5554、`vn-game` L5852），即「最后一个工具必须是 exit_plan_mode」×「最后一个工具必须是 ask_user_question」。
  * `cordis.patch.yml.bak`：13 处 `唯一且最后`、0 处 ask 门禁。
* `skills/vn-shared/vn-gate/SKILL.md:37`（VN 侧，范围外）已显式澄清：
  > `本轮的工具调用顺序没有「最后一个必须是某个工具」的硬不变量`

**判定：措辞 / 历史遗留（当前已消解）**。当前非 VN 范围内不存在该矛盾；但 `唯一且最后` 在 13 个 preset 中各出现 1 次属**逐字重复的整段规则**（plan-mode section 13 份，脚本提取出 4 种文本变体，其中 8 份完全相同、2 份完全相同）。

**潜在（非硬）措辞张力**：`cordis.patch.yml:215`「ask_user_question 只用于用户自己拥有的选择或查看无法回答的重大歧义」与多个 bootstrap 的「没有规范 → 停下询问，给三个方向由用户选」（如 `genre-fiction/novel-project-bootstrap/SKILL.md:24`）并存；plan-mode 下要求「不要用散文或 ask_user_question 问要不要开始」（L219），而 skill 要求「与用户确认」。二者可通过「plan mode 下把确认结果并入方案、由 exit_plan_mode 统一提交」调和（L211 已写明），**不算真矛盾**，但建议在 bootstrap 里加一句「规划模式下按 plan-mode 段执行」以免执行时打架。

---

## 7. 【失效引用 / 悬空指向】3 处

| # | 文件:行 | 引用 | 核实 |
|---|---|---|---|
| 1 | `genre-fiction/novel-project-bootstrap/SKILL.md:8` | `` `novel-writing/skills/novel-project-bootstrap/SKILL.md` `` | **不存在**。真实为 `skills/novel-writing/novel-project-bootstrap/SKILL.md`（中间多了 `/skills/`）。脚本对 3 种根路径逐一 `os.path.exists` 均为 MISSING |
| 2 | `novel-writing/novel-project-bootstrap/SKILL.md:8` | `` `genre-fiction/skills/novel-project-bootstrap/SKILL.md` `` | **不存在**，同上 |
| 3 | `comfyui-work/moss-image-guide/SKILL.md:65` | `python Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/scripts/compile_prompt.py` | 相对工作目录 `D:\Tools\DeepSeek Harness` 时**不存在**（拼成 `…/Plugins/dsh-user-presets/Plugins/dsh-user-presets/…`）；脚本真实位于 `skills/comfyui-work/moss-image-prompt-enhancer/scripts/compile_prompt.py`。同文件 L53-55 引用的 `skills/moss-image-prompt-enhancer`（上游仓库路径）与 `Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/`（正确绝对路径）则存在 |

**其它核实为「非失效」的疑似项**：
* `official-docs/official-doc-bootstrap/SKILL.md:17` 的 `spec-govt-gbt9704` 是脚本正则截断 `9704` 造成的假阳性（`spec-govt-gbt`），实际目录存在（`AF` 段复核）。
* `paper-writing/academic-drafting/SKILL.md:119` 的 `L007`、`literature-review/SKILL.md:34` 的 `L001`、`paper-outline/SKILL.md:42/67` 的 `L003/L012` 是**文献编号占位符**，不是行号引用。
* `prompt-writing/dsh-preset-craft/SKILL.md:31/70/85/86/119` 的 `skills/<preset-id>/<skill-name>/SKILL.md` 与 `D:/Tools/.../skills/<preset-id>` 是**模板占位符**，非悬空。
* `comfyui-work/moss-image-prompt-enhancer/SKILL.md:82`「beside this SKILL.md」为相对定位说明，正确。
* **交叉引用存在性全量校验（AA 段）**：12 棵非 VN tree 内，所有「见/调用/加载/按/对照 + skill 名」的引用**全部落在本 tree 内，0 处悬空**；`genre-fiction/novel-project-bootstrap` 中列出的 13 个 `genre-*` 与磁盘 13 个目录**一一对应，0 缺失 0 多余**（J 段）。`spec-*` 引用除上述假阳性外 0 缺失（K 段）。

**判定：失效引用（3 处，均措辞/路径书写问题）**。
**修复建议**：改成不含 `/skills/` 中缀的相对路径；comfyui 命令改用相对于工作区根的 `Plugins/...` 之外的一致性写法，或干脆写「从 skill 目录定位脚本」（其 SKILL.md L82 已有此说明）。

---

## 8. 【重复段落 / 跨 tree 逐字重复】122 段 + 80 行

归一化（空白折叠）后 ≥80 字符的段落，出现在 ≥2 个不同文件：**122 段**；≥3 棵不同 tree：**19 段**。分组：

| 来源 | 段数 | 说明 |
|---|---|---|
| genre-fiction ↔ novel-writing 10 对相同文件 | **103** | §2 的直接后果，整段逐字重复 |
| `search-query-craft` 5 份 | **7** | 方法论主体逐字相同，仅 L8-10 序言不同（见 §9） |
| screenplay 家族（含 vn 对照） | **6** | 如「汉语语感与反翻译腔」「情感节奏」「参考与致敬边界」在 3 份 writing-craft/research-materials 中逐字相同 |
| 其它跨 tree | **6** | 主要是 7 个 bootstrap 共用的 `- 全部文件使用 Markdown、UTF-8 编码，标题层级从 # 开始。`（**7 个文件**逐字相同，见下） |
| spec-common 4 份 | 计入 122 中的 4 份组 | 6 个整段 ×4 份 |

重复长行（≥40 字符、≥3 文件）**80 行**，典型：
* `- 全部文件使用 Markdown、UTF-8 编码，标题层级从 # 开始。` → **7 个文件**：`game-design/game-project-bootstrap`、`genre-fiction/novel-project-bootstrap`、`novel-writing/novel-project-bootstrap`、`official-docs/official-doc-bootstrap`、`paper-writing/paper-project-bootstrap`、`prompt-writing/prompt-project-bootstrap`、`social-issues/social-project-bootstrap`（`analysis1.txt:325-326`）。
* `- 接手已有项目但缺 README.md 时：先按本 skill 模板补建…` → 4 个 bootstrap 逐字相同（`analysis1.txt:379-380`）。
* `description: 搜索词联想构建（通用方法论…）` 及 5 个维度条目、构建纪律、注意事项 → **5 份 search-query-craft 逐字相同**（`analysis1.txt:327-368`，共 20+ 行）。
* spec-common 的 `> 用途：…`、`## 写法通则`、`## 四节骨架`、`## 注意事项` → 4 份逐字相同（`analysis1.txt:176-187`）。

**判定：冗余重复**（不是矛盾——没有互斥内容）。
**修复建议**：同 §2/§4，靠「共享 skill 目录 + 单份母本」消除；在按 tree 独立加载的约束下**这些副本都必须保留**，只能加「同源副本，修改需 N 处同步」声明。

---

## 9. 【可接受的设计副本 + 冗余】`search-query-craft` 5 份

5 份互不相同的 md5（`a916747e / 5b14b631 / 2519e278 / 325eace0 / 5d1cfd01`），但脚本穷尽 diff（以 `game-design` 50 行为基线）显示：**每份只有 1 个变更块**，精确位于 **L8-L10 → L8-L9**，其余 **47 行逐字相同**：

| tree | 行数 | 差异 |
|---|---|---|
| game-design | 50 | 基线：L8 场景、L9 本域补充维度、L10 纪律与归档（3 行） |
| official-docs | 49 | L8 场景改公文、L9 纪律改「依据材料与检索纪律」；**删掉 L9 的补充维度行** |
| paper-writing | 49 | 同上，改论文/文献 |
| prompt-writing | 49 | 同上，改提示词工程 |
| social-issues | 49 | 同上，改社会议题 |

**判定：可接受的设计副本（按 tree 分发）+ 冗余重复**。方法论主体 47/50 行完全相同，仅 2-3 行域内序言不同，是**有意的按 preset 定制**，且各 tree 只能加载自己的那份，**必须全部保留**。
**措辞问题**：5 份的 `description`（L3）**逐字相同且自称「通用方法论，适用于任何需要联网检索的场景」**，与文件内「本预设场景（xxx）」的域内限定并列，容易让人误以为可以合并成一份共享 skill。建议 description 补「按 preset 分发的副本」或把域内差异写进 description。

---

## 10. 【措辞 / 轻微自相矛盾】其它核实项

1. **`spec-common/SKILL.md:8` 与 12 个 `spec-*` 文件的措辞张力**：spec-common 说「各 spec-* **不重复**这些部分」，但脚本（AB 段）显示 12 个 `spec-*` 文件**全部**含有「四节骨架」「写法通则」「执行要求（写入」字样。逐行核对（如 `official-docs/spec-corporate-admin/SKILL.md:8`）后确认这些是**回指引文**（`见 spec-common`）与**小节标题 ①②③④**，并未复制定义文字 → **不是真冲突，属措辞易误读**。建议把 spec-common L8 改成「各 spec-* 不重复**本文件的定义文字**，只在需要时引用」。

2. **同一 bootstrap 文件内「不再询问」×「停下询问」**（`game-design/game-project-bootstrap/SKILL.md:17-18`、`genre-fiction/novel-project-bootstrap/SKILL.md:23-24`、`novel-writing/…:18-19`、`official-docs/…:16-17`、`paper-writing/…:16-17`、`prompt-writing/…:17-18`、`social-issues/…:16-17`，共 7 处）：脚本 E 段把它们标为 POS/NEG 同时命中，但逐行核实是**同一条件分支的两行**（「存在且完整 → 不再询问」/「没有、不全或冲突 → 停下询问」），**条件互斥，不是矛盾**。→ **措辞**（建议加「若/否则」连接词消除机器与人工误判）。

3. **`genre-fiction/continuity/SKILL.md:39-40`（及 novel-writing 副本）**：L39「正文未经用户确认 → 以 anchors 为基准**修改正文**」× L40「冲突涉及已确认内容 → **不得自行改写**，请用户裁决」。逐行核实为「未确认/已确认」两种情形分流 → **不是矛盾，措辞**。

4. **`science-learning/science-teaching-flow/SKILL.md` 的 ask_user_question 纪律**：L3/L68/L90/L118/L120/L130/L132 共 7 处，看似「严禁滥用」×「使用」并存，但 L120 明确限定为三类高价值场景、L118 禁止机械弹窗 → **条件分层清晰，不是矛盾**。同类 `language-learning` 7 处亦为正常使用。→ **措辞**（L3 description 里「非引导学习严禁推荐选项」与 L91/L124「引导学习时允许推荐引导选项」为显式例外，非矛盾）。

5. **`genre-fiction/novel-project-bootstrap/SKILL.md:11` × `:17` × `:156`**：L11「先判定作品类型、**与用户确认**类型/题材/篇幅，再执行本 skill」、L17「与用户确认作品名…**之前**，先判定作品类型」、L156「判定作品类型…并与用户确认…」。三处对「判定/确认/执行」的先后表述不完全一致（L17 说判定在确认之前，L11 把「判定+确认」都放在「执行 skill」之前），但都在「执行本 skill 之前」这一层，**不构成硬互斥** → **措辞**。建议统一为「① 判定类型 → ② 与用户确认 → ③ 执行」。

6. **「必须先读 A × 必须先读 B」全量扫描（G 段）**：`paper-writing/paper-project-bootstrap/SKILL.md` 有「双根文档：README.md + 文献综述进度.md，两者每轮都要先读」（L30/31/46/100），是**有意的双入口**，不是互斥；`language-learning`/`science-learning` 的「每轮先读 README.md 与 当前学习进度.md」同理；各 bootstrap 的「最先创建 README / 每轮先读 README」与「开工第一步先执行开工规范检查并落盘 规范-XX.md」（`language-learning:44`、`science-learning:38`）在「第一步」上略有叠床架屋，但前者是**文档入口**、后者是**规范检查**，可并存 → **措辞**，建议明确「第一步=规范检查；随后按 README 入口」。

7. **VN 侧（范围外，备查）**：`vn-shared/vn-gate/SKILL.md:37` 明确否定「最后一个工具必须是某工具」的硬不变量，与当前 yml 的 13 处 `唯一且最后` 措辞形成**潜在张力**（后者限定在 plan-mode 的「该回复中」，前者限定在 VN 的「本轮」），作用域不同，非硬矛盾。`vn-bible/*` 6 个文件引用 `vn-spec`/`vn-gate`（AA 段标为 missing-in-tree），但 yml L4361 把 `vn-shared` 与 `vn-bible` 一起挂给 `preset-vn-bible`，**运行时可解析**，非悬空。

---

## 11. 按严重度汇总与修复清单

| 级别 | 标注 | 条目 | 位置 | 关键数字 | 修复 |
|---|---|---|---|---|---|
| 高 | **真矛盾** | 维护政策 vs 按 tree 独立加载 | `cordis.patch.yml:337-338` / 两份 `novel-project-bootstrap/SKILL.md:8` | 3 方互斥；`customSkillDirs` 各挂单 tree | 保留两份，删「共享」措辞，改「同源副本需同步」；或引入共享目录后合并 |
| 高 | **真矛盾** | screenplay-writing 与 vn-script 同名异规则（禁止写×必须写等） | 10 个同名 SKILL.md，见 §5 表 | 10/10 不同，114–214 diff 行/对，0 相同 | 旧树归档/删除并移除 `preset-screenplay-writing`；或改名加代际标注 |
| 高 | **冗余重复** | 10 对逐字节相同 SKILL.md | genre-fiction ↔ novel-writing | 10 对 20 文件，0 行差异，贡献 103/122 重复段 | **不能删**（独立加载）；加同源声明，长期抽 `_shared` |
| 中 | **真矛盾** | `novel-project-bootstrap` 同名两份不同 + 互相指认母本 | §3 | 169 vs 162 行，29 diff 行，5 opcode | 保留两份，修 L8 路径，明确同步纪律；可考虑改名 |
| 中 | **失效引用** | 3 处悬空路径 | §7 | 2 处 `/skills/` 中缀 + 1 处 comfyui 命令 | 改相对路径/统一脚本定位写法 |
| 中 | **失效引用 / 冗余** | `prompt-writing` 整树无 preset 挂载 | §11b / `cordis.patch.yml` 全 20 个 preset | 12 棵树中 11 棵被挂载，9 个 SKILL.md 永不被加载；README.md:3/17 的「13 个预设」与当前 20 个不符 | 补 `preset-prompt-writing`，或把整树移出 `skills/` 定位为文档库 |
| 中 | **可接受的设计副本** | spec-common 四份相同 | §4 | 4/4 md5 相同，2724B，28 行，同 mtime | **其中 3 份必须保留**；第 4 份（prompt-writing）随 §11b 处置；加「四处同步」声明 |
| 中 | **可接受的设计副本 + 冗余** | search-query-craft 五份 | §9 | 47/50 行相同，仅 L8-10 不同 | **必须全部保留**；description 补「按 preset 分发」 |
| 低 | **冗余重复** | 122 段 / 80 行跨文件逐字重复 | §8 | 19 段跨 ≥3 tree；7 文件共用一行 UTF-8 纪律 | 同 §2/§4，靠共享目录消除 |
| 低 | **措辞** | 末位工具门禁 | §6 | 非 VN skill 内 **0 处**；当前 yml 13 处 `唯一且最后`、0 处 ask 门禁；两个历史备份中 7 个 preset 曾同时含两种互斥门禁 | 当前无需改；清理/归档旧 `.bak`，或在备份加「已废弃」标记 |
| 低 | **措辞** | 条件分支被误读为矛盾、spec-common「不重复」、bootstrap「第一步」叠加 | §10 | 7 处「不再询问/停下询问」、12 处 spec 回指 | 加「若/否则」「定义文字」「第一步=规范检查」等限定词 |
| 低 | **措辞** | plan-mode `唯一且最后` 13 份逐字重复 | §6 | 4 种文本变体，8+2 份完全相同 | 抽成共享 section 片段（若 yml 支持引用）或保留并注明同源 |

## 11b. 【失效引用 / 冗余 · 中】`prompt-writing` 整树无 preset 挂载（孤儿 tree）

穷尽核对 `cordis.patch.yml` 的 20 个 `preset-<id>` 与全部 `customSkillDirs`（`ops_grep` 全量 73 命中）：只有 **11 棵非 VN tree 被挂载**——L184 `game-design`、L530 `genre-fiction`、L850 `language-learning`、L1189 `novel-writing`、L1548 `official-docs`、L1915 `paper-writing`、L2151 `comfyui-work`、L2461 `science-learning`、L2800 `screenplay-writing`、L3154 `social-issues`、L4117 `godot-dev`。

**`skills/prompt-writing/`（9 个 SKILL.md）没有任何 `preset-*` 引用，也没有任何 `customSkillDirs` 指向它**：全目录 `grep 'prompt-writing|preset-prompt'` 仅 20 命中，其中 yml 里的 4 处（L30 / 1348 / 1708 / 2955）都只是**注释里列举「共用同一母本」的兄弟 tree 名**，不是挂载；`README.md:53` 与 `skills/prompt-writing/dsh-preset-craft/SKILL.md:54` 也只是把该 tree 当作「规范文档」引用。README.md:3-4 自称 13 个预设、L17 称 `cordis.patch.yml` 含 13 个 `preset-<id>` 声明，但当前 yml 实为 **20 个**（13 个非 VN/VN 基础 + 7 个 VN 阶段），且其中不含 prompt-writing。

由此产生两处派生问题：
* `prompt-writing/spec-common/SKILL.md`（§4 的四份之一）与 `prompt-writing/search-query-craft/SKILL.md`（§9 的五份之一）**永不被任何会话加载** → 这 2 份是**纯冗余 / 死副本**（其余 3 份 spec-common、4 份 search-query-craft 仍必须保留）。
* `prompt-writing/dsh-preset-craft/SKILL.md` 被 `README.md:53` 指定为「改 preset 时遵循的规范」，但它**不在任何 preset 的 skill 目录里**，模型在 prompt-writing 会话中无法通过 skill 工具加载它；只能靠人手动读文件。

**判定：失效引用 / 冗余重复（孤儿 tree）**。
**修复建议**：二选一 —— ① 补一个 `preset-prompt-writing`（并 `customSkillDirs: …/skills/prompt-writing`，含 `dsh-preset-craft` 等 9 个 skill），同时更新 README 的「13 个预设」计数；或 ② 明确把 `prompt-writing/` 定位为「文档/母本库」而非 preset 随身 skills，移出 `skills/`（例如放到 `Archive/` 或 `docs/`），并删掉 README/y ml 注释里把它当作已挂载兄弟的措辞。在 ② 之前**不要删**该 tree 的文件（README 仍引用它）。

---

### 必须保留（因为 preset 按 tree 独立加载）

`cordis.patch.yml` 的 `customSkillDirs` 证据：L184 `skills/game-design`、L530 `skills/genre-fiction`、L850 `skills/language-learning`、L1189 `skills/novel-writing`、L1548 `skills/official-docs`、L1915 `skills/paper-writing`、L2151 `skills/comfyui-work`、L2461 `skills/science-learning`、L2800 `skills/screenplay-writing`、L3154 `skills/social-issues`、L4117 `skills/godot-dev`（以及 VN 各 preset 挂 `vn-shared` + 本阶段 tree）。**每个被挂载的非 VN preset 只挂自己一棵 tree**；`prompt-writing` 是例外（无挂载，见 §11b）。因此：

1. genre-fiction 的 10 份「相同」SKILL.md —— 删了 preset 就缺 skill；
2. novel-writing 的 10 份「相同」SKILL.md —— 同上；
3. `spec-common` 中被挂载的 3 份（official-docs / paper-writing / social-issues）—— 每个含 spec-* 且已挂载的 tree 必须自带；第 4 份（prompt-writing）见 §11b；
4. `search-query-craft` 中被挂载的 4 份 —— 各 tree 的域内序言不同；第 5 份（prompt-writing）见 §11b；
5. `genre-fiction` 与 `novel-writing` 两份 `novel-project-bootstrap` —— 前者含 13 个 genre skill 判定，不可合并；
6. `screenplay-writing` 整树 —— 若不删 `preset-screenplay-writing` 就必须保留（但见 §5，建议连同 preset 一起归档）。

### 可以删 / 建议删

* 两份 `novel-project-bootstrap` L8 里的**错误路径字符串**（不是删文件，是改字）；
* `comfyui-work/moss-image-guide/SKILL.md:65` 的错误命令前缀；
* 历史备份 `cordis.patch.yml.bak-20261107-VN-order`、`cordis.patch.yml.bak-before-scope-guard` 中**已被修复的 ask 末位门禁**（若保留备份，至少标注「已废弃，勿回滚」；当前 `cordis.patch.yml` 中该门禁已是 0 处）；
* 若确认 `screenplay-writing` 为旧代际：整树 + `preset-screenplay-writing`（这是唯一一处「可整树删」的候选，但必须先确认没有会话仍在使用该 preset）。

---

## 12. 复核方式与可复现性

```bash
cd "D:/Tools/DeepSeek Harness"
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn.py   # → analysis1.txt/.json  md5分组、重复段
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn2.py  # → analysis2.txt  跨tree同名、门禁、引用
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn3.py  # → analysis3.txt  矛盾扫描、悬空引用
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn4.py  # → analysis4.txt  逐行diff、yml门禁分段
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn5.py  # → analysis5.txt  序言行号、plan-mode变体
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn6.py  # → analysis6.txt  路径存在性、互斥规则、备份分段
PYTHONIOENCODING=utf-8 python Dependency/tmp/analyze_nonvn7.py  # → analysis7.txt  引用全集、mtime、重复统计
```

所有结论均基于上述脚本输出；被审查的 113 个文件**未被写入或修改**。
