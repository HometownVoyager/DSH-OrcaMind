// 诊断脚本：检查预设 bundle 里所有会被插值的提示词文本能否用运行时真实注册的变量渲染。
//
// 背景（2026-10-11）：DSH 0.2.1 移除了内置 `cwd` 提示词变量，12 个自建预设的 persona
// 模板仍在写 `工作目录为 {{cwd}}`，导致每次运行都在发出模型请求前失败
// （`unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix"`）。
// 这类错误只在组装提示词时才暴露，roster 探针（probe-preset-roster.mjs）查不出来。
//
// 用法（在工作区根执行）：
//   Dependency/nodejs/node.exe Archive/scripts/probe-preset-prompt-vars.mjs [patch 路径]
// 省略路径时默认检查 Plugins/dsh-user-presets/cordis.patch.yml。
// 退出码 0 = 全部可渲染；1 = 有模板渲染失败（逐条打印原因）；2 = 用法/文件错误。
//
// 说明：loop 目前只注册 provider 与 model 两个变量（见
// source/packages/core/agent-loop/src/index.ts 的 ctx.systemPrompt.variable 调用）；
// 变量值本身不参与判断，这里只验证「名字已注册」这一契约。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB = path.join(ROOT, 'source', 'packages', 'core', 'system-prompt', 'lib', 'index.js')
const target = process.argv[2] ?? path.join(ROOT, 'Plugins', 'dsh-user-presets', 'cordis.patch.yml')

if (!fs.existsSync(target)) {
  console.error(`找不到 patch 文件：${target}`)
  process.exit(2)
}
if (!fs.existsSync(LIB)) {
  console.error(`找不到已构建的 dsh-system-prompt：${LIB}（先跑一次 build）`)
  process.exit(2)
}

const { renderPrompt } = await import(`file://${LIB.replaceAll('\\', '/').replaceAll(' ', '%20')}`)

/**
 * 抽出 YAML 块标量（`key: |`）的正文，按缩进判断块边界。
 * 只做粗解析：bundle patch 里的块标量都是单一缩进层级的纯文本。
 */
function blockScalars(source) {
  const lines = source.split('\n')
  const found = []
  for (let i = 0; i < lines.length; i++) {
    const header = /^(\s*)([A-Za-z_][\w-]*):\s*\|[+-]?\s*$/.exec(lines[i])
    if (header === null) continue
    const indent = header[1].length
    const body = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') { body.push(''); continue }
      if (line.search(/\S/) <= indent) break
      body.push(line)
    }
    i = j - 1
    const filled = body.filter(line => line.trim() !== '')
    const minIndent = filled.length === 0 ? 0 : Math.min(...filled.map(line => line.search(/\S/)))
    const text = body.map(line => line.trim() === '' ? '' : line.slice(minIndent)).join('\n')
    if (text.includes('{{')) found.push({ key: header[2], line: i + 2, text })
  }
  return found
}

const blocks = blockScalars(fs.readFileSync(target, 'utf8'))
const variables = { provider: 'probe-provider', model: 'probe-model' }

let failed = 0
for (const block of blocks) {
  try {
    renderPrompt({ sections: [{ name: 'deployment:persona-prefix', text: block.text }], contexts: [], tools: [], variables })
  } catch (error) {
    failed++
    console.error(`FAIL 第 ${block.line} 行（key=${block.key}）：${error.message}`)
  }
}
console.log(`${path.relative(ROOT, target)}：含变量的块标量 ${blocks.length} 条，渲染失败 ${failed} 条`)
process.exit(failed === 0 ? 0 : 1)
