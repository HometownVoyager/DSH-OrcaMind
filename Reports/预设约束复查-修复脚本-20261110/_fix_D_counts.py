# -*- coding: utf-8 -*-
"""Replace stale line-count descriptors with qualitative ones (docs changed size)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import rep, report

REP = "Reports/预设约束互博成因与治理方案-20261110.md"
SPEC = "Plugins/dsh-user-presets/VN-工作流现行规范.md"
SM = "VN-工作流改造说明.md"
RREADME = "README.md"

# 现行规范 L3
rep(SPEC,
    "取代 `VN-工作流改造施工文档.md`（2757 行）与 `VN-工作流改造说明.md`（224 行）",
    "取代长篇 `VN-工作流改造施工文档.md` 与短篇 `VN-工作流改造说明.md`", 1)
# 说明 L8
rep(SM,
    "> 当时的施工依据：`VN-工作流改造施工文档.md`（2757 行，修订 `6a7b79c1…`）。",
    "> 当时的施工依据：`VN-工作流改造施工文档.md`（施工期长篇文档，修订 `6a7b79c1…`；复查后已删去 §4.3 内嵌的旧 skill 草案，行数已变，不再引用具体行数）。", 1)
# first report L3
rep(REP,
    "`VN-工作流改造施工文档.md`（2757 行）、`VN-工作流改造说明.md`（224 行）",
    "长篇 `VN-工作流改造施工文档.md`、短篇 `VN-工作流改造说明.md`（两者行数在 11-10 复查删去内嵌草案后已变，故不写死行数）", 1)
# root README L147
rep(RREADME,
    "取代 2757 行施工文档，运行时以 7 个 persona prefix + `vn-shared` 三份 SKILL.md 为准",
    "取代长篇施工文档（已删内嵌旧 skill 草案），运行时以 7 个 persona prefix + `vn-shared` 三份 SKILL.md 为准", 1)

# D5 note in 复查报告: add resolution note (line-count claims are pre-fix historical measurements)
REP2 = "Reports/预设约束互博治理后复查-20261110.md"
rep(REP2,
    "| D5 | 数字失准：施工文档实 **2757 行**（三处写 2753）、说明实 **224 行**（写 220）；「77 处」报告自身分解 `13+36+3+20=72` 与 77 不符且口径自相矛盾；「36 份 / 39 份」未交代差额（39=36 阶段+3 共享） | 实测 + `现行规范:3`、`README.md:146`、`Reports/…:125,212`、`说明:18,22,100,222` |",
    "| D5 | 数字失准：施工文档实 **2757 行**（三处写 2753）、说明实 **224 行**（写 220）；「77 处」报告自身分解 `13+36+3+20=72` 与 77 不符且口径自相矛盾；「36 份 / 39 份」未交代差额（39=36 阶段+3 共享）· **【2026-11-10 复查后已修：全部改为定性描述，删去 §4.3 内嵌草案后行数再变，不再写死；77 处口径已在首轮报告 §5 补齐 13+36+3+20+2+3=77；36/39 差额已注明】** | 实测 + `现行规范:3`、`README.md:146`、`Reports/…:125,212`、`说明:18,22,100,222` |", 1)
rep(REP2,
    "9. 修 72 条 `../` 链接、把行号锚点改为章节名引用（D4）；统一数字 2757/224、77 处口径、36/39 差额（D5）。",
    "9. 修 72 条 `../` 链接、把行号锚点改为章节名引用（D4）；统一数字 2757/224、77 处口径、36/39 差额（D5）· **【已修：链接已补 `../`，77/36-39 口径已注明，行数改定性描述】**。", 1)
rep(REP2,
    "| D4 | 报告 **72 条 Markdown 链接全部漏 `../`**（从 `Reports/` 解析 72/72 悬空）；成片失效行号锚点（`:5906/:6178` 超 5699 范围、`vn-gate:97-105` 超 89 行等）—— 现行规范:68 自己已声明旧行号失效，报告未遵守 | `Reports/…` 全文 |",
    "| D4 | 报告 **72 条 Markdown 链接全部漏 `../`**（从 `Reports/` 解析 72/72 悬空）；成片失效行号锚点（`:5906/:6178` 超 5699 范围、`vn-gate:97-105` 超 89 行等）—— 现行规范:68 自己已声明旧行号失效，报告未遵守 · **【2026-11-10 复查后已修：75 条链接实测 0 悬空；首轮报告加实施状态补记，明确 `#L` 行号锚点为治理前 6178 行版的历史测量值】** | `Reports/…` 全文 |", 1)

# also note the fix status at top of 复查报告
rep(REP2,
    "> 方法：Python 全量机械扫描（md5 分组、逐行 difflib、正则交叉引用、挂载映射核对）+ 4 个子代理分层精读（VN skill / 非 VN skill / preset 配置 / 文档层）+ 源码核对（`source/packages/preset/agent-preset*/src/` 确认 `description` 不进模型提示词、Loader 每 preset 独立挂载）。**未修改任何被审文件。**",
    "> 方法：Python 全量机械扫描（md5 分组、逐行 difflib、正则交叉引用、挂载映射核对）+ 4 个子代理分层精读（VN skill / 非 VN skill / preset 配置 / 文档层）+ 源码核对（`source/packages/preset/agent-preset*/src/` 确认 `description` 不进模型提示词、Loader 每 preset 独立挂载）。**审查阶段未修改任何被审文件；本轮交付后用户已授权按 P0–P2 全量修复，见下方「修复实施状态」。**", 1)

report("D_counts")
