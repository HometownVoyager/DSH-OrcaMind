// 诊断插件：等待工具注册稳定后打印运行时可见工具清单（全局视图），然后退出进程。
// 用途：升级/改配置后验证各插件（含 MCP 客户端接入的 mcp__* 工具）是否真的注册成功。
// 用法：node source/apps/cli/lib/bin.js --profile web --patch Archive/scripts/probe-tool-inventory.patch.yml --port 3099
export const name = 'tool-inventory-probe'
export const inject = ['tools']

export function apply(ctx) {
  const deadline = Date.now() + 40_000
  let firstSeenAt
  const tick = () => {
    let schemas
    try {
      schemas = ctx.tools.schemas()
    } catch (error) {
      console.log(`TOOL_ERROR\t${String(error).split('\n')[0]}`)
      process.exit(1)
    }
    if (schemas.length > 0 && firstSeenAt === undefined) firstSeenAt = Date.now()
    // 首次可见后再等 8 秒，让 MCP 客户端等异步接入的行完成注册
    const settled = firstSeenAt !== undefined && Date.now() - firstSeenAt > 8000
    if (settled || Date.now() > deadline) {
      for (const schema of schemas.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`TOOL\t${schema.name}`)
      }
      console.log(`TOOL_TOTAL\t${schemas.length}`)
      process.exit(0)
    }
    setTimeout(tick, 500)
  }
  setTimeout(tick, 2000)
}
