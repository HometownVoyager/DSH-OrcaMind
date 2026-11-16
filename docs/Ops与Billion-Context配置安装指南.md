# Ops 与 Billion-Context 配置安装与排坑指南

> 最后校正：2026-10-18 21:20（DSH 0.2.1-rc.2 / web profile）。
> 本文的配置片段以 `~/.dsh/profiles/web/cordis.patch.yml` 与组合结果（`dsh --dump-config`）的**实际行**为准，已同插件版本 dsh-ops 0.3.1、billion-context 0.1.201 对齐。
> 若要改动，请改 `cordis.patch.yml`（用户层），不要手改 356KB 的 `cordis.yml`（组合产物，重启会被覆盖）。

本机固定路径（下文命令均基于此）：

| 用途 | 路径 |
| :--- | :--- |
| DSH CLI 入口 | `D:\Tools\DeepSeek Harness\source\apps\cli\lib\bin.js` |
| 便携 Node | `D:\Tools\DeepSeek Harness\Dependency\nodejs\node.exe` |
| 工作区插件源码 | `D:\Tools\DeepSeek Harness\Plugins\<name>` |
| profile | `C:\Users\HometownVoyager\.dsh\profiles\web` |

---

## 一、 dsh-ops

### 1. 作用与安装

* **作用**：为 Windows DSH 提供 Rust 文件工具（ops 系）与经过校验的独立 Bash 5.3 运行时，绕开 PowerShell 的引号/转义问题。
* **安装方式**：本机采用**本地目录 link 安装**——插件源码在 `Plugins/dsh-ops`，profile 的 `package.json` 用 `link:` 引入，因此改插件代码无需重装。安装/接管用插件自带 CLI：

```powershell
$node = "D:\Tools\DeepSeek Harness\Dependency\nodejs\node.exe"
$ops  = "D:\Tools\DeepSeek Harness\Plugins\dsh-ops\bin\dsh-ops.mjs"

# 登记到 web profile（内部委托官方 profile manager）
& $node $ops install --profile web

# 下载并校验 Bash 载荷（落到 <DSH_HOME>/dsh-ops/shells）
& $node $ops provision-shells --bash
```

* **重要：shells 目录不可配置**。`Plugins/dsh-ops/lib/shells.js:307` 的 `provisionedShellStore()` 固定返回 `path.join(dshHome(env), 'dsh-ops', 'shells')`，没有独立环境变量可覆盖。想让 411MB 的 Bash 载荷不落在 `~/.dsh` 里，只能二选一：改 `DSH_HOME`，或把 `<DSH_HOME>/dsh-ops/shells/bash` 做成目录 junction 指向工作区。
  * 本机做法：`cmd /c mklink /J "C:\Users\HometownVoyager\.dsh\dsh-ops\shells\bash" "D:\Tools\DeepSeek Harness\Dependency\dsh-ops-shells\bash"`
  * 注意用 **`/J`（junction）而不是 `/D`（symbolic link）**：`/D` 在 Windows 上需要管理员/开发者模式，`/J` 不需要。

### 2. 配置参考（`cordis.patch.yml`）

实际生效的四行（来自 `cordis.yml:6341-6369`）：

```yaml
- id: dsh-ops-shell
  name: dsh-ops/shell
  config:
    promptPolicy: true            # 注入工具说明，让模型知道有 ops_bash
    publishBashTool: true         # 启用 ops_bash 工具
    shellPolicy: advise           # advise=提示优先用 ops_bash / deny-host-shell=禁用原生 pwsh
    allowSystemShellFallback: false  # 禁止回退到未校验的系统 bash
    configUpdateVersion: 1

- id: dsh-ops-file
  name: dsh-ops/file
  config:
    promptPolicy: true
    enableShellTools: false       # 文件工具不接管 shell
    required: false               # 非必需，加载失败不阻塞启动
    toolCallTimeoutMs: 300000
    configUpdateVersion: 1

# 以下两个默认关闭，不要顺手打开
- id: dsh-ops-background
  name: dsh-ops/background
  disabled: true
- id: dsh-ops-ptc
  name: dsh-ops/ptc
  disabled: true
```

> 早期版本的本指南写过一个 `dsh-ops-panel`（`capture: false`）行——**该条目并不存在**，0.3.1 已无 panel 组件，写了只会被忽略，已从模板删除。

### 3. 常见报错与排坑

| 现象 / 报错 | 根因 | 解决方案 |
| :--- | :--- | :--- |
| `ENOENT` 找不到 Bash 执行器（`ladder` 里 `bash available: no`） | 国内镜像缺少平台 `optionalDependencies`，或从未跑过 provision | `node Plugins/dsh-ops/bin/dsh-ops.mjs provision-shells --bash`；若已迁移载荷，检查 `<DSH_HOME>/dsh-ops/shells/bash` 的 junction 是否还在 |
| `ladder` 里 `FastCtx runtime: missing` | 插件只装了 Win32 worker（`Plugins/dsh-ops/runtime/win32-x64/dsh-ops-worker.exe`），没装 `@dsh-ops/fastctx-win32-x64` | 属正常降级：文件工具有独立 worker，FastCtx 只影响 PTC/高级执行。需要时 `dsh-ops provision` 或设 `DSH_OPS_FASTCTX_BIN` |
| `ladder` 里 `pwsh available: no` | 未装 `@dsh-ops/pwsh-win32-x64`，且 `allowSystemShellFallback: false` | 要 PowerShell 7 档位就 `provision-shells --pwsh`；否则保持现状，ops_bash 不依赖它 |
| 报错含未知参数 `run_in_background` | `ops_bash` 是严格 Schema，只支持前台同步执行 | 常驻后台进程改用原生 `pwsh` 的 `run_in_background`，或命令内 `nohup ... &` |
| `MALFORMED_RESPONSE` 作废整轮 | 脚本超过约 1KB 或含复杂引号/Heredoc，直接塞进 JSON `command` | 先落盘为脚本文件，再用 `ops_bash` 的 `script_path` 执行 |
| `EXECUTOR_UNAVAILABLE`（受限模式） | `workspace-write` 下指到系统 Git Bash，MSYS 无法创建受限 signal pipe | 移除自定义 `bashPath`，用随包载荷；或会话改 `danger-full-access` |
| 报错拒绝 `sandbox_permissions` | `ops_bash` 不支持单次调用提权 | 会话提权改 DSH 模式配置，别在工具参数里传 |
| 安装时 registry 选错导致 payload 静默丢失 | `optionalDependencies` 是精确版本可选依赖，registry 没同步就**静默跳过**（不报错） | **不要用 npmmirror 装 dsh-ops**（上游 README 明说不推荐，且 `@dsh-ops/bash-win32-x64` 只有 `0.0.0-stage`）；用官方 npmjs 或 `https://mirrors.huaweicloud.com/repository/npm/` |

**本机可选载荷现状（2026-10-18 审计）**：`bash` 已 provision（`~/.dsh/dsh-ops/shells/bash` junction → `Dependency/dsh-ops-shells/bash`，MSYS 2.56.0.2 / bash 5.3.15，哈希对上 pin）；**`FastCtx` 与 `pwsh` 未装**，故 `ladder` 输出 `levels{fastctx:false, bash:true, pwsh:false}`、`rungs` 为空、`dsh-ops status`（不带 `--profile`）退出码 1。因 `dsh-ops-background` / `dsh-ops-ptc` 默认 disabled 且 `required:false`，**当前无功能影响**；要用就 `provision-shells --pwsh`（约 106MB，pin 7.6.6）。注意宿主 `pwsh` 工具实际是 Windows PowerShell 5.1，不是 dsh-ops 想提供的 PowerShell 7 档位。

**版本状态**：npm `dsh-ops` 的 latest 是 **0.3.0**（2026-10-14）；本机是 **0.3.1**（link 安装，与 GitHub tag v0.3.1 逐字节一致）——**0.3.1 从未发到 npm**（三库 404），只能从 GitHub 或本地 link 获得。上游 README 自述「dsh 0.2.1 + ds 1017 组合下 0.3.1 可能表现不佳」（本机 DSH 正是 0.2.1-rc.2），跟进时盯 0.3.2。

---

## 二、 billion-context（上游主包，ACP 主动上下文剪枝）

> **2026-10-18 换包**：原先的第三方移植版 `billion-context-dsh@0.2.27` 已停用，源码归档到 `Archive/Plugins/billion-context-dsh`。现役为上游 `billion-context@0.1.201`（npm 安装，bundle 第 12 层）。换包原因与对比见 `Plugins/docs/插件审查报告-2026-10-18.md` §11 与 §12。

### 1. 作用与安装

* **作用**：以 ACP 机制注入 `compress` / `decompress` / `search_context` / `acp_status` / `acp_read_original_image`，由模型在阶段任务结束时主动压缩历史，把上下文维持在缓存友好的比例。同时还有缓存命中诊断（`acp_cache`）、出站图片缩放、工具结果吸收等能力。
* **版本**：npm `billion-context`，当前 **0.1.201**（2026-10-18T12:40:32Z 发布）。**不要把 npmmirror 当安装源**——它滞后一版（0.1.201 尚未同步），npmjs 通过 profile 已配的 `registry=https://registry.npmjs.org/` 直连可用。
* **安装/升级**（走官方 dsh plugin 通道，不要手工改 node_modules）：

```powershell
$node = "D:\Tools\DeepSeek Harness\Dependency\nodejs\node.exe"
$cli  = "D:\Tools\DeepSeek Harness\source\apps\cli\lib\bin.js"

# 安装或升级（幂等；pnpm 会写 profile package.json + lock + pnpm-workspace 的 minimumReleaseAgeExclude）
& $node $cli plugin --profile web add billion-context@0.1.201

# 核验：应输出 0.1.201
node -e "console.log(require('C:/Users/HometownVoyager/.dsh/profiles/web/node_modules/billion-context/package.json').version)"
```

* **升级后必须重启 DSH**：代理进程（`node ...\billion-context\dist\index.js start`）是启动时拉起的子进程，仍然跑旧版本。`curl http://127.0.0.1:18787/__bili/status` 里 `version` 是运行版本、`diskVersion` 是磁盘版本，`stale: true` 就说明「装了新版但没重启」。

### 2. 配置参考（`cordis.patch.yml`）

**零配置即可工作**。上游的 `dsh.bundle.patch.yml` 已经自动完成三件事，用户层不要重复写：

1. `insert: - id: bili-native / name: billion-context` —— 插件本体行；
2. 根级 `- id: compaction-basic` 设 `disabled: true` + `config.auto: false`（与 `dsh-web-app` 同向）；
3. 给 4 个官方 Web 预设（`preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis`）加 `inject: [biliBasicCompactionPolicy]` —— 让预设等 bili-native 的**加载期 overlay** 就绪后再挂载。该 overlay 负责把预设**内部**那 17 份 `compaction-basic` 标成 disabled（#3354）；patch 引擎按 id 索引顶层条目，够不到 preset 的 config 对象，所以必须走加载期 overlay。

用户层**只需要**按需加可选配置（以下都是可选的，不写就走默认）：

```yaml
# 情形 A：想让自动更新跟着上游走（本机已采用，见第 4 节）
#   不需要在 cordis.patch.yml 里写任何东西 —— 用 dsh.cmd / BILI_DSH_BIN 解决二进制解析即可

# 情形 B：想临时冻结版本
#   ~/.config/billion-context/billion-context.json 写 {"autoUpdate": false}
#   或进程环境 ACP_AUTO_UPDATE=0（注意：advisoryCheck 独立，仍会强制移出已知缺陷版本）

# 情形 C：想调压缩阈值（默认 balanced = 0.45/0.70/0.85）
#   {"compress": {"preset": "preserve"}}   # 更保守 0.55/0.78/0.93
#   {"compress": {"preset": "efficient"}}  # 更激进 0.40/0.60/0.78
```

**关于 `modelContextLimit`**：新包的配置键在 `~/.config/billion-context/billion-context.json`（不是 `cordis.patch.yml`）。旧移植版「不要写 128000 否则阈值提前 8 倍触发」的提醒仍然成立——本机模型窗口 1M，显式写小值会跳过窗口自动探测。默认不写即可。

### 3. 常见报错与排坑

| 现象 / 报错 | 根因 | 解决方案 |
| :--- | :--- | :--- |
| PTC 会话里压缩提醒不出现（日志有 `nudge ARMED-SUPPRESSED`） | **0.1.198 的已知回归 #3600**：`compressReachable` 判定漏了 PTC 的 `run_code` omnibus，0.1.199 修复 | 升级到 ≥0.1.199（本机已 0.1.201） |
| `[update] ... bundle refresh to X failed: 'dsh' 不是内部或外部命令` | 代理的 owner-lane 自动更新要调 `dsh plugin --profile web add`，但 `dsh` 不在 PATH | 本机已修：`%APPDATA%\npm\dsh.cmd` 包装脚本指向 `Dependency\nodejs\node.exe + source/apps/cli/lib/bin.js`；也可设 `BILI_DSH_BIN` |
| 启动报 `service collision` | 原生 `compaction-basic` 与 bili 同时注册 `ctx.compaction` | 确认根级 `- id: compaction-basic` 仍是 `disabled: true`（bundle patch 自动做，别手改回去） |
| 自建预设会话里出现 dsh 原生 compaction checkpoint | bili 的 inject 门只覆盖 4 个官方 Web 预设；13 个用户自建预设没有 `inject: [biliBasicCompactionPolicy]`，overlay 可能晚于其挂载（审查发现 P1-b，未实测到发生） | 给自建预设补 `inject: [biliBasicCompactionPolicy]` |
| 模型没立刻调 `compress` | 正常行为，ACP 是模型驱动，未到阈值不强制 | 用 `acp_status` 看上下文状态；或确认 `compress.injectNudge` 为 true |
| 前缀缓存频繁失效 | 同一会话反复切换不同厂商/系列模型 | 长会话固定同一模型 |
| 压缩后上下文反而变短/丢细节 | 模型写的摘要粒度太粗 | 这是模型侧行为，可在提示里要求"保留路径、签名、报错原文" |

### 4. 自动更新（本机已修好）

代理每 180s 检查一次 npm 版本；检测到新版后会调 `dsh plugin --profile web add billion-context@<ver>` 刷新 profile bundle。**这一步以前一直失败**（`dsh` 不在 PATH）。现在的解析链路（`dist/index.js` 的 `resolveDshBinary`）：

1. `BILI_DSH_BIN` 环境变量（最高优先级）；
2. `PATH` 里按 `PATHEXT` 找 `dsh.exe/.cmd/.bat/...`；
3. 兜底目录：工具自身 node 的目录、`%APPDATA%\npm`、`%LOCALAPPDATA%\pnpm`。

本机做法是第 3 条：`C:\Users\HometownVoyager\AppData\Roaming\npm\dsh.cmd`（已在 PATH 中，同时也在兜底目录里）。**注意**：

* 0.1.200 起升级**错峰**：发现新版后不会立刻装，而是在 15min–48h 的窗口里随机抽一个时刻落盘到 `~/.cache/billion-context/.update-stagger.json`，重启不重摇。想立刻升级就手动跑上面的 `plugin add`（手动路径绕过错峰）。
* `autoRestartOnUpdate` 默认 false —— 装完不会自动重启，需要手动重启 DSH 才生效（这正是 `stale: true` 的含义）。
* 远端策略文件 `auto-update-policy.json` 可让上游全局 `hold` / `blocked` / `pinned`，本机无法覆盖；
* `advisoryCheck` 独立于 `autoUpdate`，命中严重缺陷公告时**强制安装甚至回滚**，关 `autoUpdate` 不豁免。

---

## 三、 重启与验证

```powershell
$node = "D:\Tools\DeepSeek Harness\Dependency\nodejs\node.exe"
$cli  = "D:\Tools\DeepSeek Harness\source\apps\cli\lib\bin.js"
$ops  = "D:\Tools\DeepSeek Harness\Plugins\dsh-ops\bin\dsh-ops.mjs"

# 1. dsh-ops 自检：应看到 bash available: yes 且 executable 指向 .dsh\dsh-ops\shells\bash\...
& $node $ops ladder

# 2. 插件是否登记进 profile（enabled:true）
& $node $ops status --profile web

# 3. billion-context 运行状态：version 应等于 diskVersion，stale 应为 false
curl.exe -s http://127.0.0.1:18787/__bili/status

# 4. 组合配置自检（只输出到临时目录，不要重定向进 cordis.yml —— 见下）
& $node $cli --profile web --dump-config > "$env:TEMP\dump.yml"
Select-String -Path "$env:TEMP\dump.yml" -Pattern "bili-native|compaction-acp|biliBasicCompactionPolicy|MALFORMED_RESPONSE"

# 5. 压缩能力：在 DSH 对话框里执行
#    acp_status   → 看 ACTIVE SURFACE 与已压缩块
#    acp_cache    → 看缓存命中率与 miss 拆分
```

**重启才能生效**：`cordis.patch.yml` 里的 `insert` 段、billion-context 的新版本、以及 patched 的 provider config 都是启动时读取的，改完必须重启 DSH 服务。

> ⚠️ **不要把 `--dump-config` 的输出重定向进 profile 根 `cordis.yml`**：`prepareProfile()`（`source/apps/cli/lib/profile-boot-C14i-8IN.js:220`）会在每次 boot 与每次 dump 时把该文件重置成 4 行空模板（`[]`），它不是配置源、也不可能当快照保存。需要快照就写 `Dependency/tmp/`。

---

## 四、 相关文档

* `Plugins/docs/插件审查报告-2026-10-18.md` —— 两个插件的逐项体检与结论（换包记录在 §11）
* `Plugins/docs/插件审查报告-2026-10-18-补充.md` —— 2026-10-18 晚间的复查结论、清理记录与文档修订
* `Plugins/docs/插件开发指南.md` —— 自研插件的结构约定
* `Plugins/docs/插件装卸使用指南.md` —— 日常安装/卸载/升级流程
