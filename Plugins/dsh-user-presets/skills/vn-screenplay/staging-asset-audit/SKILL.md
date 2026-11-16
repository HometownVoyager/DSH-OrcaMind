---
name: staging-asset-audit
description: VN-演出剧本阶段资产一致性只读核对：核对 03-Asset/asset-index.md 与 03-Asset/generated/ 磁盘实际资产是否一致，不另写索引文档，不一致停下询问，禁止自行修订索引。
---

# 资产一致性只读核对（staging-asset-audit）

## 何时使用
- 每轮 Do 之前，确认某场融合稿要引用的资产是否真实存在。
- 用户新增、替换或删除资产文件之后，重新核对索引与磁盘。
- 交付验收之前，确认只读索引与磁盘一致。

## 职责定位（02 底本 + 演出指示融合稿）
本阶段以 `<作品名>/02-Script/` 纯剧本正文为唯一底本，叠加演出指示写成逐场融合稿，产出只落在 `<作品名>/04-ScreenPlay/`。本 skill 沿用 vn-staging `staging-asset-audit` 的「实际资产优先」内核，改为**只读核对**：不自写索引、不另建副本。

## 第一原则：实际资产优先
以 `<作品名>/03-Asset/generated/` 磁盘实际文件为准；`<作品名>/03-Asset/asset-list.md` 是**需求文档，不是库存清单**，不把它当作资产存在的证据。`<作品名>/03-Asset/asset-index.md` 由 vn-asset-list / vn-asset-make 协作生成，是协作生成的索引、本预设只读引用，不改写、不另建副本。磁盘实际文件优先于索引、索引优先于需求列表。

## 唯一落点 / 写死路径
- **唯一产出目录写死 `<作品名>/04-ScreenPlay/`**，固定产出仅 `演出精述.md` / `draft-vN/scNNN.md` / `scene-map.md` 三类。
- **本 skill 在 `04-ScreenPlay/` 不写任何索引文件**：不写资产索引、不写资产缺口、不写交付说明、不写任何元文档。核对结论只体现在逐场融合稿的引用与标注区（按 8 词状态词表），以及 README.md 的登记。
- 白名单为**6 个编号目录 + 3 个根级文档**：`00-Bible/ 01-Plan/ 02-Script/ 03-Asset/ 04-ScreenPlay/ 05-Game/` 六目录，加根级 `README.md`、`Specifications.md`、`Direction.md` 三文档（不是 6+2）。`Direction.md` 是静态导航地图、不记录逐轮进度；制作计划与逐轮进度只归 README.md。

## 核对范围与硬约束（只读）
- 只读 `<作品名>/03-Asset/asset-index.md`（由 vn-asset-list / vn-asset-make 协作生成）与 `<作品名>/03-Asset/generated/` 磁盘实际文件，逐项核对：ID、分类、名称、相对路径、扩展名、实际存在性、差分名。
- **不改写** asset-index.md、不另建副本；**发现不一致应停下询问，不自行修订索引**，不静默忽略、不在对话里当作已对齐。
- **不伪造资产路径、资产 ID、差分名**：默认引用磁盘实际存在的文件；列表里登记了而磁盘没有的即 `listed_but_missing`，不是可用资产。
- 只读 `03-Asset/generated/` 磁盘实际资产：不搬动、不改名、不转换、不删除任何文件。
- 状态词表只用 8 个词；不凑合使用未确认资产。

## 硬门
没有 `<作品名>/03-Asset/asset-index.md` 与 `<作品名>/03-Asset/asset-gap.md` 且未经用户确认之前，**默认不开始逐场演出剧本（用户显式指令可覆盖）**；这两份由 vn-asset-list / vn-asset-make 协作生成，本预设只读、不改写、不另建副本。

## 只读与禁写
- 上游 `<作品名>/00-Bible/`、`<作品名>/01-Plan/`、`<作品名>/02-Script/`、`<作品名>/03-Asset/`（含 asset-index.md / asset-gap.md / generated/）与根级 `Direction.md`、`Specifications.md` 只读。
- `README.md` 采用双区结构（见 `vn-gate` §4）：A 区「当前状态」块 5 字段（当前预设 / 当前阶段 / 本轮子条目 / 状态 / 下一候选）就地更新，B 区「进度记录」只追加一行、永不改写或删除既有行；状态默认「待确认」，不自行置「已确认」。
- 不创建计划外文档与计划外目录；不一次性交付多份文档；不预写 `<作品名>/05-Game/`；只增不改，不复制 `02-Script/` 纯正文另建同义文件。

## 旧路径语境（不作为产出落点，仅迁移对照）
`00-设定/ 01-规划/ 02-系统/ 02-剧本/ 03-修订/ 04-资产/ 05-剧本/ 06-演出/ assets/ 规范-*.md / 剧情精述.md（根级）` 等旧路径**不作为产出落点**，只允许出现在「旧值 / 迁移 / 不 / 上游只读」语境。旧 `assets/` 与 `04-资产/` 不作为产出落点（新值 `03-Asset/generated/` 与 `03-Asset/asset-list.md`，均只读）；旧 `06-演出/资产索引.md` 仅作迁移对照，新值 `03-Asset/asset-index.md`（只读）。不引用旧路径作为事实源。

## 单轮单条目
- **每轮只处理 1 个子条目**：一轮只核对 1 条资产引用（或 1 处索引↔磁盘差异），由用户从候选清单中选定，不自主规划本阶段子任务。
- **不跨阶段**：不读写下游阶段目录、不创建下游文件、不在对话中替下游做设计；不做上游阶段的事（不改写资产索引与缺口）。
- 只增不改：不改写上游只读文件；核对结果若要落盘，只写 04-ScreenPlay/ 融合稿一个文件并在 README.md 追加一行。

## 七步循环与 Check
- Read → Report → Confirm → Do → Check → Write → Stop。Read 显式读 `<作品名>/README.md`、`<作品名>/Specifications.md` 与根级 `Direction.md`，只读 asset-index.md 与 generated/ 磁盘实际文件；Confirm / Stop 两组常用选项可按需选用，不必互斥套用（见 `vn-gate` §2）。
- Check 按 `vn-continuity`：场次号连续、状态词合法、路径一致、无伪造资产、无引擎语法、进度落盘。
- Write 只写这一个文件（只增不改），就地更新 README.md A 区 5 字段 + 在 B 区追加一行（状态「待确认」）。

## 8 条核心原则
① 实际资产优先于资产列表（磁盘实际为准，asset-list.md 是需求文档，asset-index.md 只读）。② 不伪造资产路径、资产 ID、差分名。③ 不将就也不死板（缺口显式化，不凑合使用未确认资产，不擅自改写剧本）。④ 缺口显式化（以 `03-Asset/asset-gap.md` 为准，按 8 词状态词表在融合稿中标注引用，不默默绕过/另写缺口文档/改写资产缺口表）。⑤ 融合稿与引擎转写分离（不引擎语法、路径、扩展名、引擎资源加载语法）。⑥ 长流程落盘（进度应落磁盘，每轮只增不改写入 04-ScreenPlay/ 并在 README.md 追加一行）。⑦ 单 Agent 推进（不多 Agent 协作文档、分工表、交接协议）。⑧ 主动询问、确认后整理（存在疑问应主动询问，确认后才整理落盘，不凭空假设）。

## 8 词状态词表
只用 `available / generated / substitute / placeholder / missing / hard_missing / pending / listed_but_missing` 这 8 个词标注资产状态；不自造同义词、缩写或新状态词。

## 执行要点（三条，逐字执行）
- **每轮只处理 1 个子条目**
- **不跨阶段**
