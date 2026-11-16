# -*- coding: utf-8 -*-
"""Config layer: description contradictions, B6, N1/N2/N5, sync notes."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import rep, report

Y = "Plugins/dsh-user-presets/cordis.patch.yml"
S = "Plugins/dsh-user-presets/skills/"

# ---------------------------------------------------------------- A1: preset-vn-game description
rep(Y,
    "本预设实行两道确认门：第一轮为规格门，必须先向用户确认目标引擎（LetsGaL / WebGaL / Ren'Py / Godot 四选一），只产出 05-Game/implementation-spec.md（引擎侧实现规格与目录映射：引擎选型、剧本/演出/资产到引擎结构的映射、文件命名约定、验收清单、尚未确认项清单），禁止创建 <engine>/ 目录与任何工程文件；第二轮为工程门，只有在 implementation-spec.md 经用户明确确认且 README.md 状态机 状态=已确认 之后，才允许按确认的引擎创建 05-Game/<engine>/ 骨架与工程文件。上游 00-Bible/ 01-Plan/ 02-Script/ 03-Asset/ 04-ScreenPlay/ 一律只读，禁止回写；禁止创建任何计划外文档。",
    "本预设默认实行两道确认门：第一轮为规格门，先向用户确认目标引擎（LetsGaL / WebGaL / Ren'Py / Godot 四选一），只产出 05-Game/implementation-spec.md（引擎侧实现规格与目录映射：引擎选型、剧本/演出/资产到引擎结构的映射、文件命名约定、验收清单、尚未确认项清单），默认不创建 <engine>/ 目录与工程文件；第二轮为工程门，默认在 implementation-spec.md 经用户明确确认且 README.md 状态机 状态=已确认 之后，才按确认的引擎创建 05-Game/<engine>/ 骨架与工程文件。两道门及本段流程均为默认工作节奏，用户显式指令可覆盖。上游 00-Bible/ 01-Plan/ 02-Script/ 03-Asset/ 04-ScreenPlay/ 默认只读、不回写；不创建白名单外文档。", 1)
rep(Y,
    "严格遵循统一六目录、目录纪律、三道门禁、单轮单条目七步循环、README 状态机与共用规范前置条件。\"",
    "严格遵循统一六目录、目录纪律、默认单轮单条目七步循环与 README 状态机；两道确认门与其余流程均为默认节奏，用户显式指令可覆盖（见本预设 persona【指令裁决】）。\"", 1)

# ---------------------------------------------------------------- A2: preset-vn-asset-make description
rep(Y,
    "每轮调用前必须用 ask_user_question 询问用户选择工具",
    "默认每轮调用前用 ask_user_question 询问用户选择工具", 1)
rep(Y,
    "并确认参数，未确认禁止调用任何生图工具；后续",
    "并确认参数；用户已在本轮明示工具与参数时视为已确认、可直接调用，用户显式指令可覆盖本默认节奏；后续", 1)

# ---------------------------------------------------------------- yml dangling §2.4
rep(Y,
    "在用户确认后创建根级 Specifications.md（写入 §2.4 四节骨架）与 Direction.md",
    "在用户确认后按 `vn-spec` 创建根级 Specifications.md（四节骨架）与 Direction.md", 1)

# ---------------------------------------------------------------- B6: annotate disabled preset historical text
rep(Y,
    "- 随后以 Agentic work 的方式自主规划该阶段内的子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策必须先经用户拍板，缺口处理按「求证与拍板规则」执行。",
    "- 【历史文本 · 已停用：本预设整体 `disabled: true`，不注入任何会话】随后以 Agentic work 的方式自主规划该阶段内的子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策必须先经用户拍板，缺口处理按「求证与拍板规则」执行。", 1)
rep(Y,
    "- 随后以 Agentic work 的方式自主规划该阶段内的子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策必须先向用户确认。",
    "- 【历史文本 · 已停用：本预设整体 `disabled: true`，不注入任何会话】随后以 Agentic work 的方式自主规划该阶段内的子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策必须先向用户确认。", 1)
rep(Y,
    "- 随后以 Agentic work 的方式自主规划本轮子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策与缺口裁决必须先向用户确认。",
    "- 【历史文本 · 已停用：本预设整体 `disabled: true`，不注入任何会话】随后以 Agentic work 的方式自主规划本轮子任务，调用所需技能或工具，产出一份可供用户审阅的草稿，而不是等待用户逐步发出每一个微指令。符合已确认规则的子任务可以自行完成；影响全局一致性的关键决策与缺口裁决必须先向用户确认。", 1)

# ---------------------------------------------------------------- N1: maintenance policy comment
rep(Y,
    "          # 共享 `novel-writing` 的 11 个通用写作 skills（novel-project-bootstrap 另有\n          # 「开题类型判定」增补，见该 skill 头部；原预设完整保留、一律不动），\n          # 并沿用其工具行与共性基线 persona，增补 13 个类型 skills——",
    "          # 【同源副本 · 修改须同步】11 个通用写作 skills 是 `skills/novel-writing/` 的\n          # 物理副本（Loader 每 preset 各挂单 tree、不能跨 tree 解析），不是运行时共享；\n          # 改动共性规则须同时改 `skills/novel-writing/` 与 `skills/genre-fiction/` 两份，\n          # 清单与同步纪律见 `skills/_SYNC-POLICY.md`。`novel-project-bootstrap` 另有\n          # 「开题类型判定」增补，只属 genre-fiction 版；另增补 13 个类型 skills——", 1)

# ---------------------------------------------------------------- N2: bootstrap L8 dangling paths + sync rule
rep(S + "genre-fiction/novel-project-bootstrap/SKILL.md",
    "本文件派生自家族母本 `novel-writing/skills/novel-project-bootstrap/SKILL.md`：目录结构、README 与剧情精述模板、开工规范检查、阶段门控与注意事项等共性部分与母本一致，改动须同时回改母本；本预设的域内增补有两项——①「开题类型判定」整节（13 个类型 skill 的判定与加载，通用文学与类型混合的分支）；② 何时使用、README 模板与执行步骤中的类型判定字段与已加载 genre skill 字段登记。",
    "本文件派生自家族母本 `skills/novel-writing/novel-project-bootstrap/SKILL.md`（路径相对 bundle 根，不含第二层 `/skills/`）。目录结构、README 与剧情精述模板、开工规范检查、阶段门控与注意事项等共性部分与母本一致；**改动共性部分须同时改两份**（本文件与母本，见 `skills/_SYNC-POLICY.md`）。本预设的域内增补有两项——①「开题类型判定」整节（13 个类型 skill 的判定与加载，通用文学与类型混合的分支）；② 何时使用、README 模板与执行步骤中的类型判定字段与已加载 genre skill 字段登记。这两项只改本文件，不回改母本。", 1)
rep(S + "novel-writing/novel-project-bootstrap/SKILL.md",
    "本文件是家族母本（领域无关的通用写作流程与文档约定）：`genre-fiction/skills/novel-project-bootstrap/SKILL.md` 在其基础上派生，只增补本域内容（开题类型判定）；两者的共性部分以本文件为准，改动须同时回改派生版。",
    "本文件是家族母本（领域无关的通用写作流程与文档约定）：`skills/genre-fiction/novel-project-bootstrap/SKILL.md` 在其基础上派生，只增补本域内容（开题类型判定）；两者的共性部分以本文件为准，**改动共性部分须同时改两份**（派生版见 `skills/_SYNC-POLICY.md`），派生版独有的「开题类型判定」不回改本文件。", 1)

# ---------------------------------------------------------------- N5: comfyui compile_prompt path
rep(S + "comfyui-work/moss-image-guide/SKILL.md",
    "python Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/scripts/compile_prompt.py \\",
    "python \"D:/Tools/DeepSeek Harness/Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/scripts/compile_prompt.py\" \\", 1)

# ---------------------------------------------------------------- sync note to identical duplicate files
NOTE = "\n> 【同源副本】本文件登记在 `skills/_SYNC-POLICY.md` 的同源副本组里：改动前先读该政策文件，改动须同步到组内全部副本，不要只改这一份；各 preset 各挂单 tree，不能跨 tree 解析。\n\n"
groups = [
    ["genre-fiction/%s/SKILL.md" % n, "novel-writing/%s/SKILL.md" % n]
    for n in ["character-voice", "continuity", "novel-chapter-writing", "novel-outlining",
              "novel-revision", "novel-structure", "pov-craft", "research-materials",
              "story-bible", "writing-craft"]
]
groups.append(["official-docs/spec-common/SKILL.md", "paper-writing/spec-common/SKILL.md",
               "prompt-writing/spec-common/SKILL.md", "social-issues/spec-common/SKILL.md"])
groups.append(["game-design/search-query-craft/SKILL.md", "official-docs/search-query-craft/SKILL.md",
               "paper-writing/search-query-craft/SKILL.md", "prompt-writing/search-query-craft/SKILL.md",
               "social-issues/search-query-craft/SKILL.md"])
for g in groups:
    for rel in g:
        rep(S + rel, "\n---\n\n", "\n---\n" + NOTE, 1)

report("B_config")
