# -*- coding: utf-8 -*-
"""P0: fix runtime contradictions in VN stage SKILL.md (R1-R8, D8)."""
import sys, io, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import rep, note, report

P = "Plugins/dsh-user-presets/skills/"

# ---------------------------------------------------------------- R1
# vn-continuity (shared CHECKER, loaded by all 7 presets) must use the SAME
# four sections as vn-bible-anchors (the WRITER) and the vn-script consumers.
old_r1 = """## 1. 第一基准：`00-Bible/anchors.md` 四节锚点矩阵

`00-Bible/anchors.md` 是剧情大纲前锁定的四节基准事实层，效力高于 `brainstorm.md`（已降级为创意意图记录）、高于各阶段中间稿、高于对话记忆。核查时逐节过：

| 节 | 锚点矩阵 | 逐节核查项 |
|---|---|---|
| ① 基准事实与创意核心 | 作品定位、题材、基调、叙事视角、不可动摇的前提 | 是否改变 / 否定已锁定前提；是否引入冲突题材或基调；是否私自补候选方向或未确认创意缺口 |
| ② 角色与关系 | 身份、性格内核、年龄矩阵、称谓网格、关系与信物流转状态机 | 姓名 / 身份 / 年龄 / 称谓是否一致；关系方向是否反转；矩阵是否被改写、压缩或丢失 |
| ③ 世界观与地理 | 世界规则、阵营、地理、物理与社会法则 | 是否与已锁定规则矛盾；地名 / 阵营名是否同源同写；是否越界补写未确认细节 |
| ④ 历史·术语·文风 | 时间线、专有名词、叙事时态与文风基调 | 时间线先后是否冲突；术语写法是否统一；文风是否仍以完整复合句为主 |

四节矩阵中的表格（年龄矩阵 / 称谓网格 / 信物流转状态机）是硬锚点：只比对，不压缩、不改写、不「优化」。"""

new_r1 = """## 1. 第一基准：`00-Bible/anchors.md` 四节锚点矩阵

`00-Bible/anchors.md` 是剧情大纲前锁定的四节基准事实层，效力高于 `brainstorm.md`（已降级为创意意图记录）、高于各阶段中间稿、高于对话记忆。**四节唯一定义以本表与 `vn-bible/vn-bible-anchors/SKILL.md` 为准**（两者一致）；`00-Bible/00-Bible-四份版/` 下四份 `.docx` 的固定名（核心创意与基准事实 / 角色与关系 / 世界观与地理 / 历史·术语·文风）是**收录文档的分组**，不是 `anchors.md` 的四节，不据此另立一套核查维度。核查时逐节过：

| 节 | 锚点矩阵 | 逐节核查项 |
|---|---|---|
| ① 年龄与生理时间轴矩阵（年龄矩阵） | 各角色当前年龄、关键节点年龄、年月日 / 季节 / 昼夜 / 经过天数 | 是否改变 / 否定已锁定年龄与时间线；是否私自补候选方向或未确认创意缺口 |
| ② 空间拓扑与动线模型 | 建筑属性、户型、动线连接、声光穿透法则、房间 / 门窗朝向、视线与声音遮挡 | 是否与已锁定空间规则矛盾；上下楼方式、地点位置是否同源同写；是否越界补写未确认细节 |
| ③ 称谓三层解耦网格（称谓网格） | 系统 Speaker ID、主观叙述层 / 认知称谓、对白呼告层 | 三层称谓是否一致、不混用或前后打架；矩阵是否被改写、压缩或丢失 |
| ④ 核心资产与体态状态机 | 体貌锚点、信物流转状态机（道具从哪来到哪去、当前持有者、所处阶段、状态迁移条件） | 状态迁移先后是否冲突；角色不可变体貌是否偏离锚点；矩阵是否被改写或丢失 |

四节矩阵中的表格（年龄矩阵 / 称谓网格 / 信物流转状态机）是硬锚点：只比对，不压缩、不改写、不「优化」。时间线、专有名词、文风基调等其余设定事实以 `00-Bible/` 下 `timeline.md` / `glossary.md` / `style.md` 等只读文档作次级参照，不另立第五、第六节。"""

rep(P + "vn-shared/vn-continuity/SKILL.md", old_r1, new_r1, 1)

rep(P + "vn-bible/vn-bible-anchors/SKILL.md",
    "- `<作品名>/00-Bible/anchors.md` 是唯一落点、四节结构，是本项目不可漂移的客观物理与生理基准事实源，也是 `vn-continuity` 连续性核查的第一基准、正式事实源。",
    "- `<作品名>/00-Bible/anchors.md` 是唯一落点、四节结构，是本项目不可漂移的客观物理与生理基准事实源，也是 `vn-continuity` 连续性核查的第一基准、正式事实源。**四节以本文件 §「唯一落点 / 写死路径」为唯一定义，与 `vn-continuity` §1 一致**；四份固定名 `.docx` 的分组是收录文档归类，不是 `anchors.md` 四节。", 1)

# ---------------------------------------------------------------- R2
# 3 x vn-outline: remove "按目录链逐项过" (sentence-internal contradiction)
rep(P + "vn-outline/vn-outline-chapter/SKILL.md",
    "（先过 `00-Bible/anchors.md` 四节锚点矩阵，再按目录链逐项过）",
    "（只核查本轮产物及其直接上游已确认文件，见 `vn-continuity` §2）", 1)
rep(P + "vn-outline/vn-outline-endings-flags/SKILL.md",
    "（先过 `00-Bible/anchors.md` 四节锚点矩阵，再按目录链逐项过）",
    "（只核查本轮产物及其直接上游已确认文件，见 `vn-continuity` §2）", 1)
rep(P + "vn-outline/vn-outline-structure/SKILL.md",
    "（先过 `00-Bible/anchors.md` 四节锚点矩阵，再按目录链逐项过）",
    "（只核查本轮产物及其直接上游已确认文件，见 `vn-continuity` §2）", 1)

# vn-script/continuity: full-chain check -> scoped check; no self-correction in Check
rep(P + "vn-script/continuity/SKILL.md",
    "- 修改设定后（只读复核影响面），以及每阶段产出落盘前的全量核查。",
    "- 修改设定后（只读复核影响面）。核查范围恒为本轮唯一产物及其直接上游已确认文件，不做全链全量体检（见 `vn-continuity` §2）。", 1)
rep(P + "vn-script/continuity/SKILL.md",
    "1. 本轮唯一产物与 `00-Bible/anchors.md`、`01-Plan/chapter-structure.md`、`01-Plan/endings-and-flags.md` 或 `02-Script/剧情精述.md` 不一致、且该产物尚未经用户确认时，以上游事实源为基准，在 `02-Script/` 内修正本轮产物并在核查结论中说明；产物已经用户确认的冲突按第 2 条请用户裁决。",
    "1. 本轮唯一产物与 `00-Bible/anchors.md`、`01-Plan/chapter-structure.md`、`01-Plan/endings-and-flags.md` 或 `02-Script/剧情精述.md` 不一致时，一律停下并用 `ask_user_question` 报告冲突原文位置，由用户裁决（Check 不是授权写入步，不自行修正本轮产物）；产物已经用户确认的冲突同样按第 2 条处理。", 1)
rep(P + "vn-script/continuity/SKILL.md",
    "3. 裁决或修复后的记录默认并入 `README.md` 阶段确认记录（B 区进度记录），不另建独立修订日志；用户拍板前不落盘。",
    "3. 裁决后的记录默认并入 `README.md` 阶段确认记录（B 区进度记录），不另建独立修订日志；用户拍板前不落盘。", 1)
rep(P + "vn-script/continuity/SKILL.md",
    "4. 批量改名 / 改设定属上游职责，本阶段不；先检索全部出现位置、列出改动清单、经用户确认后逐处执行、最后全局复查的流程不适用，默认回指上游文档。",
    "4. 批量改名 / 改设定属上游职责，本阶段不执行，默认回指上游文档。", 1)

# vn-script/character-voice: "修正" during Check -> stop & ask
rep(P + "vn-script/character-voice/SKILL.md",
    "发现漂移优先修正 `02-Script/` 内台词而不改上游档案",
    "发现漂移时停下并回指上游文档请用户裁决，不改写上游档案、不在 Check 步自行修正", 1)

# vn-screenplay/staging-continuity: remove "全链 Check 步基准"
rep(P + "vn-screenplay/staging-continuity/SKILL.md",
    "本 skill 沿用 vn-staging `staging-continuity` 的「五维核查」内核，改为只核查本阶段融合稿，并承担全链 Check 步基准（Check 按 vn-continuity）。",
    "本 skill 沿用 vn-staging `staging-continuity` 的「五维核查」内核，改为只核查本阶段融合稿；Check 按 `vn-continuity` 只核查本轮产物及其直接上游已确认文件，不承担全链基准。", 1)
rep(P + "vn-screenplay/staging-continuity/SKILL.md",
    "- Check 按 `vn-continuity`：本 skill 即该基准，逐条留痕（通过 / 不通过 / 待裁决）。",
    "- Check 按 `vn-continuity`：只核查本轮产物及其直接上游已确认文件，逐条留痕（通过 / 不通过 / 待裁决）。", 1)

# ---------------------------------------------------------------- R3 + R7
# 10 x vn-script: remove "以 ask_user_question 收尾" hard invariant
vnscript = ["character-voice", "continuity", "research-materials", "story-bible",
            "vn-script-format", "vn-script-outline", "vn-script-project-bootstrap",
            "vn-script-revision", "vn-script-structure", "writing-craft"]
for n in vnscript:
    rep(P + "vn-script/%s/SKILL.md" % n,
        "Stop 应停下、列出下一候选子条目并以 `ask_user_question` 收尾。",
        "Stop 应停下、报告本轮结果并列出下一候选标题，等用户下一轮指令；`ask_user_question` 只是可选确认手段，本轮工具调用顺序不设固定末位不变量。", 1)

# 8 x vn-screenplay: option groups must match vn-gate §2 (可按需选用，不必互斥套用)
rep(P + "vn-screenplay/staging-acceptance/SKILL.md",
    "Confirm / Stop 两组 `ask_user_question` 选项不跨组套用（Confirm：就做这一个 / 换一个子条目 / 先不做，停下询问；Stop：认可本轮成果 / 换一个子条目重做 / 本阶段已确认，进入下一预设）。",
    "Confirm / Stop 两组常用选项可按需选用，不必互斥套用（见 `vn-gate` §2）：Confirm 组「就做这一个 / 换一个子条目 / 先不做，停下询问」，Stop 组「认可本轮成果 / 换一个子条目重做 / 本阶段已确认，进入下一预设」。", 1)
rep(P + "vn-screenplay/staging-cues/SKILL.md",
    "Confirm / Stop 两组 `ask_user_question` 选项不跨组套用（Confirm：就做这一个 / 换一个子条目 / 先不做，停下询问；Stop：认可本轮成果 / 换一个子条目重做 / 本阶段已确认，进入下一预设）。",
    "Confirm / Stop 两组常用选项可按需选用，不必互斥套用（见 `vn-gate` §2）：Confirm 组「就做这一个 / 换一个子条目 / 先不做，停下询问」，Stop 组「认可本轮成果 / 换一个子条目重做 / 本阶段已确认，进入下一预设」。", 1)
for n in ["staging-asset-audit", "staging-continuity", "staging-direction",
          "staging-draft-format", "staging-gap-triage", "staging-project-bootstrap"]:
    rep(P + "vn-screenplay/%s/SKILL.md" % n,
        "Confirm / Stop 两组 `ask_user_question` 选项不跨组套用。",
        "Confirm / Stop 两组常用选项可按需选用，不必互斥套用（见 `vn-gate` §2）。", 1)

# ---------------------------------------------------------------- R4
# 10 x vn-script + 2 x vn-asset-list: absolute "no confirmation -> no next round"
for n in vnscript:
    rep(P + "vn-script/%s/SKILL.md" % n,
        "无用户明确确认不进入下一轮、不进入下一阶段；按用户逐轮指令推进。",
        "默认逐轮确认后推进；用户显式授权「一次做完多个子条目 / 跳过逐轮确认」时按授权节奏执行（宪法第 2 条）。", 1)
for n in ["asset-index-gap-bootstrap", "vn-asset-list"]:
    rep(P + "vn-asset-list/%s/SKILL.md" % n,
        "无用户明确确认不进入下一轮、不进入下一阶段。",
        "默认逐轮确认后推进；用户显式指令覆盖时按宪法第 2 条处理。", 1)

# ---------------------------------------------------------------- R5
# 8 x vn-screenplay hard gates: add user-override clause
rep(P + "vn-screenplay/staging-draft-format/SKILL.md",
    "## 硬门（应写死）", "## 硬门（默认前置，用户显式指令可覆盖）", 1)
rep(P + "vn-screenplay/staging-draft-format/SKILL.md",
    "写死硬门，进度必须落磁盘", "默认硬门（用户显式指令可覆盖），进度应落磁盘", 1)
rep(P + "vn-screenplay/staging-draft-format/SKILL.md",
    "且未经用户确认之前，不开始逐场演出剧本**",
    "且未经用户确认之前，默认不开始逐场演出剧本（用户显式指令可覆盖）**", 1)
for n in ["staging-acceptance", "staging-asset-audit", "staging-continuity",
          "staging-cues", "staging-direction", "staging-gap-triage", "staging-project-bootstrap"]:
    rep(P + "vn-screenplay/%s/SKILL.md" % n,
        "**不开始逐场演出剧本**", "**默认不开始逐场演出剧本（用户显式指令可覆盖）**", 1)
rep(P + "vn-screenplay/staging-acceptance/SKILL.md",
    "缺失或未经用户确认则禁止开始逐场演出剧本",
    "缺失或未经用户确认时默认停下询问（用户显式指令可覆盖）", 1)
rep(P + "vn-screenplay/staging-project-bootstrap/SKILL.md",
    "硬门未过不创建任何逐场演出剧本文件。",
    "硬门未过默认不创建任何逐场演出剧本文件（用户显式指令可覆盖）。", 1)
# asset-list side + asset-make side: same default/override wording
rep(P + "vn-asset-list/asset-index-gap-bootstrap/SKILL.md",
    "未完成并经用户确认前，不开始逐场稿",
    "未完成并经用户确认前，默认不开始逐场稿（用户显式指令可覆盖）", 1)
for n in ["asset-index-gap-bootstrap", "vn-asset-list"]:
    rep(P + "vn-asset-list/%s/SKILL.md" % n,
        "逐场演出剧本的硬门前置", "逐场演出剧本的默认硬门前置（用户显式指令可覆盖）", 1)
rep(P + "vn-asset-make/asset-make-status-sync/SKILL.md",
    "逐场稿硬门前置", "逐场稿默认硬门前置（用户显式指令可覆盖）", 2)
rep(P + "vn-game/game-implementation-spec/SKILL.md",
    "## 2. 引擎确认（硬门禁）", "## 2. 引擎确认（默认门禁，用户显式指令可覆盖）", 1)

# ---------------------------------------------------------------- R6
# unify "已确认" state rule
rep(P + "vn-shared/vn-continuity/SKILL.md",
    "- 用户裁决后，在 `README.md` B 区「进度记录」追加一行记入「冲突位置 / 裁决结论 / 裁决人 / 轮次」，并由 AI 代为把 A 区状态置「已确认」（默认不自行置位，用户显式授权时按授权）；B 区既有行不改写。",
    "- 用户裁决后，在 `README.md` B 区「进度记录」追加一行记入「冲突位置 / 裁决结论 / 裁决人 / 轮次」；A 区状态仍保持「待确认」，不因裁决自行置「已确认」。状态置「已确认」的统一判据是用户在确认中明确认可本轮成果后由 AI 代为登记（见 `vn-gate` §4），用户显式授权时按授权处理；B 区既有行不改写。", 1)
rep(P + "vn-game/game-acceptance/SKILL.md",
    "- 只有用户在 Stop 步 `ask_user_question` 明确确认后才可置「已确认」并推进；AI 不自行置位。",
    "- 状态置「已确认」的统一判据：用户在确认中明确认可本轮成果后由 AI 代为登记（见 `vn-gate` §4），不限定具体工具或步骤；AI 不自行置位。", 1)
rep(P + "vn-game/game-engine-skeleton/SKILL.md",
    "- `README.md` A 区 `状态=已确认`（由用户在 `ask_user_question` 中确认，AI 不自行置位）。",
    "- `README.md` A 区 `状态=已确认`（用户明确认可本轮成果后由 AI 代为登记，AI 不自行置位；见 `vn-gate` §4）。", 1)

# ---------------------------------------------------------------- R8
# dangling §3.0.7 (11 files) -> vn-gate §4
for n in ["vn-asset-list/asset-index-gap-bootstrap", "vn-asset-list/vn-asset-list",
          "vn-asset-make/asset-make-generate", "vn-asset-make/asset-make-spec-read",
          "vn-asset-make/asset-make-status-sync", "vn-asset-make/asset-make-verify",
          "vn-screenplay/staging-asset-audit", "vn-screenplay/staging-continuity",
          "vn-screenplay/staging-direction", "vn-screenplay/staging-gap-triage"]:
    rep(P + n + "/SKILL.md", "双区结构（§3.0.7）", "双区结构（见 `vn-gate` §4）", 1)
rep(P + "vn-screenplay/staging-acceptance/SKILL.md",
    "按 §3.0.7 双区结构", "按 `vn-gate` §4 的双区结构", 1)

# vn-bible-bootstrap: remove §2.2/§2.3/§2.4 dangling refs, point to vn-spec
rep(P + "vn-bible/vn-bible-bootstrap/SKILL.md",
    "- `<作品名>/Specifications.md`：唯一规范事实源，按 §2.4 四节骨架落盘 —— ① 来源记录 ② 结构与目录约定（§2.2 全表「6 个编号目录 + 3 个根级文档」+ §2.3 十条目录纪律，含 `Direction.md` 静态导航定位、02/04 分工、`asset-index.md` / `asset-gap.md` 协作与硬门、越界收敛原则）③ 产出格式规范（三位编号 `ch001` / `sc001`、`-` 连接符防灾、禁裸 `~`、复合句要求、抽象层级边界）④ 红线与禁忌（不台词入大纲、不计划外文档、不越权写入、不跨阶段预写、不把 `Direction.md` 当事实源或状态机）。",
    "- `<作品名>/Specifications.md`：唯一规范事实源。四节骨架、目录全表、十条目录纪律、命名与读写权限矩阵一律按 `skills/vn-shared/vn-spec/SKILL.md` 落盘（它是目录与格式的单一真源，本 skill 不另写一份、不引用任何章节号）；四节为 ① 来源记录 ② 结构与目录约定（6 个编号目录 + 3 个根级文档全表 + 十条目录纪律）③ 产出格式规范（三位编号 `ch001` / `sc001`、`-` 连接符防灾、禁裸 `~`、复合句要求、抽象层级边界）④ 红线与禁忌。不把 `Direction.md` 当事实源或状态机。", 1)
rep(P + "vn-bible/vn-bible-bootstrap/SKILL.md",
    "- §2.2 六目录全表只写进 `Specifications.md`；",
    "- 六目录全表只按 `vn-spec` 写进 `Specifications.md`；", 1)

# ---------------------------------------------------------------- D8 + vn-gate clarifications
rep(P + "vn-shared/vn-spec/SKILL.md",
    "全结构 = **6 个编号目录** + **3 个根级文档**。除此之外没有合法产出落点。",
    "全结构 = **6 个编号目录** + **3 个根级文档**；这句话指**目录白名单**（允许新建的目录与根级文档），不是文件名白名单。具体允许的文件名见本节目录树与 §5 命名规范，不按字面拒绝目录树里已列出的文件（如 `00-Bible/anchors.md`）。", 1)
rep(P + "vn-shared/vn-gate/SKILL.md",
    "- 「README 状态登记」与「成果交付」的时点：默认在**下一轮 Read 之前**完成，也可在本轮 Stop 之前完成；两者都不属于「提问之后禁止的动作」，不存在时序矛盾。",
    "- 「README 状态登记」与「成果交付」的时点：默认在本轮 Write 之后、下一轮 Read 之前完成（可在本轮 Stop 之前完成）。本轮不设固定末位工具调用，因此两者都不属于「提问之后禁止的动作」，不存在时序矛盾。", 1)
rep(P + "vn-shared/vn-gate/SKILL.md",
    "- 三份共享 skill 冲突时按 `vn-gate`（流程）> `vn-spec`（目录与格式）> `vn-continuity`（核查）执行；都不与宪法冲突。",
    "- 三份共享 skill 冲突时按 `vn-gate`（流程）> `vn-spec`（目录与格式）> `vn-continuity`（核查）执行；都不与宪法冲突。\n- 各阶段 skill 里重复出现的目录白名单 / 七步循环 / README 状态机 / 核查范围只是便于离线阅读的副本，与 `vn-shared` 三份 SKILL.md 冲突时以 `vn-shared` 为准，不逐条复述比对。", 1)

report("A_vnskills")
