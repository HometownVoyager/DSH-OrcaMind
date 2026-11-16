// 诊断插件：等预设注册表稳定后打印 roster（含每条声明的激活诊断），然后退出进程。
// 用法：node source/apps/cli/lib/bin.js web --port 3099 --patch Archive/scripts/probe-preset-roster.patch.yml
export const name = 'preset-roster-probe'
export const inject = ['agentPresets']

export function apply(ctx) {
  const deadline = Date.now() + 30_000
  const tick = async () => {
    try {
      const rows = await ctx.agentPresets.list()
      if (rows.length > 0) {
        const broken = rows.filter(r => r.broken !== undefined)
        for (const row of rows) {
          const state = row.broken === undefined ? 'ok' : `BROKEN: ${row.broken.split('\n')[0]}`
          console.log(`ROSTER\t${row.id}\t${state}`)
        }
        console.log(`ROSTER_TOTAL\t${rows.length}`)
        console.log(`ROSTER_BROKEN\t${broken.length}`)
        process.exit(0)
      }
    } catch (error) {
      console.log(`ROSTER_ERROR\t${String(error).split('\n')[0]}`)
    }
    if (Date.now() > deadline) {
      console.log('ROSTER_TIMEOUT')
      process.exit(1)
    }
    setTimeout(() => { void tick() }, 500)
  }
  setTimeout(() => { void tick() }, 1500)
}
