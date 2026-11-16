# 同源副本同步政策（2026-11-10 复查后建立）

## 为什么存在副本

`dsh-agent-preset` 的 Loader 为**每个 preset 独立挂载** `skill-filesystem.customSkillDirs`：一个 preset 只能看到自己那棵 skill tree，不能跨 tree 解析。因此多份「内容完全相同」的 `SKILL.md` **不是冗余 bug，不能单方面删除**——删掉任一侧，对应 preset 就会缺 skill。本文件是这些副本组的**唯一登记表**，改动前先读这里。

## 副本组清单

| 组 | 成员（路径相对本 `skills/` 目录） | 关系 | 同步规则 |
|---|---|---|---|
| G1 | `genre-fiction/{character-voice,continuity,novel-chapter-writing,novel-outlining,novel-revision,novel-structure,pov-craft,research-materials,story-bible,writing-craft}/SKILL.md` ↔ `novel-writing/` 同 10 个同名文件 | 10 对**逐字节相同** | 改一份必须同步改另一份；两份 `name`/`description` 不得分叉 |
| G2 | `genre-fiction/novel-project-bootstrap/SKILL.md` ↔ `novel-writing/novel-project-bootstrap/SKILL.md` | 派生关系（前者多「开题类型判定」整节） | **共性部分**（目录结构 / README 与剧情精述模板 / 开工规范检查 / 阶段门控 / 注意事项）改一须同步改另一；「开题类型判定」及其专属字段只属 genre-fiction 版，不回改母本 |
| G3 | `official-docs/spec-common/SKILL.md`、`paper-writing/spec-common/SKILL.md`、`social-issues/spec-common/SKILL.md`、`prompt-writing/spec-common/SKILL.md` | 4 份**逐字节相同** | 改一须同步改全部 4 份。注意 `prompt-writing/` 整树当前**无 preset 挂载**（孤儿树，见下），其副本只作留档，不参与运行时 |
| G4 | `game-design/search-query-craft/SKILL.md`、`official-docs/search-query-craft/SKILL.md`、`paper-writing/search-query-craft/SKILL.md`、`social-issues/search-query-craft/SKILL.md`、`prompt-writing/search-query-craft/SKILL.md` | 5 份近乎逐字相同（约 47/50 行） | 改共性规则须同步 5 份；第 5 份在孤儿树、不参与运行时 |
| G5 | 7 个 `preset-vn-*` 的 persona `prefix` 里【指令裁决】6 条宪法段；7 preset 之间 107 行工具行 | 7 份**逐字相同**（在 `cordis.patch.yml` 内） | 改宪法或工具行须同步 7 个 preset；不要只改 1 个预设 |
| G6 | 7 个 VN preset 的 persona【指令裁决】6 条 + 【默认每轮节奏】段（逐字相同） | 7 份**逐字相同** | 改一须同步七（2026-11-13 已同步加入「本轮批量 1~4 不定」与「有限创意主动性」）。`vn-script/` 10 份阶段 skill 的重复模板已于 2026-11-13 **删除并改为 `vn-shared` 指针**，不再属于副本组；口径真源唯一为 `vn-shared/vn-gate`、`vn-spec`、`vn-continuity`，改口径只改这三份 |

## 操作守则

1. 改动前先在本表查到所属组；**不要只改一份**。
2. 改完用校验脚本比对组内 md5（或 `diff`）；G1/G3 应重新回到逐字节相同，G2/G4 只允许已知的域内差异。
3. 新增一个挂载同款技能的 preset 时，把它登记进对应组，不要新建无登记的隐形第 N 份副本。

## 旧 `剧本创作` 预设（2026-11-13 恢复）

`skills/screenplay-writing/`（10 份）重新由 `preset-screenplay-writing` 挂载，运行时可达。它与 `vn-script/` 10 份同名 skill **内容硬互斥**（旧 `00-设定/ 02-剧本/ 03-修订/ 规范-剧本.md` × 新 `00-Bible/ 02-Script/ Specifications.md`），但两者挂在**不同 preset、不同会话**，不构成会话内冲突；不要把任一侧的旧值 / 新值交叉引用。旧预设的长篇连续性增强落在 persona + `continuity/SKILL.md` + `vn-script-project-bootstrap/SKILL.md` 三处，改一处须同步另两处口径。

## 孤儿树

`skills/prompt-writing/`（9 份 `SKILL.md`）当前**没有任何 preset 的 `customSkillDirs` 指向**，运行时不可达。定位：**磁盘文档库 / 编写预设时的参考材料**，不是可加载技能；其中 `dsh-preset-craft` 被 `Plugins/dsh-user-presets/README.md` 引为「改 preset 的规范」，请按**文档**引用（直接读文件），不要指望 `skill` 工具能加载它。若日后确实需要加载，应先给某个 preset 补 `customSkillDirs` 挂载并回到本表登记。
