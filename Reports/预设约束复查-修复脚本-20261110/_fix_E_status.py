# -*- coding: utf-8 -*-
"""Append implementation-status section + final index updates."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import read, write, rep, report

REP2 = "Reports/预设约束互博治理后复查-20261110.md"
RREADME = "README.md"

STATUS = r"""

---

## 9. 修复实施状态（2026-11-10，用户授权「全部修复/优化」后执行）

> 本节记录复查报告交付**之后**的落地情况。修复前快照：`Archive/Plugins/dsh-user-presets-auditfix-20261110/`（含 `cordis.patch.yml`、全部 `skills/`、两份历史文档、现行规范、首轮报告、根 README）。所有改动为静态文本/配置修改，**运行时验证仍需开新会话或重启 DSH**。

### 9.1 P0 · 运行时真矛盾（已全部修）

| 项 | 处理 | 落地位置 |
|---|---|---|
| R1 `anchors.md` 四节两套定义 | 统一为「①年龄与生理时间轴矩阵 ②空间拓扑与动线模型 ③称谓三层解耦网格 ④核心资产与体态状态机」；`vn-continuity` §1 改用此表并注明「四份 `.docx` 固定名是收录分组，不是四节」；`vn-bible-anchors` 加同源声明 | `vn-shared/vn-continuity/SKILL.md`、`vn-bible/vn-bible-anchors/SKILL.md` |
| R2 核查范围互斥 | 删 3 份 `vn-outline` 的「再按目录链逐项过」、`vn-script/continuity` 的「全量核查 / 修正本轮产物 / 批量全局复查」、`vn-screenplay/staging-continuity` 的「承担全链 Check 步基准」；`character-voice` 的「优先修正」改为「停下回指上游」 | 6 份 skill |
| R3 末位 `ask_user_question` 残留 | 10 份 `vn-script` 的「以 `ask_user_question` 收尾」改为「不设固定末位不变量」；`vn-gate` §2 时序句改「Write 之后、下一轮 Read 之前」 | 11 份 skill |
| R4 绝对确认句 | 12 处「无用户明确确认不进入下一轮」改为「默认逐轮确认；用户显式授权时按宪法第 2 条」 | 12 份 skill |
| R5 硬门无豁免 | 8 份 `vn-screenplay` 硬门 + `asset-list` / `asset-make` / `vn-game` 侧统一补「默认…（用户显式指令可覆盖）」；`staging-draft-format` 标题「应写死」改「默认前置，可覆盖」 | 12 份 skill |
| R6 「置已确认」时机 | `vn-continuity` §5 去掉自拗的「裁决后由 AI 代为置已确认」，统一为「裁决后 A 区仍待确认；用户明确认可本轮成果后 AI 代为登记」；`game-acceptance` / `game-engine-skeleton` 去掉「仅 Stop 步 / 仅 ask_user_question」限定 | 3 份 skill |
| R7 选项规则互斥 | 8 份 `vn-screenplay`「不跨组套用」改为与 `vn-gate` §2 一致的「可按需选用，不必互斥套用」 | 8 份 skill |
| R8 双真源 / 悬空章节 | `vn-bible-bootstrap` 删 `§2.2/§2.3/§2.4`，改为「按 `vn-spec` 落盘」；11 处 `§3.0.7` 改指 `vn-gate` §4；yml 的 `写入 §2.4 四节骨架` 改「按 `vn-spec`」 | 12 份 skill + yml |
| D8 白名单两层混谈 | `vn-spec:59` 补「指目录白名单，不是文件名白名单」；`vn-gate` §0 补「阶段 skill 的副本与 `vn-shared` 冲突时以 `vn-shared` 为准」 | 2 份 skill |

机械复验：末位收尾 / 不跨组套用 / 无确认不进入 / 按目录链逐项过 / 修正本轮产物 / 承担全链 / 应写死 / 禁止开始 / `§3.0.7` / `§2.2-2.4` / B 版四节 **全部 0 命中**；残留的「不全量核查」「不自行修正」均为否定语境。

### 9.2 P0 · 文档层活的对抗源（已修）

- 两份历史文档头部换成**全文失效围栏**（明确「整篇历史归档、正文现在时祈使句全是历史陈述、不得据此要求模型遵守」），并给出唯一现行入口链接。
- `施工文档` §4.3 **整段删除 130 行内嵌 `vn-gate/SKILL.md` 草案**（自称「全工作流唯一真源」的第三套可执行文本），替换为「历史草案已移除」说明；§3.0.6 加历史设计标注；步骤 8 与 `说明` §8 改过去时；`说明` §6.2 14 项验证清单标注「历史清单、不作现行验收口径」。
- `现行规范` 定位改为「唯一的人类可读现行规范入口 / 转录、不新增不覆盖运行时规则」，消除「索引 × 规范本体 × 唯一真源」三方冲突；§6 两行「已全部移除」限定为「7 个 VN 预设 + vn-shared + 全部 VN 阶段 skill」，并注明 13 个旧非 VN 预设保留各自 plan-mode 段但会话互斥。
- 首轮报告：75 条链接**实测 0 悬空**（补 `../`，其中 2 条同目录报告链接保持相对）；加「实施状态补记」（A 已实施、B1–B5 已实施、B6 复查后补做、C1–C2 已实施、C3 未实现、§7 取舍现状）；§5 的 77 处分解补齐 `13+36+3+20+2+3=77` 并注明是治理前历史测量值；§7 加取舍现状说明；数字改定性描述（删内嵌草案后行数已变，不再写死 2757/224）。
- `说明:7` ↔ `施工文档` 步骤 8 的循环引用改为过去时并置于围栏内，不再构成「现在时互相授权」。

### 9.3 P1 · 一致性 / 索引（已修）

| 项 | 处理 |
|---|---|
| N1 维护政策三方互斥 | yml `genre-fiction` 注释「共享 11 个 skills / 原预设一律不动」改为「物理副本、改动须同步、见 `_SYNC-POLICY.md`」 |
| N2 母本/派生版 | 两份 `novel-project-bootstrap` 的 `/skills/` 悬空路径改对，明确「共性改两份、开题类型判定只改 genre 版」 |
| N5 悬空路径 | `comfyui-work/moss-image-guide` 的 `compile_prompt.py` 改绝对路径（带空格加引号） |
| `preset-vn-game` description | 「两道确认门 × 三道门禁」自相矛盾 + 「必须先/禁止/一律」软化；「三道门禁」0 命中 |
| `preset-vn-asset-make` description | 「每轮调用前必须用 ask_user_question / 未确认禁止调用」软化，补「用户已明示视为已确认、显式指令可覆盖」 |
| B6 旧预设死文本 | 3 条 `disabled: true` 旧预设的 Agentic work 句加「历史文本 · 已停用，整体 disabled、不注入任何会话」注释 |
| bundle README | 13/12 → **20 个 preset**，补 7 个 VN 预设与 `vn-shared` 挂载索引表、同源副本政策指针、3 个 `.bak` 备份登记、孤儿树说明 |
| 根 README | `:99`「仍在役」改「均已加全文失效围栏、历史留档」并指出现行入口；`:109` Reports 索引补状态说明；`:147` 改定性描述 |

### 9.4 重复与孤儿树（建立治理机制，不做破坏性抽取）

- 新建 [`skills/_SYNC-POLICY.md`](../Plugins/dsh-user-presets/skills/_SYNC-POLICY.md)：登记 G1–G6 共 6 组同源副本（10 对逐字节相同的 genre↔novel、4 份 spec-common、5 份 search-query-craft、7 份宪法段、7×107 行工具行、VN 阶段模板），说明「Loader 每 preset 独立挂载，**不能删单侧**」，给出改前查表 / 改后 md5 校验的操作守则。
- 29 份逐字节相同（或近乎相同）的 SKILL.md 头部加「【同源副本】改动须同步组内全部副本」声明，避免单边漂移。
- **未做破坏性抽取**（P2 #15 的物理 `skills/_shared/` 抽真源）：跨 tree 解析需要给 2 个非 VN preset 各加第三个 `customSkillDirs`、并改写 27 份 VN 阶段 skill 的正文，风险与回归面远大于收益。改用 `vn-gate` §0 的「副本与 `vn-shared` 冲突时以 `vn-shared` 为准」 + `_SYNC-POLICY.md` G6 登记，达到同样的「单一真源、防漂移」效果且不改运行时挂载。
- **孤儿树 `prompt-writing/`**（9 份 SKILL.md，无任何 preset 挂载）：未物理移出 `skills/`（移走会让 `Plugins/dsh-user-presets/README.md` 的历史引用与磁盘结构对不上）。改按 P2 #16 的「定位为文档库」落地——`_SYNC-POLICY.md` 末尾与 bundle README 明确写「运行时不可达、按文档直接读文件引用、不要指望 `skill` 工具加载」，`dsh-preset-craft` 的引用改为文档引用。

### 9.5 明确未做（需单独排期 / 影响面大）

- **C3 Host 物理门禁**（`dsh-tool-gate` / 新 Host 插件在工具调用层强制「一轮 1 次 write + 末位 ask」）：影响所有会话，需单独回归；本轮只做 prompt/skill 层结构治理。
- **运行时行为验证**：bundle 以 `link:` 挂载，已运行会话保留启动时插件修订；需开新会话或重启 DSH 后用首轮报告 §6 方案 D 的 5 条对照 prompt 验证思考长度 / 工具调用数。
- **13 个旧非 VN preset 的 `exit_plan_mode` 段**：按复查报告 §6 判定为「不同会话、不构成会话内矛盾」，有意保留，未动。

### 9.6 改动清单（静态校验）

- 共 **4 轮脚本、150+ 处精确替换**，全部带出现次数断言；79（A）+ 41（B）+ 21（C）+ 8（D）+ 状态章节，涉及 1 份 yml、约 60 份 SKILL.md、1 份新建政策文件、6 份文档/README。
- 所有 Markdown 链接实测 0 悬空；所有被改文件保持 LF 行尾与 UTF-8；治理前快照与本轮修复前快照均可回退。
"""

t = read(REP2)
write(REP2, t.rstrip("\n") + STATUS)

# root README:145 B6 status + add sync policy / fix index note
rep(RREADME,
    "（B6 未做、C3 Host 物理门禁未实现，见复查报告）",
    "（B6 已于复查后补做、C3 Host 物理门禁仍未实现，见复查报告 §9 修复实施状态）", 1)
rep(RREADME,
    "| `预设约束互博治理后复查-20261110.md` | `Reports/` | 治理后（**5699 行版**）第二轮全量复查（2026-11-10）：20 个 preset / 164 份 SKILL.md / 7 份文档，4 个子代理分层精读 + 机械全量扫描；结论为「宪法段自洽、但 VN7 阶段 SKILL 仍有 6+ 组运行时真矛盾（anchors 四节两套定义、核查范围互斥、10 处末位 ask 收尾残留等）、大规模整块复制、两份历史文档仍以现在时下命令」，含 P0–P2 修复优先级 |",
    "| `预设约束互博治理后复查-20261110.md` | `Reports/` | 治理后（**5699 行版**）第二轮全量复查（2026-11-10）：20 个 preset / 164 份 SKILL.md / 7 份文档，4 个子代理分层精读 + 机械全量扫描；结论为「宪法段自洽、但 VN7 阶段 SKILL 仍有 6+ 组运行时真矛盾（anchors 四节两套定义、核查范围互斥、10 处末位 ask 收尾残留等）、大规模整块复制、两份历史文档仍以现在时下命令」，含 P0–P2 修复优先级与 **§9 修复实施状态（用户授权后已全部落地）** |", 1)
rep(RREADME,
    "| `VN-工作流现行规范.md` | `Plugins/dsh-user-presets/` |",
    "| `skills/_SYNC-POLICY.md` | `Plugins/dsh-user-presets/skills/` | 同源副本同步政策（2026-11-10 复查后建立）：登记 6 组逐字节相同 / 派生 SKILL.md 与 7 份宪法段，说明 Loader 每 preset 独立挂载、不能删单侧，给出改前查表 / 改后 md5 校验守则；末尾标注 `prompt-writing/` 孤儿树的文档库定位 |\n| `VN-工作流现行规范.md` | `Plugins/dsh-user-presets/` |", 1)

report("E_status")
