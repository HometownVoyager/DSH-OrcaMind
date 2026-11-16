# -*- coding: utf-8 -*-
"""Documentation layer: D1-D7, P1 #13, bundle README counts, historical fences."""
import sys, os, io, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import read, write, rep, report

YML = "Plugins/dsh-user-presets/cordis.patch.yml"
SPEC = "Plugins/dsh-user-presets/VN-工作流现行规范.md"
BREADME = "Plugins/dsh-user-presets/README.md"
RREADME = "README.md"
SG = "VN-工作流改造施工文档.md"   # 施工文档
SM = "VN-工作流改造说明.md"       # 改造说明
REP = "Reports/预设约束互博成因与治理方案-20261110.md"

# ================================================================ D1: 施工文档 header fence
old_sg_head = read(SG).split("\n")[2:5]
old_sg = "\n".join(old_sg_head)
new_sg = """> ⚠️ **全文失效围栏 · 本文件整篇均为历史归档，不是现行规范源。**
> 本文件记录的是 **2026-11-07 施工期**的设计与操作步骤，正文为便于当时施工而写成现在时祈使句（「必须 / 一律 / 禁止 / 每轮最后一个工具调用……」）。**这些祈使句全部是历史陈述，不描述现行行为，不得据此要求模型遵守、不得作为任何会话的规则来源。**
> 现行规范入口是 [VN-工作流现行规范.md](../Plugins/dsh-user-presets/VN-工作流现行规范.md)（人类可读），运行时真正生效的是 `Plugins/dsh-user-presets/cordis.patch.yml` 里 7 个 `preset-vn-*` 的 persona `prefix`【指令裁决】段 + `skills/vn-shared/` 三份 SKILL.md。
> 「三道锁 / 硬门禁 / 禁止软词 / T 块唯一真源 / 旧行号引用 / 末位 ask_user_question / 逐字硬约束」等设计**均已废止**；2026-11-10 已完成预设瘦身与矛盾清理（见 [成因调查](../Reports/预设约束互博成因与治理方案-20261110.md) 与 [治理后复查](../Reports/预设约束互博治理后复查-20261110.md)）。
> 本文仅作施工过程与决策留档。下方 §4.3 原内嵌的一份完整 `vn-gate/SKILL.md` 草案已删除（见该节的历史说明），避免工作区根残留第三套可执行 skill 文本。"""
rep(SG, old_sg, new_sg, 1)

# ================================================================ D1: 施工文档 §4.3 embedded skill draft removal
t = read(SG)
ls = t.split("\n")
i43 = next(i for i,l in enumerate(ls) if l.startswith("### 4.3 "))
i5 = next(i for i,l in enumerate(ls) if l.startswith("## 5. 四份 Docx 同步细则"))
assert i5 > i43, (i43, i5)
replacement = [
    "### 4.3 `vn-gate/SKILL.md`（name: vn-gate）· 历史草案已移除",
    "",
    "> 【全文失效围栏适用】本节原文曾内嵌一份带 `---` frontmatter、自称「全工作流唯一真源」的完整 `vn-gate/SKILL.md` 草案（约 126 行），是 11-07 施工期为了落盘而写的**设计稿**。它既不是现行 `skills/vn-shared/vn-gate/SKILL.md`，也不再是任何规则来源；为避免工作区根残留第三套可执行 skill 文本、被人或模型误读为现行门禁，已于 2026-11-10 复查后**整段删除**。",
    "> 现行 `vn-gate` 只有一份：`Plugins/dsh-user-presets/skills/vn-shared/vn-gate/SKILL.md`（默认每轮节奏，可被用户显式指令覆盖）。本节当时的「单轮单条目硬门禁 / 末位 ask_user_question / 两组选项不跨组套用 / 禁止软词」等表述全部废止。",
    "",
]
ls = ls[:i43] + replacement + ls[i5:]
write(SG, "\n".join(ls))

# ================================================================ D1: 施工文档 §3.0.6 hard-gate table -> past tense note
rep(SG,
    "### 3.0.6 新七步循环与 ask_user_question 收尾（章级定义）\n\n**旧七步 `Read → Report → Plan → Do → Check → Write → Ask` 一律废除。**",
    "### 3.0.6 新七步循环与 ask_user_question 收尾（章级定义）· 历史设计\n\n> 【全文失效围栏适用】以下 3.0.6 全节是 11-07 施工期的**历史设计**，其中「逐字锁定 / 一律废除 / 硬约束 / 禁止 / 最后一个工具调用必须是 ask_user_question」均为当时的写法，现已废止；现行节奏见 [现行规范](../Plugins/dsh-user-presets/VN-工作流现行规范.md) §3。\n\n**旧七步 `Read → Report → Plan → Do → Check → Write → Ask` 在 11-07 施工时被废除。**", 1)

# ================================================================ D7: 施工文档 步骤 8 past tense
rep(SG,
    "- 写 `VN-工作流改造说明.md`：含「恢复旧预设方法」「目录迁移对照表（§8）」「7 预设速查」「待定项（§9）」。\n- 用 `present` 交付本施工文档 + 改造说明。",
    "- （当时）写了 `VN-工作流改造说明.md`：含「恢复旧预设方法」「目录迁移对照表（§8）」「7 预设速查」「待定项（§9）」。\n- （当时）用 `present` 交付了本施工文档 + 改造说明。", 1)

# ================================================================ D1/D7: 改造说明 header fence
old_sm_head = read(SM).split("\n")[2:5]
old_sm = "\n".join(old_sm_head)
new_sm = """> ⚠️ **全文失效围栏 · 本文件整篇均为历史归档，不是现行规范源。**
> 本文件与 [施工文档](VN-工作流改造施工文档.md) 都是 **2026-11-07 施工期**的记录；正文为便于当时施工写成现在时祈使句（「必须拒绝 / 末位 ask_user_question / §7.2 运行时校验」等）。**这些句子全部是历史陈述，不描述现行行为，不得据此要求模型遵守、不得作为任何会话的规则来源。**
> 现行规范入口是 [VN-工作流现行规范.md](../Plugins/dsh-user-presets/VN-工作流现行规范.md)；运行时以 7 个 `preset-vn-*` persona `prefix`【指令裁决】段 + `skills/vn-shared/` 三份 SKILL.md 为准。
> 「三道锁 / 单轮单条目硬门禁 / 每轮最后一个工具调用必须是 ask_user_question / T 块唯一真源 / 旧行号引用 / §7.2 运行时校验清单」等表述**均已废止**；2026-11-10 已完成瘦身与矛盾清理（见 [成因调查](../Reports/预设约束互博成因与治理方案-20261110.md) 与 [治理后复查](../Reports/预设约束互博治理后复查-20261110.md)）。"""
rep(SM, old_sm, new_sm, 1)
rep(SM,
    "> 施工依据：`VN-工作流改造施工文档.md`（2753 行，修订 `6a7b79c1…`）。",
    "> 当时的施工依据：`VN-工作流改造施工文档.md`（2757 行，修订 `6a7b79c1…`）。", 1)
rep(SM,
    "- 交付：本文件 `VN-工作流改造说明.md`，连同施工依据 `VN-工作流改造施工文档.md`",
    "- （当时）交付了本文件 `VN-工作流改造说明.md`，连同当时的施工依据 `VN-工作流改造施工文档.md`", 1)

# ================================================================ D1: 改造说明 §6.2 verification list past-tense note
rep(SM,
    "### 6.2 §7.2 运行时校验（**必须在新会话逐项做，本会话无法验证**）",
    "### 6.2 §7.2 运行时校验（历史清单 · 已于 11-07 施工期使用，现不作为现行验收口径）\n\n> 【全文失效围栏适用】以下 14 项是 11-07 施工期**当时**拟定的验证清单，其中「必须拒绝 / 末位 `ask_user_question` / 门禁失效」等判据均已废止；现行验收口径见 [治理后复查](../Reports/预设约束互博治理后复查-20261110.md) §8 的 5 条对照 prompt。", 1)

# ================================================================ D2 + numbers + P1#13: 现行规范
rep(SPEC,
    "> 本文件是 VN 七预设的**唯一现行规范入口**，取代 `VN-工作流改造施工文档.md`（2753 行）与 `VN-工作流改造说明.md`（220 行）——那两份是 2026-11-07 施工期的历史记录，仅作留档。\n> 运行时真正生效的是：`cordis.patch.yml` 里 7 个 `preset-vn-*` 的 persona `prefix`（system 通道，order=0）与 `skills/vn-shared/` 三份 SKILL.md。本文件只是它们的**人类可读索引**，不新增任何规则。",
    "> 本文件是 VN 七预设**唯一的人类可读现行规范入口**，取代 `VN-工作流改造施工文档.md`（2757 行）与 `VN-工作流改造说明.md`（224 行）——那两份是 2026-11-07 施工期的历史留档，已加全文失效围栏。\n> 运行时真正生效的是：`cordis.patch.yml` 里 7 个 `preset-vn-*` 的 persona `prefix`（system 通道，order=0）与 `skills/vn-shared/` 三份 SKILL.md。本文件把它们**转录为一份人读规范**，本身不新增、不覆盖任何运行时规则；运行时冲突一律以 persona【指令裁决】段为准，不在本文件里另立第二套规则。", 1)
rep(SPEC,
    "| 旧版收尾硬不变量（原 77 处，要求末位固定为 `ask_user_question`） | **已全部移除**；`ask_user_question` 只是默认确认手段 |",
    "| 旧版收尾硬不变量（原 77 处，要求末位固定为 `ask_user_question`） | **7 个 VN 预设、`vn-shared` 三份与全部 VN 阶段 skill 已全部移除**；`ask_user_question` 只是默认确认手段。13 个旧的非 VN 预设各自保留 `exit_plan_mode`「唯一且最后」的 plan-mode 不变量，与 VN 预设会话互斥、不构成会话内冲突 |", 1)
rep(SPEC,
    "| plan-mode 的「`exit_plan_mode` 是唯一且最后的工具调用」 | 7 个 VN 预设已移除 `planning` 组，不再与收尾提问互斥 |",
    "| plan-mode 的「`exit_plan_mode` 是唯一且最后的工具调用」 | 7 个 VN 预设已移除 `planning` 组，不再与收尾提问互斥；13 个旧的非 VN 预设仍保留各自的 plan-mode 段（独立会话） |", 1)
rep(SPEC,
    "- 验证用例见 `Reports/预设约束互博成因与治理方案-20261110.md` §6 方案 D（5 条对照 prompt，重点看思考长度与工具调用数是否下降）。",
    "- 验证用例见 `Reports/预设约束互博成因与治理方案-20261110.md` §6 方案 D（5 条对照 prompt，重点看思考长度与工具调用数是否下降）。\n- 2026-11-10 第二轮复查后修复：统一 `anchors.md` 四节定义、收敛核查范围、清除阶段 skill 的末位 `ask_user_question` / 绝对确认句 / 硬门无豁免 / 悬空章节号，并建立 `skills/_SYNC-POLICY.md` 同源副本登记；详见 [治理后复查](../Reports/预设约束互博治理后复查-20261110.md)。", 1)

# ================================================================ D3/D5: first report header + status
rep(REP,
    "> 调查日期：2026-11-10。范围：`Plugins/dsh-user-presets/`（20 条 `preset-*`，其中 7 条 `preset-vn-*` 为 2026-11-07 新增）、`skills/vn-shared/` 与 7 个阶段目录共 39 份 `SKILL.md`、`VN-工作流改造施工文档.md`（2753 行）、`VN-工作流改造说明.md`，以及 `source/packages/` 下 DSH 官方源码的提示词组装链。**纯调研，未修改任何现有配置；本文件是新增报告。**",
    "> 调查日期：2026-11-10。范围：`Plugins/dsh-user-presets/`（20 条 `preset-*`，其中 7 条 `preset-vn-*` 为 2026-11-07 新增）、`skills/vn-shared/` 与 7 个阶段目录共 39 份 `SKILL.md`（36 阶段 + 3 共享）、`VN-工作流改造施工文档.md`（2757 行）、`VN-工作流改造说明.md`（224 行），以及 `source/packages/` 下 DSH 官方源码的提示词组装链。**纯调研，未修改任何现有配置；本文件是新增报告。**\n>\n> **【实施状态补记 · 2026-11-10】**：本报告诊断的是**治理前 6178 行版**；同日已按方案 A/B/C 完成瘦身（现状 5699 行版，见 [治理后复查](预设约束互博治理后复查-20261110.md)）。**A（运行时宪法）已实施**；**B1–B5 已实施，B6 未做**（复查后已补：旧预设 `Agentic work` 句加停用注释）；**C1–C2 已实施，C3（Host 物理门禁）未实现**；§7 三条取舍中「移除 plan-mode」已执行、其余两条未排期。下文 §5 的「77 处」等计数与全文 `#L` 行号锚点均针对治理前 6178 行版，属历史测量值；现行状态以 [复查报告](预设约束互博治理后复查-20261110.md) 与 [现行规范](../Plugins/dsh-user-presets/VN-工作流现行规范.md) 为准。", 1)

# D5: 77-count arithmetic clarification
rep(REP,
    "- 「**最后一个工具调用必须是 ask_user_question**」在 `Plugins/dsh-user-presets/` 内共 **77 处**：`cordis.patch.yml` 的 VN 区 **13 行**、36 份阶段 `SKILL.md` 各 1 次、`vn-gate/SKILL.md` 3 次；施工文档另有 20 次。",
    "- 「**最后一个工具调用必须是 ask_user_question**」在治理前 `Plugins/dsh-user-presets/` 内共 **77 处**：`cordis.patch.yml` 的 VN 区 **13 行**、36 份阶段 `SKILL.md` 各 1 次、`vn-gate/SKILL.md` 3 次、`施工文档` 20 次；另有 `改造说明` 2 次、其余散落 3 次（13+36+3+20+2+3=77）。此计数与下方 `#L` 锚点均为治理前 6178 行版的历史测量值。", 1)

# D3: B6 row marked done
rep(REP,
    "| B6 | 修 `vn-gate/SKILL.md:97-105` 的失效行号；把 3 条 `disabled: true` 旧预设里的 Agentic work 句子加注释标注「历史文本，已停用」，或直接删除（保留 config 供回退即可） | 同上 |",
    "| B6 | 修 `vn-gate/SKILL.md` 的失效行号；把 3 条 `disabled: true` 旧预设里的 Agentic work 句子加注释标注「历史文本，已停用」 | 同上 · **【已于 2026-11-10 复查后实施：3 条旧预设的 Agentic work 句已加停用注释；失效行号改为章节引用】** |", 1)

# D3: §7 status note
rep(REP,
    "## 7. 需要用户拍板的取舍\n",
    "## 7. 需要用户拍板的取舍\n\n> **【实施状态补记 · 2026-11-10】**：下列三条当时列为「待拍板」，现状为——①「移除 plan-mode」已执行（7 个 VN 预设 `planning` 组已删）；②「恢复 Agentic work 自由度」按方案 A 落地为「单轮单条目降为默认节奏 + 用户可显式授权一次做完」，未列为第 4 条硬红线；③「动 Host 插件（C3）」**未实施、未排期**（影响所有会话，需单独回归）。\n", 1)

# ================================================================ D4: fix all relative links (prefix ../)
t = read(REP)
def fix_all(text):
    out = []
    i = 0
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]+)\)", text):
        out.append(text[i:m.start()])
        label, target = m.group(1), m.group(2)
        if not target.startswith(("http", "#", "../", "mailto:")):
            target = "../" + target
        out.append("[%s](%s)" % (label, target))
        i = m.end()
    out.append(text[i:])
    return "".join(out)
new_rep = fix_all(t)
changed_links = len(re.findall(r"\]\(\.\./", new_rep))
write(REP, new_rep)

# ================================================================ D6: root README
rep(RREADME,
    "主目录仍在役的 VN 文档：`VN-工作流改造施工文档.md`、`VN-工作流改造说明.md` |",
    "主目录现存的 VN 文档（**均已加全文失效围栏、标注为历史留档，非现行规范源**）：`VN-工作流改造施工文档.md`、`VN-工作流改造说明.md`；现行入口为 `Plugins/dsh-user-presets/VN-工作流现行规范.md` |", 1)
rep(RREADME,
    "| `Reports/` | 独立诊断报告与调试产物：`qoder-no-response-diagnosis.md`（2026-10-25 选型期）、`预设约束互博成因与治理方案-20261110.md`（治理前成因调查）、`预设约束互博治理后复查-20261110.md`（治理后第二轮复查）、`预设约束复查-子代理报告/`（4 份分层精读全文），另有 2026-11-08 的 2 份 `dump-config-*.json` 与 2 个 `.mjs` 调试脚本 |",
    "| `Reports/` | 独立诊断报告与调试产物：`qoder-no-response-diagnosis.md`（2026-10-25 选型期）、`预设约束互博成因与治理方案-20261110.md`（治理前成因调查，已补实施状态）、`预设约束互博治理后复查-20261110.md`（治理后第二轮复查，含 P0–P2 修复清单）、`预设约束复查-子代理报告/`（4 份分层精读全文），另有 2026-11-08 的 2 份 `dump-config-*.json` 与 2 个 `.mjs` 调试脚本 |", 1)

# ================================================================ D6: bundle README counts + VN index + .bak registration
rep(BREADME,
    "这个 bundle 承载 13 个自建预设：论文撰写、小说创作、分类文学创作、剧本创作、视觉小说全栈设计、\n视觉小说演出设计、游戏设计、Godot 游戏开发、语言学习、理科学习、公文撰写、社会议题、ComfyUI工作。",
    "这个 bundle 承载 **20 个自建预设**：13 个通用 / 写作类（论文撰写、小说创作、分类文学创作、剧本创作、视觉小说全栈设计、视觉小说演出设计、游戏设计、Godot 游戏开发、语言学习、理科学习、公文撰写、社会议题、ComfyUI 工作）与 **7 个 VN 工作流预设**（`vn-bible` / `vn-outline` / `vn-script` / `vn-asset-list` / `vn-asset-make` / `vn-screenplay` / `vn-game`）。其中 `preset-screenplay-writing` / `preset-vn-design` / `preset-vn-staging` 三行带 `disabled: true`，是 11-07 之前的旧版，仅作回退保留、不参与运行时。", 1)
rep(BREADME,
    "| `cordis.patch.yml` | 13 个 `preset-<id>` 声明（组合内容来自原 `agent.cordis.yml`） |",
    "| `cordis.patch.yml` | 20 个 `preset-<id>` 声明（组合内容来自原 `agent.cordis.yml`） |", 1)
# insert VN index + bak registration after the structure table (before "注册方式")
rep(BREADME,
    "注册方式：`~/.dsh/profiles/web/package.json` 里作为 `link:` 依赖 + 列入 `dsh.profile.bundles`，\n`~/.dsh/profiles/web/node_modules/@dsh-external/dsh-user-presets` 是指向本目录的 junction。",
    """注册方式：`~/.dsh/profiles/web/package.json` 里作为 `link:` 依赖 + 列入 `dsh.profile.bundles`，
`~/.dsh/profiles/web/node_modules/@dsh-external/dsh-user-presets` 是指向本目录的 junction。

### VN 工作流预设与共享技能（2026-11-07 施工、2026-11-10 瘦身）

| 预设 id | 阶段 | 写列 | 挂载的 skill tree |
|---|---|---|---|
| `vn-bible` | 设定完善 | `00-Bible/` | `skills/vn-shared` + `skills/vn-bible` |
| `vn-outline` | 剧情大纲设计 | `01-Plan/` | `skills/vn-shared` + `skills/vn-outline` |
| `vn-script` | 剧情写作 | `02-Script/` | `skills/vn-shared` + `skills/vn-script` |
| `vn-asset-list` | 资产列表 | `03-Asset/` 根层 | `skills/vn-shared` + `skills/vn-asset-list` |
| `vn-asset-make` | 资产制造 | `03-Asset/generated/` | `skills/vn-shared` + `skills/vn-asset-make` |
| `vn-screenplay` | 演出剧本 | `04-ScreenPlay/` | `skills/vn-shared` + `skills/vn-screenplay` |
| `vn-game` | 游戏制造 | `05-Game/` | `skills/vn-shared` + `skills/vn-game` |

- `skills/vn-shared/` 三份（`vn-gate` / `vn-spec` / `vn-continuity`）是**目录与格式、每轮流程、一致性核查的单一真源**；7 个 preset 各挂一份 `vn-shared` + 本阶段 tree，物理上看不到下游阶段 skill。
- 7 个 preset 的 persona `prefix` 里【指令裁决】6 条宪法段逐字相同，改一须同步七；各阶段 skill 里的目录白名单 / 七步循环 / 状态机是离线可读副本，与 `vn-shared` 冲突时以 `vn-shared` 为准。
- 同源副本（10 对 genre-fiction↔novel-writing、4 份 spec-common、5 份 search-query-craft）登记在 `skills/_SYNC-POLICY.md`，改动前先读。
- 现行规范入口：[VN-工作流现行规范.md](VN-工作流现行规范.md)；根目录 `VN-工作流改造施工文档.md` / `VN-工作流改造说明.md` 是**历史留档**（已加全文失效围栏），不是规则来源。

### 备份文件（非现行配置）

`cordis.patch.yml.bak`（11-10 瘦身前的 6178 行版）、`cordis.patch.yml.bak-20261107-VN-order`、`cordis.patch.yml.bak-before-scope-guard` 均为历史备份；完整治理前快照另存于 `Archive/Plugins/dsh-user-presets-slim-20261110-slim/`，本次复查后修复前的快照在 `Archive/Plugins/dsh-user-presets-auditfix-20261110/`。扫描现状时忽略 `.bak*`。""", 1)

# ================================================================ orphan tree reference in bundle README
rep(BREADME,
    "- **想加/改预设**：直接编辑 `cordis.patch.yml`（遵循 `skills/prompt-writing/dsh-preset-craft` 规范）。不要再去写已经废弃的 `~/.dsh/.agent-presets/<id>/` 目录。",
    "- **想加/改预设**：直接编辑 `cordis.patch.yml`。`skills/prompt-writing/dsh-preset-craft/SKILL.md` 当前**无 preset 挂载**（孤儿树，只在磁盘上），请把它当**文档直接读文件**引用，不要指望 `skill` 工具能加载；详见 `skills/_SYNC-POLICY.md` 末尾「孤儿树」。不要再去写已经废弃的 `~/.dsh/.agent-presets/<id>/` 目录。", 1)

report("C_docs")
print("links fixed with ../:", changed_links)
