#!/usr/bin/env node
/**
 * DeepSeek Harness 固定服务入口。
 *
 * 壳（OrcaMind）与 bat 只负责：定位到本仓库根 → `node serve-harness.mjs --port <n>`。
 * 如何启动 dsh、依赖缺失时如何补装，全部收在这里；更新内核不必重编桌面壳。
 *
 * 用法：
 *   node serve-harness.mjs [--port 3080] [--]
 *
 * 约定：
 *   - 子进程 stdout 原样透传（含 `dsh web: http://…?token=…` 行）
 *   - 退出码随 dsh；父进程被 taskkill /T 时整棵树一起回收
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 3080

function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, extra: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') {
      const n = Number(argv[++i])
      if (Number.isInteger(n) && n > 0) out.port = n
      continue
    }
    if (a.startsWith('--port=')) {
      const n = Number(a.slice('--port='.length))
      if (Number.isInteger(n) && n > 0) out.port = n
      continue
    }
    if (a === '--') {
      out.extra.push(...argv.slice(i + 1))
      break
    }
    out.extra.push(a)
  }
  return out
}

function resolveEntry() {
  const srcBin = path.join(ROOT, 'source', 'apps', 'cli', 'lib', 'bin.js')
  if (fs.existsSync(srcBin)) return { script: srcBin, kind: 'source' }

  const pkgFile = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
    const bin = pkg.bin
    const entry = typeof bin === 'string' ? bin : bin && (bin.dsh || bin['deepseek-harness'])
    if (entry) return { script: path.join(path.dirname(pkgFile), entry), kind: 'npm' }
  } catch {
    /* 按未安装处理 */
  }
  return null
}

function ensureNpmInstall() {
  console.log('[serve-harness] 未找到服务端入口，先执行 npm install …')
  const r = spawnSync('npm', ['install'], {
    cwd: ROOT,
    shell: true,
    windowsHide: true,
    stdio: 'inherit',
  })
  return r.status === 0
}

function nodeCommand() {
  // 优先系统 node；找不到时用 Electron 内置 Node（开发/便携场景）
  const probe = spawnSync('node', ['-v'], { windowsHide: true, stdio: 'ignore' })
  if (!probe.error && probe.status === 0) {
    return { cmd: 'node', argsPrefix: [], env: process.env }
  }
  return {
    cmd: process.env.EMBEDDED_NODE || process.execPath,
    argsPrefix: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }
}

const { port, extra } = parseArgs(process.argv.slice(2))

let cmd = resolveEntry()
if (!cmd) {
  if (fs.existsSync(path.join(ROOT, 'source', 'package.json'))) {
    console.error('[serve-harness] source/ 存在但缺少 apps/cli/lib/bin.js：构建产物缺失。请先运行「更新-Harness.bat」完成依赖安装与构建，再启动。')
    process.exit(1)
  }
  if (!ensureNpmInstall()) {
    console.error('[serve-harness] 依赖安装失败。请先运行「更新-Harness.bat」或「启动-Harness.bat」完成安装。')
    process.exit(1)
  }
  cmd = resolveEntry()
  if (!cmd) {
    console.error('[serve-harness] 依赖安装完成后仍未找到服务端入口。')
    process.exit(1)
  }
}

const node = nodeCommand()
const args = [...node.argsPrefix, cmd.script, 'web', '--port', String(port), ...extra]
console.log(`[serve-harness] root=${ROOT}`)
console.log(`[serve-harness] kind=${cmd.kind}`)
console.log(`[serve-harness] exec=${node.cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}`)

const child = spawn(node.cmd, args, {
  cwd: ROOT,
  env: node.env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let draining = false
function forward(stream, out) {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    out.write(chunk)
  })
}
forward(child.stdout, process.stdout)
forward(child.stderr, process.stderr)

function shutdown(code) {
  if (draining) return
  draining = true
  if (child.exitCode == null && child.signalCode == null) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      try {
        process.kill(child.pid, 'SIGTERM')
      } catch {
        /* 已退出 */
      }
    }
  }
  process.exitCode = code
}

child.on('error', (err) => {
  console.error('[serve-harness] 启动 dsh 失败:', err.message)
  shutdown(1)
})
child.on('exit', (code, signal) => {
  shutdown(signal ? 1 : (code ?? 0))
})

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0))
}
