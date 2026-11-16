# 用户自建 agent 预设（bundle）

这个 bundle 承载 **20 个自建预设**：13 个通用 / 写作类（论文撰写、小说创作、分类文学创作、剧本创作、视觉小说全栈设计、视觉小说演出设计、游戏设计、Godot 游戏开发、语言学习、理科学习、公文撰写、社会议题、ComfyUI 工作）与 **7 个 VN 工作流预设**（`vn-bible` / `vn-outline` / `vn-script` / `vn-asset-list` / `vn-asset-make` / `vn-screenplay` / `vn-game`）。

- `preset-screenplay-writing`（`剧本创作`）**已于 2026-11-13 恢复启用**：它是「单会话从零陪写到完稿」的独立体系，长篇连续性已补强（跨章状态台账 `03-修订/chapter-state.md`、伏笔台账 `03-修订/foreshadowing.md`、每轮必读最小集、每章强制同步项）。
- `preset-vn-design` / `preset-vn-staging` 两行仍带 `disabled: true`，是 11-07 之前的旧版，仅作回退保留、不参与运行时。

> **两套剧本体系互斥（务必先选一个）**：`剧本创作` 用 `00-设定/ 01-规划/ 02-剧本/ 03-修订/` + `规范-剧本.md`；7 个 VN-* 用 `00-Bible/ … /05-Game/` + `Specifications.md`。目录名、事实源、正文目录（`02-剧本/` vs `02-Script/`）与衔接契约全部不兼容，**同一项目只能二选一，不要在同一会话或同一工作区交叉使用**，也不要把旧 `skills/screenplay-writing/` 的旧值当 VN 产出落点。

## 为什么有它

0.1.7 起 Harness **不再扫描** `$DSH_HOME/.agent-presets/` 目录：预设只能由某个 bundle 的 patch
以 `@deepseek-ai/dsh-agent-preset` 行声明（见 `@deepseek-ai/dsh-agent-preset` 包里的
`editing-cordis-compositions` skill 的 “Migrate a legacy preset” 一节）。
旧目录里的组合内容已逐字搬进 `cordis.patch.yml`，原目录仅作备份保留。

## 结构

| 文件 | 说明 |
|---|---|
| `cordis.patch.yml` | 20 个 `preset-<id>` 声明（组合内容来自原 `agent.cordis.yml`） |
| `skills/<id>/` | 各预设随身的 skills（原 `~/.dsh/.agent-presets/<id>/skills/` 的副本） |
| `package.json` | `dsh.bundle.patch` 指向 `cordis.patch.yml` |

注册方式：`~/.dsh/profiles/web/package.json` 里作为 `link:` 依赖 + 列入 `dsh.profile.bundles`，
`~/.dsh/profiles/web/node_modules/@dsh-external/dsh-user-presets` 是指向本目录的 junction。

### VN 工作流预设与共享技能（2026-11-07 施工、2026-11-10 瘦身）

| 预设 id | 阶段 | 写列 | 挂载的 skill tree |
|---|---|---|---|
| `vn-bible` | 设定完善 | `00-Bible/` | `skills/vn-shared` + `skills/vn-bible` |
| `vn-outline` | 剧情大纲设计 | `01-Plan/` | `skills/vn-shared` + `skills/vn-outline` |
| `vn-script` | 剧情写作 | `02-Script/` | `skills/vn-shared` + `skills/vn-script` |
| `vn-asset-list` | 资产列表 | `03-Asset/` 根层 | `skills/vn-shared` + `skills/vn-asset-list` |
| `vn-asset-make` | 资产制造 | `03-Asset/generated/` | `skills/vn-shared` + `skills/vn-asset-make` |
| `vn-screenplay` | 演出剧本 | `04-ScreenPlay/` | `skills/vn-shared` + `skills/vn-screenplay` |
| `vn-game` | 游戏制造 | `05-Game/` | `skills/vn-shared` + `skills/vn-game` |

- `skills/vn-shared/` 三份（`vn-gate` / `vn-spec` / `vn-continuity`）是**目录与格式、每轮流程、一致性核查的单一真源**；7 个 preset 各挂一份 `vn-shared` + 本阶段 tree，物理上看不到下游阶段 skill。
- **指令负荷收敛（2026-11-13）**：`vn-script/` 10 份阶段 skill 里重复 10 次的「目录白名单 / 上游只读清单 / 七步循环 / 旧值迁移表 / 执行要点」整块模板已替换为一段「共用纪律（真源见 vn-shared）」指针 + 按需最小加载要求；真源仍在 `vn-shared`，改口径只改那三份，不再 10 份同步。
- **一轮 1~4 章不定（2026-11-13）**：`vn-script` 默认一轮写 1~4 章连续正文，章数由本轮范围决定（用户写明按指令、未写明在 1~4 内自主声明并在 Report 报出），各章独立核查、README B 区一行一章；其余 6 预设默认 1 个子条目。
- **有限创意主动性（2026-11-13）**：上游已确认事实绝不改动；骨架留白时可主动给 2-3 个「推测 / 待拍板」候选写法，只入对话或 `02-Script/Draft/`，不混入正式产出。
- 7 个 preset 的 persona `prefix` 里【指令裁决】6 条宪法段逐字相同，改一须同步七；各阶段 skill 里的目录白名单 / 七步循环 / 状态机是离线可读副本，与 `vn-shared` 冲突时以 `vn-shared` 为准。
- 同源副本（10 对 genre-fiction↔novel-writing、4 份 spec-common、5 份 search-query-craft）登记在 `skills/_SYNC-POLICY.md`，改动前先读。
- 现行规范入口：[VN-工作流现行规范.md](VN-工作流现行规范.md)；两份 2026-11-07 施工期历史文档（`VN-工作流改造施工文档.md` / `VN-工作流改造说明.md`）已于 2026-11-17 随归档清理删除，不是规则来源。

### 配置漂移修复（2026-11-13）

`~/.dsh/profiles/web/cordis.patch.yml` 的 `dsh-ops` 行此前只登记 13 个旧预设，7 个 `vn-*` 漏登，导致 VN 会话拿不到 dsh-ops 原生文件工具（官方 `tool-fs` 仍在、写 Markdown 不阻塞）。现已补齐 7 行 `vn-*: { enabled: true, files: true }` 并订正注释；改完需重启 DSH 或开新会话生效。

### 备份文件（非现行配置）

`cordis.patch.yml.bak`（11-10 瘦身前的 6178 行版）、`cordis.patch.yml.bak-20261107-VN-order`、`cordis.patch.yml.bak-before-scope-guard` 均为历史备份；完整治理前快照另存于 `Archive/Plugins/dsh-user-presets-slim-20261110-slim/`，本次复查后修复前的快照在 `Archive/Plugins/dsh-user-presets-auditfix-20261110/`。扫描现状时忽略 `.bak*`。

## 写作类预设的共同基线（施工经验四支柱）

以下五个预设共享同一套施工经验，术语与核验口径保持一致；改动其中一处规则时，须同步检查另外四处（本表即同步检查表）：

| 预设 | 角色 |
|---|---|
| 剧本创作 `screenplay-writing` | 四支柱的源头定义（三级视点模式、场景起飞检查卡）；2026-11-13 恢复启用并补强长篇跨章台账 |
| 小说创作 `novel-writing` | 四支柱的小说映射（章级视点声明、章节起飞检查卡） |
| 分类文学创作 `genre-fiction` | 与小说创作同构，另叠加类型 skills（四支柱一致） |
| 视觉小说全栈设计 `vn-design` | 设定侧 anchors 四节的填写归属与锁定节点 |
| 视觉小说演出设计 `vn-staging` | 下游锚点核验与中间稿排版防灾（只读上游 anchors） |

四支柱与统一术语：

1. **全局基准事实层（Anchors Layer）**：`00-设定/anchors.md`，四节固定为 年龄与生理时间轴矩阵 / 空间拓扑与动线模型 / 称谓三层解耦网格 / 核心资产与体态状态机；写作遵循「基准事实先行」，核查遵循「锚点矩阵优先核验」。称谓三层按载体命名、同层同义：剧本为 Speaker ID / 主观叙述层 / 对白呼告，小说为 叙述指称 / 主观认知称谓 / 对白呼告。
2. **视点配置系统（POV Configuration）**：视点模式在规范文档中声明（剧本为三级视点模式：单主角强沉浸 / 场段交替轮换 / 电影化群像；小说为：第一人称单视角 / 第三人称限知·章级轮换 / 第三人称全知）；场景头或章头以 `【视点：角色】` 声明，交接即执行特权与限制转移；同段落/同场景严禁多心声。
3. **起飞检查卡（Pre-flight Stamp）**：动笔前输出检查块，字段与 anchors 四节一一对应——剧本用 `<!-- SCENE_PREFLIGHT_START -->`…`<!-- SCENE_PREFLIGHT_END -->`，小说用 `<!-- CHAPTER_PREFLIGHT_START -->`…`<!-- CHAPTER_PREFLIGHT_END -->`。
4. **排版防灾**：日期、天数、章节与代号范围连接统一用 `-`（如 `6月10日 - 6月11日`、`ch001 - ch005`），严禁裸半角波浪号 `~`。

## 改动注意事项

- **skills 路径是绝对路径**：每个预设的 `skill-filesystem.customSkillDirs` 写的是
  `D:/Tools/DeepSeek Harness/Plugins/dsh-user-presets/skills/<id>`，不再用旧机制里
  “相对本预设目录” 的 `new URL('skills/', baseUrl)`——声明行里 `baseUrl` 不再指向预设自己的目录。
  改动本目录位置时必须同步改这些绝对路径（或改 `migrate-presets-to-bundle.mjs` 后重跑）。
- **persona 模板只引用已注册变量**：`config.prefix` / `suffix` 里的 `{{名}}` 必须在组装时已注册——loop 目前只注册 `{{model}}` 与 `{{provider}}`。`{{cwd}}` 自 DSH 0.2.1 起被上游移除（`source/docs/upgrade-guide/v0.2.1-alpha.1/working-directory/`），写了它会让该预设**每一轮都在发出模型请求前失败**（`unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix"; registered variables: provider, model`）；工作目录由 `dsh-working-directory` 的必需 user context 每轮自动注入，不要写进模板。2026-10-11 已按迁移指南从全部 12 个 preset 中移除该引用；同日新增自检脚本 `Archive/scripts/probe-preset-prompt-vars.mjs`（工作区根执行 `Dependency/nodejs/node.exe Archive/scripts/probe-preset-prompt-vars.mjs`），它把本文件里 12 个 persona 模板喂给 `renderPrompt`，渲染失败会逐条打印并退出码 1。
- **group 行与它的子行禁止同 id**（2026-10-21 修复）：`cordis:group` 包装行的 `id` 必须与组内插件行不同，官方写法定式为组 `id: planning`、子项 `id: plan-mode`。若两者同名（当日 `comfyui-work` 的规划组被写成 `id: plan-mode`），Loader 的 `EntryGroup.create` 会命中同一个 store 槽位并复用 group 自己的 Entry，使该条目**成为自己的父节点**；随后 `Entry.disabled` 沿 `parent.ctx.fiber.entry` 上溯即成死循环——症状是 **DSH 启动无任何输出、CPU 满转**（不是网络等待，`setTimeout` 都不触发）。诊断法：`node --inspect` 附加后 `Debugger.pause`，栈顶停在 `get disabled`，用 `Debugger.evaluateOnCallFrame` 读 `this` 即可看到自引用链与预设 id。修复后跑下方 roster 探针确认 `ROSTER_BROKEN 0`。
- **delegation 组的 4 行基线不可缺**：每个预设都应含 `tool-subagent-control`、`tool-subagent`（必须带 `config: provider: spawn / toolName: subagent / modelSelectionSettings: true / backgroundMode: continuable`）、`tool-subagent-fork`、`tool-subagent-codex`（disabled）。2026-10-21 的 `comfyui-work` 曾丢失 `tool-subagent` 的 config 与 fork/codex 两整行（roster 报 `tool-subagent (@deepseek-ai/dsh-tool-subagent): invalid config`），已按其余 12 个预设的同一基线补回。**`tool-subagent-list-agents` 独立行已于 2026-10-27 全部删除（原 5 行基线改 4 行）**：master（`22ddee379` 起）的 `@deepseek-ai/dsh-tool-subagent-control` 包根 `apply()` 已内建 `list_agents` 工具注册，且 exports 表删除了 `./list-agents` 子路径——继续写深路径行会让 import 失败、该行 "never started"，**新建会话报 `agent-preset/invalid`**。上游若再拆分此包，先核对其 `package.json` exports 再写行。
- **委托行严禁 `toolFilter` / `persona`**（2026-10-15 修复）：`@deepseek-ai/dsh-tool-subagent` 自 DSH 0.2.1 起在**加载时拒绝**这两个键，写了它会让该 preset 挂载失败，后果是**新建会话直接报 `agent-preset/invalid`**（toast 原文 `toolFilter is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)`）。当日已从全部 13 个 preset 的 `tool-subagent` / `tool-subagent-fork` 两行（共 26 处）删除历史遗留的 `toolFilter: deny: [schedule_*]`；这笔 deny 现在既不需要也不允许——子代理的工具面继承父方 preset，四个 `schedule_*` 执行器按调用方委派深度自行拒绝（`subagent_session`），可见性不等于授权。上游依据：`source/.agents/notes/implemented/simplification/2026-10-09-preset-owned-subagent-composition.md` 与同目录 `architecture/2026-09-24-preset-scoped-schedule-tools.md`（后者明确要求三条 shipped preset 的委托行都不含 `toolFilter`）。核验用下方 roster 探针，要求 `ROSTER_BROKEN 0`。
- **想加/改预设**：直接编辑 `cordis.patch.yml`。`skills/prompt-writing/dsh-preset-craft/SKILL.md` 当前**无 preset 挂载**（孤儿树，只在磁盘上），请把它当**文档直接读文件**引用，不要指望 `skill` 工具能加载；详见 `skills/_SYNC-POLICY.md` 末尾「孤儿树」。不要再去写已经废弃的 `~/.dsh/.agent-presets/<id>/` 目录。
- 改完重启 Harness 生效；挂载诊断脚本（`probe-preset-roster.mjs` 与同名 `.patch.yml`）自 2026-10-03 起已随其余诊断工具归档到工作区 `Archive/scripts/`，从工作区根执行 `Dependency/nodejs/node.exe source/apps/cli/lib/bin.js web --patch Archive/scripts/probe-preset-roster.patch.yml --port 3099 --no-open`，会打印 `ROSTER <id> ok|BROKEN` 与 `ROSTER_BROKEN` 计数后自行退出。**flag 顺序有讲究**：`--patch` 是启动器 flag，必须写在 `--port` 之类的应用参数之前——`dsh <profile>` 简写把 profile 名插到最前后，第一个不被启动器识别的 token 起，其余参数全部透传给 web 应用。
