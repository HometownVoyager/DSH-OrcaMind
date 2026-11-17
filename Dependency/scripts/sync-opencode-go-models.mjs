#!/usr/bin/env node
/**
 * OpenCode Go 模型目录自动同步（零 Token / 不经过 agent）。
 *
 * 每次启动 Harness 前（或手动）运行：
 *   node Dependency/scripts/sync-opencode-go-models.mjs
 *
 * 做什么：
 *   1. GET https://opencode.ai/zen/go/v1/models  —— 只列 id，不需要 key
 *   2. 对照本地元数据 opencode-go-model-meta.json：
 *      - 目录 JSON 缺条目 → 补进 node_modules 里的 opencode-go.json（需重启才生效）
 *      - settings.yaml 的 opencode-go.models 缺 id → 追加（热生效）
 *   3. 实时列表里有、元数据却没有的 id：按家族模板自动学一份写入元数据（可 --no-learn 关掉）
 *   4. 元数据里的 settingsSkip 列表：被点名的 id 不追加进 settings——用户在设置页
 *      删掉的模型保持删除，不会被每次同步又塞回来（想恢复就把它从该列表里删掉）
 *
 * 不改：apiKeyEnv / 默认模型 / 已有条目的 cost 等字段（只补缺失）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 脚本在 Dependency/scripts/：SCRIPT_DIR 是脚本所在目录（元数据 json 在这），
// ROOT 上跳两级指回工作区根（source/ 相对它）
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(path.dirname(SCRIPT_DIR))
const CATALOG = path.join(
  ROOT,
  'source/packages/llm/llm-pi-ai/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json',
)
const META = path.join(SCRIPT_DIR, 'opencode-go-model-meta.json')

/**
 * 生效模型列表的落点。0.1.7 起 `~/.dsh/settings.yaml` 被移除：设置改存进
 * 活动 profile 的 patch 文件（`~/.dsh/profiles/<profile>/cordis.patch.yml`），
 * 旧文件启动时被重命名成 `settings.yaml.imported` 并一次性导入。
 *   - patch 存在 → 改它（0.1.7+）
 *   - 否则回退 settings.yaml（0.1.6 及更早）
 */
const DSH_HOME = path.join(process.env.USERPROFILE || process.env.HOME || ROOT, '.dsh')
const PROFILE = process.env.DSH_PROFILE || 'web'
const PATCH = path.join(DSH_HOME, 'profiles', PROFILE, 'cordis.patch.yml')
const LEGACY_SETTINGS = path.join(DSH_HOME, 'settings.yaml')
const SETTINGS = fs.existsSync(PATCH) ? PATCH : LEGACY_SETTINGS
const SETTINGS_IS_PATCH = SETTINGS === PATCH
const LIST_URL = 'https://opencode.ai/zen/go/v1/models'
export const ANTH = 'https://opencode.ai/zen/go'
const V1 = 'https://opencode.ai/zen/go/v1'
const PROVIDER = 'opencode-go'

/**
 * 网关总上下文（输入+输出）。上游报错原文：
 * "This model's maximum context length is 1048576 tokens. However, you requested …"
 * (665751 in the messages, 384000 in the completion)
 */
const GATEWAY_TOTAL_TOKENS = 1_048_576

/**
 * 已知需要**纠正**的条目（区别于"只补缺失"）：id → 字段覆盖。
 *
 * maxTokens：DSH 的压缩阈值是 0.8 × contextWindow。若
 *   0.8 × contextWindow + maxTokens > GATEWAY_TOTAL_TOKENS，
 * 压缩永远来不及触发，上下文涨过 (总上限 − maxTokens) 后每个请求都被上游拒绝
 * （实测 deepseek-v4.1-flash：665751 + 384000 = 1049751 > 1048576）。
 * 1M 上下文条目因此把 maxTokens 收到 131072：压缩点 800k + 131k = 931k，留足余量。
 *
 * minimax-m2.7：目录里被标成 openai-completions，实际只在 anthropic-messages
 * 上可用（openai 协议稳定 500，anthropic 协议 200）。同族的 m2.5/m3 本就是这个协议。
 *
 * MiMo-V2.6：网关实测只认 reasoning_effort 的 low/medium/high/none，
 * minimal/xhigh/max 一律 400 "Invalid request parameters"。DSH 的 max 收敛到
 * 上游最高的 high，minimal/xhigh 声明为 null（不出现在可选级别里）。
 */
const MIMO_V26_TLM = {
  off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: 'high',
}
const CORRECTIONS = {
  'deepseek-v4.1-flash': { maxTokens: 131_072 },
  'deepseek-v4-flash': { maxTokens: 131_072 },
  'deepseek-v4-flash-vision-exp': { maxTokens: 131_072 },
  'deepseek-v4-pro': { maxTokens: 131_072 },
  'deepseek-flash': { maxTokens: 131_072 },
  'minimax-m2.7': { api: 'anthropic-messages', baseUrl: ANTH },
  // MiMo-V2.6 两条都是 1048576 上下文；将来 pi-ai 目录自带条目时同样收口 maxTokens，
  // 0.8 × 1048576 + 131072 = 969933 ≤ 1048576，并按实测收窄可选推理级别。
  'mimo-v2.6-flash': { maxTokens: 131_072, thinkingLevelMap: MIMO_V26_TLM },
  'mimo-v2.6-pro': { maxTokens: 131_072, thinkingLevelMap: MIMO_V26_TLM },
}

const args = new Set(process.argv.slice(2))
const LEARN = !args.has('--no-learn')
const DRY = args.has('--dry-run')
const QUIET = args.has('--quiet')

const log = (...xs) => { if (!QUIET) console.log(...xs) }
const warn = (...xs) => console.warn(...xs)

const OPENAI_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: 'max_tokens',
}
const DEEPSEEK_COMPAT = {
  ...OPENAI_COMPAT,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: 'deepseek',
}
const DEEPSEEK_TLM = {
  minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max',
}
const NO_SESSION_COMPAT = { sessionAffinityFormat: 'openai-nosession' }

/** 家族模板：id 前缀 → 新模型的默认元数据（在克隆最近邻之前用）。 */
const FAMILY = [
  [/^deepseek-v4\.1-flash/, {
    name: 'DeepSeek V4.1 Flash', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: DEEPSEEK_COMPAT, thinkingLevelMap: DEEPSEEK_TLM,
  }],
  [/^deepseek-v4-flash-vision/, {
    name: 'DeepSeek V4 Flash Vision', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: DEEPSEEK_COMPAT, thinkingLevelMap: DEEPSEEK_TLM,
  }],
  [/^deepseek-v4-flash/, {
    name: 'DeepSeek V4 Flash', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: DEEPSEEK_COMPAT, thinkingLevelMap: DEEPSEEK_TLM,
  }],
  [/^deepseek-v4-pro/, {
    name: 'DeepSeek V4 Pro', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: DEEPSEEK_COMPAT, thinkingLevelMap: {
      minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max',
    },
  }],
  [/^glm-.*-flash/, {
    name: 'GLM Flash', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.075, output: 0.25, cacheRead: 0.015, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: OPENAI_COMPAT, thinkingLevelMap: DEEPSEEK_TLM,
  }],
  [/^glm-/, {
    name: 'GLM', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: OPENAI_COMPAT, thinkingLevelMap: DEEPSEEK_TLM,
  }],
  [/^kimi-/, {
    name: 'Kimi', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
    contextWindow: 1_048_576, maxTokens: 131_072,
    compat: OPENAI_COMPAT,
  }],
  [/^qwen3\.\d+-flash/, {
    name: 'Qwen Flash', api: 'anthropic-messages', baseUrl: ANTH,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 },
    contextWindow: 1_000_000, maxTokens: 65_536,
  }],
  [/^qwen3\.\d+-max/, {
    name: 'Qwen Max', api: 'anthropic-messages', baseUrl: ANTH,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
    contextWindow: 1_000_000, maxTokens: 131_072,
  }],
  [/^qwen3\.\d+-plus/, {
    name: 'Qwen Plus', api: 'anthropic-messages', baseUrl: ANTH,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 },
    contextWindow: 1_000_000, maxTokens: 65_536,
  }],
  [/^mimo-v/, {
    name: 'MiMo', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 128_000,
    compat: OPENAI_COMPAT,
  }],
  [/^minimax-m3/, {
    name: 'MiniMax-M3', api: 'anthropic-messages', baseUrl: ANTH,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
  }],
  [/^minimax-m/, {
    name: 'MiniMax', api: 'anthropic-messages', baseUrl: ANTH,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
  }],
  [/^muse-spark-/, {
    name: 'Muse Spark Contributor', api: 'openai-responses', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.1, output: 0.2, cacheRead: 0.015, cacheWrite: 0 },
    contextWindow: 1_048_576, maxTokens: 131_072,
    compat: NO_SESSION_COMPAT,
  }],
  [/^grok-/, {
    name: 'Grok', api: 'openai-responses', baseUrl: V1,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 500_000, maxTokens: 500_000,
    compat: NO_SESSION_COMPAT,
    thinkingLevelMap: {
      minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null,
    },
  }],
  [/^gpt-/, {
    name: 'GPT', api: 'openai-responses', baseUrl: V1,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
    contextWindow: 1_050_000, maxTokens: 128_000,
    compat: NO_SESSION_COMPAT,
  }],
  [/^hy4-/, {
    name: 'Hy4 preview', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 },
    contextWindow: 256_000, maxTokens: 64_000,
    compat: OPENAI_COMPAT,
    thinkingLevelMap: {
      off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null,
    },
  }],
  [/^hy3/, {
    name: 'Hy3', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 },
    contextWindow: 256_000, maxTokens: 64_000,
    compat: OPENAI_COMPAT,
  }],
  [/^longcat-/, {
    name: 'LongCat', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0.75, output: 3, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 1_000_000, maxTokens: 131_072,
    compat: OPENAI_COMPAT,
  }],
  [/^omen-/, {
    name: 'Omen', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262_144, maxTokens: 32_768,
    compat: OPENAI_COMPAT,
  }],
  [/^space-bunny/, {
    // OpenCode 的匿名体验模型（stealth）。2026-09-26 实测：/v1/responses 明确拒绝
    // （"not supported for format openai"，与 MiMo/GLM 同款分家），走 chat/completions。
    // 官方页标 ~1M 上下文、多模态（文本+图像）、限时免费；输出上限按网关约束收口。
    name: 'Space Bunny (Free)', api: 'openai-completions', baseUrl: V1,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576, maxTokens: 131_072,
    compat: OPENAI_COMPAT,
  }],
]

function prettyName(id) {
  return id
    .split(/[-.]/)
    .map((p) => (p.length <= 2 && /[a-z]/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

function learnMeta(id) {
  for (const [re, tpl] of FAMILY) {
    if (re.test(id)) return { id, name: prettyName(id), ...structuredClone(tpl) }
  }
  return null
}

/** 克隆目录里同协议最近邻，再套家族覆盖。 */
function cloneNearest(catalog, id, family) {
  const groups = catalog['openai-completions']
    ? Object.entries(catalog).flatMap(([, g]) => Object.values(g))
    : []
  const prefer = family?.api
  const pool = prefer ? groups.filter((e) => e.api === prefer) : groups
  const nearest = pool.find((e) => {
    const a = id.split(/[-.]/)[0]
    return e.id.startsWith(a)
  }) || pool[0]
  if (!nearest) return family
  const base = structuredClone(nearest)
  delete base.id
  return { ...base, ...(family ?? {}), name: family?.name ?? prettyName(id) }
}

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeJson(p, value) {
  fs.writeFileSync(p, JSON.stringify(value), 'utf8')
}

function findCatalogSlot(catalog, id) {
  for (const [api, group] of Object.entries(catalog)) {
    if (group && typeof group === 'object' && group[id]) return { api, entry: group[id] }
  }
  return null
}

function ensureCatalogEntry(catalog, entry) {
  const api = entry.api
  if (!catalog[api] || typeof catalog[api] !== 'object') catalog[api] = {}
  if (catalog[api][entry.id]) return false
  catalog[api][entry.id] = { ...entry, provider: PROVIDER, api }
  const sorted = {}
  for (const k of Object.keys(catalog[api]).sort()) sorted[k] = catalog[api][k]
  catalog[api] = sorted
  return true
}

/** 把目录里已存在但标错的条目就地改对（协议迁移会换分组）。 */
function correctCatalog(catalog, corrections) {
  const changes = []
  for (const [id, fields] of Object.entries(corrections)) {
    const slot = findCatalogSlot(catalog, id)
    if (!slot) continue
    const targetApi = fields.api ?? slot.api
    if (targetApi !== slot.api) {
      const moved = { ...slot.entry, api: targetApi, baseUrl: fields.baseUrl ?? slot.entry.baseUrl }
      delete catalog[slot.api][id]
      if (!catalog[targetApi] || typeof catalog[targetApi] !== 'object') catalog[targetApi] = {}
      catalog[targetApi][id] = moved
      for (const group of [slot.api, targetApi]) {
        const sorted = {}
        for (const k of Object.keys(catalog[group]).sort()) sorted[k] = catalog[group][k]
        catalog[group] = sorted
      }
      changes.push(`${id}: api ${slot.api} → ${targetApi}`)
    }
    const entry = findCatalogSlot(catalog, id).entry
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'api' || k === 'baseUrl') continue
      // 对象字段（thinkingLevelMap 等）比 JSON 文本，比引用相等才有意义；
      // 否则每次同步都报一条假变更，还会白白重写目录文件。
      if (JSON.stringify(entry[k]) === JSON.stringify(v)) continue
      changes.push(`${id}: ${k} ${JSON.stringify(entry[k])} → ${JSON.stringify(v)}`)
      entry[k] = v
    }
  }
  return changes
}

/**
 * 就地改正 settings 里已有的条目（只动被点名的字段，其它原样保留）。
 * 目录与 settings 都要改：settings 的 maxTokens 才是请求里实际发出的那个值。
 */
function correctSettingsEntries(settingsText, corrections) {
  const re = /(opencode-go:\s*\{[\s\S]*?models:\s*\[)([\s\S]*?)(\n\s*\],\s*\n\s*apiKeyEnv:)/
  const m = re.exec(settingsText)
  if (!m) return { text: settingsText, changed: [] }
  let body = m[2]
  const changed = []
  for (const [id, fields] of Object.entries(corrections)) {
    const idRe = new RegExp(`\\bid:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`)
    const at = idRe.exec(body)
    if (!at) continue
    const end = body.indexOf('}', at.index)
    if (end < 0) continue
    let entry = body.slice(at.index, end + 1)
    const before = entry
    const touched = []
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'api' || k === 'baseUrl') continue // 协议字段只存在于目录，settings 不写
      if (!new RegExp(`\\b${k}:\\s*[\\d_]+`).test(entry)) continue
      entry = entry.replace(new RegExp(`(\\b${k}:\\s*)[\\d_]+`), `$1${v}`)
      touched.push(k)
    }
    if (entry !== before) {
      body = body.slice(0, at.index) + entry + body.slice(end + 1)
      changed.push(`${id} (${touched.join(', ')})`)
    }
  }
  if (changed.length === 0) return { text: settingsText, changed }
  return {
    text: settingsText.slice(0, m.index) + m[1] + body + m[3] + settingsText.slice(m.index + m[0].length),
    changed,
  }
}

/** 在 settings 的 opencode-go.models 数组里追加缺失 id（外科手术式文本插入）。 */
function settingsModelIds(settingsText) {
  const block = /opencode-go:\s*\{[\s\S]*?apiKeyEnv:/.exec(settingsText)
  if (!block) return { text: settingsText, ids: new Set(), section: null }
  const section = block[0]
  const ids = new Set()
  for (const m of section.matchAll(/\bid:\s*([A-Za-z0-9._-]+)/g)) ids.add(m[1])
  return { text: settingsText, ids, section }
}

/* ---------- 0.1.7+：活动 profile 的补丁文件（cordis.patch.yml） ---------- */

/**
 * 定位 patch 里 `opencode-go:` 段落的缩进与范围。
 * 形如：
 *       opencode-go:
 *         models:
 *           - id: qwen3.7-max
 *             name: Qwen3.7 Max
 *         apiKeyEnv: OPENCODE_GO_API_KEY
 * @returns 缩进与起止偏移；段落缺失时 null。
 */
function patchRoute(text) {
  const route = /^([ \t]*)opencode-go:[ \t]*$/m.exec(text)
  if (!route) return null
  const routeIndent = route[1].length
  const after = route.index + route[0].length
  const models = /^([ \t]*)models:[ \t]*$/m.exec(text.slice(after))
  if (!models) return null
  const modelsIndent = models[1].length
  if (modelsIndent <= routeIndent) return null
  const bodyStart = after + models.index + models[0].length
  // 列表结束于其后第一行「缩进 <= models 缩进」的非列表项（下一个 key，如 apiKeyEnv）
  const tail = text.slice(bodyStart)
  let bodyEnd = text.length
  for (const m of tail.matchAll(/^([ \t]*)(\S.*)$/gm)) {
    if (m[1].length <= modelsIndent && !m[2].startsWith('-')) {
      bodyEnd = bodyStart + m.index
      break
    }
  }
  return { routeIndent, modelsIndent, entryIndent: modelsIndent + 2, bodyStart, bodyEnd }
}

/** 段落里的条目跨度（`- id:` 行到下一个条目/末尾）。 */
function patchEntries(body, entryIndent) {
  const re = new RegExp(`^[ \\t]{${entryIndent}}- id:[ \\t]*(\\S+)[ \\t]*$`, 'gm')
  const rows = []
  for (const m of body.matchAll(re)) rows.push({ id: m[1], start: m.index, end: body.length })
  for (let i = 0; i < rows.length - 1; i++) rows[i].end = rows[i + 1].start
  return rows
}

/** 收集 patch 里 opencode-go 已声明的模型 id。 */
function patchModelIds(text) {
  const route = patchRoute(text)
  if (!route) return new Set()
  const body = text.slice(route.bodyStart, route.bodyEnd)
  return new Set(patchEntries(body, route.entryIndent).map((r) => r.id))
}

/** 就地改正 patch 条目里已有的数值字段（只动被点名的字段）。 */
function correctPatchEntries(text, corrections) {
  const route = patchRoute(text)
  if (!route) return { text, changed: [] }
  let body = text.slice(route.bodyStart, route.bodyEnd)
  const changed = []
  for (const [id, fields] of Object.entries(corrections)) {
    if (fields.api !== undefined || fields.baseUrl !== undefined) continue // 协议在 patch 里不表达
    const row = patchEntries(body, route.entryIndent).find((r) => r.id === id)
    if (!row) continue
    let entry = body.slice(row.start, row.end)
    const before = entry
    const touched = []
    for (const [k, v] of Object.entries(fields)) {
      const field = new RegExp(`^([ \\t]*${k}:[ \\t]*)[\\d_]+[ \\t]*$`, 'm')
      if (!field.test(entry)) continue
      entry = entry.replace(field, `$1${v}`)
      touched.push(k)
    }
    if (entry !== before) {
      body = body.slice(0, row.start) + entry + body.slice(row.end)
      changed.push(`${id} (${touched.join(', ')})`)
    }
  }
  if (changed.length === 0) return { text, changed }
  return {
    text: text.slice(0, route.bodyStart) + body + text.slice(route.bodyEnd),
    changed,
  }
}

/** 向 patch 的 opencode-go.models 列表追加条目（文本插入，保留其余内容与注释）。 */
function insertIntoPatchModels(text, entries) {
  const route = patchRoute(text)
  if (!route) {
    warn('[patch] 找不到 opencode-go.models 段落，跳过更新')
    return { text, added: [] }
  }
  const body = text.slice(route.bodyStart, route.bodyEnd)
  const tailMatch = /\s*$/.exec(body)
  const tail = tailMatch ? tailMatch[0] : ''
  const head = body.slice(0, body.length - tail.length)
  const pad = ' '.repeat(route.entryIndent)
  const fpad = ' '.repeat(route.entryIndent + 2)
  const chunkOf = (e) => {
    const lines = [
      `${pad}- id: ${e.id}`,
      `${fpad}name: ${e.name ?? prettyName(e.id)}`,
      `${fpad}contextWindow: ${e.contextWindow ?? 1_000_000}`,
      `${fpad}maxTokens: ${e.maxTokens ?? 131_072}`,
    ]
    if (Array.isArray(e.input) && e.input.length > 0) {
      lines.push(`${fpad}input:`)
      for (const modality of e.input) lines.push(`${fpad}  - ${modality}`)
    }
    return lines.join('\n')
  }
  const chunks = entries.map(chunkOf)
  const joined = `${head === '' ? '' : head.endsWith('\n') ? head : `${head}\n`}${chunks.join('\n')}\n`
  return {
    text: text.slice(0, route.bodyStart) + joined + tail + text.slice(route.bodyEnd),
    added: entries.map((e) => e.id),
  }
}

/** 模型 id 的读取 / 纠正 / 追加：按落点文件格式分派。 */
const readModelIds = (text) => (SETTINGS_IS_PATCH ? patchModelIds(text) : settingsModelIds(text).ids)
const correctModelEntries = (text, corrections) => (SETTINGS_IS_PATCH
  ? correctPatchEntries(text, corrections)
  : correctSettingsEntries(text, corrections))
const insertModels = (text, entries) => (SETTINGS_IS_PATCH
  ? insertIntoPatchModels(text, entries)
  : insertIntoSettingsModels(text, entries))

function insertIntoSettingsModels(settingsText, entries) {
  // 定位 opencode-go 的 models 数组结束（"            ]," + apiKeyEnv）
  const re = /(opencode-go:\s*\{[\s\S]*?models:\s*\[[\s\S]*?)(\n\s*\],\s*\n\s*apiKeyEnv:)/
  const m = re.exec(settingsText)
  if (!m) {
    warn('[settings] 找不到 opencode-go.models 数组，跳过 settings 更新')
    return { text: settingsText, added: [] }
  }
  const added = []
  const chunks = []
  for (const e of entries) {
    const name = e.name ?? prettyName(e.id)
    const ctx = e.contextWindow ?? 1_000_000
    const maxt = e.maxTokens ?? 131_072
    chunks.push(
      ',\n              {\n'
      + `                  id: ${e.id},\n`
      + `                  name: ${name},\n`
      + `                  contextWindow: ${ctx},\n`
      + `                  maxTokens: ${maxt}\n`
      + '                }',
    )
    added.push(e.id)
  }
  if (added.length === 0) return { text: settingsText, added }
  // 在 models 数组最后一个条目的 "}" 之后、 "]" 之前插入
  let head = m[1]
  if (!head.trimEnd().endsWith('}')) {
    const trimmed = head.replace(/\s*$/, '')
    const body = entries.map((e, i) => {
      const name = e.name ?? prettyName(e.id)
      return `${i === 0 ? '' : ','}\n              {\n`
        + `                  id: ${e.id},\n`
        + `                  name: ${name},\n`
        + `                  contextWindow: ${e.contextWindow ?? 1_000_000},\n`
        + `                  maxTokens: ${e.maxTokens ?? 131_072}\n`
        + '                }'
    }).join('')
    return {
      text: settingsText.slice(0, m.index) + trimmed + body + '\n            ' + m[2] + settingsText.slice(m.index + m[0].length),
      added,
    }
  }
  return {
    text: settingsText.slice(0, m.index) + head + chunks.join('') + m[2] + settingsText.slice(m.index + m[0].length),
    added,
  }
}

async function fetchLiveIds() {
  const res = await fetch(LIST_URL, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-opencode-go-sync/1.0' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`models list HTTP ${res.status}`)
  const body = await res.json()
  const list = Array.isArray(body?.data) ? body.data : []
  const ids = list.map((x) => x?.id).filter((x) => typeof x === 'string' && x.length > 0)
  if (ids.length === 0) throw new Error('models list 为空')
  return ids
}

async function main() {
  if (!fs.existsSync(CATALOG)) {
    warn(`[catalog] 不存在: ${CATALOG}`)
    process.exitCode = 1
    return
  }
  if (!fs.existsSync(SETTINGS)) {
    warn(`[settings] 不存在: ${SETTINGS}`)
    process.exitCode = 1
    return
  }

  log('[sync] 拉取实时模型列表 ...')
  let live
  try {
    live = await fetchLiveIds()
  } catch (e) {
    warn(`[sync] 拉取失败（跳过本次，不影响启动）: ${e.message}`)
    process.exitCode = 0
    return
  }
  log(`[sync] 网关共 ${live.length} 个模型`)

  let catalog = readJson(CATALOG, null)
  let meta = readJson(META, null)

  // 首次：从当前目录播种元数据
  if (meta === null) {
    meta = { version: 1, models: {} }
    for (const group of Object.values(catalog)) {
      if (!group || typeof group !== 'object') continue
      for (const entry of Object.values(group)) {
        if (entry?.id) meta.models[entry.id] = { ...entry }
      }
    }
    log(`[meta] 从已安装目录播种 ${Object.keys(meta.models).length} 条 → ${path.basename(META)}`)
  }

  let catalogChanged = false
  let metaChanged = false
  const ensureSettings = []

  // 用户在设置页删掉的模型：元数据里点名，就不再自动追加回 settings
  const skipSettings = new Set(Array.isArray(meta.settingsSkip) ? meta.settingsSkip : [])

  for (const id of live) {
    const inCatalog = findCatalogSlot(catalog, id)
    let entry = meta.models[id]
    if (!entry && LEARN) {
      const learned = cloneNearest(catalog, id, learnMeta(id))
      if (learned) {
        entry = { id, ...learned, provider: PROVIDER }
        // 名称尽量用家族模板的 display 名
        const fam = learnMeta(id)
        if (fam?.name) entry.name = fam.name
        meta.models[id] = entry
        metaChanged = true
        log(`[learn] ${id}  ← 元数据模板/最近邻`)
      } else {
        log(`[skip] ${id}：无家族模板，不自动收录（可手动加进 meta 或插件）`)
        continue
      }
    }
    if (!entry) continue

    if (!inCatalog) {
      if (!DRY) {
        if (ensureCatalogEntry(catalog, entry)) catalogChanged = true
      }
      log(`[catalog] 补目录条目: ${id} (${entry.api})`)
      ensureSettings.push(entry)
    }
  }

  // 先纠正已知标错的条目（协议 / maxTokens），再补缺失的
  if (DRY) {
    const wouldFix = correctCatalog(catalog, CORRECTIONS)
    log(wouldFix.length > 0
      ? `[catalog] dry-run 将纠正: ${wouldFix.join('; ')}`
      : '[catalog] 无需纠正')
  } else {
    const fixed = correctCatalog(catalog, CORRECTIONS)
    if (fixed.length > 0) {
      catalogChanged = true
      for (const line of fixed) log(`[catalog] 纠正: ${line}`)
    }
  }

  // 元数据也要跟着纠正：新路由/新条目是从 meta 生成的，meta 里留着旧的 maxTokens
  // 就会把 1M 上下文 + 384k 输出那套重新带回来（见 GATEWAY_TOTAL_TOKENS 注释）。
  for (const [id, fields] of Object.entries(CORRECTIONS)) {
    const entry = meta.models[id]
    if (!entry) continue
    for (const [k, v] of Object.entries(fields)) {
      if (JSON.stringify(entry[k]) === JSON.stringify(v)) continue
      entry[k] = v
      metaChanged = true
    }
  }

  // 生效列表：凡是 live ∩ meta（或已学）且还没有的，都补上
  // 0.1.7+ 落点是在活动 profile 的补丁文件；更早版本落点是 settings.yaml。
  let settingsText = fs.readFileSync(SETTINGS, 'utf8')
  if (!DRY) {
    const fixed = correctModelEntries(settingsText, CORRECTIONS)
    if (fixed.changed.length > 0) {
      settingsText = fixed.text
      fs.writeFileSync(SETTINGS, settingsText, 'utf8')
      for (const line of fixed.changed) log(`[settings] 纠正: ${line}`)
    }
  }
  const ids = readModelIds(settingsText)
  const toAdd = []
  const skipped = []
  for (const id of live) {
    const entry = meta.models[id]
    if (!entry) continue
    if (skipSettings.has(id)) {
      if (!ids.has(id)) skipped.push(id)
      continue
    }
    if (ids.has(id)) continue
    // 目录里也没有且还没补目录的，一并走 settings（保证能选到）
    if (!findCatalogSlot(catalog, id) && !ensureSettings.some((e) => e.id === id)) {
      ensureSettings.push(entry)
    }
    toAdd.push(entry)
  }
  if (skipped.length > 0) {
    log(`[settings] 按 settingsSkip 保持删除（${skipped.length} 条）: ${skipped.join(', ')}`)
  }

  // 也确保已 meta 且 catalog 有、但 settings 漏掉的历史模型（用户手动删过的不强制加回 live 之外的）
  // ——只跟 live，避免把下线模型塞回来。

  if (catalogChanged && !DRY) {
    writeJson(CATALOG, catalog)
    log(`[catalog] 已写入（需重启 Harness 生效）: ${CATALOG}`)
  }

  if (toAdd.length > 0) {
    if (DRY) {
      log(`[settings] dry-run 将追加: ${toAdd.map((e) => e.id).join(', ')}`)
    } else {
      const { text, added } = insertModels(settingsText, toAdd)
      if (added.length > 0) {
        fs.writeFileSync(SETTINGS, text, 'utf8')
        log(`[settings] 已追加 models（热生效）: ${added.join(', ')}`)
      }
    }
  } else {
    log('[settings] models 列表已是最新')
  }

  if (metaChanged && !DRY) {
    writeJson(META, meta)
    log(`[meta] 已更新 ${path.basename(META)}（共 ${Object.keys(meta.models).length} 条）`)
  }

  log('[sync] 完成')
}

main().catch((e) => {
  warn(`[sync] 异常（不阻断启动）: ${e.stack || e}`)
  process.exitCode = 0
})
