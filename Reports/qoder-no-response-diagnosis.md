# Qoder / Qoder CN「不回复也不报错」诊断与修复方案

> 诊断日期：2026-10-27
> 插件：`dsh-providers-hub` v0.2.1-rc.2
> 现象：通过 dsh-provider-hub 对 Qoder（国际版）与 Qoder CN（中国版）发起的请求**得不到回复，也不报错**。
> 结论：**上游其实秒回了错误帧；插件把它判成「排队」，然后静默等待最长 30 分钟，期间零输出。**

---

## 1. 现象与判据

| 观察 | 事实 |
|---|---|
| 用户视角 | 请求发出后长时间无回复、无报错，UI 停在「运行中」 |
| 网关层 | `curl -m 200` 到 `127.0.0.1:8326/v1/chat/completions`（`qodercn/dfmodel`）→ **exit 28（超时）、0 字节** |
| 会话日志 | `session-7efe210e`：`qodercn: upstream connect error or disconnect/reset before headers. reset reason: connection timeout`（SERVER 503）、`qodercn: sse transport error: terminated`（TRANSPORT） |
| 账本 | `token-ledger.json` 2026-10-27：`direct|qoder|qoder-2b6fb520|dfmodel` 3 请求 / 3 错误 / 0 token；`direct|qodercn|qodercn-f0dcaf46|dfmodel` 2/2/0 |
| 对照 | 2026-10-26 同账号 CN `dfmodel` **603 请求、597 成功**；今天开始全错 |

关键判据：**这不是「服务器繁忙」的全局拥堵**，而是**今天开始、账号级**的限额/资源限制（详见 §4）。

---

## 2. 根因（已闭环、可复现）

### 2.1 上游**确实**秒回了错误帧

之前用 `res.text()` 探测是错的——它要等流结束，而这条流**永不结束**，所以看起来像「挂死」。改用**增量读取**后，抓到真实帧。

**CN `dfmodel`**（`POST https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation?...&Encode=1`，HTTP **200**，**0.5s** 到达）：

```
data:{"headers":{"Content-Type":["application/json"],"Retry-After":["30"]},
"body":"{\"code\":\"403\",\"message\":\"{\\\"code\\\":\\\"10605\\\",\\\"message\\\":\\\"{\\\\\\\"isQueued\\\\\\\":true,\\\\\\\"modelKey\\\\\\\":\\\\\\\"dfmodel\\\\\\\",\\\\\\\"queueCount\\\\\\\":4375,\\\\\\\"queueType\\\\\\\":\\\\\\\"p3\\\\\\\",\\\\\\\"retryAfterSeconds\\\\\\\":30,\\\\\\\"serviceAvailable\\\\\\\":true,\\\\\\\"subCode\\\\\\\":\\\\\\\"CALL_COUNT_LIMIT\\\\\\\",\\\\\\\"waitTime\\\\\\\":489}\\\\\\",\\\"subCode\\\":\\\"CALL_COUNT_LIMIT\\\"}\"}",
"statusCodeValue":403,"statusCode":"FORBIDDEN"}
```

**国际版 `qfmodel`**（`POST https://api2.qoder.sh/...`，HTTP **200**）：同形状，`queueCount:0, serviceAvailable:false, subCode:RESOURCE_LIMIT, waitTime:30`。

要点：

- 外层信封 `statusCodeValue:403`，但**业务码是 `10605`（排队）**，藏在 `message` 里再嵌一层。
- `queueCount:4375`、`waitTime:489s`、`retryAfterSeconds:30`。
- 国际版公开端点更直接：`POST https://api2-v2.qoder.sh/model/v1/chat/completions` → `402 {"code":116,"error":"quota exceeded"}`。

### 2.2 插件判成「排队」，然后**静默等待**

插件链路**每一环都正确**：

| 环节 | 位置 | 行为 | 验证 |
|---|---|---|---|
| 剥信封 | `src/qoder-envelope.ts:174-201` | 内层错误转 `{code, message, type:'model_error'}`，`code` 保真 | ✅ |
| SSE 消费器判排队 | `src/openai-compat.ts:928-938` | `parseQueueError(data.message)` 穿透嵌套，命中 `10605` → 抛 `ModelQueuedError` | ✅ 实测解出 `{isQueued:true, queueCount:4375, retryAfterSeconds:30, waitTime:489}` |
| adapter 捕获 | `src/qoder-adapter.ts:1844-1852` | `error instanceof ModelQueuedError` → `waitForQueue` | ✅ |
| **等待** | `src/qoder-adapter.ts:1999-2035` | **只 `sleep`，不 yield 任何内容** | ✅ |

等待参数：

- 单次等待：`queueDelayMs()` = `min(retryAfterSeconds*1000, QUEUE_MAX_DELAY_MS=10_000)` = **10s**（`src/model-queue.ts:203,313-320`）
- 次数上限：`QUEUE_MAX_ATTEMPTS = 180`（`src/model-queue.ts:206`）
- 总时长上限：`queueDeadline = Date.now() + resolveQueueTimeoutMs()`，默认 **30 分钟**（`src/qoder-adapter.ts:364-369,1660`）

**结论**：上游 `queueCount:4375`、`waitTime:489s`，插件原地转圈**最长 30 分钟、零输出**，最后抛 `qoder: 排队等待超时`。这就是「不回复也不报错」。

### 2.3 两个次要但真实的缺陷

**A. `sendEncrypted` 没有响应头超时。**

```ts
// src/qoder-adapter.ts:2069-2075
return await fetcher(request.url, {
  method: 'POST',
  headers,
  body: request.body,
  signal: options.signal,   // ← 只有客户端连接级 controller，没有 deadline
})
```

若上游「接受连接但不回响应头」，`fetch` **永不 settle**。120s 首 token 超时**够不着**——它在 `src/openai-compat.ts:773,796-798` 作用在**已 resolve 的** `response.body.getReader()` 上（`src/sse.ts:28-59`）。这是**第二种**静默挂死路径，`session-7efe210e` 抓到的正是它。

**B. `serviceAvailable` 从未被使用。**

`grep serviceAvailable src/qoder-adapter.ts` → **零命中**。国际版回 `serviceAvailable:false` + `RESOURCE_LIMIT`——**等是没意义的**，但插件照样等。

---

## 3. 为什么「不像服务器繁忙」

你的直觉成立：

- `subCode` 是 `CALL_COUNT_LIMIT`（调用数限额）/ `RESOURCE_LIMIT`，`queueCount:4375` 是**该账号**被限流后的积压，不是全站算力饱和。
- 国际版公开端点直接回 `402 quota exceeded`。
- 账本对照：昨天 CN `dfmodel` 跑通 603 次，今天 2 次全错、0 token——**今天开始**的账号级限额/资源限制。
- `state.json` 里 `modelRateLimits.dfmodel = 1793030400000` = 2026-10-26T16:00Z（UTC+8 2026-10-27 00:00），**已过期**，所以不是那条字段在挡。

---

## 4. 复现矩阵（实测）

| 渠道 | 模型 | 结果 |
|---|---|---|
| CN 加密端点 | `qfmodel` | **200，1.1s**，正常 SSE |
| CN 加密端点 | `qmodel` / `dmodel` / `gmodel` / `smodel` | **200**，0.6–3.6s，正常 |
| CN 加密端点 | **`dfmodel`** | **200 + `10605` 排队帧**（`queueCount:4375`）→ 插件静默等 |
| 国际版加密端点 | `qfmodel` / `dfmodel` | **200 + `10605` 帧**（`serviceAvailable:false, RESOURCE_LIMIT`）→ 插件静默等 |
| 国际版公开端点 | 任意 | **402 `code:116` quota exceeded** |
| CN 公开端点 | 任意 | **404** |

---

## 5. 修复方案（按优先级）

### P0 — `sendEncrypted` 加响应头超时（修第二种静默挂死）

```ts
// src/qoder-adapter.ts:2069-2075
const headerTimeoutMs = resolveHeaderTimeoutMs()   // 新增，默认 30_000，env `DSH_QODER_HEADER_TIMEOUT_MS`
return await fetcher(request.url, {
  method: 'POST',
  headers,
  body: request.body,
  signal: options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(headerTimeoutMs)])
    : AbortSignal.timeout(headerTimeoutMs),
})
```

- 命中后抛 `LlmError('qoder: 响应头超时', 'TIMEOUT')`（不可重试语义，或按 `SERVER` 处理）。
- 注意：`AbortSignal.any` 需要 Node ≥ 20.3；否则用 `Promise.race` + 手动 `controller.abort()`。
- **回归风险**：低。只把「永不 settle」变成「有界失败」。

### P0 — `serviceAvailable === false` 时不空等（修「等了也白等」）

```ts
// src/qoder-adapter.ts:1844 附近
if (error instanceof ModelQueuedError) {
  const info = queueInfoOf(error)
  // 上游明确说「服务不可用」时，排队等待无意义，直接失败并如实归类
  if (info.serviceAvailable === false) {
    throw new LlmError(`${label}: 服务暂不可用（${info.subCode ?? 'RESOURCE_LIMIT'}）`, 'SERVER')
  }
  await this.waitForQueue(info, ++queueAttempts, queueDeadline, options)
  queued = true
  break
}
```

- **回归风险**：中。需确认没有「`serviceAvailable:false` 但稍后自愈」的真实场景（当前证据不支持）。

### P1 — 排队期间向 UI 发可见进度（修「30 分钟零输出」）

`waitForQueue` 现在只 `sleep`。应让 `stream()` generator 在等待前 `yield` 一个进度 chunk（如 `{kind:'status', text:'排队中，已等待 Ns'}`），让用户看到「在排队」而不是「卡死」。

- **回归风险**：中。涉及新增 chunk 类型，需确认宿主 `BlockAssembler` 能透传或忽略。

### P1 — 缩短默认排队总时长

30 分钟对 `queueCount:4375` 这种积压**几乎必然超时**。建议默认降到 5 分钟，并让超时错误带上上游给的 `waitTime`/`queueCount`，方便用户判断是「再等等」还是「换模型/换号」。

---

## 6. 建议的验证步骤

1. 应用 P0-A 后，复现「上游接受连接但不回响应头」→ 应**有界失败**而非永久挂起。
2. 应用 P0-B 后，国际版 `qfmodel` 应**立即报 SERVER**，不再等 30 分钟。
3. 复跑 §4 矩阵，确认 CN `qfmodel` 等仍 200 正常（无回归）。
4. 单测：`sendEncrypted` 超时路径、`serviceAvailable:false` 分支、`queueDelayMs` 封顶。

---

## 7. 证据索引

| 证据 | 位置 |
|---|---|
| 上游错误帧（CN `dfmodel` / 国际版 `qfmodel`） | 本文 §2.1；实测脚本 `.tmp-verify/fullframe3.mjs`、`intl2.mjs` |
| `parseQueueError` 正确解出排队信息 | `.tmp-verify/qtest.mjs` 输出 |
| `ModelQueuedError` 被正确抛出 | `.tmp-verify/ssetest.mjs` 输出 |
| 剥信封 `code` 保真 | `src/qoder-envelope.ts:174-201` |
| SSE 层排队识别 | `src/openai-compat.ts:928-938` |
| adapter 捕获排队 | `src/qoder-adapter.ts:1844-1852` |
| `waitForQueue` 只 sleep 不 yield | `src/qoder-adapter.ts:1999-2035` |
| 排队参数（10s / 180 次 / 30min） | `src/model-queue.ts:203,206,313-320`；`src/qoder-adapter.ts:364-369,1660` |
| `sendEncrypted` 无超时 | `src/qoder-adapter.ts:2069-2075` |
| 首 token 超时够不着 header 阶段 | `src/openai-compat.ts:773,796-798`；`src/sse.ts:28-59` |
| `serviceAvailable` 未被使用 | `grep src/qoder-adapter.ts` 零命中 |
| 账本/会话证据 | `~/.dsh/jet-hub/token-ledger.json`；会话 `session-7efe210e` |
