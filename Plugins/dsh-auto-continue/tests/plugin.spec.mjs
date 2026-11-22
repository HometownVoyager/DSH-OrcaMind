// dsh-auto-continue 判定与代发路径的行为测试（纯 Node，无外部依赖）。
// 运行：node tests/plugin.spec.mjs
//
// 覆盖两层：
//   1. classify() 的判定表 —— 每一种生产上见过的错误形态各有一条用例；
//   2. apply() 的代发路径 —— 监听器读到 turn/end error 后是否真的调用了
//      agents.get().followup()，以及防循环护栏（连续上限、冷却间隔）。
//
// 第 2 层是本插件回归过的那类缺陷的守护：插件曾经用 ctx.agents 属性直读、
// 且带 export default apply，两者叠加让它在真实 Loader 下一次都没发出过。
import assert from 'node:assert/strict'
import { classify, apply } from '../lib/index.js'

let passed = 0
const cases = []
const test = (name, fn) => cases.push([name, fn])
const options = {
  includeRequestQuota: true,
  includeToolArgsInvalid: true,
  includeModelBusy: true,
  includeUnknownModel: true,
  unknownModelDelayMs: 5000,
}

// --- classify：生产日志里真实出现过的错误形态 -------------------------------

test('model_busy(14003) 立即续跑', () => {
  const v = classify({
    code: 'QUOTA',
    message: '429: {"message":"模型繁忙，请换模型或稍后重试（模型当前负载较高，code 14003，requestId 4b0484fa）。这不是账号被限流——同一凭据下换一个模型即可正常使用","type":"model_busy","code":"quota_exceeded"}',
    options,
  })
  assert.equal(v.action, 'now')
})

test('QUOTA 裸码（无文案）判定为请求额度用尽并续跑', () => {
  const v = classify({ code: 'QUOTA', message: '', options })
  assert.equal(v.action, 'now')
  assert.match(v.why, /额度用尽/)
})

test('ACCOUNT_QUOTA 裸码同样续跑', () => {
  const v = classify({ code: 'ACCOUNT_QUOTA', message: '', options })
  assert.equal(v.action, 'now')
})

test('quota_exceeded 机器标记命中额度续跑', () => {
  const v = classify({ code: 'QUOTA', message: '{"error":{"type":"quota_exceeded"}}', options })
  assert.equal(v.action, 'now')
})

test('「本轮运行失败 当前请求的额度已用尽」命中额度续跑', () => {
  const v = classify({ code: 'QUOTA', message: '本轮运行失败 当前请求的额度已用尽', options })
  assert.equal(v.action, 'now')
})

test('6004 限流但读不到重置时刻时不续跑', () => {
  const v = classify({ code: 'QUOTA', message: '您的使用量已超出频率限制，请稍后重试', options })
  assert.equal(v.action, 'skip')
})

test('6004 限流且重置点在 10 分钟内则等到重置点', () => {
  const soon = new Date(Date.now() + 5 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const text = `您的使用量已超出频率限制，将在 ${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())} ${pad(soon.getHours())}:${pad(soon.getMinutes())}:${pad(soon.getSeconds())} UTC+8 重置`
  const v = classify({ code: 'QUOTA', message: text, options })
  assert.equal(v.action, 'delay')
  assert.ok(v.delayMs > 0 && v.delayMs <= 10 * 60 * 1000)
})

test('6004 限流且重置点超过容忍窗则跳过', () => {
  const far = new Date(Date.now() + 3 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const text = `您的使用量已超出频率限制，将在 ${far.getFullYear()}-${pad(far.getMonth() + 1)}-${pad(far.getDate())} ${pad(far.getHours())}:${pad(far.getMinutes())}:${pad(far.getSeconds())} UTC+8 重置`
  const v = classify({ code: 'QUOTA', message: text, options })
  assert.equal(v.action, 'skip')
  assert.match(v.why, /距重置/)
})

test('TOOL_ARGS_INVALID 裸码立即续跑', () => {
  const v = classify({
    code: 'TOOL_ARGS_INVALID',
    message: '模型生成的工具参数不是合法 JSON（ops_glob，40 字符），本次调用已丢弃。这不是输出 token 上限，也不是网络中断 —— 直接重试即可；若连续出现，建议更换模型或缩小该次调用的跨度（例如上下文压缩的 startId–endId 区间）。',
    options,
  })
  assert.equal(v.action, 'now')
  assert.match(v.why, /工具参数/)
})

test('工具参数坏 JSON 文案特征兜底命中（code 缺失时）', () => {
  const v = classify({
    code: '',
    message: '模型生成的工具参数不是合法 JSON（ops_glob，40 字符），本次调用已丢弃。',
    options,
  })
  assert.equal(v.action, 'now')
})

test('关闭 includeToolArgsInvalid 后 TOOL_ARGS_INVALID 不再续跑', () => {
  const v = classify({ code: 'TOOL_ARGS_INVALID', message: '', options: { ...options, includeToolArgsInvalid: false } })
  assert.equal(v.action, 'skip')
})

test('UNKNOWN_MODEL 延迟续跑', () => {
  const v = classify({
    code: 'UNKNOWN_MODEL',
    message: 'pi-ai provider "sensenova" has no configured model "sensenova-u1.5-lite"',
    options,
  })
  assert.equal(v.action, 'delay')
  assert.equal(v.delayMs, 5000)
})

test('账号套餐不含该模型（403 permission_denied）不续跑', () => {
  const v = classify({
    code: 'AUTH',
    message: 'sensenova API error (403): {"message":"model is not available in the current token plan","type":"permission_denied_error","code":"7"}',
    options,
  })
  assert.equal(v.action, 'skip')
})

test('TRANSPORT 网络类立即续跑', () => {
  const v = classify({ code: 'TRANSPORT', message: 'fetch failed', options })
  assert.equal(v.action, 'now')
  assert.match(v.why, /网络/)
})

test('无关错误不续跑', () => {
  const v = classify({ code: 'UNKNOWN', message: 'something broke', options })
  assert.equal(v.action, 'skip')
})

test('关闭 includeRequestQuota 后 QUOTA 不再续跑', () => {
  const v = classify({ code: 'QUOTA', message: '', options: { ...options, includeRequestQuota: false } })
  assert.equal(v.action, 'skip')
})

// --- apply：代发路径与护栏 ---------------------------------------------------

/** 最小可用的假 session/event 通道。 */
function harness ({ header = {}, config = {} } = {}) {
  const listeners = []
  const followups = []
  const agents = new Map([['s1', { followup: (m) => followups.push(m) }]])
  const ctx = {
    get: (name) => (name === 'agents' ? { get: (id) => agents.get(id) } : undefined),
    on: (name, fn) => { listeners.push([name, fn]); return () => {} },
    effect: () => () => {},
    logger: { warn: () => {} },
  }
  apply(ctx, config)
  const emit = (event) => {
    for (const [, fn] of listeners) fn({ id: 's1', header }, event)
  }
  return { emit, followups }
}

test('turn/end error 命中额度用尽时代发一条 Continue.', () => {
  const h = harness()
  h.emit({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '' } } } })
  assert.equal(h.followups.length, 1)
  assert.equal(h.followups[0].role, 'user')
  assert.equal(h.followups[0].source.kind, 'user')
  assert.equal(h.followups[0].content[0].text, 'Continue.')
})

test('turn/end completed 不代发并清空连续计数', () => {
  const h = harness()
  h.emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(h.followups.length, 0)
})

test('冷却窗口内的连续 error 只续跑一次', () => {
  // minGapMs 默认 20s：同一时刻连发 5 次 error，只有第一次能代发。
  const h = harness()
  for (let i = 0; i < 5; i++) {
    h.emit({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '' } } } })
  }
  assert.equal(h.followups.length, 1)
})

test('冷却窗口外的连续续跑在 maxAutoContinues 处停手', () => {
  // 关掉冷却，只留连续上限：应当正好续跑 maxAutoContinues 次。
  const h = harness({ config: { minGapMs: 0 } })
  for (let i = 0; i < 5; i++) {
    h.emit({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '' } } } })
  }
  assert.equal(h.followups.length, 2)
})

test('出现一次非 error 收尾后重新获得完整续跑配额', () => {
  const h = harness({ config: { minGapMs: 0 } })
  const err = { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '' } } } }
  h.emit(err)
  h.emit(err)
  assert.equal(h.followups.length, 2)
  h.emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  h.emit(err)
  h.emit(err)
  assert.equal(h.followups.length, 4)
})

test('子代理会话不代发', () => {
  const h = harness({ header: { origin: 'subagent' } })
  h.emit({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '' } } } })
  assert.equal(h.followups.length, 0)
})

test('agents 服务缺失时不代发也不抛出', () => {
  const listeners = []
  const ctx = {
    get: () => undefined,
    on: (name, fn) => { listeners.push([name, fn]); return () => {} },
    effect: () => () => {},
    logger: { warn: () => {} },
  }
  apply(ctx, {})
  assert.doesNotThrow(() => {
    for (const [, fn] of listeners) fn({ id: 's1', header: {} }, { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '' } } } })
  })
})

// --- 运行 -------------------------------------------------------------------

for (const [name, fn] of cases) {
  try {
    await fn()
    passed++
    console.log('ok  ', name)
  } catch (e) {
    console.log('FAIL', name)
    console.log('    ', e.message)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${cases.length} passed`)
