// 诊断插件：等 MCP 生图工具注册后，直接经 DSH 工具链（ctx.tools.execute）调用一次 NB2 Lite，
// 打印结果摘要（内容块类型/大小/落盘路径）后退出进程——验证 MCP 客户端 callTool 全链路。
// 用法：node source/apps/cli/lib/bin.js --profile web --patch Archive/scripts/probe-mcp-image-call.patch.yml --port 3099
export const name = 'mcp-image-call-probe'
export const inject = ['tools']

const SAVE_DIR = 'C:/Users/HometownVoyager/AppData/Local/Temp/dsh-mcp-probe'

export function apply(ctx) {
  const deadline = Date.now() + 150_000
  const tick = async () => {
    if (ctx.tools.get('mcp__image__generate_nano_banana_2_lite') === undefined) {
      if (Date.now() > deadline) {
        console.log('MCP_PROBE\ttool not registered in time')
        process.exit(1)
      }
      setTimeout(() => { void tick() }, 500)
      return
    }
    try {
      const controller = new AbortController()
      const result = await ctx.tools.execute({
        callId: 'mcp-image-probe-1',
        name: 'mcp__image__generate_nano_banana_2_lite',
        arguments: {
          prompt: 'A minimal flat-design icon of a blue whale on a white background, centered, no text',
          aspect_ratio: '1:1',
          resolution: '1K',
          save_dir: SAVE_DIR,
          filename: 'mcp-e2e-probe',
        },
        signal: controller.signal,
      })
      console.log(`MCP_PROBE\tisError=${result.isError}`)
      for (const block of result.content ?? []) {
        if (block.type === 'text') {
          console.log(`MCP_PROBE_BLOCK\ttext\t${String(block.text).slice(0, 300)}`)
        } else if (block.type === 'image') {
          const data = block.source?.data ?? block.data
          console.log(`MCP_PROBE_BLOCK\timage\t${block.source?.media_type ?? block.mimeType ?? '?'}\tbytes≈${typeof data === 'string' ? Math.round(data.length * 0.75) : 'n/a'}`)
        } else {
          console.log(`MCP_PROBE_BLOCK\t${block.type}`)
        }
      }
      if (result.isError) console.log(`MCP_PROBE_ERROR\t${JSON.stringify(result.error).slice(0, 400)}`)
      process.exit(result.isError ? 1 : 0)
    } catch (error) {
      console.log(`MCP_PROBE_THROW\t${String(error).split('\n')[0]}`)
      process.exit(1)
    }
  }
  setTimeout(() => { void tick() }, 2500)
}
