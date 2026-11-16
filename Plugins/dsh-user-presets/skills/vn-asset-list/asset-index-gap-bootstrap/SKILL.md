---
name: asset-index-gap-bootstrap
description: VN-资产列表阶段索引/缺口骨架技能：逐轮单条目建 03-Asset/asset-index.md 与 03-Asset/asset-gap.md 的计划态骨架，磁盘实际状态留待 vn-asset-make 补齐，不填实际状态、不建副本。
---

# 资产索引 / 缺口计划态骨架（asset-index-gap-bootstrap）

本 skill 是 VN-资产列表（vn-asset-list）阶段的专属协作技能。默认使用中文与用户交流。职责：建 `03-Asset/asset-index.md`（资产索引）与 `03-Asset/asset-gap.md`（资产缺口）的**计划态骨架**，逐轮单条目、1 条资产对应 1 条索引/缺口骨架。磁盘实际状态默认留待 VN-资产制造（vn-asset-make）补齐，本 skill 不填实际状态。这两份是 `vn-screenplay` 逐场演出剧本的默认硬门前置（用户显式指令可覆盖），本预设不代替用户确认。

## 一、唯一落点 / 写死路径

- 资产索引骨架写死为 `03-Asset/asset-index.md`；资产缺口骨架写死为 `03-Asset/asset-gap.md`。只写这两份文件，不另建副本、不另建同义文件、不删除、不改写既有骨架结构。
- 本列协作写权（唯一例外）：按 §3.4 ② / ③ 与 §10 #29，这两份属本预设「写」列，仅用于建计划态骨架；磁盘实际状态由 `vn-asset-make` 在同一骨架上补齐，二者协作完成，`vn-screenplay` 只读。
- 骨架阶段只登记计划态，不写磁盘实际状态：不预填实际状态、不伪造资产路径与资产 ID、不用占位内容冒充成品。
- 状态词表只用 available / generated / substitute / placeholder / missing / hard_missing / pending / listed_but_missing 这 8 个词，不自造同义词、缩写或新状态词；骨架阶段只登记计划态，不写实际状态。
- 唯一二进制资产落点是 `03-Asset/generated/`；唯一 .docx 落点是 `00-Bible/00-Bible-四份版/`。二者本 skill 不写入。
- 不写 `04-ScreenPlay/`、`05-Game/` 及任何下游；不改写上游 `00-Bible/`、`01-Plan/`、`02-Script/` 全树；`Specifications.md` 与 `Direction.md` 只读、不改写。

### 白名单（6 个编号目录 + 3 个根级文档）

`<作品名>/` 下只允许存在 6 个编号目录 + 3 个根级文档，任何其它目录/文件不创建：
- 6 个编号目录：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/`。
- 3 个根级文档：`README.md`、`Specifications.md`、`Direction.md`。

## 二、单轮单条目

- 1 条资产对应 1 条索引骨架 + 1 条缺口骨架，作为一个不可拆分的最小产物单元；每轮只处理 1 个子条目（1 条资产），不在本轮预写其它资产条目，不一次写出整份索引或整份缺口表。
- 每轮只处理 1 个子条目，由用户从候选清单中选定，不自主规划本阶段子任务；本轮的索引条目与缺口条目应在同一轮 Do → Check → Write 内完成，不拆到下一轮。
- 这两份是 `vn-screenplay` 逐场演出剧本硬门前置：未完成并经用户确认前，默认不开始逐场稿（用户显式指令可覆盖）；本预设不代替用户确认，硬门未满足应停下询问。

## 三、硬约束

1. 每轮只处理 1 个子条目
2. 不跨阶段

补充（与上三条同等强制）：
- 不跨阶段：不读写下游阶段目录、不创建下游文件、不在对话中替下游做设计、列出下游字段或预写下游内容。
- 磁盘实际状态默认留待 VN-资产制造（vn-asset-make）补齐：不预填实际状态、不另建副本、不删除、不改写骨架结构。
- 不写 `03-Asset/generated/`（含其下各分类子目录）与任何二进制文件；不改写 `03-Asset/asset-list.md` 与 `03-Asset/notes/`（那是 `vn-asset-list` 主 skill 的落点）；不另建清单、规格、记录类文档。
- 状态词表固定 8 词，不自造词汇；不把「待确认」当作「已确认」推进；默认逐轮确认后推进；用户显式指令覆盖时按宪法第 2 条处理。

## 四、上游只读清单（逐路径）

以下只读，不落盘、不追加、不改写：
- `README.md`、`Specifications.md`、`Direction.md`。
- `00-Bible/anchors.md`（第四节 核心资产与体态状态机，唯一口径）、`00-Bible/brainstorm.md`、`00-Bible/characters/<角色名>.md`、`00-Bible/relationships.md`、`00-Bible/world.md`、`00-Bible/factions.md`、`00-Bible/geography.md`、`00-Bible/timeline.md`、`00-Bible/glossary.md`、`00-Bible/style.md`。
- `01-Plan/outline.md`、`01-Plan/chapter-structure.md`、`01-Plan/endings-and-flags.md`。
- `02-Script/剧情精述.md`、`02-Script/scene-list.md`、`02-Script/draft-vN/ch001.md`、`02-Script/draft-vN/ch001-2a.md`。
- 本阶段同列既有产物：`03-Asset/asset-list.md` 与 `03-Asset/notes/` 下 `bg.md` / `sprite.md` / `cg.md` / `bgm.md` / `sfx.md` / `ui.md` / `script.md`（只读，用于对齐 1 条资产登记）。
- 不写入的下游：`04-ScreenPlay/`、`05-Game/` 及任何下游；不改写上游 `00-Bible/` `01-Plan/` `02-Script/` 全树。

## 五、越界收敛原则

默认优先把改动限制在 `03-Asset/` 本列内（且只限上述两份骨架文件）；确有必要越出本列时，只允许「读上游已确认内容」与「按 vn-gate 在 README.md 追加一行进度」两种动作，不借「有必要」扩张写权。不改写 `Specifications.md` 与 `Direction.md`。

## 六、Check 与七步循环

- 只使用 customSkillDirs 挂载的 `vn-shared`（vn-spec / vn-continuity / vn-gate）与 `vn-asset-list` 两目录内技能；不加载或引用其它阶段 skill、模板与字段定义。
- vn-spec 用于读目录纪律与产出格式；Check 步应按 vn-continuity 逐条核查单一产物：索引/缺口条目与 `03-Asset/asset-list.md` 中该 1 条登记、`00-Bible/anchors.md` 第四节口径、`02-Script/scene-list.md` 一致，无伪造资产、无预填实际状态、无计划外文件。vn-gate 用于七步循环与 README 状态机门禁。
- 七步循环 Read → Report → Confirm → Do → Check → Write → Stop：每轮 Do 前按 vn-gate 复核本轮子条目，Check 应按 vn-continuity 复核单一产物。
- README.md 按双区结构（见 `vn-gate` §4）：A 区「当前状态」5 字段就地更新、B 区「进度记录」只追加一行且不改写既有行；AI 不自行把状态置为「已确认」。

## 八、旧值 / 迁移对照 / 不

| 旧值（仅迁移语境） | 新值（唯一产出落点 / 唯一事实源） |
|---|---|
| `04-资产/` 下散落的索引 / 缺口记录 | `03-Asset/asset-index.md` 与 `03-Asset/asset-gap.md` 两份计划态骨架 |
| `assets/` 下散落的资产记录 | `03-Asset/generated/`（唯一二进制资产落点，本 skill 禁止写入，属 VN-资产制造） |
| `06-演出/资产索引.md`、`06-演出/资产缺口.md`（旧元文档） | `03-Asset/asset-index.md`、`03-Asset/asset-gap.md` |
| `规范-视觉小说设计.md` | `Specifications.md`（唯一规范事实源） |

旧值 `04-资产/`、`assets/`、`00-设定/`、`01-规划/`、`02-系统/`、`02-剧本/`、`03-修订/`、`05-剧本/`、`06-演出/`、`规范-视觉小说设计.md`、`规范-剧本.md`、`规范-演出.md`、根级 `剧情精述.md` 等不作为产出落点，仅允许出现在「旧值 / 迁移对照 / 不」语境；`04-资产/` 与 `assets/` 不作为产出落点，规范事实源唯一为 `Specifications.md`。
