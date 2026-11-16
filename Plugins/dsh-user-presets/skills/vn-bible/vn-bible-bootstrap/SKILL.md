---
name: vn-bible-bootstrap
description: VN-设定完善阶段项目初始化：在用户确认后建根级 README.md / Specifications.md / Direction.md 与 00-Bible/ 骨架，并把统一六目录全表与目录纪律写进 Specifications.md。
---

# 项目初始化（vn-bible-bootstrap）

## 何时使用
- 本预设（VN-设定完善 / vn-bible）首轮接手一部尚无项目骨架的新作品，或用户要求「新建 VN 项目 / 开新项目」时使用。
- 只在本阶段使用；不调用其它阶段 skill，不看到下一阶段模板与字段定义。
- 白名单恒为「6 个编号目录 + 3 个根级文档」：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 与根级 `README.md`、`Specifications.md`、`Direction.md`；任何其它目录/文件不创建。本 skill 只物理创建 `00-Bible/` 与 3 个根级文档。

## 首轮显式读取与停下询问
- 首轮应显式用文件工具读 `README.md` 校验「当前预设」，并显式读一次 `Specifications.md` 与 `Direction.md`（后续轮不复读、遵守已读内容）。
- 二者不存在时，停下、用 ask_user_question 询问：仅本预设、且仅在用户明确确认后才允许创建；未经确认不动任何文件。
- 会话工作目录应是 `<作品名>/` 项目目录本身（或其子目录），否则 `Specifications.md` 不在目录链上、读不到；项目根需有 `.git` 标记或已把 `Specifications.md` 追加进 `projectRootMarkers`。

## 唯一落点 / 写死路径
- `<作品名>/README.md`：唯一进度载体，双区结构。A 区「当前状态」块 5 字段（当前预设 / 当前阶段 / 本轮子条目 / 状态 / 下一候选）仅在用户确认后就地更新；B 区「进度记录」区只追加一行、永不改写或删除既有行，状态置「待确认」。制作计划与逐轮进度只归此处。
- `<作品名>/Specifications.md`：唯一规范事实源。四节骨架、目录全表、十条目录纪律、命名与读写权限矩阵一律按 `skills/vn-shared/vn-spec/SKILL.md` 落盘（它是目录与格式的单一真源，本 skill 不另写一份、不引用任何章节号）；四节为 ① 来源记录 ② 结构与目录约定（6 个编号目录 + 3 个根级文档全表 + 十条目录纪律）③ 产出格式规范（三位编号 `ch001` / `sc001`、`-` 连接符防灾、禁裸 `~`、复合句要求、抽象层级边界）④ 红线与禁忌。不把 `Direction.md` 当事实源或状态机。
- `<作品名>/Direction.md`：只建静态导航骨架 —— 总体说明 + 七预设导航 + 源指针表 + 02/04 分工。指针指向 `Specifications.md`、`03-Asset/asset-index.md`、`03-Asset/asset-gap.md`、`04-ScreenPlay/scene-map.md`、`02-Script/scene-list.md`，目标尚不存在时默认留空待填；不预填下游内容、不复制源文件正文、不写规范条文、不写入任何逐轮进度。它是静态导航地图，不是事实源、不是状态机；冲突时以被指向的源文件为准。
- `<作品名>/00-Bible/`：本阶段唯一可写目录，含 `00-Bible/characters/` 与 `00-Bible/00-Bible-四份版/` 两个空骨架子目录（后者是唯一允许 `.docx` 的落点）。
- 六目录全表只按 `vn-spec` 写进 `Specifications.md`；不物理预建 `01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 等任何下游目录，不跨阶段预写下游文件。
- `Specifications.md` 默认取代旧三份规范、不再并存；旧值仅允许出现在迁移对照语境。

## 单轮单条目
- 每轮只处理 1 个子条目：本轮子条目由用户从候选清单中选定，且只能是「建 `README.md`」「建 `Specifications.md`」「建 `Direction.md`」「建 `00-Bible/` 骨架（含两个子目录）」四者之一；AI 不自主规划阶段内子任务，不用一份整稿替代逐步确认。
- 不在本轮内规划或预写后续子条目；Read → Report → Confirm → Do → Check → Write → Stop 七步为默认顺序；用户显式指令可调整，Write 在 Confirm 之后、Stop 之前。
- Check：按 `vn-continuity` 核查这一个产物，按 `vn-spec` 校验统一目录与格式，按 `vn-gate` 校验单轮单条目；发现冲突停下请用户裁决，不自行改写已确认内容。

## 执行要点

每轮只做 1 个子条目（用户可显式授权一次做多个；流程见 `vn-gate`）

不跨阶段写入（边界见 `vn-spec` 读写权限矩阵与 persona【指令裁决】）

- 只创建 `00-Bible/` 与 3 个根级文档；不创建计划外文档、不跨阶段预写、不越权写入。
- 一切设定事实应由用户确认后方可落盘；存在任何疑问、缺项或不确定，用 ask_user_question 求证，由用户拍板，不凭空假设。
- 违反任一红线应立即停下并用 ask_user_question 询问，不继续。

## 旧值 / 迁移对照（不作为产出落点）
`00-设定/`、`01-规划/`、`02-系统/`、`02-剧本/`、`03-修订/`、`04-资产/`、`05-剧本/`、`06-演出/`、`assets/`、`规范-视觉小说设计.md`、`规范-剧本.md`、`规范-演出.md` 均为废弃旧值，仅允许出现在本节迁移对照中，**不作为产出落点**；`Specifications.md` 取代旧三份规范，不再并存。
