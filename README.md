# DeepSeek Harness 工作区索引

本工作区是 DeepSeek Harness（DSH）的本地运行与二次开发环境：`source/` 是官方仓库源码（GitHub 浅克隆），周围一圈是自建的启动脚本、Electron 桌面壳（OrcaMind）、插件库（自研 + 第三方），以及收纳运行时依赖（自带 Node.js、pnpm store、npm 缓存）与服役依赖项的 `Dependency/`。

> **自用版声明**：本仓库（DSH-OrcaMind）是 DSH 的**个人自用工作区存档**，仅供本人留存与跨机恢复，非官方发行物、与 deepseek-ai 官方无关。官方源码（`source/`）、运行时依赖（`Dependency/`，唯 `patches/` 与 `scripts/` 两个自建服役物目录已入库）、第三方插件（`dsh-ops`、`dsh-providers-hub` 等）与全部 `node_modules` 一律不入库；文中路径、预设与配置均按本机环境硬编码（Windows，工作区根 `D:\Tools\DeepSeek Harness`，端口 3080），不保证开箱即用。各目录的作用见下文索引。

关键常量：服务端口 **3080**（`http://127.0.0.1:3080`）；DSH 主目录 `~/.dsh`（活动 profile 为 `web`，设置存于 `~/.dsh/profiles/web/cordis.patch.yml`）。

> **工作区维护守则**：
> 1. **尽量保持主目录干净**：主目录（工作区根目录）仅保留核心入口脚本（日常启动/更新/重启 bat 与 `serve-harness.mjs`）及全局索引文件（`README.md`）。严禁在主目录随意堆放测试文本、临时文件、调试转储或运行日志；临时调试与工具落脚点统一使用 `Dependency/tmp/`，测试产物与历史废弃文件及时移入 `Archive/` 对应子目录。
> 2. **同步更新本 README**：工作区内任何目录、文件、脚本的增删改、归档迁移，都必须同步更新本 README，保持索引与实际内容一致。改动后请逐节检查是否仍准确。
> 3. **设计文档管理**：未完成/进行中的设计文档（如 `*_DESIGN.md`）放在主目录（工作区根目录），便于日常查阅与频繁迭代编辑；功能实施完毕、文档定稿后，视价值并入现行文档或直接删除（2026-11-17 起不再设 `Archive/Design/` 归档位），保持主目录清爽。（截至 2026-11-17：主目录无 `*_DESIGN.md`；曾归档于 `Archive/Design/` 的两份历史设计文档已随当日归档清理删除。）
> 4. **DSH 产物不出工作区**：运行载荷（如 411MB 的 bash）用 `Dependency/` + junction 收回工作区；临时克隆区（如插件审查用 `D:\Tools\dsh-plugin-review`）用完即删，结论写进 `Plugins/docs/`。`D:\Tools` 下不再保留任何 DSH 目录。

## 启动链路

```
启动-Harness.bat ─┐
启动-Harness-桌面版.bat（OrcaMind 壳）─┤
                                  ├─→ node serve-harness.mjs --port 3080
desktop/main.js（壳托管模式）──────┘         │
                                            ├─ 定位仓库根、缺依赖时补装
                                            └─ 启动 source/apps/cli 的 dsh web 服务
                                                 → 浏览器/壳窗口挂载 http://127.0.0.1:3080
```

- `serve-harness.mjs` 是**唯一稳定入口**：bat 与 OrcaMind 壳共用。壳只探测/挂载 3080 端口，未运行时才调它拉起服务；更新内核只动 `source/`，壳不用重编。**壳按工作区根定位它，勿挪。**
- OrcaMind 壳运行时服务由壳自己管理（含自动重启），`重启-Harness.bat` 检测到壳在跑就不代杀，避免抢端口。
- 更新期间 `git reset --hard` 会冲掉 `source/` 内的本地改动，流程见下文「本地改动与更新须知」。

## 目录结构

### `source/` — DSH 官方源码

`deepseek-ai/deepseek-harness` 的浅克隆（`--depth 1`，跟随远端强推），pnpm monorepo：

- `apps/`：`cli`（dsh 命令行与 web 服务入口 `lib/bin.js`）、`web`（前端）、`desktop` / `desktop-host`（官方 Electron 桌面端）。
- `packages/`：60 余个插件化子包（Cordis 架构），核心如 `llm`（含 pi-ai 适配器，OpenCode Go 走这里）、`session`、`core`、`settings`、`preset`、`skill`、`web` 等，全清单见 `packages/README.zh.md`。
- `docs/`、`benchmarks/`、`python/`、`native/` 等官方内容；开发规范见 `source/AGENTS.md`。

**`source/` 内存在多处不受 git 管理的本地改动**（session 补丁、liveshare 端点表、会话回收站、session-log 全模型上传开关等，全景 = `Dependency/patches/local-features-overlay.patch` 的 63 文件清单 + llm-pi-ai/src 补丁），更新时必须保住（见「本地改动与更新须知」#1/#6）。

### `desktop/` — OrcaMind Electron 桌面壳

`main.js` 约 2000 行，**壳本体远不止薄壳**——服务托管之外还有划词翻译与智能朗读两大自研功能；desktop 下 13 个源码文件全部入库（无未跟踪内容），换机恢复不依赖现存 exe，重打包（`npm run dist`）或开发模式即可重建：

- **服务托管**：探测/挂载 3080 服务、未运行时调 `serve-harness.mjs` 拉起；单实例锁保留：重复启动聚焦既有窗口。**通知深链 `orcamind://` 已于 2026-10-06 移除**：协议处理器指向便携自解压 exe，每次点击通知都要完整解压启动一个 Electron 实例（数秒延迟），得不偿失；壳不再注册协议，注册表残留键已清理。
- **右键菜单 + 划词翻译**（`translate.html` 独立浮窗 + `preload-translate.js`）：壳自绘网页右键菜单（复制/链接/图片操作、翻译、朗读三件套）；选中文本「让 AI 翻译为…」唤起独立轻量浮窗——按触发位置锚定、会话级尺寸记忆、零上下文污染。翻译三通道：AI 模型翻译（**默认用当前会话活跃模型**，页面经 IPC 上报；模型列表取自 DSH 页面目录，单次无状态调用、严格关思考、错误真实回显）、MyMemory 免 Key 容错通道、跳必应翻译；结果可复制或回填 DSH 输入框（composer 注入）；主题/语言/缩放与主窗同步。
- **智能双引擎朗读**（`tts-service.js` 449 行，纯 Node/Electron 零 npm 依赖）：微软 Edge 在线神经网络语音（自实现 Sec-MS-GEC v2 DRM 握手，wss 连 speech.platform.bing.com）+ 本地 Web Speech API 离线兜底（按中英文自动选 voice）；右键「朗读选中文本 / 朗读设置 / 停止朗读」，音频经 executeJavaScript 注入页面播放；音色默认 auto（中文晓晓 / 英文 Jenny 智能推荐）+ 语速可调，存 userData/tts-settings.json。
- **桌面集成**（`preload.js` 感知 DSH 主题/语言与会话状态同步主进程）：托盘中英双语菜单（打开窗口/浏览器打开/重启服务/退出）、深浅色主题跟随与背景色适配；系统通知以壳 AppUserModelId `com.deepseek.harness.desktop` 品牌弹出（dsh-desktop-notifier 插件的系统通知依赖此身份）。
- `desktop.config.json`：`{ "DSH_ROOT": "D:/Tools/DeepSeek Harness", "port": 3080 }`，可被环境变量覆盖。
- `dist/`：打包产物，`OrcaMind.exe`（无版本号）为首选便携版；`build/` 内是图标；`scripts/make-icon.js` 生成图标。**改过 main.js 后要重新 `npm run dist`。**（2026-11-17：main.js 改为外置读 `oauth-client.local.json` 后曾两度重建，均因沙箱网络拉不动 electron 分发而失败（TLS 断连，ELECTRON_MIRROR 亦无效）；现行 exe 仍为 10-15 版——内嵌凭据与外置文件同值，行为完全等同，下次在正常网络环境重建即可，`package.json` build.files 已含该凭据文件。）

### `Plugins/` — 插件（自研 + 第三方）

装卸方法见 `Plugins/docs/插件装卸使用指南.md`，开发见 `Plugins/docs/插件开发指南.md`：

| 插件 | 用途 |
| --- | --- |
| `dsh-antigravity` | Google Antigravity / Cloud Code Assist 模型 provider（本地补丁版：CallId→ToolCallId 修正、Gemini 3.8/Claude 路由与思考预算、tool-result 契约修复、安全闸；**2026-10-06 起网络错误归码 `TRANSPORT` 并覆写 `providerRetryPolicy`——重试上限 10 次/延迟上限 30s（约 2 分钟，`ANTIAGRAVITY_MAX_RETRIES` 可覆盖），由内置 llm-retry 自动重试 VPN 抖动**） |
| `dsh-user-presets` | 13 个自建 agent 预设 bundle（论文撰写、小说创作等）+ 7 个 `VN-*` 工作流预设（2026-11-07 施工，共 20 条 `preset-*`）；注册在 `~/.dsh/profiles/web/package.json` 的 `link:` 依赖 + `dsh.profile.bundles`；**skills 路径是绝对路径，挪动本目录必须同步改 `cordis.patch.yml`；委托行严禁 `toolFilter` / `persona`（0.2.1 加载即拒，会让新建会话报 `agent-preset/invalid`）；`cordis:group` 行禁止与组内子行同 id（同名会让 DSH 启动静默挂起、CPU 满转）**，详见其 README。**2026-11-10 瘦身重构**：7 个 VN persona 由 509 行压到 184 行（加【指令裁决】宪法段、删重复块）、移除 7 处 planning 组与全部 77 处末位 `ask_user_question` 硬门禁、重写 `vn-shared` 三份 SKILL.md 并清理 36 份阶段 SKILL.md；现行规范入口为 `VN-工作流现行规范.md`，旧施工/说明文档已于 2026-11-17 随归档清理删除（改造前备份同日删除）。**Godot MCP（`mcp-godot-ai`，godot-ai 后端）以 preset 作用域挂在本 bundle 的 godot-dev 预设内**：插件与 uv 工具链在 `D:/Tools/GoDot/`（工作区外），架构/接入/纪律见 `D:/Tools/GoDot/GODOT_MCP_GUIDE.md`（2026-10-27 从 godot-mcp-enhanced 换为 hi-godot/godot-ai，旧后端与 3 个候选残留已清） |
| `dsh-office-editor` | Office 文档编辑与制造（.docx/.xlsx），结构化 JSON 造文档、坐标定向编辑。**2026-11-01 起宿主层全局挂载**（web profile `cordis.patch.yml` insert，file: URL），全部预设可用 |
| `dsh-office-reader` | Office 文档查阅（.docx/.xlsx/.pptx）：提取、搜索（`office_inspect`/`office_read`/`office_find`）。**2026-11-01 排查：四件套本体健康，此前仅 5 个自建预设携带，官方 ptc/standard 会话拿不到工具、模型退化解压 docx；现已在 web profile `cordis.patch.yml` 宿主层补挂，全部预设可用**；预设层原行保留（同名工具重复注册由 tools registry 自然覆盖）；改插件后仍须重启 DSH |
| `dsh-pdf-editor` | PDF 编辑：页面操作、AcroForm 填写、水印盖章（pdf-lib）。**2026-11-01 起宿主层全局挂载**（同 office-reader） |
| `dsh-pdf-reader` | PDF 查阅：概览、文本提取、关键词搜索（pdfjs-dist）。**2026-11-01 起宿主层全局挂载**（同 office-reader） |
| `dsh-tool-gate` | 宿主侧工具闸门：按预设白名单施加 `tools.restrict` |
| `dsh-step-fpga` | STEP FPGA 实验预设 + 预设专属 MCP（`mcp-stepfpga`，stdio，预设作用域挂载仅本预设可见）：面向小脚丫 STEP-MAX10 核心板 + STEP BaseBoard V4.0 的课程作业与竞赛，`data/board.yaml`/`experiments.yaml` 结构化引脚与实验索引、编译→报告→改码闭环、`failOnStartupError: false`，详见其 README |
| `dsh-desktop-notifier` | 桌面通知 v0.3.0：任务全状态弹 OrcaMind 品牌系统通知——完成/截断/失败（含 fetch failed）/中止/被阻止/中断 + 等待确认 + 等待回答（监听 `turn/end` 全部 reason、`approval/asked`、旁听 `user-questions/request` waterfall），**按状态播 C:\Windows\Media 系统提示音**（toast 本体静音防双响，`sound` 总开关）。深链跳转已移除（便携壳自解压太慢）。bundle 层改动需重启 DSH，详见其 README |
| `dsh-auto-continue` | 网络类失败自动续跑：turn/end 以 error 收尾且命中网络特征（`TRANSPORT`/`TIMEOUT` 码或 fetch failed/ECONNRESET 等消息）时，自动代发一条 `Continue.`（`agent.followup`，与服务端 prompt 同路径）。兜底两类 llm-retry 管不到的场景：请求层重试穷尽、pi-ai 系未归码的网络错误。护栏：连续续跑上限 2 次（成功收尾才重置）、间隔 ≥20s、子代理不跟。零运行时依赖；装在 web profile，重启 DSH 生效，详见其 README |
| `dsh-ops` | **第三方**运维插件 **0.5.5**（本地 link，GitHub release tgz 就地替换；2026-11-14 自 0.5.4 升级，其间 0.5.3/0.5.4 跟进未逐版记档，0.5.2 系 11-09 自 0.5.1 升入）：Rust 文件工具（`ops_grep`/`ops_glob`/`ops_inspect_local_file`/`ops_replace`）+ 经校验的独立 Bash 执行器（`ops_bash`，Windows 默认执行器为**随包 Niubash v1.5.0 载荷**）。**0.5.0 起七行组件制改为单行 `dsh-ops` 配置**，13 个自建预设经 profile 的 `presets.<id>` 显式接入保持全局可用。接线现状：① engines `>=0.2.2-rc.1 <0.2.3-0` 自 0.5.0 正式版起原生覆盖 DSH 0.2.2-rc.1，`compatibility.json` 豁免表已清空（旧 alpha 时代的精确版本豁免不再需要）；② 宿主适配层引用的 `@deepseek-ai/dsh-scope` 以 junction 指向 `source/packages/core/scope`（升级须先 `fs.rmdirSync` 摘除、装完重建）；③ 零运行时依赖，`node_modules` 仅此一个 junction。**0.5.1 主修 0.5.0 的缓存/临时文件不回收**（Niubash 执行树清理代码未运行，每次 ops_bash 泄漏整树副本，上游有用户被占 10G）：新增 `dsh-ops cache status\|reclaim`（默认仅预览，真删须 `--yes --all-hosts-stopped`）与只读 `dsh-ops disk status`（R1–R13 归属清单）；Windows 每调用执行根改为跟随载荷卷（本机即 `D:\dsh-ops-exec`），异卷 tmpdir 不再静默整树复制、执行树改硬链接+只读封印。**0.5.2 再修三处**：Windows Niubash 并发调用的硬链接计数误报（改稳定文件身份校验并协调准备中/失败调用的释放）、设置页无法保存或清除各模式 Git Bash 执行路径、离线缓存回收遗漏显式及同卷根目录/无法解除只读与拒删封印。**0.5.5 修两处**：PTC 作用域关闭常驻工具与动态加载时仍注册 `allowedTools` 候选池——无 loader 的作用域不再声明这些 API，首轮提示词省约 22.5k tokens（常驻与默认加载行为不变）；Native 搜索诊断丢失修复并统一模式契约（上游 #867）。**2026-11-16 本地补丁（cordis rc.12 适配，boot 探针验证）**：DSH 0.2.2-rc.2+ 内置 Cordis 4.1.0 移除了 `ctx.root`（读它即抛 `cannot get property "root" without inject`，插件激活失败）——`lib/` 内 22 处 `ctx.root ?? ctx` 已批量改写为 `ctx[Symbol.for('cordis.root')] ?? ctx`（官方升级指南 v0.2.2-rc.2 的纯 JS 迁移路径；补丁脚本已用毕删除）。上游 0.5.5 尚未适配，**下次升级 dsh-ops 须重放此补丁**（或上游发适配版后撤销）。2026-11-14 升级日的 0.5.4 回滚备份已随 2026-11-16 清理删除（0.5.5 已稳定），`%TEMP%\dsh-*` 同日再清（5426 项，DSH 停机时安全，会随使用重新积累）。2026-11-09 升级日实测：ops 缓存 **0 可回收**、`D:\dsh-ops-exec` 未产生；宿主 R7 `dsh-subprocess-*` spill（升级前 111 项/178MB）已随当日清理一并手工清空（连同其余 `%TEMP%\dsh-*` 共 7031 项/~2.16GB，DSH 停机时安全，会随使用重新积累）。`dsh-ops-background`/`dsh-ops-ptc` 默认禁用；详见 `docs/Ops与Billion-Context配置安装指南.md` |
| `billion-context` | ACP 主动上下文剪枝 **0.1.201（第三方上游主包，npm 安装，bundle 第 12 层）**：注入 `compress`/`decompress`/`search_context`/`acp_status`/`acp_read_original_image`，另带缓存命中诊断（`acp_cache`）、出站图片缩放、工具结果吸收。bundle patch 自动插入 `bili-native` 行、禁用根级 `compaction-basic`、并给 4 个官方 Web 预设加 `inject:[biliBasicCompactionPolicy]` 门（加载期 overlay 负责禁用预设内那 17 份 `compaction-basic`）。配置在 `~/.config/billion-context/billion-context.json`，**零配置即可用**。**旧的第三方移植版 `billion-context-dsh@0.2.27` 已停用**（2026-10-18 换包，原因见审查报告 §11；其备份已随 2026-11-17 归档清理删除） |
| `dsh-image-mcp` | 生图 MCP 服务器（stdio 零依赖）：`mcp__image__` 下三个工具——NB2 完整版（NB 2.1 预铺链首，后端未推送时自动回落）、NB2 Lite（Antigravity OAuth 直连，实测可用）、本机 ComfyUI（**auto 优先 Qwen Image 2.1**，照抄实测工作流）；三工具都支持 `save_dir`/`filename` 把成图落到指定目录（相对路径以工作区根为基准）。配在 web profile `cordis.patch.yml` 的 `mcp-image` 条目，重启 DSH 生效，详见其 README |
| `dsh-providers-hub` | **第三方**（Gitee `iJetLi/deepseek-harness-codearts`，commit `f9bbbb2`，Provider 轨；2026-11-16 合并上游 128 提交至 `8010916`（package.json 版本升 0.2.1-rc.3、peer 增 `dsh-client-ui-sidebar-right`、依赖零变化——只重建 lib/ 未重装；此前 11-08 已合 87 提交至 `e8041e4`/`0c467a3`）。**qoder 排队语义互补合并**：上游 11-13/11-15 重构（`waitForQueueFrames` 心跳帧/queue-notice/TOCTOU 预检/Cosy-MachineOS 形态头）与本地 P0-B 共存——账号封顶判据精化为 `serviceAvailable:false` **且** `subCode:RESOURCE_LIMIT`（新导出 `isAccountCappedQueue`；上游新真实报文里无 subCode 的 `serviceAvailable:false` 只是普通排队，旧判据会拦死聚合轮换与心跳，聚合测试 6 条全红后修正）；测试 fixture 双轨制（`REAL_QUEUED` 取上游形状但 `serviceAvailable` 保 true，CN dfmodel 深度积压拆出为 `REAL_QUEUE_SATURATED`）；报错文案保留 label 前缀 + `queueFactsSuffix` + 响应头 deadline。**本地 qoder 挂死 WIP 已在 `5c00fd7` 固化为提交**（stash@{0} 与 `Dependency/tmp/ph-wip-resolved-on-de052dd.patch` 备份仍在）。全量测试 13928 项：28 失败 = 19 项与合并前基线逐字相同（环境性）+ 9 项在纯上游 8010916 上同样失败（上游新文件的本机环境敏感），零合并引入。**2026-11-16 新模型实测**（网关 `/v1/models`）：**Qwen4-Max 已在 trae（`trae/qwen4-max`，1M/x0.69/三档思考）**；qoder/qodercn 活目录尚未推送（不手工造死条目）；**Hy4 Flash 已在 buddy/workbuddy（`hy4flash`+`-free`，960k/x0.03）与 opencode（`hy4-flash-free`，1M）动态浮现**，无需手工添加）：17 家 AI 编程平台额度接入 DSH 模型选择器——**ZCode Start Plan / Trae / Qoder+QoderCN** / CodeArts / CodeBuddy / MiniMax 等，带聚合路由（9 家同底座模型自动轮换、优先烧快过期积分）、多账号池、每日签到与一键领取、本地 OpenAI 兼容网关 `127.0.0.1:8326`。登录/签到全在 Web UI 的 Jet Hub 面板；**严禁从 npm 装同名包（发布者非原作者）**。2026-10-25 接入，详见 `docs/ProvidersHub与ZCodeCliProxy接入指南.md` |
| ~~`dsh-google-aistudio`~~ | **第三方**（npm 名 `github:dtsummery/dsh-google-aistudio`，内核=Mag1cFall/AIStudio2API 托管），**2026-11-16 整体卸载（AI Studio 网页 cookie 反代路线退役）**：web/desktop 两 profile 的依赖/bundles、web `cordis.patch.yml` 配置块（gemini-4-argon 等 9 模型）、node_modules/pnpm-lock 均已清；`~/.dsh/aistudio` 内核与登录态 **2.1G**（aistudio2api.exe v0.3.2 + bin/auth cookie + camoufox runtime）与 `%TEMP%` 内核残留已删。卸载动机：Argon 属付费权益模型而所用 Pro 主号已被 Antigravity 判不合规，网页 cookie 反代的封号风险收益不再成立；Gemini 通路保留 Antigravity 补丁版（`agy/gemini-3.8-flash` 等）。回滚锚：两 profile 的 `*.bak-before-aistudio-removal-20261116` |
| ~~`dsh-zcode-cli-proxy`~~ | **第三方**（GitHub `kyle123740`，commit `18375a9e`，委托轨），**2026-11-03 卸载**：profile 依赖/bundles 早已摘除，本次补清三处残渣（profile node_modules junction、cordis.patch.yml 配置块、插件目录本体）；插件目录备份已随 2026-11-17 归档清理删除，需要时从上游 GitHub `kyle123740` 重装。曾把 **ZCode Start Plan 免费额度**注册为 provider `zcode-cli`（ZCode 原生 agent yolo 执行）；接入细节与选型记录见 `docs/ProvidersHub与ZCodeCliProxy接入指南.md` |
| ~~`DSH-Plugin-不许启动` / `DSH-Plugin-创造模式` / `DSH-自动下载原神`~~ | 行为类趣味插件，**已移入 `Archive/`**，`Plugins/` 下已无这三个目录 |
| ~~`dsh-workbuddy-settings`~~（+ npm 包 `dsh-connect-workbuddy` 5.6.2） | WorkBuddy 额度接入轨（CN/Global 双区），**2026-10-26 移除**：与 `dsh-providers-hub` 功能重叠（2026-10-25 选型记录已如此判定）。settings 插件本体已移除（备份已随 2026-11-17 归档清理删除）；profile 的依赖/bundles/cordis.patch.yml 配置块（约 1300 行目录缓存）已清；默认模型当时改指 `zcode-cli` 的 `glm-5.3-flash`（2026-11-03 cli-proxy 卸载后现指 `antigravity/gemini-3.8-flash`）。对应桌面客户端 WorkBuddy / WorkBuddy AI 已一并卸载 |

> 本表是**插件总账**：除本目录的子目录外，还登记不在本目录的 npm 安装包（`billion-context`，实际装于 profile 的 node_modules）与已卸载插件（划线项）。自研 = 表内未标注者，均已入库；**第三方** = `dsh-ops`、`dsh-providers-hub`、`billion-context`（均不入库，可随时按上文渠道重装）。

### `Dependency/` — 依赖项（运行时 + 服役文件）

自带运行时 + 从 `Archive/` 迁出的服役文件。**本工作区已不依赖系统安装的 Node.js**：

| 内容 | 用途 |
| --- | --- |
| `nodejs/` | **自带 Node.js v24.16.0**（复制自原 `C:\Program Files\nodejs`；已删除其 npm 内置的 `prefix=${APPDATA}\npm` 绑定，全局 `npm i -g` 落进本目录，pnpm@11.7.0 已装入其中）。启动×3 与更新共四个 bat 开头都执行 `set "PATH=%~dp0Dependency\nodejs;%PATH%"`，运行时取自这里而非系统 PATH |
| `.pnpm-store/` | pnpm 内容寻址存储，原 `D:\.pnpm-store` 同卷整体迁入（硬链接不失效，已有 node_modules 无需重装）。位置配置在 pnpm 11 的 `%LOCALAPPDATA%\pnpm\config\config.yaml`（`storeDir` 字段）——**删掉它 pnpm 会退回盘根默认、重建 `D:\.pnpm-store`** |
| `npm-cache/` | npm 下载缓存；`~/.npmrc` 的 `cache` 一行指向此处（首次缓存时自动生成，可随时整目录删除） |
| `patches/opencode-session-fix.patch` | ⚠️ **仍在服役**：session 跨域补丁（无 `x-opencode-session` 头网关返 400），上游至今未修，每次更新后要重放（见「本地改动与更新须知」）。**已入库本仓**（`.gitattributes` 标 binary 防行尾改写），跨机恢复可直接取用 |
| `patches/local-features-overlay.patch` | source 全部**其余**本地改动的兜底备份（2026-11-19 自 `2e39e70496`/rc.5 导出，63 文件约 +2000 行）：会话回收站（trash）、session-log 全模型上传开关、desktop 壳接线、liveshare 端点表、acp model-control 等；与上行互补（上行只含 llm-pi-ai/src）。重放 `git -C source apply ../Dependency/patches/local-features-overlay.patch`；本地改动演进后须重新导出（`git -C source diff HEAD -- . ':(exclude)packages/llm/llm-pi-ai/src'`）。**已入库本仓** |
| `scripts/`（`sync-opencode-go-models.mjs` + `opencode-go-model-meta.json` + `deps-stamp.mjs`） | ⚠️ **仍在服役**：启动/更新前零 Token 同步 OpenCode Go 模型目录、纠正 maxTokens（网关 1048576 总上限 vs DSH 压缩阈值）；`deps-stamp.mjs` 计算依赖指纹写入 `Dependency\.deps-stamp`（更新 bat 的增量安装判据）。同步脚本按「所在目录上跳两级 = 工作区根」定位，**必须保持 `scripts/` 子目录层级**，元数据 json 必须与脚本同目录。**均已入库本仓**，跨机恢复可直接取用 |
| ~~`dsh-ops-shells/`~~ | **已不存在**（2026-11-08 复核）：0.4 时代的 411MB PortableGit 2.56.0.2 Bash 载荷与 `~/.dsh/dsh-ops/shells/bash` 目录 junction 均已消失——0.5.0 稳定版起 Windows 默认执行器改为随包 Niubash v1.5.0 载荷，托管安装改落 `<DSH_HOME>/dsh-ops/`；如需 Git Bash 执行器，在 ops 设置页选择或 `node Plugins/dsh-ops/bin/dsh-ops.mjs bash-runtime git --path <路径>` |
| `tmp/` | 临时/诊断落脚点（不进启动链路），**用完即删或归档**（2026-11-17 清理后现存 **0 项**：providers-hub qoder WIP 备份 `ph-wip-resolved-on-de052dd.patch` 已删——该 WIP 早已固化为提交 `5c00fd7`，对应 stash×2 经核实冗余一并 drop） |

> **与系统 Node 的关系**：`C:\Program Files\nodejs`（系统 PATH）与 `%APPDATA%\npm`（用户 PATH，装有旧 pnpm）原样保留，其他软件不受影响，DSH 已完全不依赖它们。想彻底收编：在「设置 → 应用」卸载 Node.js（安装器自动清系统 PATH 条目），再从用户 PATH 删掉 `%APPDATA%\npm` 条目——`Dependency\nodejs` 已追加到用户 PATH 末尾兜底，新开终端的 `node / npm / pnpm` 即落到工作区内；手动跑命令也可直接用 `Dependency\nodejs\node.exe / npm.cmd / pnpm.cmd`。

### `Archive/` — 归档

2026-11-17 经两波清理后仅存更新/排障流程在用的探针四件套：

| 内容 | 状态 |
| --- | --- |
| `scripts/` probe 四件套（4 个 `.mjs` + 3 个 `.patch.yml`） | **仍在服役**的诊断探针：`probe-preset-roster.mjs` + `probe-preset-roster.patch.yml`（升级后跑 ROSTER 检查，用法见「本地改动与更新须知」#4）、`probe-preset-prompt-vars.mjs`（校验预设 persona 模板里的提示词变量能否渲染——上游 0.2.1 移除内置 `{{cwd}}` 后，未注册变量会让预设整轮失败，而 roster 探针查不出这类问题）、`probe-tool-inventory.{mjs,patch.yml}` 与 `probe-mcp-image-call.{mjs,patch.yml}`（工具挂载 / 生图 MCP 诊断） |

> **历史注记（2026-11-17 归档清理）**：本日分两波删除——①升级验证与备份残留：`ops-0.5.2-check`/`ops-0.5.4-check`（407MB）、`pre-plugin-update-20261111`（预更 git bundles）、`ag-*` dsh-antigravity 升级诊断物、`profile-web-backup-20261025`、`VN-工作流改造施工文档.md.bak`、旧更新 bat 两版备份；②历史归档全清：`Design/` 两份已实施设计文档、`Archive/Plugins/` 全部已移除插件备份（dsh-user-presets-slim、dsh-zcode-cli-proxy-removed 等）、`dsh-google-aistudio-main` 插件源码副本与 aistudio 三份 tgz、`gemini-relay/` 退役双通道脚本、VN 系历史文档 8 份（施工文档/说明自主目录移入后一并删除，现行规范见 `Plugins/dsh-user-presets/VN-工作流现行规范.md`）、sh 三件套、providershub 诊断转储、browser-sim.js；更早已消失的还有 `Character Encoding Test/` 与 `retired-orcamind.tar.gz`（旧 README 记载已失准）。服役中的补丁与同步脚本在 `Dependency/`。

### 其他根目录内容

| 内容 | 说明 |
| --- | --- |
| `Figure/` | 生图落盘目录：dsh-image-mcp 三工具的默认/指定输出位（`DSH-Images/` 等子目录由工具按需创建），产物随用随生成，2026-11-17 时为空 |
| `Workflows/` | 图像工作流留存（`moss-image/`、`qwen-image/`，ComfyUI 调试期产物） |
| `Reports/` | 独立诊断报告与调试产物：`qoder-no-response-diagnosis.md`（2026-10-25 选型期）、`预设约束互博成因与治理方案-20261110.md`（治理前成因调查，已补实施状态）、`预设约束互博治理后复查-20261110.md`（治理后第二轮复查，含 P0–P2 修复清单）、`预设约束复查-子代理报告/`（4 份分层精读全文）、`预设约束复查-修复脚本-20261110/`（用户授权全量修复后的脚本 / 精确替换日志 / 校验输出归档）；2026-11-08 的 2 份 `dump-config-*.json` 与 2 个 `.mjs` 一次性调试脚本已于 2026-11-14 清理 |
| `.gitignore` / `.gitattributes` | 入库范围规则（source、Dependency 大部、三方插件、node_modules/dist、凭据不入库；`patches/`+`scripts/` 例外放行）与行尾规则（`*.patch binary` 防 autocrlf 把补丁改写成 CRLF） |

## 启动 / 更新脚本（工作区根目录）

| 脚本 | 用途 |
| --- | --- |
| `启动-Harness.bat` | 常规启动：先同步 OpenCode Go 模型目录（`Dependency\scripts\`，尽力而为）→ 3080 已监听则直接开浏览器，否则经 `serve-harness.mjs` 起服务并 3 秒后自动开浏览器 |
| `启动-Harness-桌面版.bat` | 启动 OrcaMind 壳：优先 `desktop/dist/OrcaMind.exe`（兼容带版本号旧产物），未打包时自动装 Electron 走开发模式 |
| `启动-Harness-桌面版(开发模式).bat` | 以源码开发模式拉起 OrcaMind 壳（直接运行 `desktop/` 源码，改动即时生效，支持 DevTools 审查） |
| `启动-官方桌面端.bat` | 从 `source/apps/desktop` 以 dev 模式跑官方 Electron 桌面端（源码 runtime 才带本地补丁；**打包版 runtime 不带，OpenCode Go 会 400**）。首次会经 npmmirror 下载 Electron |
| `更新-Harness.bat` | 更新 `source/`：四镜像 fallback 拉取仓库，检测运行中服务（OrcaMind 壳需先完全退出），`fetch --depth 1` + `stash` → `reset --hard FETCH_HEAD` → `stash pop`，然后安装依赖（只跑一次）→ build（失败才 clean 重建）→ **逐 profile 同步 OpenCode Go 模型目录**（web/desktop/headless，无路由的自动跳过）。**2026-11-05 重写为纯 ASCII 英文输出**：不再依赖 `chcp 936`/GBK，任何编辑器或工具可直接改，中文 Windows/代理终端下永不乱码；旧 GBK 版与 11-04 版 UTF-8 草案备份已随 2026-11-17 归档清理删除。冲突处理升级为**自动恢复循环**：①启动预检发现 UU 残留不再拒绝执行，而是进入等待（上限 30 分钟）——在另一终端把冲突解干净（`git add` 标记解决）后脚本自动检测、自动 `add -A`、自动 drop 冗余 auto-stash、自动续建；②树干净但有孤儿 auto-stash 时自动 `stash pop`（撞冲突同样进恢复循环）；③恢复完成与构建前都跑 `git grep` **冲突标记扫描**（`<<<<<<<`/`>>>>>>>`），半解状态绝不进入构建（2026-10-26 事故根因防线）；④**`cd /d "%~dp0%SRC%"` 幂等绝对路径**：修复安装路径上第二次相对 `cd source` 报"系统找不到指定的路径"的潜伏 bug（新旧版本都有，仅日志噪音，构建不受影响）；⑤detached HEAD 时回退抓 `master`。保留：依赖指纹跳过（`Dependency\.deps-stamp`）、失败 `pause` 后退出码 1、结尾打印 commit+版本号、克隆目标非空先确认再删、git rerere（同形状冲突自动复用）。改脚本须知：**`if (...)` 块内的 echo/REM 文本严禁出现 ASCII 括号**（解析期即炸，块不执行也炸；全角括号安全），行尾保持 CRLF、纯 ASCII |
| `重启-Harness.bat` | 重启服务；OrcaMind 壳在跑时提示由壳自己重启 |
| `open-opencode-go-models.bat` | 记事本打开 pi-ai 内置的 OpenCode Go 模型目录 `source/packages/llm/llm-pi-ai/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json` |

## 本地改动与更新须知

更新（`更新-Harness.bat` 或手动）会 `reset --hard`，以下东西要留意：

1. **session 补丁**（必须，否则 OpenCode Go 请求全 400）：已在工作树中（stash 流自动携带，无需重放）。上游 4 参 `requestHeaders(profile.headers, options, model.baseUrl, prepareHeaders)` 之上外层叠加 `openCodeSessionHeaders(model, sessionId)`（2026-11-04 对 `8bd073392e`/0.2.2-alpha.3 重并；2026-11-13 对 `e8f7b93a34`/0.2.2-rc.2 重并——rc.2 在该调用上追加了 `prefixDigests` 实参并新增 `bindThinkingToPrefix` 块，sessionId 行插在其后；2026-11-14 对 `39163dd30`/0.2.2-rc.3 随 stash 流自动并回、无冲突；2026-11-18 对 `ca33fd684`/0.2.2-rc.4 与 2026-11-19 对 `2e39e70496`/0.2.2-rc.5 亦均随 stash 流自动并回、无冲突）。重放兜底补丁已重新生成并**入库本仓**：`git -C source apply ../Dependency/patches/opencode-session-fix.patch`（`git diff HEAD -- packages/llm/llm-pi-ai/src` 导出；跨机恢复可直接取用）；验证 `grep -c x-opencode-session source/packages/llm/llm-pi-ai/lib/index.js` 应 ≥2。**pi-ai 1.3.0 目录变更**：`omen-alpha` 已不在 opencode-go 内置目录，测试/脚本需用现役模型 id（如 `glm-5.3`）。
2. **liveshare 端点分类闸门**（0.2.2-alpha.2 起新增）：本地会话回收站功能在 workspace-controller 每加一个 Remote 端点，必须同步在 `packages/experimental/liveshare/src/endpoint-classification.ts` 的 `VIEWER_ENDPOINT_CLASSES` 表补一行（破坏性会话操作用 `owner-only`），否则 client 编译门 `TS1360` 失败（2026-10-31 已为 `workspace/deleteSession`/`workspace/trashSession` 补录）。
3. **模型目录纠正**（maxTokens / 新模型补录）：`node_modules` 重建后纠正丢失，更新后手动重跑 `node Dependency/scripts/sync-opencode-go-models.mjs`（按 `DSH_PROFILE` 生效，默认 web；**web 现已无 opencode-go 路由，会打印"[patch] 找不到段落"属正常**——desktop 仍有路由需同步，更新 bat 已改为逐 profile 循环）。
4. **自建预设**：在 `Plugins/dsh-user-presets/`，不在 `source/` 里，更新不碰；但目录挪动会破坏其中的绝对路径。上游每次升级都要留意预设声明的**已删除字段**：0.2.1 起 `tool-subagent` / `tool-subagent-fork` 拒绝 `toolFilter` 与 `persona`，残留会让预设挂载失败、新会话创建报 `agent-preset/invalid`（2026-10-15 已清 26 处）；升级后跑 `Dependency/nodejs/node.exe source/apps/cli/lib/bin.js web --patch Archive/scripts/probe-preset-roster.patch.yml --port 3099 --no-open` 看 ROSTER 是否全部 ok（2026-10-31 全量 17/17 ok）。
5. **组行与子行严禁同 id**（2026-10-21 事故：`comfyui-work` 的 `cordis:group` 被写成 `id: plan-mode` 与子项同名，Loader 复用同一 store 槽位使条目自引用，DSH 启动静默挂起且 CPU 满转；正确写法是组 `id: planning`、子项 `id: plan-mode`）。
6. 流程要点：依赖只装一次（失败看日志，不反复重试）；构建失败先看是不是真错误（陈旧产物才 clean 重建；clean 报 exit 1 是上游 bug，以 BUILD_EXIT=0 为准）；输出经管道会掩盖退出码，用 `> log 2>&1; echo EXIT=$?`。**stash pop 冲突时脚本进入自动恢复循环**（2026-11-05 起）：改动安全保留在 stash@{0}，在另一终端解完 UU 文件并 `git add` 后，脚本会在 30 分钟窗口内自动检测 → `add -A` → drop 冗余 stash → 续建，无需重跑；rerere 会自动复用已解过的同形状冲突（但上游每次改到冲突文件都会生成新形状，每个版本仍需人工/代理解一轮）。本地会话回收站功能常驻未提交（连同全部其余本地改动的兜底备份已导出至 `Dependency/patches/local-features-overlay.patch`，改动演进后须重新导出）：2026-11-05 合入 rc.1 时上游把菜单触发器重构成 `renderFactorySlot('contextMenu.button')` 工厂并删除 `openSessionMenu` prop，本地 trash 键盘删除（`isInputTarget` + Delete/⌘Backspace）已在新架构上重接线，见 ui-workspace `Rows.tsx`/`WorkspaceBrowser.tsx`。当前 source 在 master `e8f7b93a34` = **v0.2.2-rc.2**（2026-11-13；rc.1→rc.2 依赖变更 libreoffice-kit 0.1.5→0.2.3、新增 stagehand 4.4.0，指纹机制自动单次增量安装 +26/-17；rc.2 上游新增 `session-archived`/`session-unarchiving` 契约事件与 RowToast `message`/`tone` 字段、adapter 新增 `bindThinkingToPrefix`，trash 补丁四处冲突均并回，另需在 SessionTree 实例化处显式传 `useRemoteAccess`）。当前 source 在 master `39163dd30f` = **v0.2.2-rc.3**（2026-11-14；lockfile +1371/-255 指纹失配，手动增量安装一次约 3 分钟；rc.3 新增实验性 DeepSeek 会话导入插件、修 Windows 桌面版应用内更新；stash pop 冲突 5 处已解并录 rerere——commands.ts 三 import 并存、slots.ts RowToast 双成员、apply/rename-assembly 两测试数组双保留、shortcuts 仅 EOF 空行取上游；trash 补丁测试另按 rc.3 类型修 4 文件：branded id 直呼改 `brandString<SessionId/ReasoningEffortId>()`、rows 测试 SessionNode 补 `failed: false`，构建 run-gates 10/10 通过）。当前 source 在 master `ca33fd684` = **v0.2.2-rc.4**（2026-11-18；上游 release squash 大波次 3104 文件 +88k/-31k，16 个本地改动文件被波及但 stash pop 全部 hunk 级自动并回、零冲突，lockfile 未变指纹跳过安装，构建全绿）。当前 source 在 master `2e39e70496` = **v0.2.2-rc.5**（2026-11-19；上游 960 文件、与本地 64 文件零交集 stash pop 干净；lockfile +140/-15 指纹失配增量安装一次 15.7s，新增 connector/linear 与 connector/notion 工作区包；内容主打 forge 代码评审页、notion/linear 连接器、session SQLite 组提交性能、web 搜索默认 DeepSeek 模型、Windows 安装器拖拽修复；run-gates 10/10 通过），跑 `更新-Harness.bat` 会跟 master 走（含本地改动自动 stash/pop 与冲突自动恢复）。
7. **OAuth client 凭据文件（本机专属，不入库）**：Antigravity 公共 client 身份于 2026-11-17 从三处源码内嵌改为外置——`Plugins/dsh-antigravity/oauth-client.local.json`、`Plugins/dsh-image-mcp/oauth-client.local.json`、`desktop/oauth-client.local.json`（三份同内容，已被 .gitignore 排除）。缺文件时：antigravity token 刷新失败（`ANTIGRAVITY_CLIENT_ID/SECRET` env 可兜底）、image-mcp 的 NB2 Lite 工具不可用（`DSH_IMAGE_CLIENT_ID/SECRET` env 可兜底）、OrcaMind 壳内 Antigravity 刷新失败。跨机恢复时需重建这三份文件（客户端凭据非用户密钥，用户令牌仍在 `~/.dsh/storages/antigravity-oauth.json`）。
8. **跨机恢复概要**（2026-11-18 起 `patches/`、`scripts/` 已入库，本地改动补丁不再依赖本机 stash）：① clone 本仓到**同路径** `D:\Tools\DeepSeek Harness`（预设 skills、desktop.config.json 等绝对路径硬编码，路径必须一致）；② 重建三份 `oauth-client.local.json`（见 #7）；③ 浅克隆官方 `source/`，`git apply` `Dependency/patches/` 下两个补丁；④ 重建 `Dependency/` 运行时（Node → pnpm storeDir → source 装依赖 + build），dsh-ops 装后重放 ctx.root 补丁（22 处 `ctx.root` → `ctx[Symbol.for('cordis.root')]`）、providers-hub 从 Gitee fork 重装（本地合并成果不在库）；⑤ 迁 `~/.dsh`（`profiles/web/` 的 cordis.patch.yml + package.json `link:` 接线 + storages 登录态，整目录拷贝）。`desktop/dist/` 的 exe 不入库，未打包时「启动-桌面版」bat 自动走开发模式。

## 文档索引

工作区有三处文档库（`docs/`、`Plugins/docs/`、`Reports/`），按用途分工，新增文档请归入对应位置并在下表登记：

| 文档 | 位置 | 内容 |
| --- | --- | --- |
| `Ops与Billion-Context配置安装指南.md` | `docs/` | dsh-ops 与 billion-context 的安装、`cordis.patch.yml` 配置模板（已与 dsh-ops 0.3.1 / billion-context 0.1.201 实际行对齐）、junction 重定向做法、自动更新修复、高频报错排查。**⚠️ 内容停在 0.3.1 时代**：0.5.0 起七行组件制已改单行 `dsh-ops` 配置，模板须自行换算，升级史见 Plugins 表 dsh-ops 行 |
| `Ops与Billion-Context技术架构与排坑指南.md` | `docs/` | 2026-10-20：Ops 与 DSH 原生环境的核心分工、读写/终端行为边界深剖 + Billion-Context×Antigravity/Gemini 兼容性全景与修复路线（0.3.1/0.0.5 时代产物；其二三章与下方专项指南同题，同日产出、互为详略） |
| `Billion-Context与Antigravity-Gemini兼容性专项分析与修复指南.md` | `docs/` | 2026-10-20 专项：10-19 Gemini 调用瘫痪全链路复盘（Google 空帧 → bili 503 → TRANSPORT）、compress/acp_status 404 根因（会话生命周期绑定 + 透传副作用）、修复方案论证 |
| `billion-context-guide.md` | `docs/` | Billion-Context (ACP) 核心机制缺陷深度剖析与避坑指南（v0.1.200~0.1.203+）：growthFloor 数学坍塌致上下文锁死 10% 以下、KV cache 归零与耗时暴增、`neverPreserveRecentTools` 工具黑名单、思考断裂归因等；基于 9.5MB 会话日志与内核源码 |
| `ProvidersHub与ZCodeCliProxy接入指南.md` | `docs/` | ZCode / Trae / Qoder 额度双轨接入（2026-10-25）：Provider 轨 dsh-providers-hub（17 家 + 聚合路由 + 签到 + 8326 网关）与委托轨 dsh-zcode-cli-proxy（Start Plan + ZCode 原生 agent，yolo 风险提示）、登录/验证流程、npm 同名包投毒警告、回滚与选型记录 |
| `MagiCrew国际站WAF封锁调查报告-20261106.md` | `docs/` | magicrew 国际站「签到/余额 405 双灭」全程调查（11-05~11-06）：referer 缺失修复（cherry-pick PR #176）与阿里云 ESA WAF 三连跳时间线、13 项实测矩阵（curl/Node 全模拟/**真实 Chrome 带凭据也 405**，主站与国内站对照）、阻断页特征、出口 IP 拉黑 vs 站点事故的判别实验与恢复清单、一行自查命令 |
| `SenseNova模型使用指南.docx` | `docs/` | 商汤 SenseNova Token Plan 公测通道使用指南（五个模型怎么选、思考强度下拉怎么调、429 报错怎么处理；2026-11-17 自主目录移入） |
| `sensenova-report.md` | `docs/` | 2026-10-23 SenseNova Token Plan API 能力调研（信源分级标注）：端点、OpenAI/Anthropic 双协议支持矩阵、额度池等——上方 docx 的调研底稿 |
| `预设约束互博成因与治理方案-20261110.md` | `Reports/` | 预设使用时「左右脑互博」消耗变多的成因调查（2026-11-10，**治理前 6178 行版**）：DSH 源码层无指令优先级机制（纯 order 排序 + join）、11-07 VN 改造删掉用户指令逃生阀并全量绝对化、77 处重复硬约束与 5 类逻辑矛盾、运行时宪法 + 消除矛盾 + 结构性减重三层治理方案 A/B/C（B6 已于复查后补做、C3 Host 物理门禁仍未实现，见复查报告 §9 修复实施状态） |
| `预设约束互博治理后复查-20261110.md` | `Reports/` | 治理后（**5699 行版**）第二轮全量复查（2026-11-10）：20 个 preset / 164 份 SKILL.md / 7 份文档，4 个子代理分层精读 + 机械全量扫描；结论为「宪法段自洽、但 VN7 阶段 SKILL 仍有 6+ 组运行时真矛盾（anchors 四节两套定义、核查范围互斥、10 处末位 ask 收尾残留等）、大规模整块复制、两份历史文档仍以现在时下命令」，含 P0–P2 修复优先级与 **§9 修复实施状态（用户授权后已全部落地）** |
| `skills/_SYNC-POLICY.md` | `Plugins/dsh-user-presets/skills/` | 同源副本同步政策（2026-11-10 复查后建立）：登记 6 组逐字节相同 / 派生 SKILL.md 与 7 份宪法段，说明 Loader 每 preset 独立挂载、不能删单侧，给出改前查表 / 改后 md5 校验守则；末尾标注 `prompt-writing/` 孤儿树的文档库定位 |
| `VN-工作流现行规范.md` | `Plugins/dsh-user-presets/` | VN 七预设的唯一现行规范入口（2026-11-10）：指令裁决宪法、七预设目录表、默认每轮节奏、README 双区状态机、跨阶段边界、已废止设计清单；取代长篇施工文档（已删内嵌旧 skill 草案），运行时以 7 个 persona prefix + `vn-shared` 三份 SKILL.md 为准 |
| `插件审查报告-2026-10-18.md` | `Plugins/docs/` | 当日对 web profile 227 行配置 + 12 个自装 bundle + 13 个本地插件目录 + 2 个 MCP 服务器的逐项体检结论（含 dsh-ops 0.3.1 的取舍理由与 13 处误判澄清，§11 记录换包） |
| `插件审查报告-2026-10-18-补充.md` | `Plugins/docs/` | 同日晚间复查：升级 billion-context 至 0.1.201、修自动更新与 provider retryPolicy、清理旧插件与 652MB 死物、文档勘误 |
| `插件开发指南.md` | `Plugins/docs/` | 自研插件的目录结构、Cordis 注册约定、bundle patch 与调试方式 |
| `插件装卸使用指南.md` | `Plugins/docs/` | 日常安装/卸载/升级/回滚流程 |
| `DSH刷B站插件调研报告.md` | `Plugins/docs/` | 独立插件调研文档（B 站自动化方向，未实施；2026-11-17 自主目录移入） |

> 判据：**配置/排障类**放 `docs/`；**插件相关**（审查报告、开发、装卸）放 `Plugins/docs/`；**设计规范**未完成在根目录、定稿后视价值并入现行文档或删除（2026-11-17 起不再设 `Archive/Design/`）。三处互不重复，挪动文件须同步本表。

## 相关笔记

跨会话的踩坑与配置细节记录在 ZCode 项目记忆中（OpenCode Go maxTokens 约束、0.1.7 设置/预设迁移、Gemini provider 路线、更新流程等），此处不重复展开。
