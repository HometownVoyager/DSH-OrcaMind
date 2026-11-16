---
name: staging-project-bootstrap
description: VN-演出剧本阶段初始化：在 <作品名>/04-ScreenPlay/ 建 演出精述.md、scene-map.md 骨架与 draft-vN/ 目录，不预写逐场稿，只增不改并登记 README 状态机。新建/接手本阶段项目时使用。
---

# VN-演出剧本 · 项目初始化（staging-project-bootstrap）

## 何时使用
- 用户切换到 vn-screenplay / VN-演出剧本 预设，首轮需建立本阶段骨架时。
- 接手已有项目但缺 `<作品名>/04-ScreenPlay/` 骨架时。
- 每轮开工前检阅状态、每轮收尾时登记进度与确认记录。

## 职责定位（02 底本 + 演出指示融合稿）
本阶段以 `<作品名>/02-Script/` 纯剧本正文（台词/叙述/场景表）为**唯一底本**，叠加演出指示写成逐场演出剧本融合稿，产出只落在 `<作品名>/04-ScreenPlay/`。8 个 skill 的内核与 8 条核心原则沿用 vn-staging 全链，但职责统一改为「底本 + 演出指示融合稿」。

## 唯一落点 / 写死路径
- **唯一产出目录写死 `<作品名>/04-ScreenPlay/`**，`04-ScreenPlay/` 固定产出仅三类：`演出精述.md`、`draft-vN/scNNN.md`（逐场演出剧本融合稿，三位编号）、`scene-map.md`（演出侧场次表）。
- 本 skill 首轮只建：`04-ScreenPlay/演出精述.md`（骨架）、`04-ScreenPlay/scene-map.md`（骨架）、`04-ScreenPlay/draft-vN/` 空目录；**不预写任何逐场稿**。
- `README.md` 采用双区结构：A 区「当前状态」块 5 字段就地更新（当前预设 / 当前阶段 / 本轮子条目 / 状态 / 下一候选），B 区「进度记录」只追加一行、永不改写或删除既有行；状态默认置「待确认」，不自行置「已确认」。
- 统一目录表白名单为**6 个编号目录 + 3 个根级文档**（不是 6+2）：`00-Bible/ 01-Plan/ 02-Script/ 03-Asset/ 04-ScreenPlay/ 05-Game/` 六个编号目录，加根级 `README.md`、`Specifications.md`、`Direction.md` 三份文档。

## 硬门
- 没有 `<作品名>/03-Asset/asset-index.md` 与 `<作品名>/03-Asset/asset-gap.md` 且未经用户确认之前，**默认不开始逐场演出剧本（用户显式指令可覆盖）**；未满足硬门应停下询问，不预写逐场稿。
- 这两份由 vn-asset-list（建骨架）与 vn-asset-make（补磁盘实际状态）协作生成，本预设只读、不改写、不另建副本。硬门未过默认不创建任何逐场演出剧本文件（用户显式指令可覆盖）。

## 只读与禁写
- 上游 `<作品名>/00-Bible/`、`<作品名>/01-Plan/`（含 `endings-and-flags.md`）、`<作品名>/02-Script/`、`<作品名>/03-Asset/`（含 `asset-index.md` / `asset-gap.md` / `generated/`）与根级 `Direction.md`、`Specifications.md` **只读**。
- `Direction.md` 是静态导航地图，不记录逐轮进度；制作计划与逐轮进度**只归 README.md**，本 skill 不在 04-ScreenPlay/ 内写制作计划。
- 不创建计划外文档与计划外目录；不创建 `04-ScreenPlay/` 之外的一切元文档（总体说明 / 制作计划 / 资产索引 / 资产缺口 / 交付说明不落 04，也不在别处另建）。
- 不预写 `<作品名>/05-Game/`：不写入、不创建、不预写下游文件，不在对话中替下游做设计。

## 旧路径语境（不作为产出落点，仅迁移对照）
`00-设定/ 01-规划/ 02-系统/ 02-剧本/ 03-修订/ 04-资产/ 05-剧本/ 06-演出/ assets/ 规范-*.md / 剧情精述.md（根级）` 等旧路径**不作为产出落点**，只允许出现在「旧值 / 迁移 / 不 / 上游只读」语境。
- 旧 `06-演出/` 不作为产出落点（仅迁移对照，新值 `04-ScreenPlay/`）。
- 旧 `06-演出/总体说明.md`、`06-演出/制作计划.md`、`06-演出/资产索引.md`、`06-演出/资产缺口.md` 不落 04、不另建：总体说明/制作计划并入根级 `Direction.md`（只读，制作计划/逐轮进度只归 README.md），资产索引/缺口改置 `03-Asset/asset-index.md` / `03-Asset/asset-gap.md`（只读）。
- 根级 `剧情精述.md`（上游只读）仅作迁移对照，新值 `02-Script/剧情精述.md`。

## 单轮单条目
- **每轮只处理 1 个子条目**：本 skill 一轮只建「骨架中的一个子条目」（如 `演出精述.md` 骨架、或 `scene-map.md` 骨架、或 `draft-vN/` 目录登记），由用户从候选清单中选定，不自主规划本阶段子任务。
- **不跨阶段**：不读写下游阶段目录、不创建下游文件、不在对话中替下游做设计；不做上游阶段的事（改写设定/大纲/剧本正文/资产清单与规格/资产索引与缺口）。
- 只增不改：不改写上游只读文件，只写 04-ScreenPlay/ 这一处并追加 README.md 一行。
- 不一次性交付多份文档；不把 `02-Script/` 正文复制进 `04-ScreenPlay/` 另建同义文件。

## 七步循环与 Check
- Read → Report → Confirm → Do → Check → Write → Stop。Read 显式读 `<作品名>/README.md`、`<作品名>/Specifications.md` 与根级 `Direction.md`，并核对上游交接；Confirm / Stop 两组常用选项可按需选用，不必互斥套用（见 `vn-gate` §2）。
- Check 按 `vn-continuity`：场次号连续、状态词合法、路径一致、无伪造资产、无引擎语法、无计划外文件、进度落盘、未复制 02-Script 正文。
- Write 只写这一个文件（只增不改），就地更新 README.md A 区 5 字段 + 在 B 区追加一行（状态「待确认」）。

## 8 条核心原则
① 实际资产优先于资产列表：以 `03-Asset/generated/` 磁盘实际文件为准，`03-Asset/asset-list.md` 是需求文档不是库存清单，`03-Asset/asset-index.md` 只读引用不改写。
② 不伪造资产路径、资产 ID、差分名。
③ 不将就也不死板：缺口显式化，不凑合使用未确认资产，不因缺资产擅自改写剧本。
④ 缺口显式化：以 `03-Asset/asset-gap.md` 为准，按 8 词状态词表在融合稿中标注引用，不默默绕过、不另写缺口文档、不改写资产缺口表。
⑤ 融合稿与引擎转写分离：逐场演出剧本不引擎语法，不写路径、扩展名、引擎资源加载语法。
⑥ 长流程落盘：进度应落磁盘，不只存在对话里；每轮只增不改写入 04-ScreenPlay/ 并在 README.md 追加一行。
⑦ 单 Agent 推进：不编写多 Agent 协作文档、分工表、交接协议。
⑧ 主动询问、确认后整理：任何疑问主动询问，用户确认后才整理落盘，不凭空假设。

## 8 词状态词表
只用 `available / generated / substitute / placeholder / missing / hard_missing / pending / listed_but_missing` 这 8 个词标注资产状态；不自造同义词、缩写或新状态词。

## 执行要点（三条，逐字执行）
- **每轮只处理 1 个子条目**
- **不跨阶段**
