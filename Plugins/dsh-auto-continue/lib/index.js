/**
 * @dsh-external/dsh-auto-continue —— 网络类失败与请求截断自动续跑插件。
 *
 * turn/end reason=error 且错误属于网络类（TRANSPORT / TIMEOUT 码，或消息命中
 * fetch failed / terminated / ECONNRESET 等特征）或单次请求预算/额度耗尽（如
 * WorkBuddy Global 的 DeepSeek V4.1 Flash 报「当前请求的额度已用尽」截断）时，
 * 自动向同一会话代发一条 "Continue."（agent.followup，与 Web 客户端发送走
 * 同一条服务端路径）。兜底覆盖四类场景：
 *   1. 请求层重试穷尽仍失败（VPN 断连超出重试窗口，llm-retry 已放弃）；
 *   2. 非 antigravity 适配器（如 pi-ai 系直连）抛出的未归码网络错误——它们
 *      被宿主归码 UNKNOWN，根本不进重试；
 *   3. 单次请求 Token / 预算耗尽导致回合截断（报「当前请求的额度已用尽」），
 *      无需用户手动点「继续」，自动代发 Continue. 无缝接力完成任务；
 *   4. 模型偶发把工具调用参数写成非法 JSON（providers-hub 归码
 *      TOOL_ARGS_INVALID，硬失败不给底层重试）。它是**单次采样病理**——
 *      providers-hub 判「不可重试」针对的是底层**同请求**白退避（输出形态
 *      大概率原样复现），而本插件的 Continue 是**重新驱动一轮**＝换一次采样，
 *      偶发场景大概率就好。连续写坏由 maxAutoContinues 护栏收口，不会烧额度。
 *
 * 防循环护栏：
 * - 同一会话连续自动续跑 maxAutoContinues 次后停手，直到出现一次非 error
 *   收尾（completed / max-tokens / aborted / …）才重新计数；
 * - 两次续跑之间至少间隔 minGapMs；
 * - 子代理会话一律不代发（includeSubagents 打开后才跟）；
 * - 用户手动中止（aborted）不是 error，天然不触发；
 * - streaks 字典定期淘汰超期条目，杜绝长期运行的内存泄漏。
 *
 * 消息 source.kind='user'，会话里可见一条 "Continue."（已接受的留痕代价）。
 * 一切异常就地吞掉 + 可选审计日志：绝不影响 agent 运行。
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const name = '@dsh-external/dsh-auto-continue'

/**
 * `agents` 通过注入声明读取，而不是 `ctx.agents` 属性直读。
 *
 * 直读在插件自己的 fiber 里会走一次 ancestor-only 的 fiber walk，找不到
 * `agents` 就抛 `cannot get property "agents" without inject`；本插件的监听器
 * 把异常就地吞掉，于是每一次命中都会静默失败。
 *
 * 无默认导出：`export default apply` 会让 Loader 的 `unwrapExports` 优先取
 * `.default`，把 `name` 与 `inject` 这些兄弟命名导出整体丢掉（postmortem
 * 0001），插件会退化成没有注入的裸函数。
 */
export const inject = ['agents']

const LOG = join(tmpdir(), 'dsh-auto-continue.log')

/** 判定为「网络类失败」的可重试错误码（与 dsh-llm retry-policy 的默认集合子集）。 */
const ERROR_CODES = new Set(['TRANSPORT', 'TIMEOUT'])

/** 错误消息特征：覆盖未归码的裸 undici 错误（fetch failed / terminated / 系统错误码）。 */
const ERROR_PATTERN = /fetch failed|terminated|network error|socket hang up|other side closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR|antigravity network error/i

/**
 * 单次请求预算/额度耗尽特征（如 WorkBuddy Global 的 DeepSeek V4.1 Flash 截断）：
 * 宿主报错「本轮运行失败 当前请求的额度已用尽」或底层报 quota/budget exhausted，
 * 但它不是长期账号限流（不含 6004 或小时级重置点），代发一条 Continue. 即可无缝接力继续完成！
 *
 * 「本轮运行失败 当前请求的额度已用尽」这句中文只存在于客户端展示层
 * （ui-chat 把 QUOTA / ACCOUNT_QUOTA 映射成 `message.failure.quota`），
 * `turn/end` 的 `error.message` 里永远不会出现它。所以本插件判定额度用尽
 * 靠两条路：消息正文命中下列特征，或者宿主归码本身就是 QUOTA /
 * ACCOUNT_QUOTA（见 classify 第 3 步）。
 *
 * `quota_exceeded` 是上游在错误体里给出的机器可读标记，与中文文案等价。
 */
const REQUEST_QUOTA_PATTERN = /当前请求的额度已用尽|本轮运行失败.*额度已用尽|本轮运行失败.*当前请求|request.*quota|quota[_-]?exceeded|out of budget|insufficient (?:quota|budget|credits)|budget.*exceeded/i

/**
 * 模型把工具调用参数写坏（providers-hub SSE 层归码 TOOL_ARGS_INVALID，硬失败）。
 *
 * 事件里的 `code` 就是这个码（会话日志实锤：finish reason
 * `{kind:'error', failure:{code:'TOOL_ARGS_INVALID', message:'模型生成的工具参数
 * 不是合法 JSON（…）…'}}`）。`code` 判定为主，`message` 文案特征兜底——万一
 * 宿主把 code 层剥掉了，文案还在。文案只由 providers-hub `toolArgsInvalidFailure`
 * 生成，特征短语唯一，不会误伤其它失败。
 */
const TOOL_ARGS_INVALID_CODE = 'TOOL_ARGS_INVALID'
const TOOL_ARGS_INVALID_PATTERN = /工具参数不是合法 JSON/

/**
 * WorkBuddy 上游 429 的两种子型（实测日志）。
 *
 * `code` 在宿主侧归一为 QUOTA，所以只能从消息正文分辨：
 *  - model_busy（业务码 14003）：上游原话 "This model is currently saturated.
 *    It is not a network issue..."，插件注释给的冷却约 1 分钟。属于瞬时拥塞，
 *    续跑大概率能成。
 *  - soft_rate（业务码 6004，文案「您的使用量已超出频率限制，将在 X 重置」）：
 *    重置点常常是小时级，此刻续跑只会再吃一次 429。除非重置点已经很近，
 *    否则不续跑。
 */
const MODEL_BUSY_PATTERN = /14003|模型繁忙|model[_-]?busy|saturated/i
const RATE_LIMIT_PATTERN = /6004|超出频率限制|频率限制|rate limit/i
/** 上游给的重置时刻，形如「将在 2026-10-19 15:50:04 UTC+8 重置」。 */
const RESET_AT_PATTERN = /将在\s*(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})(?:\s*(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?)?/
/** 目录瞬时为空时 pi-ai 抛的错：模型其实还在上游，只是这一刻没读到。 */
const UNKNOWN_MODEL_PATTERN = /has no configured model|no configured model/i
/** 重置点超过这个时长就判定为「等下去没意义」，不再自动续跑。 */
const RESET_TOLERANCE_MS = 10 * 60 * 1000

/**
 * 判定一次 error 收尾要不要自动续跑。
 *
 * 返回 { action: 'now' | 'delay' | 'skip', why, delayMs }。
 *
 * 分类顺序是有意的：
 * 1. UNKNOWN_MODEL：目录瞬时为空，先延迟再试。
 * 2. REQUEST_QUOTA：单次请求额度/预算耗尽（DeepSeek V4.1 Flash 截断），立即续跑接力。
 *    命中方式是消息正文命中特征，或宿主归码本身就是 QUOTA / ACCOUNT_QUOTA
 *    ——「本轮运行失败 当前请求的额度已用尽」是客户端展示文案，
 *    不会出现在 error.message 里，只靠文案匹配会漏掉这一类。
 * 2.5. TOOL_ARGS_INVALID：模型偶发把工具参数写成非法 JSON，立即续跑接力
 *    （单次采样病理，重驱动一轮＝换采样；连续写坏由外层护栏收口）。
 * 3. 429 / QUOTA：区分 model_busy（瞬时拥塞续跑）、带重置时间的频率限制（按需等待）、无时间戳长限流（跳过）。
 * 4. 纯网络类：TRANSPORT/TIMEOUT 与 undici 瞬态网络错误立即续跑。
 */
export function classify ({ code, message, options }) {
  // 1) 目录瞬时为空：模型其实还在上游，本地这一刻没读到。
  if (UNKNOWN_MODEL_PATTERN.test(message)) {
    if (!options.includeUnknownModel) return { action: 'skip', why: 'UNKNOWN_MODEL 已关闭续跑' }
    return { action: 'delay', why: '目录瞬时为空（UNKNOWN_MODEL）', delayMs: options.unknownModelDelayMs }
  }

  // 2) 单次请求额度/预算耗尽特征（直接命中关键字）：
  //    专门针对「本轮运行失败 当前请求的额度已用尽」这类单次回合预算截断，立即 Continue 接力。
  if (REQUEST_QUOTA_PATTERN.test(message)) {
    if (!options.includeRequestQuota) return { action: 'skip', why: '单次请求额度用尽续跑已关闭' }
    return { action: 'now', why: '当前请求额度已用尽（自动 Continue 接力）' }
  }

  // 2.5) 模型偶发把工具调用参数写坏（providers-hub 的 TOOL_ARGS_INVALID）：
  //      providers-hub 刻意不给底层重试（同请求退避会复现同一坏输出），但
  //      本插件代发的 Continue 是重新驱动一轮＝换一次采样，偶发场景能自愈。
  //      连续写坏时 maxAutoContinues（默认 2）会停手，对应文案里
  //      「若连续出现，建议更换模型」的人工处置线。
  if (code === TOOL_ARGS_INVALID_CODE || TOOL_ARGS_INVALID_PATTERN.test(message)) {
    if (!options.includeToolArgsInvalid) return { action: 'skip', why: '工具参数坏 JSON 续跑已关闭' }
    return { action: 'now', why: '工具参数非法 JSON（TOOL_ARGS_INVALID，重采样续跑）' }
  }

  // 3) WorkBuddy 与各类 Provider 的 QUOTA / 429：宿主统一归码 QUOTA 或 ACCOUNT_QUOTA。
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA' || RATE_LIMIT_PATTERN.test(message) || MODEL_BUSY_PATTERN.test(message)) {
    // 3a) model_busy(14003)：上游拥塞，冷却约 1 分钟 —— 续跑值得。
    if (MODEL_BUSY_PATTERN.test(message)) {
      if (!options.includeModelBusy) return { action: 'skip', why: 'model_busy 已关闭续跑' }
      return { action: 'now', why: '上游模型繁忙（14003）' }
    }
    // 3b) soft_rate(6004)：配额到顶，从文案里解重置点。
    const reset = resetDelayMs(message)
    if (reset === undefined) {
      // 若包含明确的频率限制标识且没有重置时刻，跳过以避免盲目空转
      if (RATE_LIMIT_PATTERN.test(message)) {
        return { action: 'skip', why: '限流（6004）但读不到重置时刻' }
      }
      // 若只是裸 QUOTA / ACCOUNT_QUOTA 码但无频率限制关键字，判定为请求预算不足截断
      if (options.includeRequestQuota) {
        return { action: 'now', why: '单次请求额度用尽（QUOTA，自动 Continue 接力）' }
      }
      return { action: 'skip', why: 'QUOTA 错误但未开启请求额度续跑' }
    }
    if (reset > RESET_TOLERANCE_MS) return { action: 'skip', why: `限流（6004）距重置还有 ${Math.round(reset / 60000)} 分钟` }
    return { action: 'delay', why: `限流（6004）距重置约 ${Math.round(reset / 1000)} 秒`, delayMs: reset }
  }

  // 4) 纯网络类：原插件的老路径。
  if (ERROR_CODES.has(code) || ERROR_PATTERN.test(message)) return { action: 'now', why: '网络类失败' }

  return { action: 'skip', why: '不匹配任何续跑特征' }
}

/**
 * 从上游文案里解出距重置还有多少毫秒。
 * 形如「将在 2026-10-19 15:50:04 UTC+8 重置」，按本地时区解析；解不出返回 undefined。
 */
export function resetDelayMs (message) {
  const match = RESET_AT_PATTERN.exec(message)
  if (!match) return undefined

  if (match[3] !== undefined) {
    const sign = match[3] === '-' ? -1 : 1
    const hours = Number(match[4] ?? 0)
    const minutes = Number(match[5] ?? 0)
    const offsetMinutes = sign * (hours * 60 + minutes)
    const asUtc = Date.parse(`${match[1]}T${match[2]}Z`)
    if (!Number.isFinite(asUtc)) return undefined
    return asUtc - offsetMinutes * 60 * 1000 - Date.now()
  }

  const at = new Date(`${match[1]}T${match[2]}`).getTime()
  if (!Number.isFinite(at)) return undefined
  return at - Date.now()
}

export function apply(ctx, config = {}) {
  /** 由 `inject` 声明注入，来自 ApiSessionAgentController 的全局单例。 */
  const agents = ctx.get('agents')

  const options = {
    enabled: config.enabled !== false,
    sendText: typeof config.sendText === 'string' && config.sendText.trim() !== '' ? config.sendText : 'Continue.',
    maxAutoContinues: Number.isSafeInteger(config.maxAutoContinues) && config.maxAutoContinues >= 0 ? config.maxAutoContinues : 2,
    minGapMs: Number.isFinite(config.minGapMs) && config.minGapMs >= 0 ? config.minGapMs : 20000,
    includeSubagents: config.includeSubagents === true,
    debugLog: config.debugLog === true,
    /** WorkBuddy Global 等「当前请求的额度已用尽」截断是否自动续跑。 */
    includeRequestQuota: config.includeRequestQuota !== false,
    /** 模型把工具参数写成非法 JSON（TOOL_ARGS_INVALID）是否重采样续跑。 */
    includeToolArgsInvalid: config.includeToolArgsInvalid !== false,
    /** WorkBuddy model_busy(14003) 这类瞬时 429 是否续跑。 */
    includeModelBusy: config.includeModelBusy !== false,
    /** 目录瞬时为空（UNKNOWN_MODEL）是否续跑；插件侧已在定时重拉目录。 */
    includeUnknownModel: config.includeUnknownModel !== false,
    /** UNKNOWN_MODEL 续跑前的等待，给目录重拉留一个落地窗口。 */
    unknownModelDelayMs: Number.isFinite(config.unknownModelDelayMs) && config.unknownModelDelayMs >= 0 ? config.unknownModelDelayMs : 5000,
  }

  /** 每会话的连续续跑状态：{ streak 连续次数, lastAt 上次续跑时间 }。 */
  const streaks = new Map()

  /** 状态字典定期垃圾回收：防止长时间运行会话累积造成内存泄漏。 */
  const pruneStreaks = () => {
    if (streaks.size < 500) return
    const now = Date.now()
    const maxAgeMs = 24 * 3600 * 1000 // 超过 24 小时未活动的清理
    for (const [sId, entry] of streaks.entries()) {
      if (now - entry.lastAt > maxAgeMs) streaks.delete(sId)
    }
  }

  const audit = (line) => {
    if (!options.debugLog) return
    const entry = `${new Date().toISOString()} ${line}\n`
    try {
      if (statSync(LOG).size > 256 * 1024) writeFileSync(LOG, entry, 'utf8')
      else appendFileSync(LOG, entry, 'utf8')
    } catch {
      try { writeFileSync(LOG, entry, 'utf8') } catch { /* 宿主不可写时静默 */ }
    }
  }

  const isSubagent = (session) => {
    const header = session?.header ?? {}
    return header.parentSession !== undefined
      || header.origin === 'subagent'
      || (header.delegationDepth ?? 0) > 0
  }

  /** 代发一条用户消息；返回是否成功入队。与 SessionCommandController.prompt 的 followup 路径一致。 */
  const deliver = (sessionId, text) => {
    const agent = agents.get(sessionId)
    if (!agent) {
      audit(`agent 不在运行表（已关闭或回收），放弃：${sessionId}`)
      return false
    }
    agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
    return true
  }

  audit(`插件加载 enabled=${options.enabled} maxAutoContinues=${options.maxAutoContinues} minGapMs=${options.minGapMs} requestQuota=${options.includeRequestQuota} toolArgsInvalid=${options.includeToolArgsInvalid} subagents=${options.includeSubagents}`)

  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'turn/end') return
      const sessionId = session?.id
      if (!sessionId) return

      const reason = event.data?.reason
      const kind = typeof reason === 'object' && reason !== null ? reason.kind : undefined

      // 任何非 error 收尾都重置连续计数：下一次网络或额度失败重新获得完整配额。
      if (kind !== 'error') {
        if (streaks.get(sessionId)?.streak) {
          audit(`会话 ${sessionId} 以 ${String(kind)} 收尾，重置连续计数`)
        }
        streaks.delete(sessionId)
        return
      }

      if (!options.enabled) return
      if (isSubagent(session) && !options.includeSubagents) return

      const error = typeof reason === 'object' && reason !== null ? reason.error : undefined
      const message = typeof error?.message === 'string' ? error.message : ''
      const code = typeof error?.code === 'string' ? error.code : ''

      const verdict = classify({ code, message, options })

      if (verdict.action === 'skip') {
        audit(`会话 ${sessionId} 失败但不续跑（${verdict.why}；code=${code || '?'}`)
        return
      }

      pruneStreaks()
      const state = streaks.get(sessionId) ?? { streak: 0, lastAt: 0 }
      if (state.streak >= options.maxAutoContinues) {
        audit(`会话 ${sessionId} 连续续跑已达上限 ${options.maxAutoContinues}，放弃`)
        return
      }
      const now = Date.now()
      if (state.lastAt > 0 && now - state.lastAt < options.minGapMs) {
        audit(`会话 ${sessionId} 距上次续跑不足 ${options.minGapMs}ms，放弃`)
        return
      }

      audit(`会话 ${sessionId} 命中 ${verdict.why}（code=${code || '?'}: ${message.slice(0, 120)}），自动续跑第 ${state.streak + 1} 次`)

      const send = () => {
        if (deliver(sessionId, options.sendText)) streaks.set(sessionId, { streak: state.streak + 1, lastAt: Date.now() })
      }
      // 目录瞬时为空或需延迟重试的走 setTimeout，其余立即续跑
      if (verdict.action === 'delay') setTimeout(send, verdict.delayMs)
      else send()
    } catch (error) {
      audit(`处理 turn/end 异常（已吞掉）：${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
