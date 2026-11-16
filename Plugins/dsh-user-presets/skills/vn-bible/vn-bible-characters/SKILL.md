---
name: vn-bible-characters
description: 改造自 vn-design/vn-character-design：一个子条目一个角色档案，逐轮写 00-Bible/characters/<角色名>.md 与 00-Bible/relationships.md。
---

# 角色与关系（vn-bible-characters）

## 何时使用
- 本预设（VN-设定完善 / vn-bible）进入角色设定子阶段，或需要新增角色、补充已确认角色档案时使用。
- 不调用其它阶段 skill，不看到下一阶段模板与字段定义。
- 白名单恒为「6 个编号目录 + 3 个根级文档」：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 与根级 `README.md`、`Specifications.md`、`Direction.md`；本 skill 的唯一落点只属于 `00-Bible/`。

## 唯一落点 / 写死路径
- `<作品名>/00-Bible/characters/<角色名>.md`：一个角色一份档案，一个子条目一个角色档案。
- `<作品名>/00-Bible/relationships.md`：角色间关系网与关系变化方向，作为剧情大纲与路线设计的输入。
- 不写 `00-Bible/brainstorm.md`、`00-Bible/anchors.md`、`00-Bible/world.md`、`00-Bible/factions.md`、`00-Bible/geography.md`、`00-Bible/timeline.md`、`00-Bible/glossary.md`、`00-Bible/style.md` 以及任何其它文件。
- 不写入 `01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 等任何下游目录与文件，不替下游做设计。
- 首轮显式读一次 `Specifications.md` 与 `Direction.md`（后续轮不复读），读根级 `README.md` 校验「当前预设」，只读 `00-Bible/` 内本阶段已有产物。年龄矩阵、称谓网格、体貌锚点、信物流转状态机等常量事实只属于 `00-Bible/anchors.md`，本 skill 不改写或另写一套口径；引用时回读该文件。

## 单轮单条目
- 每轮只处理 1 个子条目：即 1 个角色档案（`<角色名>.md`），或单独 1 轮只处理 `relationships.md` 的关系条目；本轮子条目由用户从候选清单中选定，AI 不自主规划阶段内子任务、不用一份整稿替代逐步确认。
- 档案以完整、连贯且包含因果关系的复合句为主，不碎片段落；内容只写事实与规则（定位、目标、动机、性格、体貌锚点、成长弧线、与主题的关联），默认守住抽象层级边界、不场景与台词扩写、不镜头/走位/演出指示。
- 不「稳稳接住」「接住你」及其比喻义表述；排版防灾不裸 `~` 字符，连接符用 `-`（如 `ch001-2a`），编号默认三位（`ch001` / `sc001`）。
- 一切设定事实应由用户确认后方可落盘；用户未明示的内容只列开放问题条目标题、不展开，存在疑问用 ask_user_question 求证，由用户拍板。
- Read → Report → Confirm → Do → Check → Write → Stop 七步为默认顺序；用户显式指令可调整；Write 在 Confirm 之后、Stop 之前，只写这一个文件 + 就地更新 `README.md` A 区「当前状态」5 字段 + 在 B 区「进度记录」追加一行（状态置「待确认」）。
- Check：按 `vn-continuity` 核查这一个产物（锚点矩阵优先），按 `vn-spec` 校验统一目录与格式，按 `vn-gate` 校验单轮单条目；冲突停下请用户裁决。

## 执行要点

每轮只做 1 个子条目（用户可显式授权一次做多个；流程见 `vn-gate`）

不跨阶段写入（边界见 `vn-spec` 读写权限矩阵与 persona【指令裁决】）

- 不创建计划外文档、不跨阶段预写、不越权写入；违反任一红线应立即停下并用 ask_user_question 询问。

## 旧值 / 迁移对照（不作为产出落点）
`00-设定/characters/`、`00-设定/relationships.md`、`00-设定/`、`01-规划/`、`02-系统/`、`02-剧本/`、`03-修订/`、`04-资产/`、`05-剧本/`、`06-演出/`、`assets/`、`规范-视觉小说设计.md`、`规范-剧本.md`、`规范-演出.md` 均为废弃旧值，仅允许出现在本节迁移对照中，**不作为产出落点**。
