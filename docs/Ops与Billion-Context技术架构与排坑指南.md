# Ops 与 Billion-Context 技术架构、兼容性与排坑指南

> **创建日期**：2026-10-20  
> **适用环境**：Windows 11 x64 / DeepSeek Harness (DSH) 0.2.1-rc.2 / Web Profile  
> **核心组件版本**：
> - `dsh-ops`: 0.3.1 (本地 link 模式)
> - `billion-context`: 0.1.201 (npm 上游主包，bundle 第 12 层)
> - `dsh-antigravity`: 0.0.5 (本地 link 模式，含 2026-10-19 晚间针对 Google/bili 兼容补丁)

---

## 目录
- [一、 Ops 插件与 DSH 原生环境的核心分工与行为边界](#一-ops-插件与-dsh-原生环境的核心分工与行为边界)
  - [1.1 架构分工表](#11-架构分工表)
  - [1.2 关键行为深度剖析：读取操作](#12-关键行为深度剖析读取操作)
  - [1.3 关键行为深度剖析：编辑与写入操作](#13-关键行为深度剖析编辑与写入操作)
  - [1.4 命令行执行与终端环境](#14-命令行执行与终端环境)
- [二、 Billion-Context 与 Antigravity / Gemini 的兼容性全景分析](#二-billion-context-与-antigravity--gemini-的兼容性全景分析)
  - [2.1 Billion-Context 是只在 Gemini 上出问题吗？](#21-billion-context-是只在-gemini-上出问题吗)
  - [2.2 昨天（2026-10-19）Gemini 调用瘫痪的根因复盘](#22-昨天2026-10-19gemini-调用瘫痪的根因复盘)
  - [2.3 为什么当前会话调用 compress / acp_status 会报 404？](#23-为什么当前会话调用-compress--acp_status-会报-404)
- [三、 Billion-Context 修复方案深度论证（可行性与路线图）](#三-billion-context-修复方案深度论证可行性与路线图)
  - [3.1 核心修复思路](#31-核心修复思路)
  - [3.2 两种实施路线对比](#32-两种实施路线对比)
  - [3.3 详细落地步骤与测试用例规划](#33-详细落地步骤与测试用例规划)
- [四、 运维常用诊断与排错清单](#四-运维常用诊断与排错清单)

---

## 一、 Ops 插件与 DSH 原生环境的核心分工与行为边界

### 1.1 架构分工表

| 工具名称 | 归属源 | 底层技术实现 | 核心定位与适用场景 |
| :--- | :--- | :--- | :--- |
| **`ops_inspect_local_file`** | **Ops 插件** | Rust 独立 Worker 进程 (`dsh-ops-worker.exe`) | 极低内存开销的高性能读取；支持批量行分片、编码转换、Hex 视图与行数限制。 |
| **`read`** | **DSH 原生** | Node.js 宿主文件系统 API | 原生行号文本读取；自动关联宿主文件版本感知（`fs/observed`）。 |
| **`ops_replace`** | **Ops 插件** | Rust 独立 Worker 进程 | **多文件/跨文件字面量（Literal）批量原子替换**；带 CAS 版本校验与内容防护。 |
| **`edit`** | **DSH 原生** | Node.js 宿主文件系统 API | **单文件精准编辑**；基于唯一上下文替换；强依赖“先读后改”观测锁。 |
| **`write`** | **DSH 原生** | Node.js 宿主文件系统 API | 全新文件创建、或者整文件完全重写。 |
| **`ops_glob` / `ops_grep`** | **Ops 插件** | Rust 原生实现 | 高性能正则检索与多文件模式匹配，自动忽略 `.git`、符号链接、隐藏目录。 |
| **`glob` / `grep`** | **DSH 原生** | 宿主自带 ripgrep / glob | 原生路径检索与全局正则搜索。 |
| **`ops_bash`** | **Ops 插件** | 独立携带的 Bash 5.3.15 运行时 | 跨平台统一的通用 Shell，避开 Windows PowerShell 的转义和引用陷阱。 |
| **`pwsh`** | **混合挂钩** | 宿主外壳 + Ops 挂载的 PowerShell 7.6.6 | 宿主原生暴露的 `pwsh` 工具接口，但运行时被 `session-pwsh.js` 指向 Ops 的 pwsh7。 |

---

### 1.2 关键行为深度剖析：读取操作

- **原生 `read` 的机制**：
  DSH 核心安全模型要求：在修改任何文件之前，必须先经过**观测**。原生 `read` 会把文件的 `target` 与当前版本号（mtime/version）登记到宿主的 `fs/observed` 观测表中。如果跳过读取直接执行 `edit`，宿主安全策略会抛出拦截。
- **Ops `ops_inspect_local_file` 的协同与桥接**：
  在 `Plugins/dsh-ops/lib/file/worker.js` 中，Ops 插件专门实现了与宿主观测表的打通：
  ```javascript
  // 当 Ops 工具读取完文件后，主动向宿主同步触发 fs/observed 事件
  function emitObserved(ctx, observed, exec) {
    if (!observed) return;
    const { target, info } = observed;
    ...
    try { ctx.emit('fs/observed', target, observation, exec); } catch {}
  }
  ```
  **结论**：使用 `ops_inspect_local_file` 读过的文件，会像原生 `read` 一样在宿主侧建立观测，后续可以直接使用原生 `edit` 工具编辑，不会报未读取错误。

---

### 1.3 关键行为深度剖析：编辑与写入操作

- **原生 `edit`**：
  针对单个已读文件进行局部精确修改。通过 `old_string` 与 `new_string` 的唯一匹配进行替换，安全性极高。
- **原生 `write`**：
  整文件直接覆盖写或创建新文件。不校验 `old_string`，适合初始化脚手架、重写整篇文档。
- **Ops 的 `ops_replace`**：
  专为**批量修改**打造（例如项目内全局重命名某个变量或替换配置项）。
  - **非正则**：`pattern` 必须是字面文本（Literal），防止正则误伤；
  - **原子更新与广播**：替换成功后，Ops 会调用 `observeReplaced` 刷新宿主对所有变动文件的版本观测（`version/size`），防止宿主把改动误判为外部未知脏写。
- **推荐策略**：
  - **单文件精准修改** ➡️ 首选原生 `edit`；
  - **创建新文件 / 批量覆盖** ➡️ 使用原生 `write`；
  - **跨多文件批量查找替换** ➡️ 使用 Ops 的 `ops_replace`。

---

### 1.4 命令行执行与终端环境

- **原生 `pwsh`**：
  在 Windows 下容易出现换行符丢失、单双引号嵌套解析错误（特别是在 JSON、Base64 或内联脚本场景）。
- **Ops `ops_bash`**：
  插件自带便携版 Bash 5.3.15。命令语法与 Linux 完全一致，避免了大量的 Windows PowerShell 平台特有报错。
  - **规范建议**：对于超过 1KB、含 Heredoc 或特殊转义字符的复杂脚本，切勿直接以单行字符串塞进 `command`，应先用 `write` 落盘为 `.sh` 文件，再通过 `script_path` 参数执行。

---

## 二、 Billion-Context 与 Antigravity / Gemini 的兼容性全景分析

### 2.1 Billion-Context 是只在 Gemini 上出问题吗？

**答案：不是只在 Gemini 上出问题，但 Gemini（通过 Antigravity 走 Cloud Code Assist）最为致命。**

1. **Claude (Anthropic) & GPT (OpenAI) 通道**：
   - 使用工业标准的 `/v1/messages` 或 `/v1/chat/completions` 协议。
   - 请求体是扁平的 `messages: [...]`，流式响应遵循标准 SSE 规范（如 `event: message_delta`、`data: [DONE]`）。
   - Billion-Context 的 AST 转换和流式重构主要在此类标准协议上打磨，即使有微小抖动，通常能较好地补齐终结帧。
2. **Gemini / Antigravity 通道**：
   - 依赖 Google 专有的 Cloud Code Assist 内部协议（`/v1internal:streamGenerateContent`）。
   - 请求体包裹在专用 Envelope 中：`{ project: "...", model: "...", request: { contents: [...] } }`。
   - 上游响应不是标品 SSE，且对上下文参数、`systemInstruction`、`generationConfig` 的格式容忍度极其严苛。

---

### 2.2 昨天（2026-10-19）Gemini 调用瘫痪的根因复盘

昨天在尝试让 Antigravity 与 Billion-Context 协同运行时的故障链路如下：

```text
[Antigravity 发起请求]
       │
       ▼ (全局 fetch 拦截)
[Billion-Context: dsh-native] ─── 打上 x-bili-plugin: dsh 标记
       │
       ▼ (路由到 bili 本地代理)
[Billion-Context: ACP 内核]
   ├─ 解包 v1internal 信封
   ├─ 转换为 bili 内部 Core 消息格式
   ├─ 执行上下文修剪 / 工具注入
   └─ 重新组装（coreToGoogle）并包裹回 v1internal 发送给 Google 上游
       │
       ▼
[Google Cloud Code Assist 端点]
   └─ 由于请求体格式发生微小偏移（如 systemInstruction / tools 缺失关键字段或结构漂移）
   └─ Google 返回 HTTP 200，但【仅输出 2 帧、0 个有效字符，且没有返回 finishReason 终结帧】就断开连接！
       │
       ▼
[Billion-Context: 流读取检测]
   └─ 检测到 stream EOF，且 sawTerminal === false
   └─ 触发 emitUpstreamTruncation(...)
   └─ bili 就地合成带内错误：
      503 upstream stream ended before a completion event; this turn may be incomplete
       │
       ▼
[DSH 宿主层]
   └─ 收到 503 带内错误，归码为 TRANSPORT 异常
   └─ 判定模型调用彻底失败！所有 Gemini 请求全军覆没！
```

**昨天的临时脱困补丁（Git commit `c7b3083`）**：
为了先让 Gemini 恢复工作，在 `Plugins/dsh-antigravity/lib/index.js` 中添加了逻辑：当检测到全局存在 Billion-Context 的拦截标识（`Symbol.for("billion-context.native-fetch-intercept")`）时，主动在请求头注入：
```http
x-bili-passthrough: 1
```
让 Billion-Context 代理完全**逐字节透传** Google 流量，绕开它的 ACP 重构内核。Gemini 随即恢复正常调用。

---

### 2.3 为什么当前会话调用 compress / acp_status 会报 404？

报错原文：
```text
ToolCallError: bili proxy tool compress / acp_status failed (404): unknown plugin conversation (no model request has arrived with this conversation id yet...)
```

**机制原因**：
1. Billion-Context 的 `compress` / `acp_status` 等工具，其执行端是 Billion-Context 内置的 Local Admin 代理端口（如 `127.0.0.1:18787`）。
2. 该代理维护了一个内存中的 `conversations` 映射表。只有当某次模型请求**完整通过了 ACP 内核的生命周期**，并在请求头或请求体中提取到会话 ID 后，该会话才会在 bili 的代理端激活（Resident）。
3. 由于当前 Antigravity 对 Google 通道启用了 `x-bili-passthrough: 1`，或者底层请求绕过了 ACP 状态机，Billion-Context 代理层至今**从未成功捕获并建立当前会话的上下文记录**。
4. 当 Agent 在当前会话中发起 `compress` 调用时，代理端在内存中查无此会话，因此返回 404。

---

## 三、 Billion-Context 修复方案深度论证（可行性与路线图）

### 3.1 核心修复思路

要彻底修复并恢复 Gemini 上的上下文压缩功能，关键点在于**让 Google 能够接受 Billion-Context 重建后的请求体，并正常输出包含 `finishReason` 的完整流**。

通过对 Billion-Context 源码（`dist/index.js`）的审计，发现核心痛点在以下两处：
1. **`coreToGoogle` 的重建结构缺陷**：
   - Google `v1internal` 对 `systemInstruction` 的处理非常严苛。Billion-Context 在 `prepareGoogle` 里追加了 ACP 提示词和系统指引，重构后的 `systemInstruction` 如果被包装成多段或格式不符合 Cloud Code 内部网关的预期，上游会直接静默结束。
   - 工具注入：Billion-Context 注入的 `absorb`、`compress` 等工具 Schema，如果包含了悬空的 `$ref` 或不兼容的 JSON Schema 特性，Gemini 会在握手阶段直接退出。
2. **截断检测（`sawTerminal`）过于激进**：
   - 在 `dist/index.js:3792000` 处，当流正常到达 EOF 时，若上游因特定输出格式未显式发送 `finishReason`，bili 会默认合成 503 报错；而实际上该流可能只是一个正常的单轮输出结束。

---

### 3.2 两种实施路线对比

| 方案 | 改造位置 | 优点 | 缺点 / 风险 |
| :--- | :--- | :--- | :--- |
| **方案 1：精细化 Antigravity 插件层适配** | `Plugins/dsh-antigravity` | 源码在工作区，Git 可控，修改立即可见；不污染 `~/.dsh` 全局环境。 | 无法干预 Billion-Context 代理内部的解包与组装逻辑。 |
| **方案 2：Billion-Context 协议层补丁 (推荐)** | `~/.dsh/profiles/web/node_modules/billion-context` | 直接从源头解决 `coreToGoogle` 与流式截断的问题，打通官方 ACP 完整闭环。 | 需修改 profile 下的编译后文件；上游一旦自动更新可能会覆盖（需冻结版本）。 |

---

### 3.3 详细落地步骤与测试用例规划

#### 步骤 1：建立隔离测试环境
- 在 `~/.config/billion-context/billion-context.json` 中暂时锁定版本：`{"autoUpdate": false}`，防止调试期间被自动覆盖。
- 备份当前的 `dist/index.js`。

#### 步骤 2：对齐 Google v1internal 请求体重构
- 检查 `coreToGoogle` 中输出的 `contents` 与原请求的差分；
- 确保所有的 `tools` 定义均经过 `stripMetaSchema` 与 `inlineSchemaRefs` 处理，消除所有悬空的 `$defs`；
- 确保 `systemInstruction` 维持单段 text 格式，避免复杂对象嵌套。

#### 步骤 3：优化 EOF 终结帧判定（容错）
- 在 `dist/index.js` 中针对 `protocol === "google"` 的 EOF 逻辑，如果已有接收到的数据且正常结束，允许将其标记为正常 EOF，避免就地抛出 503 带内错误。

#### 步骤 4：分阶段放行与验证
1. **阶段 1**：在测试会话中，临时将 Antigravity 的 `x-bili-passthrough` 环境变量切换为 `0`（`ANTIGRAVITY_BILI_PASSTHROUGH=0`）；
2. **阶段 2**：发送一次简单的提问，观察是否能正常流式打字输出；
3. **阶段 3**：调用 `acp_status`，验证会话 ID 是否已在 Billion-Context 代理中成功 Resident；
4. **阶段 4**：当上下文超过设定的初始阈值后，测试调用 `compress` 进行实际的历史折叠。

---

## 四、 运维常用诊断与排错清单

```powershell
# 1. 检查 Billion-Context 本地代理健康度与捕获状态
curl.exe -s http://127.0.0.1:18787/__bili/status

# 2. 检查当前会话与缓存命中情况
# 可以在 DSH 对话框或 PTC 中执行：
# await tools.acp_cache({ detail: "summary" });
# await tools.acp_status({});

# 3. 检查 Antigravity 是否处于直连 passthrough 模式
# 若日志中出现 "x-bili-passthrough: 1"，说明 ACP 被绕过，compress 不可用。
# 若要启用测试，可在 .env 中配置：
# ANTIGRAVITY_BILI_PASSTHROUGH=0
```
