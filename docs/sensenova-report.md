# SenseNova（商汤日日新）Token Plan API 能力调研

> 调研时间 2026-10-23。信源分级：**[已证实]** = 官方文档或可复现实测；**[社区实测]** = 第三方插件作者长程实测（可信但非官方）；**[推测]** = 由间接证据推断，未拿到一手出处。
> 官方文档站 https://platform.sensenova.cn/docs 是 Next.js SPA，纯 HTML 抓不到正文；下文引用的是第三方仓库对官方文档的**逐字归档**（已标注出处），一手入口仍以上述 URL 为准。

---

## 1. 这个端点是什么产品？兼容哪个 OpenAI 协议？

**是 SenseNova Token Plan（免费/积分制套餐）的推理网关，不是按量计费的通用开放平台。**

- **[已证实]** 官方「接入方式」页把 Base URL 定为 https://token.sensenova.cn/v1，并注明 API Key「在 SenseNova 控制台 · **token-plan** 申请」。同页给出 OpenAI 与 Anthropic 两套接入配置。
  → https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/blob/main/docs/sensenova-api-reference/15、接入方式.md
- **[已证实]** Token Plan 是公测免费额度制（每 5 小时 1,500 次请求），并有「通用积分 / Flash-Lite 专属积分」两池滚动额度。
  → https://www.sensetime.com/cn/news/sensenova-u1-5-lite-token-plan-20260911-1741
  → https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/blob/main/docs/sensenova-api-reference/1、快速开始.md

**协议支持：两套都「支持」，但成熟度不同。**

| 协议 | 路径 | 状态 | 证据 |
|---|---|---|---|
| OpenAI **Chat Completions** | `POST /v1/chat/completions` | **[已证实] 主路径**，每个模型页都以此开头 | 见各模型页，如 5、DeepSeek V4 Flash.md |
| **Anthropic Messages** | `POST /v1/messages` | **[已证实] 完整实现**（含 thinking block、tools、streaming） | 11、模型列表.md；sensenova-compatibility.md 逐项实测 |
| OpenAI **Responses** | `POST /v1/responses` | **[已证实] 路由存在，但无独立章节** | 见下 |
| 图像生成/编辑 | `/v1/images/generations`、`/v1/images/edits` | **[已证实]** | 官方新闻页 |

**关于 `/v1/responses`（重点，官方文档没写清楚）：**

- **[已证实]** 我做了**无鉴权探针**：`POST /v1/responses` 返回 `401 {"error":{"code":16,"message":"Authorization Not Found"}}`，而同样不存在的路由 `/v1/bogus-route-xyz` 返回 `404 NOT_FOUND`。→ 路由**真实存在**，只是先过鉴权中间件。
  （同法确认 `/v1/chat/completions`、`/v1/messages`、`/v1/messages/count_tokens`、`/v1/images/generations` 均存在；`/v1/embeddings`、`/v1/completions` 不存在。注：`count_tokens` 路由存在但实测返回 404，见 compatibility.md。）
- **[已证实]** 官方文档在多处**顺带**提及 Responses，说明它是一等公民但缺专门章节：
  - 「Chat 接口字段为 `reasoning_effort`；Messages 为 `output_config.effort`；**Responses 为 `reasoning.effort`**」
  - 「视频输入仅支持 Chat Completions 接口；Anthropic Messages API 与 **Responses API 不支持视频**」
  - 「Chat Completions 与 **Responses 支持前缀续写**」
  → https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/blob/main/docs/sensenova-api-reference/6、DeepSeek%20V4.1%20Flash.md
- **[推测]** Responses 的 schema 比 chat/completions 更严格（社区 issue 提到「SenseNova Responses 严格 schema 400」）→ https://github.com/ranxianglei/billion-context/issues/1757

> **实操结论**：默认走 `/v1/chat/completions`；需要 Anthropic 生态（Claude Code 类）走 `/v1/messages`；`/v1/responses` 可用但文档与示例最少，只作备选。

---

## 2. 可用模型 id 清单

**[已证实] 官方「模型总览」表**（见 1、快速开始.md）：

| 展示名 | Model ID | 备注 |
|---|---|---|
| SenseNova 6.8 Flash Lite | `sensenova-6.8-flash-lite` | 多模态智能体，**唯一可靠读图**；262K 上下文 |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 1M 上下文，思考/非思考 |
| DeepSeek V4.1 Flash | `deepseek-flash` | ⚠️ **V4.1 的 id 就是 `deepseek-flash`**，不是 `deepseek-v4.1-flash` |
| GLM-5.2 | `glm-5.2` | 1M 上下文，长程 Coding |
| Kimi K3 | `kimi-k3` | 原生多模态，1M 上下文 |
| SenseNova U1.5 Lite | `sensenova-u1.5-lite` | **图像生成**，非对话 |
| SenseNova U1.5 Fast | `sensenova-u1.5-fast` | **图像生成**，非对话 |

**[已证实] `/v1/models` 实测目录**（2026-09-29，9 个 id）：`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-flash`、`deepseek-v4.1-flash`、`glm-5.2`、`kimi-k3`、`sensenova-6.8-flash-lite`、`sensenova-u1-fast`、`sensenova-u1.5-lite`
→ https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/blob/main/docs/SENSENOVA-API.md

**逐条回答你点名的 id：**

| 你问的 id | 存在？ | 说明 |
|---|---|---|
| `deepseek-v4-flash` | ✅ **[已证实]** | 官方模型总览 + 独立文档页，首选 |
| `glm-5.2` | ✅ **[已证实]** | 官方模型总览 + 独立文档页 |
| `kimi-k3` | ✅ **[已证实]** | 官方模型总览（无独立文档页） |
| `sensenova-6.8-flash-lite` | ✅ **[已证实]** | 文档示例默认模型 |
| `deepseek-flash` | ✅ **[已证实]** | = DeepSeek V4.1 Flash |
| `deepseek-v4.1-flash` | ⚠️ **[已证实]** | 在 `/v1/models` 目录里，但**不是官方模型总览里的名字**；某 Key 实测调用返回 **403**（套餐未开通）。属目录别名/权限位，不建议写死 |
| `deepseek-v4-pro` | ✅ **[已证实]** | 在 `/v1/models` 目录里，官方总览未列 |

**关键坑（[社区实测]，务必注意）：**
- `sensenova-u1-*` 系列是**图像生成模型**（`output_modalities:["image"]`），调 `/v1/chat/completions` 返回 **404**。
- 2026-09-30 平台把六家模型（deepseek/glm/kimi 系）的 `input_modalities` 从 `["text","image"]` 退回 `["text"]`，**只有 `sensenova-6.8-flash-lite` 保留真视觉**。
- **不要硬编码模型清单**：用 `GET /v1/models` 动态拉取（该接口免费、只读、不计费、不占额度）。

---

## 3. 思考 / 推理参数 —— **按模型家族分家，没有统一取值集**

这是全篇最容易踩坑的地方：**同一个网关背后是各家模型的原生参数方言**。

### 3.1 逐模型对照（[已证实]，来自各模型官方文档页）

| 模型 | 开关字段 | `reasoning_effort` 取值 | 默认值 | 响应思考字段 |
|---|---|---|---|---|
| `sensenova-6.8-flash-lite` | `thinking`（字符串 `enabled`/`disabled`） | `low` / `medium` / `high` / `max` / `none` | **high** | `message.reasoning` |
| `deepseek-v4-flash` | `thinking`（同上） | `low` / `medium` / `high` / `max` / `none` | **high** | `message.reasoning_content` |
| `deepseek-flash`（V4.1） | `thinking`（**object** `{"type":"enabled"/"disabled"}`，不支持 adaptive） | 原生 `none`/`low`/`high`/`max`；映射 `minimal→low`、`medium/xhigh→high`、`ultra→max` | **high** | `message.reasoning_content` |
| `glm-5.2` | **无** `thinking` 字段 | `max` / `xhigh` / `high` / `medium` / `low` / `minimal` / `none` | **max**（注意！） | `message.reasoning_content` |

来源：官方文档归档 13、思考模式与可用参数.md / 2、SenseNova 6.8 Flash Lite.md / 5、DeepSeek V4 Flash.md / 6、DeepSeek V4.1 Flash.md / 7、GLM-5.2.md（均在 https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/tree/main/docs/sensenova-api-reference/ 下）

### 3.2 直接回答你的四个问题

- **支持 `reasoning_effort` 吗？** 支持（GLM-5.2 与 deepseek 系原生；flash-lite 文档也列）。
- **取值是什么？** 平台报错列表 `low / medium / high / xhigh / none` 是**并集**；`max` 只被 glm-5.2（实测 200）与 deepseek-flash（文档自述）接受。**你列的 `off` 不存在，对应的是 `none`**；`minimal` 只在 glm-5.2 上出现。
- **支持 `thinking_budget` 吗？** **Chat Completions 侧不支持**（字段表里没有）。只有 **Anthropic `/v1/messages`** 支持 `thinking: {type:"enabled", budget_tokens:N}`。
- **支持 `thinking {type:"enabled"}` 吗？** 支持，但**仅对 deepseek-flash / glm-5.2 / deepseek-v4-flash 有效**；flash-lite 的官方文档写的是字符串形态。
- **支持 `enable_thinking` 吗？** **不支持，且会静默忽略**（不报错，但模型照常思考）。

### 3.3 三个必须知道的实测反例（[社区实测]，官方文档写错）

> 来源：https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/blob/main/docs/PITFALLS.md §20、§21（2026-09-29 对该端点 40+ 次真实请求）

1. **`thinking` 字符串形态全线 400** —— 官方文档写 `"thinking": "disabled"`，实测在 flash-lite / deepseek-v4-flash / glm-5.2 上**全部 400**；必须用 object `{"type":"disabled"}`。
2. **`reasoning_effort:"max"` 在 flash-lite / deepseek-v4-flash 上 400** —— 平台报错原文：`field ReasoningEffort invalid, should be one of: low, medium, high, xhigh, none`。只有 glm-5.2 接受 `max`。
3. **思考默认就是开的** —— 每请求多烧约 26 个 prompt token、慢约 2.9 倍（1044ms vs 361ms）。想要「快」必须显式传 `reasoning_effort:"none"`。

> **落地建议**：按**模型家族**而不是按「平台」写适配层。最稳三档映射：`off → "none"`、`medium → "medium"`、`high → "high"`，`max` 只对 glm-5.2 放行，其余模型降级到 `high`。

---

## 4. 限流：RPM / TPM 到底是多少？

### 4.1 官方**没有**公布具体 RPM/TPM 数字

- **[已证实]** Token Plan 公测期用**积分制**而非 RPM/TPM 明示额度：通用积分池 **60,000 积分 / 滚动 5 小时** + **600,000 积分 / 滚动周额度**；Flash-Lite 另有**同额专属池**（优先扣专属池）。→ 1、快速开始.md
- **[已证实]** 另有请求次数口径：**每 5 小时 1,500 次请求**（U1.5 Lite 公测）。→ https://www.sensetime.com/cn/news/sensenova-u1-5-lite-token-plan-20260911-1741
- **[已证实]** 官方错误码表只有一行：`429 → quota_exceeded_error →「速率/额度超限，建议指数退避重试」`。**没有 RPM/TPM 数值表**。→ 14、错误码.md

### 4.2 实测到的真实限流信号（[社区实测]，最有价值的部分）

| 观测到的响应体 | 含义 | 出处 |
|---|---|---|
| `{"message":"inference tpm exhausted","type":"invalid_request_error","code":"429001"}` | **TPM 耗尽**，`429001` 是网关限流码 | https://www.cnblogs.com/whyNotDIY/p/22598753 |
| `FREE_QUOTA_EXHAUSTED` | **额度真耗尽**（区别于瞬时限流） | https://github.com/jacek4yang/sensenova-proxy |
| `Server is busy, please try again later` | 容量/排队类 429 | 同上 |
| `{"error":{"code":8,...}}` | Google 风格 `RESOURCE_EXHAUSTED` = 429；**code 8 泛指任何服务端资源耗尽（RPM/TPM/并发/容量），不等于额度耗尽** | https://console.sensecore.cn/micro/help/en/docs/model-as-a-service/nova/overview/ErrorCode/ |

- **[社区实测] 单 Key 的真实 RPM 约 3**（保守设本地预限流 2）。→ https://github.com/Phoeky/dsh-sensenova-pool
- **[社区实测] 429 ≠ 额度耗尽**：生产环境出现过「dashboard 显示 5 小时通用池还剩 97.7%」时仍返回 429。

### 4.3 `RateLimitExceeded.EndpointRPMExceeded` 的含义

- **[推测]** 该字符串本身**我没有在一手官方文档中找到**（官方错误码表只有 HTTP 状态码维度）。从命名拆解 + 周边证据看：
  - `RateLimitExceeded` = 限流大类
  - `EndpointRPMExceeded` = **该 endpoint 的 RPM 超限**（不是 TPM，不是额度）
- **[推测，但证据很强] 「associated endpoint」说明：限流桶的键是 (endpoint, 账号)，不是 API Key。**
  - 「associated endpoint」= 与该 Key 关联的那个推理端点（模型/路由）。
  - 直接推论：**同一账号下多建几把 Key 没有用** —— 它们共享同一个额度桶；要提吞吐必须**换账号**。
  - 两条独立第三方佐证：
    - 「SenseNova limits are **account- / endpoint-scoped** — multiple keys inside the *same* account share a single quota bucket」→ https://github.com/modesthub/dsh-sensenova-freeapi
    - 「同一个账号下建多个 Key 共享额度，所以**每个 Key 要来自不同账号**才有效果」→ https://github.com/SUJIElearning/sensenova-duokey

---

## 5. 429 的推荐处理

### 5.1 `Retry-After` 会返回吗？—— **会，但不是每次都有**

- **[已证实] 有值的情况**：DSH 日志实测抓到 SenseNova 返回 **8515ms** 的重试延迟并被直接采用。→ https://www.cnblogs.com/whyNotDIY/p/22598753
- **[已证实] 两种格式都要支持**：秒数 + HTTP-date（`Wed, 21 Oct 2026 07:28:00 GMT`）。sensenova-proxy 的 `rate_limit.rs` 实现了完整解析，并明确「**authoritative Retry-After always wins**（原值使用并透传给客户端）」。→ https://github.com/jacek4yang/sensenova-proxy
- **[社区实测] 有缺失的情况**：滚动窗口型 TPM/RPM 429 有时**不带任何 retry hint**，此时只能本地退避。→ https://github.com/can1357/oh-my-pi/issues/13253

### 5.2 推荐退避策略

`````````
1. 429 + 有 Retry-After  → 按该值等待（不要自己算）
2. 429 + 无 Retry-After  → 指数退避 + 抖动，10s → 20s → 40s → 80s，封顶 120s
3. 连续 N 次仍 429       → 换 Key（不同账号）或换模型，不要死磕同一路由
4. 出现 FREE_QUOTA_EXHAUSTED → 是真额度耗尽，停止重试，等滚动窗口重置
`````````

- **[社区实测] 退避上限必须 ≥ 60s**：因为 TPM 窗口就是 60 秒。DSH 默认 `maxDelayMs: 10000` **太小**，必须提到 `60000`，`maxRetries` 提到 8。→ https://www.cnblogs.com/whyNotDIY/p/22598753
- **[社区实测] 不要把 429 当额度耗尽**：只有 body 出现 `FREE_QUOTA_EXHAUSTED` 之类**显式证据**才判定额度耗尽；裸 429 一律当瞬时限流。

### 5.3 并发限制 —— **有，且很紧**

- **[已证实] 服务端有排队/串行化**：4 个并发请求首轮每个耗时 ~8s，第二轮 ~1.2s —— 说明服务端在**排队**而非并行。
- **[社区实测] 推荐每 Key 并发 = 1**（串行）。多 Key 插件默认 `maxConcurrency: 1`、`concurrency: 1`。
- **[社区实测] 单 Key 撞墙后恢复要 8–10 分钟**（全组恢复），期间换 Key 才有意义。→ https://github.com/SUJIElearning/sensenova-duokey

---

## 6. 给接入方的 5 条硬建议

1. **模型清单动态拉 `/v1/models`**，别硬编码 —— 平台在 2026-09-30 就悄悄改过 `input_modalities`。
2. **思考参数按模型家族分支**：`off→"none"`、`max` 只给 glm-5.2、`thinking` 一律用 object 形态。
3. **`reasoning_effort` 默认是 high** —— 不想付这个延迟/Token 成本就显式传 `none`。
4. **限流是常态不是异常**：本地预限流（~2 RPM/Key）+ 每 Key 并发 1 + 退避封顶 60s，比「挨打后再重试」稳得多。
5. **多 Key 必须跨账号** —— 同账号多 Key 共享额度桶（这是 "associated endpoint" 的核心含义）。

---

## 附：信源清单

**官方（一手）**
- https://platform.sensenova.cn/docs （SPA，需浏览器）
- https://token.sensenova.cn/v1 （我做的无鉴权探针：401 vs 404 可判定路由是否存在）
- https://console.sensecore.cn/micro/help/en/docs/model-as-a-service/nova/overview/ErrorCode/ （大装置错误码 code↔HTTP 映射）
- https://www.sensetime.com/cn/news/sensenova-u1-5-lite-token-plan-20260911-1741

**官方文档逐字归档（第三方仓库，内容为官方原文）**
- https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/tree/main/docs/sensenova-api-reference/

**社区实测（可信但非官方）**
- https://github.com/jacek4yang/sensenova-proxy/blob/main/docs/sensenova-compatibility.md （2026-09-06 全量兼容性矩阵）
- https://github.com/eghrhegpe/dsh-connect-sensenova-token-plan/blob/main/docs/PITFALLS.md （§20/§21 文档 vs 实测不符）
- https://www.cnblogs.com/whyNotDIY/p/22598753 （429001 / Retry-After 8515ms）
- https://github.com/modesthub/dsh-sensenova-freeapi
- https://github.com/Phoeky/dsh-sensenova-pool
- https://github.com/SUJIElearning/sensenova-duokey