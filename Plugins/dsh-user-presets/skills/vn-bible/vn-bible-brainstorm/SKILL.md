---
name: vn-bible-brainstorm
description: 改造自 vn-design/vn-brainstorm 的 Brainstorm 首个严格子阶段：六字段逐个确认、每轮 1 字段，只写 00-Bible/brainstorm.md 的创意意图记录。
---

# 头脑风暴（vn-bible-brainstorm）

## 何时使用
- 本预设（VN-设定完善 / vn-bible）开工时的首个严格子阶段，或用户要求回到创意原点重新确认定位时使用。
- 本阶段只回答「这是一部什么样的作品」，不写角色细节、世界观规则与具体剧情；不调用其它阶段 skill，不看到下一阶段模板与字段定义。
- 白名单恒为「6 个编号目录 + 3 个根级文档」：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 与根级 `README.md`、`Specifications.md`、`Direction.md`；本 skill 的唯一落点只属于 `00-Bible/`。

## 唯一落点 / 写死路径
- `<作品名>/00-Bible/brainstorm.md` 是唯一落点、唯一允许写的文件。
- 不写 `00-Bible/characters/`、`00-Bible/world.md`、`00-Bible/anchors.md`、`00-Bible/relationships.md`、`00-Bible/factions.md`、`00-Bible/geography.md`、`00-Bible/timeline.md`、`00-Bible/glossary.md`、`00-Bible/style.md`、`01-Plan/` 以及任何其它文件。
- 不写入 `01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 等任何下游目录与文件；不替下游阶段构思章节、剧本正文、资产、演出或游戏实现。
- 首轮显式读一次 `Specifications.md` 与 `Direction.md`（后续轮不复读），读根级 `README.md` 校验「当前预设」，只读 `00-Bible/` 内本阶段已有产物。

## 单轮单条目
- 六字段固定且按顺序为：① 作品一句话定位 ② 题材与类型 ③ 核心主题与母题 ④ 情绪基调与核心体验 ⑤ 目标受众 ⑥ 篇幅与结构规模预期。
- 六字段逐个处理，每轮只处理 1 个子条目（1 个字段），未轮到的字段保持模板占位、不提前填写或预写；本轮子条目由用户从候选清单中选定，AI 不自主规划阶段内子任务。
- 每字段只写用户确认过的原话 + 至多 1 句归纳，硬上限 2 句；不复合句展开，不角色小传、场景、台词、镜头、走位与演出指示。
- 不再适用「主动给 2-3 个候选方向」在该子阶段的适用性；用户未明示的内容进「开放问题」清单，且只列条目标题、不展开，不自行补全后写进正文；候选方向只在用户明确要求时才给，且只呈现在对话里、不落盘。
- 一切设定事实应由用户确认后方可落盘；存在任何疑问、缺项、冲突或不确定，用 ask_user_question 求证，由用户拍板，不自行裁决、不凭空假设。
- Read → Report → Confirm → Do → Check → Write → Stop 七步为默认顺序；用户显式指令可调整；Write 在 Confirm 之后、Stop 之前，只写这一个文件 + 就地更新 `README.md` A 区「当前状态」5 字段 + 在 B 区「进度记录」追加一行（状态置「待确认」）。
- Check：按 `vn-continuity` 核查这一个产物，按 `vn-spec` 校验统一目录与格式，按 `vn-gate` 校验单轮单条目；冲突停下请用户裁决。

## 执行要点

每轮只做 1 个子条目（用户可显式授权一次做多个；流程见 `vn-gate`）

不跨阶段写入（边界见 `vn-spec` 读写权限矩阵与 persona【指令裁决】）

- `00-Bible/brainstorm.md` 定稿默认降级为「创意意图记录」，不再是后续所有阶段的基准参照；正式事实源默认为 `00-Bible/anchors.md` 与各设定文档。
- 不创建计划外文档、不跨阶段预写、不越权写入；违反任一红线应立即停下并用 ask_user_question 询问。

## 旧值 / 迁移对照（不作为产出落点）
`00-设定/brainstorm.md`、`00-设定/`、`01-规划/`、`02-系统/`、`02-剧本/`、`03-修订/`、`04-资产/`、`05-剧本/`、`06-演出/`、`assets/`、`规范-视觉小说设计.md`、`规范-剧本.md`、`规范-演出.md` 均为废弃旧值，仅允许出现在本节迁移对照中，**不作为产出落点**。
