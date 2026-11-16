---
name: vn-bible-docx
description: 新建：由已确认 Markdown 同步生成 00-Bible/00-Bible-四份版/ 下四个固定名 .docx，只在用户明确要求或收录源经确认变更时触发。
---

# 四份 Docx 同步（vn-bible-docx）

## 何时使用
- 本预设（VN-设定完善 / vn-bible）接到以下三种触发之一时使用：① 用户明确要求同步（含指定某一份或四份全量）；② `00-Bible/anchors.md` 或任一收录源文件经用户确认变更后；③ 用户要求交付四份时。
- 不在未被明确要求时自动同步：不每轮 Write 顺带同步、不在 Check 步同步、不因「顺便保持一致」而写 Docx。
- `office-reader` 与 `office-editor` 默认仅本预设（VN-设定完善）挂载，其余 6 个预设默认物理上无权读写 Docx；不调用其它阶段 skill，不看到下一阶段模板与字段定义。
- 白名单恒为「6 个编号目录 + 3 个根级文档」：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`、`05-Game/` 与根级 `README.md`、`Specifications.md`、`Direction.md`；本 skill 的唯一落点只属于 `00-Bible/00-Bible-四份版/`。

## 唯一落点 / 写死路径
- 唯一合法 `.docx` 落点是 `<作品名>/00-Bible/00-Bible-四份版/`，四个固定文件名不改动，除这 4 个名字外不在该目录新建任何文件、不新建第 5 份（含总览 / 索引 / 附录 / 合集）。工作区任何其它位置不产出 `.docx`。
- 固定四名与收录的 Markdown 源（一一对应，均在 `00-Bible/`）：
  - `01-核心创意与基准事实.docx` ← `00-Bible/brainstorm.md` + `00-Bible/anchors.md`
  - `02-角色与关系.docx` ← `00-Bible/characters/` 全部 + `00-Bible/relationships.md`
  - `03-世界观与地理.docx` ← `00-Bible/world.md` + `00-Bible/factions.md` + `00-Bible/geography.md`
  - `04-历史·术语·文风.docx` ← `00-Bible/timeline.md` + `00-Bible/glossary.md` + `00-Bible/style.md`（文件名含 U+00B7 间隔号 `·`，不写成连字符或顿号版本）
- 第 4 份只对应 `timeline.md` + `glossary.md` + `style.md`，不含系统、不含资产、不含结局分支；`README.md` / `Specifications.md` 同样不进入四份。
- 四份只装「设定」：即 `00-Bible/` 下的人物、关系、世界观、地理、历史、术语、文风、基准事实与创意核心。不收录 `01-Plan/`（结局、分支条件、好感度 / FLAG、章节大纲、结构表、推进规则）、`03-Asset/`（资产清单、规格、数量、优先级、生成提示词、二进制资产索引）、`02-Script/`（剧本正文、场景表、剧情精述、Draft/ 零散草稿）、`04-ScreenPlay/`（逐场融合稿、scene-map.md、演出精述）、`05-Game/`（实现规格、工程骨架、引擎内容）的任何内容，哪怕只是一句摘要、一个附表或一条索引。
- 首轮显式读一次 `Specifications.md` 与 `Direction.md`（后续轮不复读），读根级 `README.md` 校验「当前预设」，只读 `00-Bible/` 内已确认的 Markdown 源；不读下游阶段目录作为事实来源。

## 单轮单条目
- 每轮只处理 1 个子条目：即四个固定 `.docx` 中的 1 份的同步；本轮子条目由用户从候选清单中选定，AI 不自主规划阶段内子任务、不用一份整稿替代逐步确认。同步只改 4 个固定文件的内容，不改文件名、不改目录、不新建第 5 份、不自动迁移或重命名既有 Docx。
- 同步方向恒为 Markdown → Docx：每个 `.md` 压成「标题 + 关键事实条目」，一个事实一条目，说明性长段压成要点句但保留因果复合句主干、不展开成新段落；不新增 Markdown 里没有的事实，不补写、推断、补全开放问题、把候选方向写成既定设定或加入总结评语与推荐。
- 表格应原样保留、不压缩丢失：尤其是「年龄矩阵」「称谓网格」「信物流转状态机」三张表，行列、单元格文字、状态迁移条件默认照搬；不把表格改写成叙述、不合并行、不只留表头。
- Markdown 默认是唯一事实源，Docx 只是对外 / 交付用的压缩版副本，不具备事实源地位；两者不一致时恒以 Markdown 为准并按下述触发同步，不反向以 Docx 为准改 Markdown、不把 Docx 内容反向当作事实源，四份之间不互相引用为事实源。`vn-continuity` 一致性核查只认 `00-Bible/anchors.md` 与 `.md` 链路，不认 Docx。
- 若用户直接改了 Docx：应回写对应 Markdown（经用户确认后按同步方向修正）或在 `README.md` B 区「进度记录」追加一行登记差异（差异位置 / Docx 值 / Markdown 值 / 待裁决，A 区状态置「待确认」），二选一；不让 Docx 成为独立事实源、不据此改写其它 Markdown 而不登记。
- 一切内容应由已确认 Markdown 与用户确认支撑；存在疑问用 ask_user_question 求证，由用户拍板，不凭空假设。
- Read → Report → Confirm → Do → Check → Write → Stop 七步为默认顺序；用户显式指令可调整；Write 在 Confirm 之后、Stop 之前，只写这一个 `.docx` + 就地更新 `README.md` A 区「当前状态」5 字段 + 在 B 区「进度记录」追加一行（状态置「待确认」）。
- Check：按 `vn-continuity` 核查这一个产物（只认 `.md` 链路与 `anchors.md`），按 `vn-spec` 校验统一目录与格式，按 `vn-gate` 校验单轮单条目；冲突停下请用户裁决。

## 执行要点

每轮只做 1 个子条目（用户可显式授权一次做多个；流程见 `vn-gate`）

不跨阶段写入（边界见 `vn-spec` 读写权限矩阵与 persona【指令裁决】）

- 不创建计划外文档、不跨阶段预写、不越权写入；违反任一红线应立即停下并用 ask_user_question 询问。

## 旧值 / 迁移对照（不作为产出落点）
`00-设定/`、`01-规划/`、`02-系统/`、`02-剧本/`、`03-修订/`、`04-资产/`、`05-剧本/`、`06-演出/`、`assets/`、`规范-视觉小说设计.md`、`规范-剧本.md`、`规范-演出.md` 均为废弃旧值，仅允许出现在本节迁移对照中，**不作为产出落点**。
