/**
 * 测试小工具：用最小 ctx 桩把 dsh-pdf-editor 的工具注册出来，直接调用 execute。
 *
 * 断言的是 execute 的原始返回值；要验证渲染文案时用 `render(name, value)` 单独跑一遍。
 * 用法：`const env = await loadEditorTools(); await env.call('pdf_pages', {...})`
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const editorLib = join(here, '..', 'lib', 'index.js')

/** Raised when a tool result would not survive the harness's lossless-JSON result boundary. */
export class LosslessError extends Error {}

/**
 * Assert a tool result is lossless JSON.
 *
 * The harness rejects a result carrying `undefined` values, functions, symbols, non-finite numbers,
 * or exotic objects — and it does so at the real tool boundary, which a test that calls `execute`
 * directly would otherwise never exercise. Every `call()` therefore checks it, so this class of bug
 * cannot ship silently.
 */
export function assertLossless(value, path = 'result') {
  const seen = new Set()
  const walk = (node, at) => {
    if (node === null) return
    const kind = typeof node
    if (kind === 'string' || kind === 'boolean') return
    if (kind === 'number') {
      if (!Number.isFinite(node)) throw new LosslessError(`${at} 不是有限数字：${node}`)
      return
    }
    if (kind === 'undefined') throw new LosslessError(`${at} 是 undefined（lossless JSON 不允许）`)
    if (kind !== 'object') throw new LosslessError(`${at} 的类型是 ${kind}，无法序列化`)
    if (seen.has(node)) throw new LosslessError(`${at} 存在循环引用`)
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`))
      seen.delete(node)
      return
    }
    const proto = Object.getPrototypeOf(node)
    if (proto !== Object.prototype && proto !== null) throw new LosslessError(`${at} 不是普通对象（${node.constructor?.name ?? 'unknown'}）`)
    for (const [key, item] of Object.entries(node)) walk(item, `${at}.${key}`)
    seen.delete(node)
  }
  walk(value, path)
}

/** Raised when a tool result does not satisfy the tool's own declared output schema. */
export class SchemaError extends Error {}

/**
 * Check a tool result against the tool's declared output schema.
 *
 * The harness validates every result against the schema before it reaches the model, and a test that
 * calls `execute` directly never exercises that check — so a value carrying an undeclared key (or a
 * missing required one) would pass the suite and fail live. This mirrors the enforced subset:
 * `type`, `properties`, `required: true` per property, `additionalProperties: false`, `items`, and
 * exact-one `oneOf`.
 *
 * @param value - the tool result.
 * @param schema - the tool's `output.schema`.
 * @param path - path prefix used in messages.
 */
export function assertMatchesSchema(value, schema, path = 'result') {
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((branch) => {
      try {
        assertMatchesSchema(value, branch, path)
        return true
      } catch {
        return false
      }
    })
    if (matches.length !== 1) throw new SchemaError(`${path} 命中 ${matches.length} 个 oneOf 分支（要求恰好 1 个）`)
    return
  }
  if (schema.type === undefined) return
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SchemaError(`${path} 应是对象，实际是 ${Array.isArray(value) ? 'array' : typeof value}`)
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      const member = value[key]
      if (child.required === true && member === undefined) throw new SchemaError(`${path}.${key} 缺少必需字段`)
      if (member !== undefined) assertMatchesSchema(member, child, `${path}.${key}`)
    }
    if (schema.additionalProperties === false) {
      const declared = new Set(Object.keys(schema.properties ?? {}))
      const extra = Object.keys(value).filter((key) => !declared.has(key))
      if (extra.length > 0) throw new SchemaError(`${path} 含未声明字段：${extra.join('、')}`)
    }
    return
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new SchemaError(`${path} 应是数组`)
    if (schema.items !== undefined) value.forEach((item, index) => assertMatchesSchema(item, schema.items, `${path}[${index}]`))
    return
  }
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (schema.type === 'integer' && !(actual === 'number' && Number.isInteger(value))) throw new SchemaError(`${path} 应是整数，实际是 ${actual}`)
  if (schema.type !== 'integer' && actual !== schema.type) throw new SchemaError(`${path} 应是 ${schema.type}，实际是 ${actual}`)
}

/** Register the editor plugin against a stub ctx and return its tools. */
export async function loadEditorTools(pluginPath = editorLib, configOverrides = {}) {
  const module = await import(new URL(`file://${pluginPath.replace(/\\/gu, '/')}`).href)
  const registered = []
  const ctx = {
    effect: (fn) => fn(),
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
  }
  // schemastery schemas are callable and resolve every `default()`, so tests run on deployed defaults.
  let config = {}
  try {
    config = { ...module.Config({}), ...configOverrides }
  } catch {
    config = { ...configOverrides }
  }
  module.apply(ctx, config)
  const tools = new Map(registered.map((tool) => [tool.name, tool]))
  const exec = {
    // A real AbortSignal: the tools forward it into node:fs, which validates the instance.
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: process.cwd() } } },
  }
  return {
    tools,
    exec,
    config,
    /** Run one tool and return its raw result, rejecting anything the real boundary would reject. */
    async call(name, args) {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`工具未注册：${name}（已注册：${[...tools.keys()].join('、')}）`)
      const result = await tool.execute(args, exec)
      assertLossless(result, name)
      if (tool.output?.schema !== undefined) assertMatchesSchema(result, tool.output.schema, name)
      return result
    },
    /** Run one tool expecting failure, returning the message. */
    async fail(name, args) {
      try {
        await this.call(name, args)
      } catch (error) {
        if (error instanceof LosslessError || error instanceof SchemaError) throw error
        return error instanceof Error ? error.message : String(error)
      }
      throw new Error(`预期 ${name} 失败，但它成功了`)
    },
    /** Render one tool's result the way the model would see it. */
    render(name, value, args = {}) {
      const renderFn = tools.get(name)?.output?.render
      return renderFn === undefined ? String(value) : renderFn(args, value)
    },
  }
}

/** Tiny assertion helper shared by the tests. */
export function makeChecker(label) {
  let failures = 0
  let checks = 0
  const check = (name, condition, detail = '') => {
    checks++
    if (condition) console.log(`  ok   - ${name}`)
    else { failures++; console.log(`  FAIL - ${name} ${detail}`) }
  }
  return {
    check,
    done() {
      console.log(`\n${failures === 0 ? `ALL PASS（${checks} 项）` : `${failures} FAILURES（${checks} 项）`} — ${label}`)
      return failures === 0 ? 0 : 1
    },
  }
}
