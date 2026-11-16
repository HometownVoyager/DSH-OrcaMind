---
name: vn-spec
description: VN 工作流目录与格式规范。统一 6 编号目录 + 3 根级文档树、读写权限矩阵、命名规范、白名单与共用规范前置条件。与 persona 的【指令裁决】冲突时以 persona 为准。
---

# vn-spec · 目录与格式规范

本 skill 是 VN 七预设共享的**目录 / 命名 / 格式**规范。判断「目录在哪、谁能写、文件怎么命名、哪些文档禁止创建」以本 skill 与项目根 `Specifications.md` 为准；流程按 `vn-gate`，核查按 `vn-continuity`；三者冲突时以各预设 persona 的【指令裁决】段为最高优先级。

## 1. 事实源

- 项目根 `Specifications.md` 是**唯一规范事实源**；本 skill 与它冲突时以它为准并停下询问。
- `README.md` 只记录进度与阶段状态，不是规范事实源；`00-Bible/brainstorm.md` 定稿降级为「创意意图记录」，正式事实源为 `00-Bible/anchors.md` 与各设定文档。
- `01-Plan/endings-and-flags.md` 只在「结局 / 分支 / 好感度 / FLAG / 章节推进规则」这一窄域内是唯一事实源。
- 三份旧规范（`规范-视觉小说设计.md` / `规范-剧本.md` / `规范-演出.md`）已被 `Specifications.md` 取代，不再并存；旧值仅出现在迁移对照语境。

## 2. 统一目录树（写进 `Specifications.md`）

```
<作品名>/
├── README.md                  # 唯一进度/阶段状态机
├── Specifications.md          # 唯一规范事实源
├── Direction.md               # 静态导航地图：总体说明 + 七预设导航 + 源指针表 + 02/04 分工
├── 00-Bible/
│   ├── anchors.md             # 四节基准事实层，剧情大纲前锁定
│   ├── brainstorm.md          # 仅 Brainstorm 六字段
│   ├── characters/<角色名>.md
│   ├── relationships.md
│   ├── world.md / factions.md / geography.md / timeline.md / glossary.md / style.md
│   └── 00-Bible-四份版/       # 唯一 .docx 落点，四个固定名
│       ├── 01-核心创意与基准事实.docx
│       ├── 02-角色与关系.docx
│       ├── 03-世界观与地理.docx
│       └── 04-历史·术语·文风.docx   # · 为 U+00B7
├── 01-Plan/
│   ├── outline.md
│   ├── chapter-structure.md
│   └── endings-and-flags.md   # 结局/分支/好感度/FLAG/章节推进规则，唯一事实源
├── 02-Script/
│   ├── draft-vN/ch001.md      # 三位编号；分支后缀 ch001-2a；纯剧本正文
│   ├── scene-list.md
│   ├── 剧情精述.md
│   └── Draft/                 # 零散草稿，只进不出
├── 03-Asset/
│   ├── asset-list.md
│   ├── notes/                 # 分类规格 + 生成提示词
│   ├── asset-index.md         # vn-asset-list 建骨架、vn-asset-make 补实际状态
│   ├── asset-gap.md           # 同上；逐场演出剧本的硬门前置
│   └── generated/             # 唯一二进制资产落点
├── 04-ScreenPlay/
│   ├── 演出精述.md
│   ├── draft-vN/sc001.md      # 逐场演出剧本（02 底本 + 演出指示融合稿）
│   └── scene-map.md           # 04 根层
└── 05-Game/
    ├── implementation-spec.md
    └── <engine>/              # 确认引擎后才建
```

全结构 = **6 个编号目录** + **3 个根级文档**；这句话指**目录白名单**（允许新建的目录与根级文档），不是文件名白名单。具体允许的文件名见本节目录树与 §5 命名规范，不按字面拒绝目录树里已列出的文件（如 `00-Bible/anchors.md`）。

## 3. 十条目录纪律

1. **白名单封闭**：只有上述 6 编号目录 + 3 根级文档可新建；任何其它目录 / 文件禁止创建（含以「临时 / 备份 / 修订 / 草稿」为名的目录）。
2. **单列写权 + 越界收敛**：每个预设只写自己那一列；上游只读，下游不预写、不创建。确需越出本列时，只允许「读上游已确认内容」与「在 README.md 追加一行进度」两类受控动作，不借此扩张写权。
3. **根级文档例外**：`Specifications.md` 仅「VN-设定完善」可创建 / 修订（须用户确认）；`Direction.md` 仅「VN-设定完善」首轮可建静态导航骨架，其余 6 预设只读（`vn-screenplay` 必要时经用户明确确认才允许追加指针行）；`README.md` 采用双区结构，A 区 5 字段就地更新、B 区按本轮子条目数追加对应行数（一轮 1~4 章时一行一章）。
4. **`Direction.md` 静态导航定位**：只写「去哪找」的指针与 02/04 分工，不复制源文件内容、不写规范条文、不记逐轮进度；冲突时以被指向的源文件为准。
5. **02/04 分工**：`02-Script/` 是纯剧本正文，`04-ScreenPlay/` 是叠加演出指示的逐场融合稿；不互相复制正文、不另建同义文件；`scene-list.md`（剧本侧）与 `scene-map.md`（演出侧）分工明确。
6. **资产索引 / 缺口协作**：`asset-index.md` / `asset-gap.md` 由 `vn-asset-list` 建骨架、`vn-asset-make` 补磁盘实际状态，`vn-screenplay` 只读。这两份是逐场演出剧本的默认硬门前置：未完成并经用户确认前，默认不开始 `04-ScreenPlay/draft-vN/` 逐场稿（用户显式指令可覆盖）。
7. **两个唯一落点**：`03-Asset/generated/` 是唯一二进制资产落点；`00-Bible/00-Bible-四份版/` 是唯一 `.docx` 落点。
8. **`02-Script/Draft/` 只进不出**：零散草稿只写入，不读取为事实源、不参与连续性核查、不自动收编或归档。
9. **结局 / 分支单一事实源**：`01-Plan/endings-and-flags.md` 只此一份，下游只读；不另建 `endings.md` / `systems.md` 或任何同义文件，不把结局条件散落进其它文件。
10. **旧结构切割**：`00-设定/` `01-规划/` `02-系统/` `02-剧本/` `03-修订/` `04-资产/` `05-剧本/` `06-演出/` `assets/` 等旧目录名已废弃，仅作迁移对照，禁止作为产出落点。本仓库不自动迁移既有项目文件。

## 4. 读写权限矩阵

| 预设 \ 目标 | 00-Bible | 01-Plan | 02-Script | 03-Asset | 04-ScreenPlay | 05-Game | README | Specifications | Direction |
|---|---|---|---|---|---|---|---|---|---|
| VN-设定完善 | 写 | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 | 追加 | 写 | 写（静态骨架） |
| VN-剧情大纲设计 | 只读 | 写 | 禁止 | 禁止 | 禁止 | 禁止 | 追加 | 只读 | 只读 |
| VN-剧情写作 | 只读 | 只读 | 写 | 禁止 | 禁止 | 禁止 | 追加 | 只读 | 只读 |
| VN-资产列表 | 只读 | 只读 | 只读 | 写 | 禁止 | 禁止 | 追加 | 只读 | 只读 |
| VN-资产制造 | 只读 | 只读 | 只读 | 写 | 禁止 | 禁止 | 追加 | 只读 | 只读 |
| VN-演出剧本 | 只读 | 只读 | 只读 | 只读 | 写 | 禁止 | 追加 | 只读 | 只读（确认后可追加指针） |
| VN-游戏制造 | 只读 | 只读 | 只读 | 只读 | 只读 | 写 | 追加 | 只读 | 只读 |

- **写** = 本预设唯一合法产出落点；**只读** = 上游，可读已确认内容，不改写 / 新建 / 追加；**禁止** = 下游，不读、不写、不创建、不替其做设计；**追加** = README 双区受控写。
- `03-Asset/` 同列两预设落点互不重叠：`vn-asset-list` 只写根层文档与骨架，`vn-asset-make` 只写 `generated/` 与补实际状态；彼此不写入对方落点。
- 用户显式指令与矩阵冲突时，按 persona【指令裁决】第 3 条处理（不擅自执行、一句话点明冲突、二选一由用户拍板）。

## 5. 命名与格式

- **三位编号**：章节 `ch001.md`、场次 `sc001.md`，不足补零；分支后缀 `ch001-2a`；稿次 `draft-vN`。
- **连接符**：多词文件名用半角 `-`（`endings-and-flags.md` / `asset-index.md` / `scene-map.md` 等）；根级 `Direction.md` / `Specifications.md` / `README.md` 为固定名。
- **禁裸 `~`**：文件名与正文分隔不用裸波浪号或密集波浪号堆叠，分隔用 `---` 或规范标题。
- **文风**：正文以完整、连贯的复合句为主，不写碎片段落；Brainstorm 字段至多写用户确认过的原话 + 1 句归纳（上限 2 句）；不写「稳稳接住 / 接住你」的比喻义。
- **抽象层级**：大纲层不写台词；`01-Plan/` 不写场景调度，`00-Bible/` 不写章节节奏；越界内容不落盘。

## 6. 白名单自检（Write 前）

默认在每次 Write 前自检：① 目标落在 6 编号目录之一 ② 属于本预设「写」列 ③ 文件名符合 §5 ④ `.docx` 是四个固定名之一且位于 `00-Bible/00-Bible-四份版/` ⑤ 处于本轮子条目范围内。任一项不通过时停下询问，不落盘。用户显式指令覆盖时按宪法第 3 条处理。

## 7. 共用规范生效前置条件

1. cwd 必须是 `<作品名>/` 项目目录本身或其子目录，不停在工作区根；否则 `agent-instructions` 读不到 `Specifications.md`。
2. `projectRootMarkers: ['.git', 'Specifications.md']`（保留 `.git` 并追加 `Specifications.md`）；`instructionFileCandidates: ['Specifications.md', 'README.md', 'AGENTS.md']`；`maxBytes: 65536`。
3. 首轮 Read 显式用文件工具读一次 `Specifications.md` 与 `Direction.md`，确认两份文件存在；后续轮按已读内容执行、不复读。`Direction.md` 不是事实源，以被指向的源文件为准。
4. `Specifications.md` 或 `Direction.md` 不存在时停下询问，不自行创建、不凭空假设；只有「VN-设定完善」在用户明确确认后才可创建（`Direction.md` 只建静态导航骨架），其余 6 预设不创建。
5. Read 步的**固定顺序**见 `vn-gate` §1；本 skill 不再另设「必须先」条款，避免多个「必须先」争第一。
