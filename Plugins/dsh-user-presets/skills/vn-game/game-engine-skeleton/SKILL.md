---
name: game-engine-skeleton
description: 第二轮工程门专用：仅在 implementation-spec.md 经用户明确确认且 README 状态=已确认 后，按确认引擎逐模块创建 05-Game/<engine>/ 骨架与工程文件。
---

# game-engine-skeleton · 第二轮工程门

## 1. 前置条件（二者缺一不动工）
- `05-Game/implementation-spec.md` 经用户明确确认；
- `README.md` A 区 `状态=已确认`（用户明确认可本轮成果后由 AI 代为登记，AI 不自行置位；见 `vn-gate` §4）。
- 未满足前置条件时停下询问，不动工、不预建目录、不写入任何工程文件。

## 2. 唯一产出
- 唯一允许新建的目录：`<作品名>/05-Game/<engine>/`，`engine` 默认取用户确认值。
- 映射输入（只读）：`00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/`；`05-Game/implementation-spec.md` 前置校验只读。
- 除 `05-Game/<engine>/` 外不创建任何计划外文件，不写 `05-Game/` 之外任何位置。

## 3. 四引擎条件分支指引
- 分支 A · LetsGaL → 按 JSON 工程格式逐模块建 `project.json` / `characters.json` / `scenes.json` / `chapters/*.json` / `assets/.manifest.json`。
- 分支 B · WebGAL → 按 `game/scene/*.txt` + `config.txt` 逐模块建骨架。
- 分支 C · Ren'Py → 不预写结构，应在第一轮确认引擎后据实补写分支内容再动工。
- 分支 D · Godot → 不预写结构，应在第一轮确认引擎后据实补写分支内容再动工。
- 不在未确认引擎时凭空假设任一引擎的目录结构并写进文件；不复用 `godot-dev` 的 MCP 行；不挂任何引擎专属 MCP 行。

## 4. 硬约束
- `README.md` 按双区结构：A 区 5 字段仅在用户确认后就地更新，B 区只追加一行且不改写既有行；状态置「待确认」。
- 不跨阶段、不创建计划外文档、不越权写入。

## 执行要点
每轮只做 1 个子条目（用户可显式授权一次做多个；流程见 `vn-gate`）
不跨阶段写入（边界见 `vn-spec` 读写权限矩阵与 persona【指令裁决】）
