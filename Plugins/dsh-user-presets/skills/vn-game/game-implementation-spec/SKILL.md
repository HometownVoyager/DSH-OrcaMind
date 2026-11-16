---
name: game-implementation-spec
description: 第一轮规格门专用：先由用户确认目标引擎，再逐节产出 05-Game/implementation-spec.md 的引擎侧实现规格与目录映射，每轮只写其中一节。
---

# game-implementation-spec · 第一轮规格门

## 1. 唯一产出与前置
- 唯一产出的落点：`<作品名>/05-Game/implementation-spec.md`，每轮只写其中一节，不一轮写完整份。
- 本道门**只**产出该文件：不创建 `05-Game/<engine>/` 目录、不创建任何工程文件、不写入任何引擎专属目录结构结论。
- 唯一规范事实源：`<作品名>/Specifications.md`（只读）；结局/分支唯一事实源：`<作品名>/01-Plan/endings-and-flags.md`（只读）。
- 映射输入（只读）：`02-Script/draft-vN/`、`02-Script/剧情精述.md`、`02-Script/scene-list.md`、`03-Asset/asset-list.md`、`03-Asset/generated/`、`04-ScreenPlay/draft-vN/sc001.md`、`04-ScreenPlay/scene-map.md`。

## 2. 引擎确认（默认门禁，用户显式指令可覆盖）
- 应先向用户确认目标引擎，四选一 LetsGaL / WebGaL / Ren'Py / Godot（用户曾表示大概率 LetsGaL，但未定）；未经确认不写入任何引擎专属结论。
- 引擎事实源只写已确认部分：LetsGaL Studio 为 JSON 工程格式（`project.json` / `characters.json` / `scenes.json` / `chapters/*.json` / `assets/.manifest.json`）；WebGAL 为 `game/scene/*.txt` + `config.txt`；Ren'Py 与 Godot 在第一轮确认引擎后据实补写，不凭空假设。
- 未确认项只进「尚未确认项清单」：只列条目标题、不展开、不写入正文结论。

## 3. 内容质量
- 应写实，以已确认的上游事实源与已确认的引擎为据，不臆造引擎目录结构、文件名、验收项。
- 映射规则应逐条追溯到上游具体文件与具体条目，不含糊表述。
- 编号与命名默认沿用 `Specifications.md` ③节：三位编号 `ch001` / `sc001`、分支后缀 `-2a`、`-` 连接符、禁裸 `~`。
- 规格文件不写入台词、不写入上游正文、不复制上游全文。

## 4. 硬约束
- 不回写 `00-Bible/`、`01-Plan/`、`02-Script/`、`03-Asset/`、`04-ScreenPlay/` 任何文件；发现上游缺漏停下询问。
- `README.md` 按双区结构：A 区「当前状态」5 字段仅在用户确认后就地更新，B 区「进度记录」只追加一行且不改写既有行；状态置「待确认」，AI 不自行置「已确认」。

## 执行要点
每轮只做 1 个子条目（用户可显式授权一次做多个；流程见 `vn-gate`）
不跨阶段写入（边界见 `vn-spec` 读写权限矩阵与 persona【指令裁决】）
