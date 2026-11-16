# VN 系列 skill 审查报告（自相矛盾 / 重复 / 单一真源 / 失效引用 / 降权）

审查范围：`Plugins/dsh-user-presets/skills/` 下 55 份 SKILL.md
- vn-shared（3）、vn-bible（6）、vn-outline（3）、vn-script（10）、vn-asset-list（2）、vn-asset-make（4）、vn-screenplay（8）、vn-game（3）、vn-design（8）、vn-staging（8）
读取方式：全部以 UTF-8 逐行读取，行号为本报告证据中的 `文件:行号`。

> 路径缩写约定（下列证据用短名，完整路径 = `Plugins/dsh-user-presets/skills/` + 短名）：
> `vn-shared/vn-gate/SKILL.md` → `gate`；`vn-shared/vn-spec/SKILL.md` → `spec`；`vn-shared/vn-continuity/SKILL.md` → `cont`
> `vn-bible/*/SKILL.md` → `bible-xxx`；`vn-outline/*/SKILL.md` → `outline-xxx`；`vn-script/<子>/SKILL.md` → `script/<子>`
> `vn-asset-list/<子>/SKILL.md` → `asset-list/<子>`；`vn-asset-make/<子>/SKILL.md` → `asset-make/<子>`
> `vn-screenplay/<子>/SKILL.md` → `screenplay/<子>`；`vn-game/<子>/SKILL.md` → `game/<子>`
> `vn-design/<子>/SKILL.md` → `design/<子>`；`vn-staging/<子>/SKILL.md` → `staging/<子>`

严重度分级：**A 真矛盾 > B 末位门禁 > C 重复 > D 失效引用 > E 措辞/降权**。
每条末尾给出【修复建议】。

---

## 0. 体系划分（重要前提）

用户提示指出 `vn-design/*` 与 `vn-staging/*` **不加载 vn-shared，是另一套体系**。审查证实：
- 新体系（vn-shared + 7 棵阶段树）：统一「6 编号目录 + 3 根级文档」、`00-Bible/ 01-Plan/ 02-Script/ 03-Asset/ 04-ScreenPlay/ 05-Game/`、README 双区状态机、七步循环 `Read→Report→Confirm→Do→Check→Write→Stop`、单一规范事实源 `Specifications.md`。
- 旧体系 A（vn-design）：`00-设定/ 01-规划/ 02-系统/ 03-修订/ 04-资产/`、六阶段、`规范-视觉小说设计.md`、`03-修订/continuity-log.md`、`00-设定/anchors.md`。
- 旧体系 B（vn-staging）：`05-剧本/ 06-演出/`、`assets/`、`规范-剧本.md` / `规范-演出.md`、`06-演出/资产索引.md`、`资产缺口.md`、`制作计划.md`、`总体说明.md`、`交付说明.md`。

**关键结论**：旧体系 A/B 与新体系描述的是**同一视觉小说工作流（设定→大纲→剧本→资产→演出）**，但目录、事实源、状态机、核查范围、交付物规则**全部不同且互斥**。新体系的每一份阶段 skill 都在文末写了「旧值 / 迁移对照 / 不」把这些旧路径声明为废弃，却**没有把 vn-design / vn-staging 这两棵树本身禁用或删除**——它们仍是并列存在的 skill 目录。这正是「单一真源被破坏」的最大来源，详见 A-8、C-5。

---

# A. 真矛盾（互斥要求）— 最高严重度

## A-1 ★ 末位工具调用：vn-shared 明确否定「最后一个必须是某工具」，vn-script 10 份文件却强制「以 ask_user_question 收尾」

这是本次审查**最硬的一组矛盾**，也是审查维度 1 与维度 2 的交点。

- `gate:35-37`（§2 收尾与提问）原文：
  - `gate:37`：「Confirm 与 Stop 可用 `ask_user_question`，但**本轮的工具调用顺序没有「最后一个必须是某个工具」的硬不变量**；报告、交付（`present`）、README 状态登记都是正常步骤，按实际需要安排。」
  - `gate:38`：「「README 状态登记」与「成果交付」的时点：默认在**下一轮 Read 之前**完成，也可在本轮 Stop 之前完成；两者都不属于「提问之后禁止的动作」，不存在时序矛盾。」
- 但 `script/*` 10 份文件的「七步循环」段**逐字重复**了一句相反的话（以 `script/vn-script-project-bootstrap:62` 为样本）：
  - 「……Write 只写本子条目声明的产出文件并同步更新 `README.md` 双区；**Stop 应停下、列出下一候选子条目并以 `ask_user_question` 收尾**。」
  - 逐字命中文件与行号（全部 10 份，措辞完全一致）：
    - `script/vn-script-project-bootstrap:62`、`script/vn-script-outline:61`、`script/vn-script-structure:57`、`script/vn-script-format:104`、`script/vn-script-revision:64`、`script/continuity:74`、`script/character-voice:57`、`script/story-bible:57`、`script/research-materials:57`、`script/writing-craft:77`
- 冲突实质：「没有末位硬不变量」×「Stop 必须以 ask_user_question 收尾（末位硬不变量）」。后者把 `ask_user_question` 钉死为**每轮最后一个工具调用**，且 Write 之后的 README 登记被排在提问之前，与 `gate:37` 的「报告/交付/present 都是正常步骤，按实际需要安排」互斥。
- 顺带：`gate:39` 说「两组常用选项（**可按需选用，不必互斥套用**）」；而 `screenplay/*` 8 份文件却写「Confirm / Stop 两组 `ask_user_question` 选项**不跨组套用**」（`screenplay/staging-project-bootstrap:45`、`staging-draft-format:64`、`staging-direction:50`、`staging-cues:48`、`staging-continuity:62`、`staging-gap-triage:44`、`staging-asset-audit:48`、`staging-acceptance:62`）。「不必互斥套用」×「不跨组套用」是同一规则的正反表述，`screenplay/staging-acceptance:62` 与 `staging-cues:48` 甚至把两组选项内容逐字抄了进去，等于把 gate 的「可按需选用」改成「两组必须分开」。
- 【修复建议】**必须修复**。二选一：① 删除 `script/*` 10 份里「以 `ask_user_question` 收尾」，改为「Stop 停下并报告，工具顺序按实际需要安排（见 `vn-gate` §2）」；② 若确实要保留末位门禁，则必须**同时改写 `gate:37`、`gate:38`、`gate:8`（「不是绝对门禁」）、`cont:61`**，否则与宪法级声明直接打架。推荐方案 ①。同时统一「选项是否跨组套用」的措辞。

> 区分：`design/*` / `staging/*` 也在用 ask_user_question、也有「停下询问」，但**没有**任何「最后一个/末位/收尾必须是某工具」的措辞（全树 grep `最后|末位|收尾|最后一个必须` 仅命中 `gate:37` 的否定句、`design` 无、`staging` 无）。所以「末位门禁」矛盾只在 vn-script 树内部产生，不是跨体系差异。

## A-2 ★ 核查范围：vn-shared 禁「全链全量体检 / 顺手改文件」，vn-script/continuity 与 vn-design 却要求「全量核查 / 就地修正」

- `cont:8`：「本 skill 只做一件事：在 `vn-gate` 的 **Check** 步，针对**本轮那 1 个子条目**做一致性核查。**不探测下游、不做全链全量体检，也不是「顺手改文件」的授权**。」
- `cont:31`：「不逐项遍历 6 个编号目录，不探测下游目录是否存在」；`cont:32`：「不存在「链路逐项过整条链」与「下游不读取」的张力」；`cont:40`：「即使发现非本轮文件「看起来更好」也不改；**Check 不是授权写入步**」；`cont:52`：「不自行改写已确认内容：不改上游、不改本轮产物以「抹平」冲突……」。
- `gate:77` 复述同一禁令：「`vn-continuity` 的核查范围以本轮唯一产物及其**直接上游已确认文件**为限，**不探测下游、不做全链全量体检**」。
- 反过来：
  - `script/continuity:11`：「修改设定后（只读复核影响面），以及**每阶段产出落盘前的全量核查**。」（标题就叫「单一产物连续性核查」，description 也说「每轮 Check 步：对本轮唯一产物执行**定向靶向核查**」——**同一份文件内**：`script/continuity:3` 与 `script/continuity:11` 自相矛盾。）
  - `design/vn-continuity:10`：「每阶段产出落盘前（**全量核查一次**）。」；`design/vn-project-bootstrap:130`：「每阶段产出落盘前按 vn-continuity 执行一次**全量核查**；查出的冲突先请用户裁决，并记入 `03-修订/continuity-log.md`。」
  - `screenplay/staging-continuity:15`：「……改为只核查本阶段融合稿，并承担**全链 Check 步基准**（Check 按 vn-continuity）」——把「全链」当作正面职责写入，与 `cont:8` 的「不做全链全量体检」正面冲突。
  - `script/continuity:49`：「本轮唯一产物与……不一致、且该产物尚未经用户确认时，以上游事实源为基准，**在 `02-Script/` 内修正本轮产物**并在核查结论中说明」；`script/character-voice:24`：「发现漂移**优先修正 `02-Script/` 内台词**而不改上游档案」。这直接违反 `cont:40`「Check 不是授权写入步」与 `cont:52`「不改本轮产物以抹平冲突」。
  - `vn-outline/*` 三份则站在 gate 一边：`outline-structure:41` / `outline-chapter:40` / `outline-endings-flags:42` 都写「**不全量核查**、不顺手改非本轮文件、不预写下游」，且同时写「**再按目录链逐项过**」——「不全量核查」×「按目录链逐项过」是**同一句内的自相矛盾**（疑为消除旧版冲突时拼接残留）。
- 【修复建议】**必须修复**。① 删 `script/continuity:11` 的「全量核查」、改 `design/*` 与 `screenplay/staging-continuity:15` 的「全链/全量」措辞；② 把 `script/continuity:49`、`script/character-voice:24` 的「修正本轮产物」改为「停下、报告、交用户裁决，Check 不写入」；③ 修 `outline-*:40-42`「不全量核查……再按目录链逐项过」的自相拗句。

## A-3 ★ 「状态置已确认」的时机在 vn-shared 内部两处互斥

- `gate:69`：「`已确认` **默认由用户在确认中给出后，AI 代为登记；AI 不自行置位**。用户显式授权时按其授权处理。」（= 用户确认 → AI 代登记）
- `gate:12`（硬红线之一）：「③ **不自行把 README 状态置「已确认」**」；`gate:83` 把「自行置「已确认」」列为**越界**，要求 `ask_user_question` 报告、不自行改回。
- 但 `cont:53`（§5 冲突处理）原文：「用户裁决后，在 `README.md` B 区「进度记录」追加一行记入……**并由 AI 代为把 A 区状态置「已确认」（默认不自行置位，用户显式授权时按授权）**」。
- 冲突点：`cont:53` 把「AI 代为置已确认」绑定在**「冲突裁决后」**，而 `gate:69` 绑定在「**用户在确认中给出后**」；`gate:12` 又把「自行置已确认」定为红线。`cont:53` 括号里同时写「（默认不自行置位）」却又写「由 AI 代为把 A 区状态置已确认」——**同一句内自相矛盾**（默认不自行置位 × 由 AI 代为置位）。此外 `gate:70` 说「裁决结论追加一行记入 B 区」，`cont:53` 却说裁决后还要改 A 区，与 `gate:30`「Write 步……状态置「待确认」」、`cont:58`「无冲突时……状态 = 待确认」、`cont:60`「状态从「待确认」变「已确认」的默认途径是用户在确认中明确认可」冲突。
- 另：`game/game-acceptance:15`：「只有用户在 **Stop 步 `ask_user_question` 明确确认后**才可置「已确认」并推进」——把确认时点钉死在「Stop 步」，而 `gate:65` 状态机是「`待确认 --用户明确确认--> 已确认`」、`gate:71` 说阶段切换 = 用户手动切换预设 + `状态=已确认`，均未限定在 Stop 步；`game/game-engine-skeleton:10` 又说前置是「README `状态=已确认`（由用户在 `ask_user_question` 中确认）」。这是把「已确认」时机第三处、第四处各写了一遍。
- 【修复建议】**必须修复**。统一为单一真源 `gate:69`：所有阶段只保留「用户明确确认 → AI 代为登记；AI 不自行置位」，删除 `cont:53` 的「由 AI 代为把 A 区状态置已确认」及其括号内自相括注；`game/game-acceptance:15` 去掉「Stop 步」限定。

## A-4 ★ anchors「四节」定义互斥：vn-shared/vn-continuity 的第①节 ≠ vn-bible-anchors / vn-design 的第①节

- `cont:12-19` 的四节锚点矩阵表：
  - `cont:16`：「① **基准事实与创意核心** | 作品定位、题材、基调、叙事视角、不可动摇的前提」；② 角色与关系；③ 世界观与地理；④ 历史·术语·文风。表格硬锚点是「年龄矩阵 / 称谓网格 / **信物流转状态机**」（`cont:21`）。
- `bible-anchors:15`：「四节固定为：**一、年龄与生理时间轴矩阵**（年龄矩阵）；二、空间拓扑与动线模型；三、称谓三层解耦网格；四、核心资产与体态状态机（体貌锚点、信物流转状态机）」。`spec:25` 只写「四节基准事实层」不展开。
- `design/vn-project-bootstrap:65,72,85,94` 的四节模板与 `bible-anchors:15` 一致（① 年龄矩阵 ② 空间拓扑 ③ 称谓网格 ④ 资产/体态状态机），`design/vn-story-outline:44` 也按此四节列。
- 冲突：同一个「`00-Bible/anchors.md` 四节」，`cont:16` 的 ① 是「基准事实与创意核心（定位/题材/基调/视角）」，而 `bible-anchors:15` 的 ① 是「年龄与生理时间轴矩阵」；② 在前者是「角色与关系」、后者是「空间拓扑」；③ 前者「世界观与地理」、后者「称谓网格」；④ 前者「历史·术语·文风」、后者「核心资产与体态状态机」。**四节逐节都不同**，且 `cont:21` 把「信物流转状态机」列为硬锚点表，而 `bible-anchors:15` 把它塞进第四节。这会导致 Check 步「逐节过锚点矩阵」时按两套互不对应的表执行。
- 且 `script/continuity:31`、`script/story-bible:29`、`script/vn-script-format:68`、`vn-outline/*:40-42` 全部按 `bible-anchors` 的四节（年龄/空间/称谓/资产）叙述，与 `cont:16` 的表格不一致。
- 【修复建议】**必须修复**。以 `bible-anchors:15` 为唯一「四节」定义，改写 `cont:14-21` 的矩阵表；或反之，但必须让 `cont`、`bible-anchors`、`script/*`、`outline/*` 四处一致，并明确 `brainstorm.md` 降级后的「定位/题材/基调」归哪一节。

## A-5 ★ 单一事实源 `Specifications.md` 的双重「唯一」：vn-shared 说自己与 Specifications 冲突时让位，vn-bible-bootstrap 却把完整规范条文写进 skill

- `spec:12`：「项目根 `Specifications.md` 是**唯一规范事实源**；本 skill 与它冲突时以它为准并停下询问。」`spec:8`：「判断……以本 skill 与项目根 `Specifications.md` 为准」。
- `bible-bootstrap:20` 却把 `Specifications.md` 的**四节骨架内容逐项写死在 skill 里**：「按 §2.4 四节骨架落盘 —— ① 来源记录 ② 结构与目录约定（§2.2 全表……+ §2.3 十条目录纪律，含……）③ 产出格式规范（……）④ 红线与禁忌（……）」。同一事实（目录树、十条纪律、命名规则、红线）在 `spec:17-72` 与 `bible-bootstrap:20` 两处定义，且 `bible-bootstrap:20` 引用了 **`§2.2 / §2.3 / §2.4`** ——这些章节号在 `spec` 里**并不存在**（`spec` 只有 `## 1..7`），属悬空指向（见 D-1）。
- `spec:108` 更明确：「Read 步的**固定顺序**见 `vn-gate` §1；**本 skill 不再另设「必须先」条款，避免多个「必须先」争第一**」——即作者已意识到「多个必须先争第一」是问题；但 `vn-design/vn-project-bootstrap:14-15` 又写「开工规范检查（**第一步**，落盘 `规范-视觉小说设计.md`）／每个新项目**第一步**先检查……」，而 `bible-bootstrap:14`、`vn-spec:106` 把「首轮显式读 `Specifications.md` 与 `Direction.md`」作为首动作。两套体系「第一步」不同（见 A-8）。
- 【修复建议】**必须修复**。`bible-bootstrap:20` 改为「按 `vn-spec` 与 `Specifications.md` 落盘，条文不在本 skill 复述」；删除悬空的 `§2.2/§2.3/§2.4`。

## A-6 ★ vn-screenplay 与 vn-staging「同名 skill 职责对调」：描述同一工作流却规则相反

`vn-screenplay/*` 声明「8 个 skill 的内核与 8 条核心原则**沿用 vn-staging 全链**」（`screenplay/staging-project-bootstrap:14`），但逐个比对，同名 skill 的**产出物与写权被换掉了**：

| skill 名 | vn-staging（旧） | vn-screenplay（新） | 冲突 |
|---|---|---|---|
| `staging-direction` | `vn-staging/staging-direction:1-3`：「**视觉演出设计**：剧情分场、立绘出场与调度……为某场戏设计画面调度时使用」，产出是中间稿「演出」步骤 | `screenplay/staging-direction:3`：「**演出精述撰写**：只写 `04-ScreenPlay/演出精述.md`」，`:14` 明说「沿用……『视觉演出设计/分场』内核，**改为撰写演出精述**」 | 同名不同职责 |
| `staging-cues` | `vn-staging/staging-cues:45-47`：「本 skill 管**听得见**的部分：BGM、音效、环境音、静默；`staging-direction` 管**看得见**的部分」 | `screenplay/staging-cues:3,14`：「**单场演出提示编排**：叠加台词、表情、音乐、转场 cue 写成**逐场融合稿**」，`:18`「只写 `draft-vN/scNNN.md`」 | cues 从「只管听觉」变成「写整场融合稿」，并侵入 direction 的视觉面 |
| `staging-gap-triage` | `vn-staging/staging-gap-triage:3,57-81`：「**建立** `06-演出/资产缺口.md`」，含「生成/替代/降级/占位/暂停」五路径并**写盘** | `screenplay/staging-gap-triage:3,14,20,24`：「**只读核对**，不自写缺口表、不另建副本……五路径只作为呈报候选，本 skill **不代为落盘任何缺口处置文档**」 | 一写盘 / 一只读，互斥 |
| `staging-asset-audit` | `vn-staging/staging-asset-audit:3,47,102-107`：「建立与维护 `06-演出/资产索引.md`」，**写索引** | `screenplay/staging-asset-audit:3,21,26`：「**只读核对**，不另写索引文档，禁止自行修订索引」 | 写 / 只读互斥 |
| `staging-acceptance` | `vn-staging/staging-acceptance:3,42-64`：「**交付验收**：逐项执行验收清单……产出**交付说明**」 | `screenplay/staging-acceptance:3,6,14`：「**首轮交接验收**：校验上游交接、README 状态机……三分支判定」，且 `screenplay/staging-project-bootstrap:29`「不创建 `04-ScreenPlay/` 之外的一切元文档（……**交付说明**不落 04）」 | 旧体系产出「交付说明」，新体系禁止该文档 |

- 另有目录/事实源硬冲突：`vn-staging/staging-project-bootstrap:20-38` 产出 `06-演出/总体说明.md`、`制作计划.md`、`资产索引.md`、`资产缺口.md`、`交付说明.md`、`assets/`；`screenplay/staging-project-bootstrap:29,34-35` 明确「总体说明/制作计划并入根级 `Direction.md`、资产索引/缺口改置 `03-Asset/`（只读）、**交付说明不落 04、也不在别处另建**」。`vn-staging/staging-project-bootstrap:14` 还写「`00-设定/`、`01-规划/`……既有文件一律不重写」，而新体系把这些目录整体判为废弃。
- 【修复建议】**必须修复**（重点）。要么把 vn-staging 整树标记为 `disabled`（并在所有 `screenplay/*` 的「沿用 vn-staging 全链」处改为「已重写，不再引用 vn-staging」），要么把两树同名 skill 的职责描述统一。当前「沿用全链 + 职责统一改为……」是**自相矛盾的措辞**：既然改了职责与写权，就不能叫「沿用」。

## A-7 ★ 硬门强度：vn-spec 说「默认硬门、用户可覆盖」，vn-screenplay 8 份说「不开始、禁止、写死」

- `spec:68`（目录纪律第 6 条）：「这两份是逐场演出剧本的**默认硬门前置**：未完成并经用户确认前，**默认不开始** `04-ScreenPlay/draft-vN/` 逐场稿（**用户显式指令可覆盖**）」。`spec:8` 又整体声明「与 persona【指令裁决】冲突时以 persona 为准」，`gate:8` 说「一切流程与确认要求用户可覆盖」。
- 但 `screenplay/*` 8 份把硬门写成无豁免的绝对禁令：
  - `screenplay/staging-draft-format:32` 标题「**硬门（应写死）**」，`:33`「**没有……且未经用户确认之前，不开始逐场演出剧本**」；
  - `screenplay/staging-project-bootstrap:23`「不开始逐场演出剧本……**硬门未过不创建任何逐场演出剧本文件**」；
  - `screenplay/staging-acceptance:35` 表格「缺失或未经用户确认则**禁止开始**逐场演出剧本」、`:46` 同；
  - `screenplay/staging-cues:32`、`staging-direction:31`、`staging-continuity:46`、`staging-gap-triage:28`、`staging-asset-audit:32` 全部「不开始逐场演出剧本」无「用户可覆盖」字样。
- `asset-list/asset-index-gap-bootstrap:29` 也写「**未完成并经用户确认前，不开始逐场稿**……硬门未满足应停下询问」，未带豁免。
- 冲突：`spec:68` 的「默认 + 用户显式指令可覆盖」是**可降权的软门**；`screenplay/*` 把它抬成「写死 / 禁止 / 不开始」的**硬红线**。这与审查维度 6「降权不彻底」直接对应。
- 【修复建议】**必须修复**。统一措辞：要么 `spec:68` 删掉「默认/可覆盖」并让所有阶段一致写成硬红线；要么（推荐，因与 `gate:8` 宪法一致）给 `screenplay/*` 8 处 + `asset-index-gap-bootstrap:29` 补「除非用户明确要求」豁免，并把 `staging-draft-format:32` 的「应写死」改为「默认」。

## A-8 ★ 两套体系对「同一工作流」的目录/阶段编号/事实源全面互斥（重点说明）

用户特别要求说明 vn-design / vn-staging 与 vn-shared 是否「描述了同一工作流却规则不同」。**是，且规则全面相反**：

| 事实 | 新体系（vn-shared 及各阶段树） | 旧体系 A（vn-design） | 旧体系 B（vn-staging） | 证据 |
|---|---|---|---|---|
| 目录白名单 | `00-Bible/ 01-Plan/ 02-Script/ 03-Asset/ 04-ScreenPlay/ 05-Game/` 6+3 | `00-设定/ 01-规划/ 02-系统/ 03-修订/ 04-资产/` | `05-剧本/ 06-演出/ assets/` | `spec:17-59` × `design/vn-project-bootstrap:28-53` × `staging/staging-project-bootstrap:16-38` |
| 规范事实源 | `Specifications.md`（唯一） | `规范-视觉小说设计.md`（工作区主目录，一部作品一份） | `规范-剧本.md` + `规范-演出.md` | `spec:12` × `design/vn-project-bootstrap:14-26` × `staging/staging-project-bootstrap:20` |
| 阶段数 | 七预设（7 阶段，含 VN-游戏制造） | **六阶段** Brainstorm→人物→世界观→大纲→系统→资产 | 演出子阶段 | `spec:23`「七预设导航」/`gate:3` × `design/vn-project-bootstrap:127`「六阶段顺序」 |
| 结局/分支事实源 | `01-Plan/endings-and-flags.md` 唯一 | `02-系统/systems.md` + `02-系统/endings.md` **两份** | `05-剧本/` 只读 | `spec:71` × `design/vn-system-design:11,37` |
| 连续性记录 | 并入 `README.md` B 区，取消独立修订目录 | `03-修订/continuity-log.md` | `03-修订/continuity-log.md`（沿用） | `cont:54`「旧版 `03-修订/continuity-log.md` 已废弃」× `design/vn-continuity:39` × `staging/staging-continuity:65` |
| 核查范围 | 只核查本轮 1 个产物 + 直接上游，不探测下游 | 每阶段**全量核查**、跨阶段互查（8 项清单） | 五维核查 + 交付前**逐场覆盖** | `cont:8,31` × `design/vn-continuity:10,17-27` × `staging/staging-continuity:78` |
| 状态机 | README 双区 A 区 5 字段 + B 区只追加 | README 模板含「阶段确认记录 / 进度记录」两张表，字段不同 | README「只追加行」，字段沿用上游表头 | `gate:50-60` × `design/vn-project-bootstrap:99-117` × `staging/staging-project-bootstrap:147-148` |
| 资产事实源 | `03-Asset/asset-index.md`（协作生成，只读引用） | `04-资产/asset-list.md` + `notes/` | `06-演出/资产索引.md`（本模式**自建**） | `spec:68` × `design/vn-asset-list:11` × `staging/staging-asset-audit:47` |
| 交付物 | 无「交付说明」 | 无 | **产出「交付说明」** | `screenplay/staging-project-bootstrap:29` 禁止 × `staging/staging-acceptance:42-64` 要求 |
| 推进门控 | 用户手动切换预设 + `状态=已确认`（`gate:71`） | 「只有用户确认本阶段完成……才推进，六阶段推进门控」 | 「阶段不可跳」 | `gate:71` × `design/vn-project-bootstrap:3,127` × `staging/staging-project-bootstrap:159` |

- 新体系明确把旧值判为废弃：`bible-bootstrap:42`、`bible-brainstorm:37`、`bible-anchors:37`、`bible-characters:36`、`bible-world:36`、`bible-docx:43`、`spec:15,72`、`cont:54`、`script/*` 的「旧值/迁移对照」表、`screenplay/*` 的「旧路径语境」段——**共 40+ 处**声明旧目录/旧规范「不作为产出落点、不创建、不写入、不引用为事实源」。
- 但 `vn-design/` 与 `vn-staging/` 两棵树**本身仍存在**，且其 SKILL.md 里 `00-设定/`、`03-修订/continuity-log.md`、`规范-视觉小说设计.md`、`06-演出/资产索引.md` 都是**正面产出指令**（不是迁移对照）。若两树仍可被加载，就与新体系的红线（「不创建白名单外文件」`gate:12`）直接冲突。
- 【修复建议】**必须修复（最高优先）**。把 `vn-design/`、`vn-staging/` 整体禁用/移出 `customSkillDirs`，或至少在每份旧 skill 顶部加「已废弃，仅作历史迁移对照，不得作为产出依据」。否则「单一真源」在物理上不成立。

## A-9 硬门「用户确认」的归属矛盾：asset-make 说「不代替用户确认」，vn-spec 说「经用户确认」，vn-screenplay 把确认挂在自己阶段

- `asset-list/asset-index-gap-bootstrap:8,29`：「这两份是 `vn-screenplay` 逐场演出剧本的硬门前置，**本预设不代替用户确认**」；`asset-make/asset-make-status-sync:17,33` 同样「本预设不代替用户确认 / 不代替下游确认」。
- `spec:68`：「未完成**并经用户确认**前，默认不开始……逐场稿」——没写由谁确认。
- `screenplay/staging-project-bootstrap:23`：「没有……**且未经用户确认之前**，不开始逐场演出剧本」；`screenplay/staging-acceptance:35` 表格把「硬门前置存在」列为**本阶段自己的验收项**。
- 冲突：上游两阶段都说「确认不由我做」，下游把「经用户确认」当成自己开工前的检查——**没有任何一份文件指定「由哪个预设、在哪一轮向用户发起这次确认」**，形成责任悬空；且 `gate:27` 的 Confirm 只确认「本轮就做这一个」，不等于「确认 asset-index/asset-gap 可放行」。
- 【修复建议】需修复。在 `spec:68` 或 `gate` 增补一句单一真源：「硬门确认由 VN-演出剧本 首轮 Read 用 `ask_user_question` 发起，用户确认后登记 README B 区」，并删除三处「不代替用户确认」的推诿式表述或明确其指代。

## A-10 单一文件内自相矛盾：`vn-bible-brainstorm` 的「六字段 × 每轮 1 字段 × 只写 1 个文件」与「硬上限 2 句」

- `bible-brainstorm:20`：「六字段固定且按顺序为：① 作品一句话定位 ② 题材与类型 ③ 核心主题与母题 ④ 情绪基调与核心体验 ⑤ 目标受众 ⑥ 篇幅与结构规模预期」；`:21`「六字段逐个处理，每轮只处理 1 个子条目（1 个字段），未轮到的字段保持模板占位、不提前填写或预写」；`:14`「`00-Bible/brainstorm.md` 是唯一落点、唯一允许写的文件」。
- 但 `bible-brainstorm:22`：「每字段只写用户确认过的原话 + 至多 1 句归纳，**硬上限 2 句**；不复合句展开」——而 `bible-anchors:25`、`bible-characters:22`、`bible-world:22`、`vn-spec:95` 都要求「以完整、连贯且包含因果关系的**复合句**为主，不碎片段落」。`brainstorm` 的「不复合句展开」与全局文风规范冲突（属可接受视角差异还是矛盾见下方【区分】）。
- 【区分】这条更接近**可接受的视角差异**：Brainstorm 字段刻意保留用户原话、不展开，是阶段特性；`vn-spec:95` 自己也写了「Brainstorm 字段至多写用户确认过的原话 + 1 句归纳（上限 2 句）」的例外。故 **A-10 不算真矛盾**，仅记录：但 `bible-brainstorm:22` 的「硬上限 2 句」「不复合句展开」与 `bible-anchors:25` 的「以完整复合句为主」在措辞上易被误读，建议加「（Brainstorm 例外见 vn-spec §5）」。

---

# B. 末位工具调用不变量（审查维度 2 全量清单）

对 `最后一个 / 末位 / 收尾 / 结尾 / 以…收尾 / present / exit_plan_mode / 提问后` 全树 grep，命中如下：

1. **否定式（唯一的「正确」声明）**：`gate:37`「本轮的工具调用顺序**没有「最后一个必须是某个工具」的硬不变量**；报告、交付（`present`）、README 状态登记都是正常步骤」。`gate:35` 章节名「## 2. 收尾与提问」。`cont:61`「不存在「**提问后不得写文件**」的时序矛盾」。
2. **肯定式（违规，10 份逐字重复）**：`script/vn-script-project-bootstrap:62`、`script/vn-script-outline:61`、`script/vn-script-structure:57`、`script/vn-script-format:104`、`script/vn-script-revision:64`、`script/continuity:74`、`script/character-voice:57`、`script/story-bible:57`、`script/research-materials:57`、`script/writing-craft:77`——「Stop 应停下、列出下一候选子条目并**以 `ask_user_question` 收尾**」。这是「收尾工具调用必须是 ask_user_question」的变体说法。
3. **时点限定式（变体）**：`game/game-acceptance:15`「只有用户在 **Stop 步 `ask_user_question` 明确确认后**才可置「已确认」并推进」——把「确认」这一动作钉死在 Stop 步的特定工具上，等价于「Stop 步必须发生 ask_user_question」。`game/game-engine-skeleton:10`「`README.md` A 区 `状态=已确认`（由用户在 `ask_user_question` 中确认）」。
4. **未命中**：全树**没有** `exit_plan_mode`；`present` 只在 `gate:37` 作为「交付是正常步骤」出现；`vn-design/*`、`vn-staging/*` 全树**没有**任何末位/收尾硬不变量措辞（仅在 `design/vn-project-bootstrap:11`「每阶段结束时更新进度」、`screenplay/staging-project-bootstrap:11`「每轮收尾时登记进度与确认记录」出现「收尾时登记」这种**时点描述**，不是工具不变量，属可接受）。
- 【修复建议】见 A-1。B 类问题与 A-1 是同一根因，修 A-1 即覆盖 B。额外把 `game/game-acceptance:15` 的「Stop 步」限定删除。

---

# C. 重复（审查维度 3）

## C-1 ★ vn-script 10 份文件的「整块模板逐字复制」

`vn-script/` 下 10 份 SKILL.md 拥有**完全相同的 7 个段落**（逐字或仅替换文件名）：
- 「## 目录白名单（6 个编号目录 + 3 个根级文档）」段（含「统一目录表以 `Specifications.md` ②节为唯一事实源……白名单按「6 个编号目录 + 3 个根级文档」执行，不按任何其它数目口径书写」）——grep 精确命中 **10/10** 份：`script/*:44/45/48/49/50/51/61/64/65/91`（行号各异）。
- 「## 上游只读清单（不落盘、追加、改写）」段（根级三文档 + `00-Bible/` 十份 + `01-Plan/` 三份 + 本阶段已有产物 + 下游禁写）——10 份逐字相同。
- 「## 七步循环」段 + 末位 `ask_user_question` 收尾句——10 份逐字相同（见 A-1/B-2）。
- 「## `02-Script/Draft/` 只进不出 与 Check 门禁」段（3 条 + README 双区 2 条）——10 份逐字相同。
- 「## 旧值 / 迁移对照」迁移表（9~10 行）——10 份近乎逐字相同，仅 `vn-script-project-bootstrap` 多一行 `00-设定/anchors.md`、`vn-script-structure` 的 `structure/endings/systems` 合并成一行、`story-bible` 多「设定集」。
- 「## 执行要点」段（每轮 1 个子条目 / 不跨阶段 / 不一轮多条目 / 排版防灾 / 只使用 vn-shared 与 vn-script）——10 份逐字相同。
- 「只使用 `vn-shared`（vn-spec / vn-continuity / vn-gate）与 `vn-script` 挂载 skill，不加载或引用其它阶段 skill」——10 份逐字相同。

【修复建议】应修复。把上述 7 块抽成 `vn-shared` 单一真源（或 `vn-script/_shared` 片段），10 份只保留各自「唯一落点 / 单轮单条目 / 本 skill 特有规则」。当前只要改一条规则就要改 10 处，已实际造成 A-1（10 处一起错）。

## C-2 ★ vn-screenplay 8 份文件的「8 条核心原则 + 8 词状态词表 + 硬门 + 白名单 + 七步循环 + 旧路径语境」逐字复制

grep `## 8 条核心原则` 命中 **8/8**：`screenplay/staging-project-bootstrap:49`、`staging-draft-format:68`、`staging-direction:54`、`staging-cues:52`、`staging-continuity:66`、`staging-gap-triage:48`、`staging-asset-audit:52`、`staging-acceptance:66`。每份随后紧跟「## 8 词状态词表」（只用 `available / generated / substitute / placeholder / missing / hard_missing / pending / listed_but_missing` 8 词）——**8 份逐字相同**（`staging-gap-triage:52` 多一句「特别警惕 listed_but_missing」）。此外：
- 「## 硬门」段 8 份近乎逐字相同（`staging-project-bootstrap:22-24`、`staging-draft-format:32-33`、`staging-direction:30-31`、`staging-cues:31-32`、`staging-continuity:45-46`、`staging-gap-triage:27-28`、`staging-asset-audit:31-32`、`staging-acceptance:45-46`）。
- 「白名单为 6 个编号目录 + 3 个根级文档（**不是 6+2**）」8 份逐字相同（含「不是 6+2」这个针对旧版的防御性括注）。
- 「## 七步循环与 Check」段 8 份近乎逐字相同，且都写「Confirm / Stop 两组 `ask_user_question` 选项**不跨组套用**」（与 `gate:39` 冲突，见 A-1）。
- 「## 旧路径语境」段 8 份近乎逐字相同。
- 「## 执行要点（三条，逐字执行）」实际只列了 **2 条**（每轮只处理 1 个子条目 / 不跨阶段）——8 份都标题写「三条」却只有两条，属**同一份文件内的自相矛盾 + 重复**（见 E-3）。
【修复建议】应修复。同 C-1，抽成单一真源；并把「三条」改成「两条」或补第三条。

## C-3 ★ vn-bible 6 份文件的「白名单恒为 6+3 / 首轮显式读 / 单轮单条目 / 七步循环 / 执行要点 / 旧值迁移对照」逐字复制

`bible-bootstrap:11`、`bible-brainstorm:11`、`bible-anchors:11`、`bible-characters:11`、`bible-world:11`、`bible-docx:12` 逐字相同：「白名单恒为「6 个编号目录 + 3 个根级文档」：`00-Bible/`、`01-Plan/`……任何其它目录/文件不创建」。
`bible-brainstorm:17`、`bible-anchors:19`、`bible-characters:18`、`bible-world:17`、`bible-docx:23` 逐字相同：「首轮显式读一次 `Specifications.md` 与 `Direction.md`（后续轮不复读），读根级 `README.md` 校验「当前预设」，只读 `00-Bible/` 内本阶段已有产物」。
6 份的「不创建计划外文档、不跨阶段预写、不越权写入；违反任一红线应立即停下并用 ask_user_question 询问」逐字相同（`:35/:35/:35/:34/:41` 等）。
6 份文末「旧值 / 迁移对照（不作为产出落点）」整段近乎逐字相同（仅各加自己的旧文件名）。
`bible-brainstorm:25`、`bible-anchors:26`、`bible-characters:25`、`bible-world:25`、`bible-docx:32`：「Read → Report → Confirm → Do → Check → Write → Stop 七步为默认顺序……Write 在 Confirm 之后、Stop 之前，只写这一个文件 + 就地更新 README.md A 区 5 字段 + 在 B 区追加一行（状态置「待确认」）」逐字相同。
【修复建议】应修复。同 C-1。

## C-4 vn-outline 3 份文件近乎整篇互为副本

`outline-structure`、`outline-chapter`、`outline-endings-flags` 三份共享：§1 唯一落点白名单 6+3（`:13`/`:13`/`:13`）、§2 单轮单条目「一个子条目 = ……恰好一项」的长句（`:20`/`:19`/`:21` 逐字相同）、§3 硬约束、上游只读清单（`:37-39`/`:36-38`/`:38-40` 逐字相同）、Check 段（`:41`/`:40`/`:42`）、README 双区结构段（`:43`/`:42`/`:44` 逐字相同）、§6 旧值迁移对照。三份仅 §5 模板与「本 skill 只负责 X」一句不同。
【修复建议】应修复。

## C-5 vn-asset-make 4 份文件的「唯一产出落点 / 越界收敛 / 白名单 / 旧路径禁令 / README 双区」逐字复制

`asset-make-spec-read:49-62`、`asset-make-generate:53-65`、`asset-make-verify:46-62`、`asset-make-status-sync:49-62`：白名单 6+3 段、旧路径禁令段（8 个旧目录 + `规范-*.md` + 6 个旧独立文件，逐字相同）、README 双区（§3.0.7）段、越界收敛原则段，逐字相同。
`vn-asset-list` 2 份也复制同一套「白名单 6+3 / 越界收敛 / §3.0.7 / §3.4 ② / §10 #29」。
【修复建议】应修复。

## C-6 单一事实「6 编号目录 + 3 根级文档」被重定义 40+ 次

`spec:17-59` 是唯一真源（目录树 + 「全结构 = 6 个编号目录 + 3 个根级文档」`spec:59` + 十条纪律 `spec:61-72` + 读写矩阵 `spec:74-88`）。但下列文件各自又完整复述一遍 6+3 清单：
- `bible-bootstrap:11`、`bible-brainstorm:11`、`bible-anchors:11`、`bible-characters:11`、`bible-world:11`、`bible-docx:12`（6）
- `outline-structure:13`、`outline-chapter:13`、`outline-endings-flags:13`（3）
- `script/*` 10 份（目录白名单段）（10）
- `asset-list/vn-asset-list:19-23`、`asset-list/asset-index-gap-bootstrap:19-23`（2）
- `asset-make/*` 4 份（白名单与目录纪律段）（4）
- `screenplay/*` 8 份（「白名单为 6 个编号目录 + 3 个根级文档（不是 6+2）」）（8）
- `screenplay/staging-project-bootstrap:20` 额外写「（不是 6+2）」，`screenplay/staging-draft-format:20` 等同。
共 **33+ 处**复述，且 `vn-screenplay` 8 份额外加了「不是 6+2」这一**在其它文件从未出现**的否定口径（暗示曾存在 6+2 版本），构成「同一事实多处定义且表述不一致」。
【修复建议】应修复。全部改为「见 `vn-spec` §2」，只在 `spec` 保留清单。

## C-7 「README 双区状态机 A 区 5 字段 + B 区只追加」被重定义 30+ 次，且口径漂移

`gate:50-60` 是唯一真源（5 字段 = `当前预设/当前阶段/本轮子条目/状态/下一候选`，三值状态机 `gate:62-67`）。复述处：
- `bible-bootstrap:19`（「A 区 5 字段……仅在用户确认后就地更新；B 区只追加一行、永不改写或删除既有行，状态置「待确认」」）
- `outline-*:42-44`、`script/*:68-69/81-82`、`asset-list/*:63/61`、`asset-make/*:56-59`、`screenplay/*:19/36/50/32/36`、`game/*:27/26/14`、`screenplay/staging-acceptance:19`
- 口径漂移：① 有的写「**仅在用户确认后**就地更新」（`outline-*`、`script/*`、`asset-make/*`、`bible-bootstrap:19`），有的写「就地更新」无条件（`screenplay/staging-project-bootstrap:19`、`asset-list/asset-index-gap-bootstrap:61`、`game/game-engine-skeleton:26`）；② 有的写「状态置「待确认」」、有的写「状态默认「待确认」」、有的不写；③ `gate:59` 状态三值写作 `进行中 | 待确认 | 已确认`，而多数阶段文件只写「状态」不列三值，`asset-make/*:59` 写「状态(进行中|待确认|已确认)」，`screenplay/staging-acceptance:24` 又列一次三值；④ `gate:69`「已确认默认由用户在确认中给出后 AI 代为登记」与 `cont:53` 冲突（见 A-3）。
【修复建议】应修复。统一引用 `gate` §4，删各阶段复述。

## C-8 T 块 / 红线 / 状态机 / 目录表被重复定义

- 「十条目录纪律」：`spec:61-72` 定义，`bible-bootstrap:20` 又完整复述（含「§2.3 十条目录纪律」悬空引用），`script/vn-script-project-bootstrap:35-40「目录纪律」` 再复述一次。
- 「三条硬红线」：`gate:12` 定义，`bible-*:35`「违反任一红线应立即停下并用 ask_user_question 询问」6 份复述，`script/*` 执行要点 10 份复述，`asset-list/*:33-34`「## 三、硬约束 1. 每轮只处理 1 个子条目 2. 不跨阶段」把「三条」写成**两条**（见 E-3）。
- 「七步循环」：`gate:17-31` 定义表，`script/*` 10 份、`screenplay/*` 8 份、`vn-asset-list/*:60,62`、`vn-screenplay/*:61-64` 各自复述一遍（共 20+ 处），且 `script/*` 版本带 A-1 的末位门禁错误。
- 「三分支交接」：`gate:72` 标「全章唯一判定」，`screenplay/staging-acceptance:23-27` 又完整重写一遍三分支并标「（§4.3 §5）」——**「唯一判定」被定义了两次**（见 D-3、A-3）。
【修复建议】应修复。

---

# D. 失效引用 / 悬空指向（审查维度 5）

## D-1 ★ 悬空章节号：`§2.2 / §2.3 / §2.4 / §3.0.7 / §3.4 / §10 #29 / §4.3 / §5 / 见 §4`

对全部 55 份文件 grep `§数字`，命中 21 处，逐一核对被引文档是否存在对应小节：

| 引用 | 出现位置 | 被指文档实际小节 | 结论 |
|---|---|---|---|
| `§2.4 四节骨架`、`§2.2 全表`、`§2.3 十条目录纪律` | `bible-bootstrap:20`、`bible-bootstrap:23`（「§2.2 六目录全表」） | `vn-spec` 只有 `## 1. 事实源 / 2. 统一目录树 / 3. 十条目录纪律 / 4. 读写权限矩阵 / 5. 命名与格式 / 6. 白名单自检 / 7. 共用规范生效前置条件`——**没有 §2.2/§2.3/§2.4，也没有「四节骨架」** | **悬空**：疑指某份已不存在的施工文档（「四节骨架」在 `design/vn-project-bootstrap:21` 与 `staging/staging-project-bootstrap:152` 指的是**规范文档**的四节，不是 vn-spec） |
| `§3.0.7` | `asset-list/vn-asset-list:63`、`asset-list/asset-index-gap-bootstrap:61`、`asset-make/*:56/59/59/59`（4）、`screenplay/staging-asset-audit:36`、`staging-continuity:50`、`staging-direction:20`、`staging-gap-triage:32`、`staging-acceptance:18` ——共 **12 处** | 55 份文件中**没有任何 `§3.0.7` 或 `3.0.7` 章节**；`gate` §4 才是「README 双区状态机」 | **悬空**（最严重，12 处指向不存在的编号） |
| `§3.4 ② / ③ / ⑤ 技能使用段`、`§10 #29` | `asset-list/vn-asset-list:67`（两处）、`asset-list/asset-index-gap-bootstrap:13` | 无 `§3.4`、无 `§10`、无「#29」 | **悬空**，疑指已删除的旧预设/施工文档条目编号 |
| `§4.3 §5 三分支判定` | `screenplay/staging-acceptance:3,23` | `gate` 的三分支在 `§4` 第 72 行（无 §4.3）；`gate §5` 是「跨阶段边界」，**不是三分支** | **悬空 + 指错**：`§5` 指向了错误内容 |
| `见 §4`（README 双区） | `outline-structure:16`、`outline-chapter:15`、`outline-endings-flags:17` | 这三份文件**自身没有 `## 4.` 小节**（章节为 1/2/3/5/6，§4 缺失——见 D-2）；若指 `gate §4` 则未标明文档 | **悬空/指代不明** |
| `Specifications.md ②节 / ③节` | `script/*` 10 份（「统一目录表以 `Specifications.md` ②节为唯一事实源」10 处，`script/vn-script-format:14`「③节」、`script/vn-script-outline:17`「③节」、`script/vn-script-format:15`「③节场次命名」等） | `bible-bootstrap:20` 说 `Specifications.md` 是「四节骨架」：① 来源记录 ② 结构与目录约定 ③ 产出格式规范 ④ 红线与禁忌。**② 节是「结构与目录约定」而非「统一目录表唯一事实源」，③ 节是「产出格式规范」**——`script/*` 把「③节」同时用作「场次命名与全局默认视点模式声明处」（`script/vn-script-project-bootstrap:55`、`script/vn-script-outline:54`），但 `bible-bootstrap:20` 的 ③ 节里**没有「视点模式」** | **指代不一致**（真源文件未定义该条目，见 A-5） |
| `vn-gate §1 / §2 / §4 / §5`、`vn-continuity §2 / §5` | `gate:25,77,88`、`cont:32,61`、`spec:108` | 这些在 `gate`/`cont` 内**确实存在**（§1 七步、§2 收尾、§4 状态机、§5 跨阶段；cont §2 核查范围、§5 冲突处理） | **有效引用**（少数正确） |

【修复建议】**必须修复**。把 `§3.0.7`（12 处）、`§3.4 ②/③/⑤`（3 处）、`§10 #29`（2 处）、`§2.2/§2.3/§2.4`（3 处）、`§4.3 §5`（2 处）、`见 §4`（3 处）全部改为「见 `vn-gate` §4 / `vn-spec` §2 / `vn-spec` §5」等真实编号；并核对 `Specifications.md` ②/③ 节的实际内容。

## D-2 ★ vn-outline 三份文件自身章节编号跳号（§4 不存在却引用 §4）

`outline-structure`、`outline-chapter`、`outline-endings-flags` 的章节为：
`## 1. 唯一落点` / `## 2. 单轮单条目` / `## 3. 硬约束` / **`## 5. …模板`** / `## 6. 旧值`——**没有 §4**。但 `outline-structure:16`、`outline-chapter:15`、`outline-endings-flags:17` 都写「只按双区结构更新状态并追加进度行（**见 §4**）」，`outline-structure:33`、`outline-chapter:32`、`outline-endings-flags:34` 又写「本节与 **§6** 中出现的一切旧值……」（§6 存在，有效）。§4 是删节后未清理的悬空引用。
【修复建议】需修复。改成「见 `vn-gate` §4 README 双区状态机」。

## D-3 「全章唯一判定」被两处定义（含失效的「唯一」声明）

`gate:72`：「**首轮「当前预设」校验三分支**（**全章唯一判定**）：① 匹配自己……② 合法交接……③ 其余不匹配……」。
`screenplay/staging-acceptance:23-27`：「## 三分支判定（§4.3 §5）……1. 匹配自己……2. 合法交接……3. 其余不匹配……」，并在 `screenplay/staging-acceptance:3` description 重申「按 §4.3 §5 三分支判定」。
「唯一判定」被定义了两次，且第二次的章节号悬空（D-1）。另 `screenplay/staging-acceptance:18` 写「仅在「合法交接」时按 §3.0.7 双区结构……就地登记」，与 `gate:72`「② 合法交接 → 首轮就地登记为自己的 id 并追加一行交接登记」内容一致但措辞/编号另起一套。
【修复建议】需修复。删除 `screenplay/staging-acceptance` 的三分支重写，改为「按 `vn-gate` §4 首轮三分支判定（全章唯一）」。

## D-4 旧文档名 / 旧 skill 名 / 旧章节号作为「正面引用」残留在旧体系内部（`vn-design` / `vn-staging` 树内自洽）

以下在新体系里已被判为废弃，但在旧体系**内部是有效引用**（故标注为「跨体系失效」而非「树内悬空」）：
- `design/vn-project-bootstrap:49`「`03-修订/continuity-log.md`（见 vn-continuity）」、`design/vn-continuity:39`「## continuity-log.md 格式（03-修订/continuity-log.md）」——`vn-design/vn-continuity` **确实存在**，树内有效；但 `cont:54` 说「旧版 `03-修订/continuity-log.md` 已废弃，`03-修订/` 不在白名单内，不创建或写入」。
- `staging/staging-project-bootstrap:76,92,151` 引用 `staging-asset-audit` / `staging-gap-triage` / `规范-剧本.md` / `00-设定/anchors.md`——树内有效，跨体系失效。
- `staging/staging-continuity:65`「……项目既有的 `03-修订/continuity-log.md`（上游已有该文件时沿用，不新建第二份）」——引用了一个新体系禁止创建的路径。
- `staging/staging-draft-format:102`「按 `staging-continuity` 执行一致性核查，按 `staging-acceptance` 执行交付验收」——`staging/staging-acceptance` 存在（树内有效），但其「交付说明」被 `screenplay/staging-project-bootstrap:29` 禁止。
- `script/*` 迁移表反复出现「本 skill 由 `screenplay-writing` 全链复制并改造」（`script/vn-script-project-bootstrap:73` 等 10 份）——`screenplay-writing/` 树**仍存在**（在 skills 根下），但其 `vn-script-project-bootstrap/SKILL.md:53,60` 引用 `03-修订/continuity-log.md`、`vn-script-revision:41` 等，属旧链；`script/vn-script-project-bootstrap:24-27` 明确说「接手 vn-design 项目的衔接契约不再适用 / 双目录分支不再适用 / 只增不改清单不再适用 / 不设……首建职责 / 不设阶段顺序推进门控」，即**明确废弃**了 screenplay-writing 的这些行为。迁移表本身是「旧值语境」，可接受；但「沿用 screenplay-writing 全链并改造」作为章节标题在 6 份 `script/*` 里出现（`:29` 等），易被误读为仍有效。
【修复建议】需修复（配合 A-8）。旧树禁用后，把这些正面引用一并改为「历史迁移对照」。

## D-5 阶段编号 / order 不一致（失效的旧编号）

- `outline-structure:8`、`outline-chapter:8`、`outline-endings-flags:8`：「本 skill 仅服务 VN 工作流**第 2 阶段（order 31）**「VN-剧情大纲设计 / vn-outline」」。
- `asset-list/vn-asset-list:8`：「是 VN 工作流**第 4 阶段**「资产清单与规格」的专属技能」。
- `spec:76-84` 读写矩阵列出 **7 个预设**：VN-设定完善（写 00-Bible）、VN-剧情大纲设计（01-Plan）、VN-剧情写作（02-Script）、VN-资产列表（03-Asset）、VN-资产制造（03-Asset）、VN-演出剧本（04-ScreenPlay）、VN-游戏制造（05-Game）。按此序：设定=第1、大纲=第2、剧本=第3、资产列表=**第4**、资产制造=第5、演出=第6、游戏=第7。故「第 2 阶段」「第 4 阶段」与矩阵一致。
- 但 `design/vn-project-bootstrap:127` 的**六阶段**编号（阶段1 Brainstorm…阶段6 资产列表）与「第 4 阶段」的语义完全不同（旧体系阶段4 = 剧情大纲）。两套编号并存且都写「第 N 阶段」，读者无法判断指哪套。
- `order 31` 这个编号在 55 份文件中**只出现 3 次**（都在 vn-outline），无其它文件定义 order 序列，属**孤立/无法核验的编号**。
【修复建议】需修复。统一用预设 id（如 `vn-outline`）而非「第 N 阶段」；删除或补全 `order 31` 的序列定义。

---

# E. 措辞 / 降权不彻底（审查维度 6）

## E-1 ★ 绝对词在无「除非用户明确要求」豁免下构成新硬约束

`gate:8` 声明「本 skill……**不是绝对门禁**……用户显式指令可覆盖本 skill 的一切流程与确认要求。规则措辞以「默认」为主，**不因未使用绝对化措辞而降低效力**」；`gate:13`「本 skill 其余内容……均为**默认节奏**」；`spec:8`「三者冲突时以 persona【指令裁决】为最高优先级」。`vn-spec:100`「用户显式指令覆盖时按宪法第 3 条处理」、`spec:68`「用户显式指令可覆盖」是**少数带豁免的范本**。

但下列文件大量使用 `一律 / 必须 / 不得 / 禁止 / 严禁 / 唯一 / 写死 / 应写死`，**且同段未带任何豁免**：

- `screenplay/*` 8 份：「**唯一产出目录写死** `<作品名>/04-ScreenPlay/`」（`staging-project-bootstrap:17`、`staging-draft-format:18`、`staging-direction:17`、`staging-cues:17`、`staging-continuity:18`、`staging-gap-triage:23`、`staging-asset-audit:20`、`staging-acceptance:17`）；「**硬门（应写死）**」（`staging-draft-format:32`）；「**禁止开始**逐场演出剧本」（`staging-acceptance:35`）；「只用 8 词状态词表；**不自造同义词、缩写或新状态词**」（8 份 `## 8 词状态词表`）；「**执行要点（三条，逐字执行）**」（8 份）。
- `asset-make/*`：「**唯一允许产出落点写死为** `03-Asset/generated/`」（4 份）、「**不写任何文件**」（`asset-make-spec-read:12,31`）、「**不调用任何生图工具**」（`asset-make-generate:19`）、「状态词表**只用**这 8 个词……**不自造词汇**」（`asset-make-status-sync:31`）。
- `script/*`：「**每轮只处理 1 个子条目**」「**不跨阶段**」「不裸 `~`」「只使用 `vn-shared` 与 `vn-script` 挂载 skill」（10 份执行要点）；`script/vn-script-format:47`「**绝对不在同一个场景段落中同时出现两个角色的无声内心独白**」——用了「绝对」，而 `script/vn-script-format:33` 自己又说「**绝不使用**「绝对不他人内心 / 绝对单一视角」之类一刀切死规则」——**同一份文件内**：`:33` 反对一刀切绝对规则，`:47` 又立了一条「绝对不」。这是「默认 + 否定」式自相拗句的典型。
- `cont:21`「**只比对，不压缩、不改写、不「优化」**」、`cont:44`「`02-Script/Draft/` **不参与核查**」、`cont:59`「**不把核查结论写成单独文件**」。
- `bible-docx:15`「四个固定文件名**不改动**，除这 4 个名字外**不在该目录新建任何文件、不新建第 5 份**」；`bible-docx:29`「**不认 Docx**」。
- 【修复建议】**需修复（降权不彻底）**。按审查维度 6，给所有不带豁免的绝对词补「（除非用户明确要求）」或统一改为「默认……；用户显式指令可覆盖（见 `vn-gate` §0）」。至少 `screenplay/*`、`asset-make/*`、`script/*` 三棵树必须处理。特别修 `script/vn-script-format:33 × :47` 的自相拗句。

## E-2 ★ 「默认 + 否定」自相矛盾句式（审查维度 6 点名）

- `script/vn-script-project-bootstrap:23-27`「### 删除项（**不再适用，不保留**）」下四条：「**双目录分支不再适用**：不存在两套正文目录并存的分支……正文目录**默认统一为** `02-Script/`」「**只增不改清单不再适用**：不存在……例外清单」「不设……首建职责、不设阶段顺序推进门控（阶段切换由用户手动切换预设，见 vn-gate）」——用「不再适用/不存在/不设」这种**绝对否定**去描述一个「默认」行为，正是「默认 + 否定」自相矛盾：既然是「默认统一」，就仍可能有例外（用户覆盖），但「不存在……分支」把例外也否掉了。
- `bible-bootstrap:24` / `bible-bootstrap:42`：「`Specifications.md` **默认取代**旧三份规范、**不再并存**」——「默认」×「不再并存（绝对）」。`spec:15` 同样「已被 `Specifications.md` 取代，**不再并存**」。
- `bible-brainstorm:23`：「**不再适用**「主动给 2-3 个候选方向」在该子阶段的适用性；……候选方向**只在用户明确要求时才给**」——「不再适用」×「明确要求时才给（仍适用）」，同一句自相矛盾；且句子「……在该子阶段的适用性」语病（「不再适用……的适用性」）。
- `cont:53`：「**并由 AI 代为把 A 区状态置「已确认」（默认不自行置位，用户显式授权时按授权）**」——「代为置位」×「默认不自行置位」（见 A-3）。
- `gate:8`「规则措辞以「默认」为主，**不因未使用绝对化措辞而降低效力**」——这句本身在说「默认 ≠ 弱」，却又被 `gate:12` 的「硬红线只有三条」和大量阶段文件的绝对词架空，属降权声明未贯彻。
- `screenplay/*` 8 份「白名单为 6 个编号目录 + 3 个根级文档（**不是 6+2**）」——「不是 6+2」是对一个**从未在本体系出现过的旧值**的绝对否定，属残留防御性措辞，且 8 份重复。
【修复建议】需修复。把「不再适用/不存在/不设/不再并存」改为「默认不……；用户显式要求时按 `vn-gate` §0 处理」；修 `bible-brainstorm:23` 语病；删「不是 6+2」。

## E-3 标题与内容数量不符（重复段落里的计数错误）

- `vn-asset-list/vn-asset-list:32-37`「## 三、硬约束」下列 **1. 每轮只处理 1 个子条目 2. 不跨阶段**，随后写「**补充（与上三条同等强制）**」——但上面只有**两条**，却说「上三条」。`asset-list/asset-index-gap-bootstrap:31-37` 同样「## 三、硬约束」两条 + 「补充（与**上三条**同等强制）」。属复制时漏了第三条（疑为丢失的「不自行置已确认」）。
- `screenplay/*` 8 份「## 执行要点（**三条，逐字执行**）」实际只列两条（`- **每轮只处理 1 个子条目**` / `- **不跨阶段**`）。`staging-project-bootstrap:62-64`、`staging-draft-format:74-76`、`staging-direction:60-62`、`staging-cues:58-60`、`staging-continuity:72-74`、`staging-gap-triage:54-56`、`staging-asset-audit:58-60`、`staging-acceptance:72-74` 全部如此。
- `game/*` 3 份「## 执行要点」也只列两条（`game-implementation-spec:30-31`、`game-engine-skeleton:30-31`、`game-acceptance:22-23`）但未标数量，无矛盾。
【修复建议】需修复。补第三条或改标题为「两条」。

## E-4 「唯一」被滥用导致单一真源名存实亡

grep `唯一` 在 55 份文件中命中极多。典型：「唯一落点 / 写死路径」几乎每份都有；`spec:12`「**唯一规范事实源**」、`spec:21`「唯一进度/阶段状态机」、`spec:59`「全结构 = 6+3。除此之外**没有合法产出落点**」、`spec:69`「**两个唯一落点**」、`spec:71`「结局/分支**单一事实源**」；`gate:52`「`README.md` 是**唯一**进度/阶段状态机」；`bible-anchors:14`「是……**第一基准、正式事实源**」；`cont:12`「效力高于……高于对话记忆」；`script/vn-script-structure:15,31-32` 同时把 `01-Plan/chapter-structure.md` 叫「章节结构**唯一事实源**」、把 `endings-and-flags.md` 叫「结局/分支/FLAG **唯一事实源**」——而 `vn-spec` 只把 `endings-and-flags.md` 定为「窄域唯一事实源」（`spec:14`），`chapter-structure.md` 并未被 `spec` 授予「唯一事实源」地位。**下游擅自给上游文件加封「唯一事实源」**，属单一真源被破坏（维度 4）。
【修复建议】需修复。只保留 `spec` 认证过的「唯一事实源」清单，删除 `script/*` 对 `chapter-structure.md` 的加封。

---

# 附：可接受的视角差异（明确标注，不算矛盾）

以下经核对**不是**真矛盾，列出以免误报：
1. **A-10（brainstorm 2 句上限 vs 复合句）**：`vn-spec:95` 自己写了「Brainstorm 字段至多写用户确认过的原话 + 1 句归纳（上限 2 句）」的例外，属阶段特性，可接受。仅措辞建议加交叉引用。
2. **vn-asset-make 四份 skill 分工写权不同**（`asset-make-spec-read` 只读、`generate` 只写 generated/、`verify` 只写 README、`status-sync` 只补两份骨架实际状态字段）：四份互相引用、边界互补，**不是矛盾**，是刻意拆分。C-5 只针对其重复段落。
3. **`vn-bible-docx` 的触发条件**（仅用户明确要求 / 收录源变更 / 交付四份时）与「七步循环每轮 1 个子条目」不冲突：它说明「不在未被明确要求时自动同步」（`:10`），是触发条件而非流程例外。
4. **vn-design / vn-staging 树内自洽**：旧体系内部引用（`design/vn-continuity` ↔ `03-修订/continuity-log.md`、`staging/*` ↔ `06-演出/*`）在**各自树内**是有效的；问题只在与新体系并存（A-8、D-4），不是树内悬空。
5. **`staging-cues:47`「转场写一次即可，在视觉与听觉两侧分别注明各自处理，不要两处重复描述同一件事」** 与 `screenplay/staging-cues` 的融合稿写法：属同一文档内的分工约定，不是跨文件矛盾。
6. **`vn-game` 两道门**（`game-implementation-spec` 第一轮规格门 → `game-engine-skeleton` 第二轮工程门 → `game-acceptance` 验收）是**顺序门控**，三份互相引用且前置条件一致（`:9-10` 要求 implementation-spec 已确认 + README 状态=已确认），无互斥；仅 `game-acceptance:15` 的「Stop 步」限定（A-3/B-3）需修。
7. **`gate:39` 的「两组选项」与 `screenplay/*` 的选项内容**：选项文字本身一致（Confirm：就做这一个/换一个子条目/先不做；Stop：认可/换一个重做/进入下一预设），仅「是否跨组套用」措辞相反（A-1 已列）。

---

# 修复优先级汇总

| 序 | 问题 | 严重度 | 修复必要性 |
|---|---|---|---|
| 1 | A-1 / B：末位门禁 `gate:37` × `script/*` 10 份 | 真矛盾+门禁 | **必须**，改 10 处或改 gate（推荐改 10 处） |
| 2 | A-8：vn-design / vn-staging 与 vn-shared 同工作流却规则全反，且旧树仍存在 | 真矛盾 | **必须**，禁用/移出旧两树 |
| 3 | A-6：vn-screenplay 与 vn-staging 同名 skill 职责对调、写/只读互斥 | 真矛盾 | **必须** |
| 4 | A-2：核查范围 全量/全链/顺手改 × 不全量/不授权写入 | 真矛盾 | **必须** |
| 5 | A-3：`已确认` 时机 4 处不一致 + `cont:53` 句内自相矛盾 | 真矛盾 | **必须** |
| 6 | A-4：anchors 四节两套定义 | 真矛盾 | **必须** |
| 7 | A-7：硬门「默认可覆盖」×「写死/禁止」 | 真矛盾/降权 | **必须** |
| 8 | A-5：`Specifications.md` 单一真源被 skill 复述 + 悬空 §2.2/2.3/2.4 | 真矛盾 | **必须** |
| 9 | D-1：`§3.0.7`(12) / `§3.4`(3) / `§10 #29`(2) / `§4.3 §5`(2) / `见 §4`(3) 悬空 | 失效引用 | **必须** |
| 10 | D-2：vn-outline 三份缺 §4 却引用 §4 | 失效引用 | 需修复 |
| 11 | D-3：「全章唯一判定」被定义两次 | 失效引用/重复 | 需修复 |
| 12 | C-1~C-8：10+8+6+3+4+33+30+多块逐字重复 | 重复 | 应修复（抽单一真源） |
| 13 | E-1/E-2/E-3/E-4：绝对词无豁免、默认+否定、三条=两条、唯一滥用 | 措辞/降权 | 需修复 |
| 14 | A-9：硬门确认责任悬空 | 真矛盾 | 需修复 |
| 15 | D-5：第 N 阶段 / order 31 双编号 | 失效引用 | 需修复 |
| 16 | A-10 / 附录 1~7 | 可接受差异 | 不必修复（仅措辞建议） |

审查结论：**存在 9 组真矛盾（其中末位门禁、两套体系并存、核查范围、已确认时机、anchors 四节为高危），1 组末位工具调用不变量违规（10 份逐字重复），8 类大规模重复，5 类失效引用，4 类降权不彻底**。所有发现均带 `文件:行号` 证据，未修改任何被审查文件。
