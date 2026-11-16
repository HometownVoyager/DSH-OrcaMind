---
name: vn-asset-list
description: VN-资产列表阶段专属清单助手：逐条登记资产清单、规格、数量、优先级与生成提示词，只写 03-Asset/asset-list.md 与 03-Asset/notes/ 下七类分类规格文件，不产出任何二进制文件。
---

# VN-资产列表（vn-asset-list）

本 skill 由旧 `vn-design/vn-asset-list` 改组，是 VN 工作流第 4 阶段「资产清单与规格」的专属技能。默认使用中文与用户交流。职责：依据 `00-Bible/`、`01-Plan/`、`02-Script/` 已确认事实，逐条登记资产清单、规格、数量、优先级与生成提示词；不产出任何二进制文件。`03-Asset/asset-index.md` 与 `03-Asset/asset-gap.md` 两份计划态骨架由同目录 `asset-index-gap-bootstrap` 承担，本 skill 不越界代写。

## 一、唯一落点 / 写死路径

- 唯一清单落点写死为 `03-Asset/asset-list.md`：资产标识、分类、数量、优先级只登记于此。
- 分类规格与生成提示词的唯一落点写死为 `03-Asset/notes/`，固定 7 类：`bg.md` / `sprite.md` / `cg.md` / `bgm.md` / `sfx.md` / `ui.md` / `script.md`。不在 `03-Asset/notes/` 之外另建清单、规格或提示词文件，不另建同义文件与独立修订目录。
- 生成提示词应逐条写进对应分类规格文件，与该条规格字段一一对应，并逐条标注上游事实来源；应具体、可复用，不含糊形容词堆砌。
- 唯一规范事实源为 `Specifications.md`（只读，不改写）；`Direction.md` 是静态导航地图，只读。
- 唯一二进制资产落点是 `03-Asset/generated/`；唯一 .docx 落点是 `00-Bible/00-Bible-四份版/`。二者本预设不写入。
- 不写 `03-Asset/generated/`（含其下 `bg/` `sprite/` `cg/` `bgm/` `sfx/` `ui/` `script/`），该目录属 VN-资产制造（vn-asset-make）；不产出任何二进制文件（图片、音频、字体、可执行文件等）。

### 白名单（6 个编号目录 + 3 个根级文档）

`<作品名>/` 下只允许存在 6 个编号目录 + 3 个根级文档，任何其它目录/文件不创建：
- 6 个编号目录：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/`。
- 3 个根级文档：`README.md`、`Specifications.md`、`Direction.md`。

## 二、单轮单条目

- 「一个子条目」= `03-Asset/asset-list.md` 中 1 条资产登记（标识 / 分类 / 数量 / 优先级）连同 `03-Asset/notes/` 对应分类规格文件里该条的「规格 + 生成提示词」，作为一个不可拆分的最小产物单元。
- 每条「清单登记 + 规格 + 数量 + 优先级 + 生成提示词」为一个子条目，应在同一轮 Do → Check → Write 内完成，不拆到下一轮、不生成提示词单独起轮、不合并多条资产为一轮。
- 每轮只处理 1 个子条目，不在本轮内规划或预写后续资产条目，不一次写出整份清单；本轮子条目由用户从候选清单中选定，不自主规划本阶段子任务。
- 每轮 Write 后在 `README.md` 追加一行进度并把状态置「待确认」，随后停下，不自行开始下一轮。

## 三、硬约束

1. 每轮只处理 1 个子条目
2. 不跨阶段

补充（与上三条同等强制）：
- 不跨阶段：不读写下游阶段目录、不创建下游文件、不在对话中替下游做设计、列出下游字段或预写下游内容。
- 核心资产与体态状态机应与 `00-Bible/anchors.md` 第四节同一口径，只读；不在清单、规格或生成提示词里自创设定。
- 发现需求缺口（角色外观、场景、时段、情绪、数量、优先级未定等）应停下，用 ask_user_question 回指 `00-Bible/characters/<角色名>.md`、`00-Bible/world.md`、`01-Plan/chapter-structure.md`、`02-Script/scene-list.md` 等上游文档，由用户拍板；不自行补全后落盘，不补写候选方向或改写上游事实。
- 不产出任何二进制文件；不把「待确认」当作「已确认」推进；默认逐轮确认后推进；用户显式指令覆盖时按宪法第 2 条处理。
- `01-Plan/endings-and-flags.md` 是结局与分支条件唯一事实源，只读，不另建同义文件。

## 四、上游只读清单（逐路径）

以下只读，不落盘、不追加、不改写：
- `README.md`、`Specifications.md`、`Direction.md`。
- `00-Bible/anchors.md`（第四节 核心资产与体态状态机，唯一口径）、`00-Bible/brainstorm.md`、`00-Bible/characters/<角色名>.md`、`00-Bible/relationships.md`、`00-Bible/world.md`、`00-Bible/factions.md`、`00-Bible/geography.md`、`00-Bible/timeline.md`、`00-Bible/glossary.md`、`00-Bible/style.md`。
- `01-Plan/outline.md`、`01-Plan/chapter-structure.md`、`01-Plan/endings-and-flags.md`。
- `02-Script/剧情精述.md`、`02-Script/scene-list.md`、`02-Script/draft-vN/ch001.md`、`02-Script/draft-vN/ch001-2a.md`。
- 本阶段已有产物：`03-Asset/asset-list.md` 与 `03-Asset/notes/` 下 `bg.md` / `sprite.md` / `cg.md` / `bgm.md` / `sfx.md` / `ui.md` / `script.md`（作为同列既有内容读取，只改本轮子条目那一行）。
- 不写入的上游/下游：`00-Bible/` 全树、`01-Plan/` 全树、`02-Script/` 全树、`03-Asset/generated/`、`04-ScreenPlay/`、`05-Game/`。

## 五、越界收敛原则

默认优先把改动限制在 `03-Asset/` 本列内；确有必要越出本列时，只允许「读上游已确认内容」与「按 vn-gate 在 README.md 追加一行进度」两种动作，不借「有必要」扩张写权。不改写 `Specifications.md` 与 `Direction.md`。

## 六、Check 与七步循环

- 只使用 customSkillDirs 挂载的 `vn-shared`（vn-spec / vn-continuity / vn-gate）与 `vn-asset-list` 两目录内技能；不加载或引用其它阶段 skill、模板与字段定义。
- vn-spec 用于读目录纪律与产出格式；Check 步应按 vn-continuity 逐条核查单一产物：与 `00-Bible/anchors.md` 第四节核心资产与体态状态机、`01-Plan/endings-and-flags.md`、`02-Script/scene-list.md` 事实一致，生成提示词与规格字段一一对应并标注上游事实来源。vn-gate 用于七步循环与 README 状态机门禁。
- 七步循环 Read → Report → Confirm → Do → Check → Write → Stop：每轮 Do 前按 vn-gate 复核本轮子条目，Check 应按 vn-continuity 复核单一产物。
- README.md 按双区结构（见 `vn-gate` §4）：A 区「当前状态」5 字段仅在用户确认后就地更新，B 区「进度记录」只追加一行且不改写或删除既有行；AI 不自行把状态置为「已确认」。

## 八、asset-index-gap-bootstrap 职责（本阶段协作写权）

本阶段 skill 默认含 `asset-index-gap-bootstrap` 职责（§3.4 ② 技能使用段）：`03-Asset/asset-index.md` 与 `03-Asset/asset-gap.md` 两份计划态骨架由本目录（vn-asset-list 阶段）承担，逐轮单条目、1 条资产对应 1 条索引/缺口骨架，磁盘实际状态默认留待 `vn-asset-make` 补齐；这两份是 `vn-screenplay` 逐场演出剧本的默认硬门前置（用户显式指令可覆盖），本预设不代替用户确认。该职责的完整执行细则见同目录 `asset-index-gap-bootstrap/SKILL.md`；本 skill 只负责声明与协同，不越界代写骨架、不复制其执行细则，二者同属本阶段「写」列的唯一例外（§3.4 ⑤ 与 §10 #29），`vn-screenplay` 对两份只读。

## 九、旧值 / 迁移对照 / 不

| 旧值（仅迁移语境） | 新值（唯一产出落点 / 唯一事实源） |
|---|---|
| `04-资产/` 下散落的清单 | `03-Asset/asset-list.md` |
| `04-资产/` 下散落的规格 | `03-Asset/notes/` 下 `bg.md` / `sprite.md` / `cg.md` / `bgm.md` / `sfx.md` / `ui.md` / `script.md` 七类分类规格文件 |
| `assets/` | `03-Asset/generated/`（本预设禁止写入，属 VN-资产制造） |
| `规范-视觉小说设计.md` | `Specifications.md`（唯一规范事实源） |

旧值 `04-资产/`、`assets/`、`00-设定/`、`01-规划/`、`02-系统/`、`02-剧本/`、`03-修订/`、`05-剧本/`、`06-演出/`、`规范-视觉小说设计.md`、`规范-剧本.md`、`规范-演出.md`、根级 `剧情精述.md` 等不作为产出落点，仅允许出现在「旧值 / 迁移对照 / 不」语境；`04-资产/` 与 `assets/` 不作为产出落点，`规范-视觉小说设计.md` 不引用，规范事实源唯一为 `Specifications.md`。
