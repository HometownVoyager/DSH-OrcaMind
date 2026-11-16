---
name: dsh-preset-craft
description: DSH 元层面方法论——现代 DSH 预设（Cordis Bundle Patch 体系：cordis.patch.yml 与 @deepseek-ai/dsh-agent-preset 声明）与 skill（SKILL.md）的编写规范、派生流程、isolate realm 规则、工具标准行组（含 time-context/schedule/office/pdf）与挂载验收闭环。撰写或派生改造 DSH 预设/skill 时使用；动手前先核对本母本。
---

# DSH 预设与 skill 编写（dsh-preset-craft）

## 何时使用
- 用户要求「写一个 DSH 预设」「新建 agent preset」「派生改造某个预设」时。
- 用户要求「写一个 skill」「给某预设加技能」时。
- 预设/skill 写完或改完后：执行挂载验证与格式核查时。
- 提示词项目的类型登记为「DSH 元层面」时，全程以本 skill 为流程母本（需求澄清与交付留痕沿用五阶段文档体系）。

## 一、架构基准与格式协议（DSH 0.1.7+ 现代体系）

> **重要历史演变**：DSH 0.1.7 起已全面废弃旧式 `$DSH_HOME/.agent-presets/<id>/` 目录（`preset.yml` + `agent.cordis.yml`），运行时不再扫描该目录。所有预设均通过 **Cordis Bundle Patch**（`cordis.patch.yml`）中的 `@deepseek-ai/dsh-agent-preset` 声明行装配。

### 1. Bundle 规范（预设包结构）
一个预设 Bundle 目录（如 `Plugins/dsh-user-presets/`）包含：
- `package.json`：声明 bundle patch 路径
  ```json
  {
    "name": "@dsh-external/dsh-user-presets",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
  }
  ```
- `cordis.patch.yml`：Cordis 补丁文件，通过 `- insert:` 向 Roster 注入预设。
- `skills/<preset-id>/<skill-name>/SKILL.md`：各预设携带的随身技能库。

### 2. 预设声明行（`cordis.patch.yml`）
每个预设在 `insert:` 列表中为一个独立的条目：
```yaml
- insert:
    - id: preset-<id>
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: <id>                        # 预设 ID（小写字母、数字与连字符，如 novel-writing）
        name: "显示名称"                 # 用户界面可见的中文/本地化名称
        description: "一句话长描述"       # 在 Web UI 选择器中展示的完整定位与流程说明
        order: 10                       # Roster 排序权重（数字越小越靠前；未声明则排在声明者之后并按字母序）
        plugins:                        # 插件组成列表（Cordis entry list）
          # ... 插件列表 ...
```

#### 排序权重（`order`）规划建议
- 官方预设：`standard: 1`, `ptc: 2`, `minimal: 3`, `cordis: 4`
- 创作与叙事类：`10 - 19`（如 novel-writing: 10, genre-fiction: 11, screenplay-writing: 12, vn-design: 13, vn-staging: 14）
- 系统与设计类：`20 - 29`（如 game-design: 20）
- 学习与研究类：`30 - 39`（如 language-learning: 30, science-learning: 31）
- 公文与学术类：`40 - 49`（如 official-docs: 40, paper-writing: 41, social-issues: 42）
- 提示词与工具类：`50 - 59`（如 prompt-writing: 50）

### 3. 标准预设插件组成（与官方 standard 对齐）
预设由一系列 Cordis 插件行组成，主要行组分工如下：

1. **Identity & Context**：
   - `persona`（`@deepseek-ai/dsh-persona`）：**域改造的主战场**。在 `config.prefix` 中使用 YAML 块标量（`|`）定义角色定位、各阶段推进流程、每轮工作协议、开工规范检查与红线纪律。模板**只能引用已注册的提示词变量**——loop 目前只注册 `{{model}}` 与 `{{provider}}`；**`{{cwd}}` 自 0.2.1 起已被上游移除**，写了它会让预设在任何模型请求发出前整轮失败（工作目录改由 `dsh-working-directory` 的必需 user context 每轮自动注入，不必也不该写进模板）。
   - `agent-instructions`（`@deepseek-ai/dsh-agent-instructions`）：`config.maxBytes: 65536` 控制提示词预算。
   - `time-context`（`@deepseek-ai/dsh-time-context`）：**（DSH 0.2.x 核心标配）** 每轮在 Context 中自动注入当前日期、时间、时区与会话流逝时长。
2. **执行与系统工具（消费 Host 能力，松散挂载，不进 isolate）**：
   - `tool-bash`（`disabled: !!js process.platform === 'win32'`）
   - `tool-pwsh`（`disabled: !!js process.platform !== 'win32'`）
   - `tool-fs` 与 `tool-fs-search`（`config.sampleOverCapGlobResults: false`）
   - `tool-jobs`（后台任务控制）
   - `tool-schedule`（`@deepseek-ai/dsh-tool-schedule`）：定时提醒与调度工具（`schedule_*`）
3. **随身技能与目标**：
   - `skill-filesystem`（`@deepseek-ai/dsh-skill-filesystem`）：`config.customSkillDirs` 使用绝对路径指向本 bundle 内对应的技能目录（如 `D:/Tools/DeepSeek Harness/Plugins/dsh-user-presets/skills/<preset-id>`）。
   - `tool-skill`（`@deepseek-ai/dsh-tool-skill`）
   - `command-goal` 与 `tool-goal`（目标管理）
4. **Isolate Realm 隔离组（发布私有服务，必须在 group + isolate 中）**：
   - `planning`（`isolate: { planMode: true }`）：包含 `plan-mode`
   - `compaction`（`isolate: { compaction: true, toolResultPruner: true }`）：包含 `compaction-basic`, `command-compact`, `tool-result-pruner`
   - `delegation`（`isolate: { workflowEngine: true }`）：包含 `tool-subagent-control`（包根一行即含 `list_agents` 等全部控制工具），`tool-subagent`（`provider: spawn`），`tool-subagent-fork`（`provider: fork`）。**注意**：这些工具的 `config` **严禁**出现 `persona` 或 `toolFilter`（含空值）——0.2.1 起 `@deepseek-ai/dsh-tool-subagent` 在加载时直接拒绝这两个键（`tool-subagent: toolFilter is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)`），后果是该 preset 挂载失败、**整个新会话创建报 `agent-preset/invalid`**。另外**禁止引用 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 这类深路径**（master 已删除该 exports 子路径，写了即 "never started"）。子代理的工具面 = 父方 preset 的工具面；四个 `schedule_*` 执行器按调用方委派深度自行拒绝子代理（`subagent_session`），所以不需要、也不允许再写 deny 列表。
5. **通用交互与交付工具**：
   - `tool-ask-user`（用户澄清提问）
   - `tool-todo`（任务清单管理，`allowParallelInProgress: true`）
   - `tool-web`（`fetch: true`, `searchTimeoutMs: 60000`）
   - `present`（文件卡片交付）
6. **专业扩展插件（选配）**：
   - Office/PDF 工具：需要文档研读、考据、编辑输出的预设（如 official-docs, paper-writing, social-issues, language-learning, science-learning）挂载 `dsh-office-reader`, `dsh-office-editor`, `dsh-pdf-reader`, `dsh-pdf-editor`。

### 4. 随身技能文件规范（`skills/<preset>/<skill>/SKILL.md`）
- 每个技能独立一个子目录，内含 `SKILL.md`。
- 头部以 YAML Frontmatter 标明：
  ```markdown
  ---
  name: <skill-name>
  description: <一句话说明：这是什么方法 + 何时使用>
  ---
  ```
- 正文使用规范的 Markdown 标题结构：`# 技能名` → `## 何时使用` → 流程/模板正文 → `## 注意事项`。

---

## 二、Isolate Realm 规则与排错

- **规则核心**：预设贡献的是“单个会话的环境”，其内部如果包含了**发布服务**的插件行（例如 `planMode`, `workflowEngine`），必须使用带有 `isolate` 声明的 `cordis:group` 包裹，使其限制在会话私有 realm 内。
- **常见错误形态**：
  - `Preset services require isolate realms: <服务名…>` —— 预设自己的服务行漏了 `isolate` 包裹，泄漏到了进程全局，挂载时被 `@deepseek-ai/dsh-agent-preset-registry` 拒绝。
  - `service "<name>" has been registered at <Owner>` —— 预设发布的服务与 Host 宿主全局服务冲突。
- **纯工具行不进 Realm**：只消费宿主 Registry 注册工具的插件（如 `tool-bash`, `tool-fs`, `tool-jobs`, `tool-schedule`, `present`）**严禁**放进 isolate realm，否则会导致其找不到宿主提供的真实 Registry。

---

## 三、预设派生与定制流程

1. **确定预设 ID 与定位**：
   - ID 必须符合 `[a-z0-9][a-z0-9-]*`；
   - 确定显示名称、描述（description）与排序权重（`order`）。
2. **在 `cordis.patch.yml` 中添加声明**：
   - 复制结构最相近的既有预设声明行，更改 `id`、`name`、`description` 与 `order`；
   - 重写 `persona` 行的 `config.prefix`（这是领域能力、阶段流程与红线纪律的核心）；
   - 根据领域需求决定是否挂载专业扩展插件（如 Office/PDF 系列）；
   - 更新 `skill-filesystem` 的 `customSkillDirs` 指向新预设的技能目录。
3. **编写配套 Skills**：
   - 在 `skills/<preset-id>/` 目录下创建对应的技能子目录和 `SKILL.md`；
   - 每个开工类技能（如 `*-project-bootstrap`）必须落实**开工规范检查**（落盘唯一的 `规范-<领域>.md` 四节骨架）；
   - 叙事类预设必须严格落实“施工经验四支柱”（全局基准事实层 `anchors.md`、视点配置系统、起飞检查卡、排版防灾）。
4. **验证与挂载检查**：
   - 验证 YAML 语法是否合法；
   - 检查随身技能目录是否存在且路径正确；
   - 跑 preset roster 全量探针（从工作区根执行）：
     `Dependency/nodejs/node.exe source/apps/cli/lib/bin.js web --patch Archive/scripts/probe-preset-roster.patch.yml --port 3099 --no-open`
     逐行打印 `ROSTER <id> ok|BROKEN` 与 `ROSTER_BROKEN` 计数后自行退出；**BROKEN 必须为 0**，非 0 时该行会带上挂载失败原因，照原因修声明行本身；
   - 通过 DSH Web 界面选择器确认新预设是否正常显示并在新会话中测试。

---

## 四、纪律与验收清单

1. **禁止破坏官方 shipped 预设**：官方 standard / ptc / minimal / cordis 随核心版本分发，改动在升级时会被覆盖；所有定制均在 bundle patch 中进行。
2. **规范事实源不撞名**：不同预设的开工规范文档应具有明确的领域标识（如 `规范-游戏设计.md`、`规范-语言学习.md`、`规范-理科学习.md`），严禁跨预设共用模糊的泛化名称导致同工作区覆盖。
3. **技能引用自包含**：每个预设的随身技能必须自包含，涉及基准模板（如 `anchors.md`）必须在技能内直接嵌入完整 Markdown 模板，严禁指引 Agent 去查找未挂载到本预设的外部技能。
4. **工具集完整性**：所有预设必须具备 `time-context` 与 `tool-schedule`，确保系统级上下文与任务调度的统一性。委托行只写 `provider` / `toolName` 等组合字段，不写 `persona` / `toolFilter`（0.2.1 会拒绝加载，见 §一.3.4）；子代理对 `schedule_*` 的可见性继承自父方，执行期由工具自身按委派深度拒绝。
5. **提示词变量只引用已注册名**：`config.prefix` / `suffix` 里出现的每个 `{{名}}` 都必须是 loop 已注册的变量（当前只有 `provider` 与 `model`）。`{{cwd}}` 在 0.2.1 被上游移除，未注册的引用会让该预设**每一轮都在发出模型请求前失败**（报错形如 `unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix"`）；工作目录、日期等运行时事实由对应服务的 context 提供，不要凭直觉写变量名。验收方法：把模板文本喂给 `@deepseek-ai/dsh-system-prompt` 的 `renderPrompt`（变量集 `{provider, model}`）跑一遍，不抛错才算过。