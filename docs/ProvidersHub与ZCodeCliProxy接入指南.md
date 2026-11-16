# ProvidersHub 与 ZCodeCliProxy 接入指南（ZCode / Trae / Qoder 额度双轨）

> 接入日期：2026-10-25 ｜ 目标 profile：`web` ｜ 前置调研与选型结论见本文末尾「选型记录」。
> 两个均为**第三方逆向通道插件**：在 IDE 之外消耗平台额度，存在平台 ToS 灰区（限流/封号风险自担）；providers-hub 会持有全部已登录平台凭据，**建议只登免费/签到额度账号**。

## 双轨架构一览

| 轨道 | 插件 | 消耗额度 | Agentic 发生在 |
| --- | --- | --- | --- |
| Provider 轨 | `dsh-providers-hub`（17 家 provider + 聚合路由） | ZCode Start Plan、Trae、Qoder/QoderCN、CodeArts、CodeBuddy 等 17 家 | **DSH 自己的 agent loop**（文件/Bash/MCP 工具循环），插件只供模型推理 |
| 委托轨 | `dsh-zcode-cli-proxy`（provider `zcode-cli`） | 仅 ZCode **Start Plan**（免费套餐，无需付费 Coding Plan） | **ZCode 原生 agent**（`zcode.cjs app-server` 常驻子进程，全工具 yolo 模式） |

两轨都把模型注册进 DSH 模型选择器；区别是工具调用由谁执行。cli-proxy 的 agent 会**自动放行所有权限请求（yolo）**，只对信任任务使用，注意提示词注入风险。

## 安装状态（2026-10-25）

| 项 | 值 |
| --- | --- |
| `Plugins/dsh-providers-hub` | Gitee `iJetLi/deepseek-harness-codearts`，commit `df7cae36`，v0.2.1-rc.2，MIT |
| `Plugins/dsh-zcode-cli-proxy` | GitHub `kyle123740/dsh-zcode-cli-proxy`，commit `18375a9e`，v0.3.1，AGPL-3.0 |
| 构建方式 | providers-hub：插件目录内 `pnpm install --frozen-lockfile`（prepare 钩子自动完成 tsc + 资产 + 客户端构建，产物 `lib/`）；运行时依赖（jose/undici/cosmokit/schemastery）由插件本地 `node_modules` 解析。cli-proxy：仓库自带预编译 `lib/`，零运行时依赖 |
| 接线 | 手工三件套（profile `package.json` 的 bundles+dependencies `link:`、node_modules junction、pnpm-lock importers）；cli-proxy 额外在 profile `cordis.patch.yml` 末尾有配置块 |
| 兼容性 | 两者均声明支持 DSH 0.2.1-rc.x；本机 source 版本 0.2.1-rc.2，探针零激活失败 |

**严禁从 npm 安装**：npm 上的 `dsh-codearts-auth`（发布者 weiyou）与 Gitee 原作者**不是同一人**，属同名投毒面。更新一律走 Gitee `git pull` → `pnpm install --frozen-lockfile`（prepare 自动重建）→ 重启 DSH。

## 关键配置

providers-hub：无 profile 层配置，全部在 Web UI 的 **Jet Hub 面板**（Settings 内）操作——各平台登录、多账号池、每日签到、余额查询、一键领取。另起本地 OpenAI 兼容网关 `127.0.0.1:8326`（`/v1/chat/completions`、`/v1/responses`），可供其他客户端复用已登录账号。

cli-proxy（profile `cordis.patch.yml` 末尾 `- id: dsh-zcode-cli-proxy` 行）：

| 键 | 当前值 | 说明 |
| --- | --- | --- |
| `zcodeCliPath` | `D:/Tools/Zcode/resources/glm/zcode.cjs` | **必填**：本机 ZCode 装在 D 盘非默认位，插件自动探测只查 `%LOCALAPPDATA%\Programs\ZCode`、`Program Files\ZCode` 与 mac/linux 路径，探测不到 |
| `zcodeCliNode` | 默认 `node` | app-server 用 node 拉起；如遇坏 PATH 可改 `Dependency\nodejs\node.exe` 绝对路径 |
| `cliModels` | 默认 `glm-5.3-flash` 起步 | 验证稳定后可加 `glm-5.3`；模型名经 `startPlanModelId` 映射到 Start Plan 端点 `zcode.z.ai/api/v1/zcode-plan/anthropic` |
| `zcodeDataBaseDir` | 默认空 = `~/.zcode/v2` | 复用 ZCode 桌面端登录凭据 `credentials.json`，无需另登 |
| `injectStartPlanAccount` | 默认 true | 经 `provider/updateAccountConfig` 注入 Start Plan 账号（revision hash 须逐字匹配） |

## 登录与验证流程（首次）

1. **重启 DSH**（OrcaMind 壳完全退出后跑 `重启-Harness.bat`；壳在跑时由壳自管重启）。
2. 浏览器开 `http://127.0.0.1:3080` → Settings → **Jet Hub**：
   - **Qoder/QoderCN**：设备码流程，手机/网页确认；
   - **Trae**：浏览器回调授权；
   - **ZCode**：providers-hub 有独立 zcode 通道（可领签到/营销额度）；cli-proxy 不需要面板登录，直接读 `~/.zcode/v2/credentials.json`。
   - 登录完点每日签到/一键领取，确认额度到账。
3. **Agentic 实测**（各平台一枪）：选 providers-hub 注册的 zcode / trae / qoder 模型，发「在 Workflows 下建一个 txt 并写入内容」类小任务，确认 DSH 工具循环执行且扣对应平台额度；再选 cli-proxy 的 `GLM-5.3-Flash (ZCode CLI)` 发同款任务，确认 app-server 拉起（任务管理器可见 `zcode.cjs app-server --stdio` 子进程）、ZCode 原生 agent 执行、Start Plan 额度扣减。
4. 排障：boot 警告看 `Dependency/tmp/boot-harness.bat` 的 `harness-boot.log`；cli-proxy 会话复用/turn 锁自检 `node Plugins/dsh-zcode-cli-proxy/test/turn-lock.mjs`。

## 回滚

备份在 `Archive/profile-web-backup-20261025/`（package.json / pnpm-lock.yaml / cordis.patch.yml 三件）。恢复 = 覆盖回 profile + 删两个 node_modules junction + 删 `Plugins/` 下两个目录。

## 选型记录（2026-10-25 调研）

- 候选全量核实：`dsh-providers-hub`（选定，17 家全覆盖 + 聚合轮换 + 签到）、`dsh-workbuddy-trae-qoder-connect`（与 providers-hub 重叠，原留作 Trae CN 通道失败备选；**2026-10-26 已卸载**，连同 `dsh-workbuddy-settings` 与 WorkBuddy 桌面端，见 README 插件表）、`dsh-multi-agent-gateway`（太新 0-2★，弃）、`dsh-zcode-coding-plan`（**需付费 GLM Coding Plan，README 明言无订阅装了无效果，弃**）、`dsh-zcode-cli-proxy`（选定，Start Plan 免费额度 + ZCode 原生 agent 委托）。
- WorkBuddy 通道原由 `dsh-connect-workbuddy` 5.6.2 覆盖，无需重复接入；**该通道已于 2026-10-26 移除**（与 providers-hub 重叠），`agent-default-model` 已改指 `zcode-cli` 的 `glm-5.3-flash`。
- Trae/Qoder **无需本地安装 IDE**：插件自带浏览器回调/设备码登录，网页注册账号即可；唯一需要客户端的是 ZCode（cli-proxy 拉起其 app-server）。
