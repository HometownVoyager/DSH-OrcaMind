# dsh-auto-continue

网络类失败与请求截断自动续跑插件。当一轮以 `turn/end` `reason.kind=error` 收尾、且失败属于
网络类（错误码 `TRANSPORT` / `TIMEOUT`，或消息命中 `fetch failed` / `terminated` /
`ECONNRESET` 等特征）或单次请求预算/额度耗尽（如 WorkBuddy Global 的 DeepSeek V4.1 Flash
因预算不足报「当前请求的额度已用尽」截断）时，自动向同一会话代发一条 `Continue.`
（`agent.followup`，与 Web 客户端发送同一条服务端路径）。

兜底覆盖三类 dsh 内置 llm-retry 管不到的场景：

1. 请求层重试穷尽仍失败（VPN 断连超出重试窗口）——antigravity 适配器已把网络
   错误归码 `TRANSPORT` 并把重试上限提到 10 次（约 2 分钟），仍撑不过去时由本
   插件接手；
2. 非 antigravity 适配器（如 pi-ai 系直连）抛出的未归码网络错误——它们被宿主
   归码 `UNKNOWN`，不进重试，直接失败；
3. **单次请求预算/额度用尽**（如 WorkBuddy Global 中 DeepSeek V4.1 Flash 报「当前请求的额度已用尽」截断）：
   自动代发 `Continue.` 无缝接力继续完成任务，避免用户反复手动点击。

## 防循环护栏

- 同一会话**连续**自动续跑 `maxAutoContinues` 次后停手，直到出现一次非 error
  收尾（completed / max-tokens / aborted / …）才重新计数；
- 两次续跑之间至少间隔 `minGapMs`；
- 子代理会话一律不代发；
- 用户手动中止（aborted）不是 error，天然不触发；
- `streaks` 状态字典具备定期过期清理保护，防内存泄漏。

## 配置（bundle patch 里 config 覆写，均有缺省）

| 键 | 缺省 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `sendText` | `"Continue."` | 代发文本 |
| `maxAutoContinues` | `2` | 同一会话连续续跑上限 |
| `minGapMs` | `20000` | 两次续跑最小间隔 |
| `includeSubagents` | `false` | 子代理会话是否也续跑 |
| `includeRequestQuota` | `true` | 单次请求额度/预算耗尽截断（「当前请求的额度已用尽」）是否自动续跑 |
| `includeModelBusy` | `true` | 上游 model_busy（14003）是否续跑 |
| `includeUnknownModel` | `true` | 目录瞬时为空（UNKNOWN_MODEL）是否续跑 |
| `unknownModelDelayMs` | `5000` | UNKNOWN_MODEL 续跑前的等待 |
| `debugLog` | `false` | 追加到 `%TEMP%\dsh-auto-continue.log` |

## 判定顺序（2026-10-20 扩展）

1. **目录瞬时为空**（`UNKNOWN_MODEL`）：宿主 `llm-pi-ai` 抛
   `pi-ai provider "workbuddy" has no configured model "..."`，而模型在上游仍然存在。
   → 命中后**先等 `unknownModelDelayMs`** 再续跑，给目录重拉留一个落地窗口。
2. **单次请求预算/额度耗尽**（`REQUEST_QUOTA`）：命中「当前请求的额度已用尽」或单次请求预算耗尽截断，
   且未包含长期频率限制。
   → **立即续跑**代发 `Continue.` 接力完成。
3. **上游 429 与频率限流**：宿主统一归码 `QUOTA`。
   - `model_busy`（业务码 14003，"This model is currently saturated"）：上游拥塞，冷却约 1 分钟 → **立即续跑**。
   - `soft_rate`（业务码 6004，文案「将在 … 重置」）：从文案里解出重置时刻。
     * 距重置 ≤ 10 分钟 → 等到重置点再续跑；
     * 距重置 > 10 分钟 → **不续跑**。
     * 解不出重置时刻 → 不续跑（避免空转）。
4. **纯网络类**：`TRANSPORT` / `TIMEOUT` 与裸 undici 错误特征（`fetch failed` / `ECONNRESET` 等）→ **立即续跑**。

### 「本轮运行失败 当前请求的额度已用尽」从不在 `error.message` 里

这句中文是客户端展示文案：`ui-chat` 的 `MessageItem.tsx` 把 `QUOTA` /
`ACCOUNT_QUOTA` 归码映射到 `message.failure.quota`，`turn/end` 的
`reason.error.message` 只带上游原文。翻遍本地 445 个会话日志，没有任何一条
出现过它。所以额度用尽的判定有两条路，缺一不可：

- 消息正文命中 `REQUEST_QUOTA_PATTERN`（含上游机器标记 `quota_exceeded`）；
- 宿主归码本身就是 `QUOTA` / `ACCOUNT_QUOTA`。

## 插件加载形态（2026-10-23 修复）

插件以命名空间形式导出 `name` / `inject` / `apply`，**没有** `export default`。
Loader 的 `unwrapExports` 会优先取 `.default`，一旦存在默认导出，`name` 与
`inject` 这些兄弟命名导出会被整体丢掉，插件退化成没有注入的裸函数。

`agents` 经 `inject` 声明后由 `ctx.get('agents')` 取用，不用 `ctx.agents` 属性
直读：直读在插件自己的 fiber 里走一次 ancestor-only 的 fiber walk，取不到就抛
`cannot get property "agents" without inject`，而本插件的监听器把异常就地吞掉，
表现为「命中了一切正常，但一条 Continue. 都没发出去」。

## 测试

```sh
node tests/plugin.spec.mjs
```

覆盖 `classify()` 的判定表（含生产日志里真实出现过的错误形态）与 `apply()` 的
代发路径、连续上限、冷却窗口、子代理过滤。

## 消息留痕

代发的消息 `source.kind='user'`，会话里会出现一条 `Continue.`——这是自动续跑
的可见痕迹。
