# Billion-Context 与 Antigravity (Gemini) 兼容性专项分析与修复指南

> **创建日期**：2026-10-20  
> **适用环境**：DeepSeek Harness (DSH) 0.2.1-rc.2 / Web Profile  
> **核心组件**：
> - 模型通道插件：`dsh-antigravity` (v0.0.5)
> - 上下文压缩插件：`billion-context` (v0.1.201)
> - 目标模型通道：Google Cloud Code Assist 通道上的 Gemini 系列模型（如 `gemini-3.8-flash` 等）

---

## 目录
- [一、 核心背景与问题表现](#一-核心背景与问题表现)
  - [1.1 现状与报错现象](#11-现状与报错现象)
  - [1.2 Billion-Context 的问题是只出现在 Gemini 上吗？](#12-billion-context-的问题是只出现在-gemini-上吗)
- [二、 深度复盘：昨天（2026-10-19）Gemini 调用瘫痪的全链路根因](#二-深度复盘昨天2026-10-19gemini-调用瘫痪的全链路根因)
  - [2.1 通信链路全貌](#21-通信链路全貌)
  - [2.2 为什么 Google 上游会返回空帧？](#22-为什么-google-上游会返回空帧)
  - [2.3 为什么 Billion-Context 会报 503 并触发 DSH TRANSPORT 错误？](#23-为什么-billion-context-会报-503-并触发-dsh-transport-错误)
  - [2.4 昨天的应急处置代码（Commit c7b3083）解析](#24-昨天的应急处置代码commit-c7b3083解析)
- [三、 根因解析：为什么当前调用 compress / acp_status 会报 404？](#三-根因解析为什么当前调用-compress--acp_status-会报-404)
  - [3.1 Billion-Context 会话生命周期绑定机制](#31-billion-context-会话生命周期绑定机制)
  - [3.2 透传（Passthrough）带来的副作用闭环](#32-透传passthrough带来的副作用闭环)
- [四、 彻底修复 Billion-Context 与 Gemini 兼容性的方案论证](#四-彻底修复-billion-context-与-gemini-兼容性的方案论证)
  - [4.1 核心修复思路](#41-核心修复思路)
  - [4.2 两种技术路线对比与选型](#42-两种技术路线对比与选型)
  - [4.3 具体的代码级修复要点](#43-具体的代码级修复要点)
- [五、 分阶段实施与验证测试规范](#五-分阶段实施与验证测试规范)
  - [5.1 测试前置准备（安全隔离）](#51-测试前置准备安全隔离)
  - [5.2 验证步骤与验收判定准则](#52-验证步骤与验收判定准则)
  - [5.3 快速回滚机制](#53-快速回滚机制)

---

## 一、 核心背景与问题表现

### 1.1 现状与报错现象

在 DSH 环境中同时装载 `dsh-antigravity` 与 `billion-context` 时，主要面临两类典型问题：

1. **会话压缩工具调用报 404**：
   在对话中直接或通过代码调用 `compress` 或 `acp_status` 工具时，抛出如下异常：
   ```text
   ToolCallError: bili proxy tool acp_status failed (404): unknown plugin conversation 
   (no model request has arrived with this conversation id yet — if your messages ARE 
   still reaching the model, its LLM transport may be bypassing this proxy's fetch 
   interception...)
   ```
2. **昨天修复兼容性时 Gemini 直接瘫痪**：
   在试图让 Billion-Context 介入 Gemini 通道后，所有发往 Gemini 模型的对话全部直接报错，控制台提示 `TRANSPORT` 错误，导致模型完全不可用。

---

### 1.2 Billion-Context 的问题是只出现在 Gemini 上吗？

**结论：不是只在 Gemini 上出问题，但 Gemini（通过 Antigravity 走 Cloud Code Assist/v1internal 通道时）是最容易被彻底破坏的。**

- **Claude (Anthropic) & GPT (OpenAI) 通道**：
  - 采用标准的 HTTP REST 协议（`/v1/messages`、`/v1/chat/completions`）。
  - 请求体格式规范透明（扁平的 `messages: [...]` 数组），流式 SSE 响应格式具有明确的终结规范（如 `data: [DONE]` 或 `event: message_stop`）。
  - Billion-Context 对这类协议的解构、压缩注入和响应帧重写有成熟的测试用例覆盖，容错性较好。
- **Google / Gemini 通道（Antigravity）**：
  - Antigravity 调用的是 Google 专有的内部协议：`/v1internal:streamGenerateContent?alt=sse`。
  - 请求使用了 Google 专用的 Envelope（信封结构）：
    ```json
    {
      "project": "projects/...",
      "model": "gemini-3.8-flash",
      "request": {
        "contents": [...],
        "systemInstruction": { ... },
        "generationConfig": { ... },
        "tools": [ ... ]
      }
    }
    ```
  - Google Cloud Code Assist 网关对请求体的字段类型、`systemInstruction` 包装方式、以及 `tools` 的 JSON Schema 容忍度极度严苛。一旦中间代理重构的请求体稍有偏差，Google 上游不会返回具体的报错信息，而是返回 HTTP 200 后立即异常中断流连接。

---

## 二、 深度复盘：昨天（2026-10-19）Gemini 调用瘫痪的全链路根因

### 2.1 通信链路全貌

昨天在排查 Antigravity 与 Billion-Context 时的请求全流程如下：

```text
[DSH 运行环境]
       │
       ▼
[dsh-antigravity 插件]
       │  (调用 globalThis.fetch)
       ▼
[billion-context / dsh-native] ─── 全局 fetch 拦截被命中
       │  (自动注入 Header: "x-bili-plugin: dsh")
       ▼
[billion-context 本地代理 (127.0.0.1:18787)]
       │
       ├─ Step 1: 识别 URL 属于 google / v1internal 通道
       ├─ Step 2: unwrapV1Internal(...) 剥除外层信封，提取 request 对象
       ├─ Step 3: googleToCore(...) 转换为 bili 内部抽象的 Core 消息流
       ├─ Step 4: 执行上下文分析、压缩检测并注入 ACP 系统提示词与工具
       ├─ Step 5: coreToGoogle(...) 将 Core 格式重新打包回 Google contents 结构
       ├─ Step 6: wrapV1Internal(...) 重新套回外层信封
       │
       ▼  (重新序列化后的 HTTP 请求发送至 Google 每日端点)
[Google 上游 daily-cloudcode-pa.googleapis.com]
       │
       ▼  (Google 收到被改写/缺失特定签名的请求体)
[Google 网关异常响应]
   - 返回 HTTP 200 OK
   - 响应仅包含 2 个 SSE 握手帧、0 个有效文本字符
   - 未输出候选内容，也未输出 finishReason，随即直接关闭 TCP/HTTP 连接！
       │
       ▼
[billion-context 流式读取监听器]
   - 检测到流已到达 EOF（done === true）
   - 检查状态标记：sawTerminal === false（从未收到有效的终止帧）
   - 触发截断处理：emitUpstreamTruncation(...)
   - bili 在流内合成 503 错误：
     "503 upstream stream ended before a completion event; this turn may be incomplete"
       │
       ▼
[dsh-antigravity & DSH 宿主层]
   - SSE 解析器捕获 503 异常响应
   - 归码为不可恢复的 TRANSPORT 错误
   - 【最终结果】：Gemini 调用直接崩塌，整轮对话中断。
```

---

### 2.2 为什么 Google 上游会返回空帧？

根据 Billion-Context 源码（`dist/index.js`）的实现逻辑，ACP 内核在处理 Google 协议时存在三个关键缺陷：

1. **`systemInstruction` 结构的变异**：
   - 原始 Antigravity 发出的 `systemInstruction` 结构通常非常紧凑。
   - Billion-Context 在 `prepareGoogle`（`dist/index.js:3908373`）中，为了注入 ACP 规范（如带有折叠标记说明的系统提示），强行重组了 `systemInstruction`：
     ```javascript
     systemInstruction = extraSystemParts.length > 0 
       ? { parts: sysParts.map(text2 => ({ text: text2 })) } 
       : parsed.systemInstruction;
     ```
     Google 的内部验证层对这种多段 `parts` 的格式极为敏感，容易引发静默拒绝。
2. **工具 Schema 包含不兼容的 JSON Schema 特性**：
   - Gemini 的 API 不支持 JSON Schema 规范中的 `$defs` / `definitions` 以及本地指针引用 `$ref: "#/$defs/..."`。
   - 当 Billion-Context 尝试给 Google 请求注入自带的工具（如 `compress` / `absorb`）时，如果 Schema 中存在未内联的嵌套定义，Google 端会直接在编译阶段终止。
3. **`coreToGoogle` 的多轮工具结果配对错位**：
   - Gemini 要求模型输出的 `functionCall` 和用户的 `functionResponse` 必须按极其严格的角色交替（`model` 紧跟 `user`，且名称一致）。
   - Billion-Context 在将内部 Core 消息转回 Google 消息格式时，重新调整了消息块排序（`normalizeGoogleUserPartOrder`），一旦发生微小错位，Google 端就会直接切断流。

---

### 2.3 为什么 Billion-Context 会报 503 并触发 DSH TRANSPORT 错误？

在 Billion-Context 的流式读取主循环（`dist/index.js:3792000`）中：
```javascript
const truncated = !sawTerminal && !res.destroyed && !res.writableEnded;
...
if (truncated) {
  emitUpstreamTruncation(res, protocol, finalFinishReason !== void 0, log2, buildTruncationDiag("eof"), transparentTruncationApplies(session));
  return;
}
```
- `sawTerminal` 只有在读到 Google 返回的候选块中带有明确的 `finishReason`（如 `STOP`）时才会被置为 `true`。
- 由于 Google 上游因请求体重构错误而提前挂断了连接，Billion-Context 的流读取到达了 EOF，但 `sawTerminal` 依然是 `false`。
- 这段逻辑强制判定为“流式传输遭遇意外截断”，于是调用 `emitUpstreamTruncation`，就地合成并下发了：
  ```json
  data: {"error":{"code":503,"message":"upstream stream ended before a completion event; this turn may be incomplete","status":"UNAVAILABLE"}}
  ```
- DSH 宿主收到包含 503 的响应后，认为网络传输中断，直接报告 `TRANSPORT`。

---

### 2.4 昨天的应急处置代码（Commit c7b3083）解析

为了紧急恢复 Gemini 的可用性，昨天在 `Plugins/dsh-antigravity/lib/index.js` 中加入了避让措施：

```javascript
// 检查全局作用域中是否存在 billion-context 的原生拦截标记
const BILI_INTERCEPT_FLAG = Symbol.for('billion-context.native-fetch-intercept');

function biliPassthroughHeaderBag() {
  if (antigravityEnv("BILI_PASSTHROUGH") === "0") return {};
  try {
    if (globalThis[BILI_INTERCEPT_FLAG] !== true) return {};
  } catch {
    return {};
  }
  return { "x-bili-passthrough": "1" };
}
```

- **运行效果**：在向 Google 发送请求时附带 `x-bili-passthrough: 1` 请求头。
- **底层行为**：Billion-Context 的 `dsh-native` 模块捕获到该请求头后，会执行 `directSendOrRefuse`，将请求按原始字节原封不动直接转给 Google，**完全绕过自身的 ACP 内核改写**。
- **权衡利弊**：
  - ✅ **好处**：Gemini 模型彻底摆脱了被改写导致 503 的灾难，恢复正常流畅的流式生成；
  - ❌ **代价**：Google 流量对 Billion-Context 隐形，导致了下一步的 404 问题。

---

## 三、 根因解析：为什么当前调用 compress / acp_status 会报 404？

### 3.1 Billion-Context 会话生命周期绑定机制

Billion-Context 的设计是以**请求劫持驱动**为核心的：

```text
模型请求流经 bili 代理
       │
       ▼
bili 解析并在内存映射表中登记:
conversations.set(conversationId, { session, lastSeen, ... })
       │
       ▼
此时该会话在 bili 内部被标为「Resident（常驻就绪）」
       │
       ▼
后续 Agent 调用 compress(conversationId)
       │
       ▼
bili 代理在内存表中命中 session ➡️ 正常执行历史分析与折叠
```

---

### 3.2 透传（Passthrough）带来的副作用闭环

当我们在 Antigravity 中开启了 `x-bili-passthrough: 1` 之后，流程变成了：

1. Antigravity 正常与 Google 交互，模型生成顺畅；
2. 但 Billion-Context 代理层因为收到透传指令，**从未对请求进行解包分析，也从未在内部映射表中注册该会话（No model request has arrived with this conversation id yet）**；
3. 当 Agent 认为会话过长、尝试调用 `acp_status` 或 `compress` 工具时：
   - 工具向 `127.0.0.1:18787/__bili/tool/compress` 发送请求，携带当前的会话 ID；
   - Billion-Context 代理查询自身内存，发现该会话根本不存在；
   - 最终抛出标准报错：
     ```text
     ToolCallError: bili proxy tool acp_status / compress failed (404): unknown plugin conversation
     ```

**总结**：当前系统的状态是：**为了保住 Gemini 的模型调用生命线，主动开启了透传；而透传使 Billion-Context 脱离了会话感知，从而导致压缩工具全面 404。**

---

## 四、 彻底修复 Billion-Context 与 Gemini 兼容性的方案论证

### 4.1 核心修复思路

要实现**“既要 Gemini 模型正常稳定对话，又要 Billion-Context 能成功执行上下文压缩”**，必须同时攻克以下两关：

1. **上游握手关**：修正 Billion-Context 重组 Google 请求体时的格式偏差，消除多段 `systemInstruction` 与不合规 Schema，让 Google 正常接收并返回内容；
2. **终结识别关**：放宽 Billion-Context 对 Google 流正常关闭的判定条件，即使没有显式的 `STOP` 帧，只要已接收到完整数据，就不合成 503 阻断会话。

---

### 4.2 两种技术路线对比与选型

| 维度 | 方案 A：在 Antigravity 侧做微创适配 | 方案 B：在 Billion-Context 协议层打补丁（推荐） |
| :--- | :--- | :--- |
| **修改位置** | `Plugins/dsh-antigravity/lib/index.js` | `~/.dsh/profiles/web/node_modules/billion-context/dist/index.js` |
| **实现机制** | 不发 `x-bili-passthrough: 1`，而在发给 bili 前将请求预先转换为 Google 最标准的原子形态。 | 修复 bili 内部针对 `protocol === "google"` 的解包、重包和截断误判代码。 |
| **可维护性** | 源码在工作区仓库，Git 追踪，非常易于管理和回滚。 | 属于对 node_modules 的打补丁；需要通过配置禁用 bili 自动更新，防止补丁被覆盖。 |
| **能力上限** | 无法彻底解决 bili 代理内部对 Google EOF 判定过于激进的问题。 | **治本之策**。直接修复协议重构与截断逻辑，完整启用官方 ACP 能力。 |

---

### 4.3 具体的代码级修复要点

针对方案 B，修复代码需集中在 Billion-Context 的 `dist/index.js`：

#### 修复点 1：保持 Google systemInstruction 格式纯净
在 `prepareGoogle`（约 3908373 字符处）：
- **现状**：将 ACP 注入的文本与系统原指令合并为多段数组 `parts: [{text: ...}, {text: ...}]`。
- **改法**：将所有需要注入的文本段与系统原有文本用 `

---

` 拼成**单条纯文本字符串**，维持 `systemInstruction: { parts: [{ text: unifiedSystemText }] }` 的单段原子形态。

#### 修复点 2：彻底内联工具参数的 $defs 引用
在 `injectGoogleTool` 注入工具前：
- 确保调用内联展开逻辑，移除所有 `$defs`、`definitions` 和 `$schema` 等元属性，将引用展开为字面描述，防止 Google 校验报错。

#### 修复点 3：Google 流式 EOF 宽容放行
在流循环结束的截断检测处（约 3792000 字符处）：
```javascript
// 原逻辑：只要没有明确看到 terminal 帧，就合成 503
const truncated = !sawTerminal && !res.destroyed && !res.writableEnded;

// 修复为：针对 google 协议，如果已经正常接收并转发了有效响应帧（buf 或数据已流出），正常终结流，不合成 503
const truncated = protocol === "google" 
  ? (!sawTerminal && !sawAnyValidChunk && !res.destroyed && !res.writableEnded)
  : (!sawTerminal && !res.destroyed && !res.writableEnded);
```

---

## 五、 分阶段实施与验证测试规范

### 5.1 测试前置准备（安全隔离）

1. **冻结 Billion-Context 自动更新**：
   在用户配置文件（`%USERPROFILE%\.config\billion-context\billion-context.json`）中确保包含：
   ```json
   {
     "autoUpdate": false
   }
   ```
   避免测试过程中补丁被上游错峰升级覆盖。
2. **备份核心文件**：
   在修改任何文件前，创建时间戳快照：
   - 快照路径：`dist/index.js.bak-20261020`。

---

### 5.2 验证步骤与验收判定准则

| 阶段 | 执行动作 | 验收标准（判定通过准则） |
| :--- | :--- | :--- |
| **阶段 1：透传开关切换** | 在环境配置中设置 `ANTIGRAVITY_BILI_PASSTHROUGH=0`，重启 DSH 会话。 | 请求头不再携带 `x-bili-passthrough`，Google 流量重新流经 ACP 代理。 |
| **阶段 2：模型正常打字测试** | 发送单轮测试提问（如“写一段 100 字的代码注释”）。 | **严禁出现 503 / TRANSPORT 报错**；模型能够正常流式打字输出完整回答。 |
| **阶段 3：会话 Resident 状态验证** | 在会话中执行 `await tools.acp_status({});`。 | 返回状态 JSON，显示当前会话的上下文统计，**不再报 404 unknown plugin conversation**。 |
| **阶段 4：真实压缩触发测试** | 制造长对话上下文，或手动调用一次 `compress`。 | 工具正常返回压缩块元数据，历史消息成功建立索引折叠。 |

---

### 5.3 快速回滚机制

如果在调试过程中再次出现模型无法响应的紧急情况：
1. 立刻在当前进程环境变量或 `.env` 中重设：
   ```bash
   ANTIGRAVITY_BILI_PASSTHROUGH=1
   ```
2. 或将快照文件还原回 `dist/index.js` 并重启 DSH。
系统将在 10 秒内完整恢复到当前稳定的模型对话状态。
