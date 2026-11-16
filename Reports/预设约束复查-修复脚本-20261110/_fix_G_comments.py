# -*- coding: utf-8 -*-
"""Clarify the 5 '原预设完整保留' derivation comments (N1 residual)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fix_common import rep, report

Y = "Plugins/dsh-user-presets/cordis.patch.yml"

# Each of the 5 comments: clarify that "一律不动" refers ONLY to derivation-time
# inheritance of tool lines/persona skeleton, NOT to shared skills or a freeze policy.
pairs = [
 ("          # 派生自 `vn-design`（原预设完整保留、一律不动）：完整继承其工具行与\n          # 骨架，skills 全部替换为 11 个游戏设计 skills——项目搭建/头脑风暴/",
  "          # 派生自 `vn-design`（施工期「原预设保留不动」仅指当时未改其工具行 / realm 骨架；本预设的 skills 是物理副本，改动按 `skills/_SYNC-POLICY.md` 同步）：完整继承其工具行与\n          # 骨架，skills 全部替换为 11 个游戏设计 skills——项目搭建/头脑风暴/"),
 ("          # 派生自 `science-learning`（原预设完整保留、一律不动）：完整继承其工具行、\n          # realm 结构与教学闭环骨架（README 入口/学习计划三件套/练习穿插/阶段综合",
  "          # 派生自 `science-learning`（施工期「原预设保留不动」仅指当时未改其工具行 / realm 骨架；本预设的 skills 是物理副本，改动按 `skills/_SYNC-POLICY.md` 同步）：完整继承其工具行、\n          # realm 结构与教学闭环骨架（README 入口/学习计划三件套/练习穿插/阶段综合"),
]
for old, new in pairs:
    rep(Y, old, new, 1)

# 3 x novel-writing comments (identical prefix line, different following line)
rep(Y,
    "          # 派生自 `novel-writing`（原预设完整保留、一律不动）：完整继承其工具行与\n          # 共性基线 persona 骨架，skills 全部替换为 8 个公文 skills（含 spec-common 共用底座）——项目搭建/",
    "          # 派生自 `novel-writing`（施工期「原预设保留不动」仅指当时未改其工具行 / persona 骨架；本预设的 skills 是物理副本，改动按 `skills/_SYNC-POLICY.md` 同步）：完整继承其工具行与\n          # 共性基线 persona 骨架，skills 全部替换为 8 个公文 skills（含 spec-common 共用底座）——项目搭建/", 1)
rep(Y,
    "          # 派生自 `novel-writing`（原预设完整保留、一律不动）：完整继承其工具行与\n          # 共性基线 persona 骨架，skills 全部替换为 11 个论文 skills（含 spec-common 共用底座）——项目搭建/",
    "          # 派生自 `novel-writing`（施工期「原预设保留不动」仅指当时未改其工具行 / persona 骨架；本预设的 skills 是物理副本，改动按 `skills/_SYNC-POLICY.md` 同步）：完整继承其工具行与\n          # 共性基线 persona 骨架，skills 全部替换为 11 个论文 skills（含 spec-common 共用底座）——项目搭建/", 1)
rep(Y,
    "          # 派生自 `novel-writing`（原预设完整保留、一律不动）：完整继承其工具行与\n          # 共性基线 persona，skills 全部替换为 10 个议题 skills（含 spec-common 共用底座）——项目搭建/论证方法/",
    "          # 派生自 `novel-writing`（施工期「原预设保留不动」仅指当时未改其工具行 / persona 骨架；本预设的 skills 是物理副本，改动按 `skills/_SYNC-POLICY.md` 同步）：完整继承其工具行与\n          # 共性基线 persona，skills 全部替换为 10 个议题 skills（含 spec-common 共用底座）——项目搭建/论证方法/", 1)

report("G_comments")
