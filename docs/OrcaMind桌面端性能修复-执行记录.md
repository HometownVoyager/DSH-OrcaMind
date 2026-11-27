# OrcaMind 桌面端性能修复 —— 执行记录（2026-11-27）

> 依据 `docs/OrcaMind桌面端性能与风扇问题-审计与修复指南.md` 落地。本文记录实际改了什么、怎么验证的、以及**没做**什么。

## 一、已落地清单

| 指南条目 | 状态 | 改动位置 |
|---|---|---|
| 4.1 GPU 策略（P0） | ✅ | `desktop/desktop.config.json`、`desktop/main.js` |
| 4.2 翻译浮窗隐藏后销毁（P0） | ✅ | `desktop/main.js` |
| 4.3 后端目录拉取重试（P0，壳外） | ✅ 部分 | `Plugins/dsh-providers-hub/src/magicrew-adapter.ts`（+ 编译到 `lib/`） |
| 4.4 启动页 CSS 动画（P1） | ✅ | `desktop/shell-theme.css` |
| 4.5 托盘关闭语义（P2） | ✅ 最小+中档 | `desktop/main.js`、`desktop/shell-i18n.js` |
| 4.6 就绪轮询指数退避（P2） | ✅ | `desktop/main.js` |
| 4.7 日志同步写盘降频（P2） | ✅ | `desktop/main.js` |
| 4.8 preload 模型探测去重（P3） | ✅ | `desktop/preload.js` |
| 4.9 TTS 音频块解析（P3） | ✅ 部分 | `desktop/tts-service.js`、`desktop/main.js` |

## 二、各项实际行为

### 4.1 GPU 策略
- 新增 `desktop.config.json` 的 `gpuMode`：`auto`（默认，不加任何开关）/ `software`（`use-gl=swiftshader` + `disable-gpu-compositing`）/ `disabled`（`disableHardwareAcceleration()`）。也可用环境变量 `DSH_GPU_MODE` 覆盖。
- 应用在模块顶层、`app.whenReady()` 之前（`disableHardwareAcceleration` 的硬性要求）。
- 启动时把 `app.getGPUFeatureStatus()` 写进 `main.log`（`[gpu] mode=… featureStatus=…`），用于判断是否发生了软件渲染回退——原来完全没有检测手段。

### 4.2 翻译浮窗
- 新增 `scheduleTranslateTeardown()` / `cancelTranslateTeardown()`：失焦隐藏或 `translate-close` 后 **30 秒**未再用就 `destroy()`，渲染进程与透明合成表面一并释放；`showTranslateWindow()` 开头取消回收，`closed` 事件清空引用。
- `sandbox: false → true`（浮窗只用 preload 桥）。
- **未做**（需 UI 回归）：去掉 `transparent` / `alwaysOnTop`。这两项才是持续合成开销的根本，隐藏后销毁已经把它们的常驻时间压到 30 秒。

### 4.3 后端目录拉取（壳外，真根因之一）
排查结论：指南说的「无退避重试」在当前代码里**已部分过时** —— `magicrew-adapter.ts` 已有 60 秒负缓存（`catalogFailedAt` + `product.catalogRetryMs`）与 in-flight 单飞去重。真正缺的是**连续失败不退化**：业务码 2155/6008 这类持续故障下，它每分钟稳定失败一次，一天上千次无效 GET + 上千条 warn。
本次最小修复：
- 连续失败指数退避：60s → 120s → 240s → … → **30 分钟封顶**（`catalogFailStreak` + `catalogRetryDelayMs()`）。第一次失败仍是 60s，上游一次抖动不受惩罚；成功或手动刷新即归零。
- 失败时追加一条「N 次连续失败、X 秒内不再重试」的 warn，原有 `目录拉取失败` 文案逐字保留（不破坏既有排查脚本）。
- 总开关：`DSH_MAGICREW_REMOTE_CATALOG=off` 时完全不发起远端目录 GET，只用上次快照/静态表（缺省照常）。
- 覆盖国内站与国际站（同一个适配器类、两个 product 常量）。
- **未做**：其他 provider 的定时拉取未逐一审计；「关闭自动目录刷新」的全局 UI 配置项未加（需动 cordis 配置面，超出最小修复范围）。

### 4.4 启动页 CSS
- `.shell-grid`：删掉 `grid-drift`（`background-position` 是 paint 属性，在约 270% 视口 + mask 的图层上每帧重绘），网格改静态。
- `.shell-scan`：`top` 动画 → `transform: translateY()`（合成器），加 `will-change`。
- `.shell-card`：`backdrop-filter: blur(20px)` 移除（错误页会长时间停留，且 `prefers-reduced-motion` 管不到它），背景不透明度 0.82/0.86 → 0.94/0.95 保证可读性。
- 低成本项（whale/breathe/badge）保持原样。

### 4.5 托盘语义
- 托盘退出项按 `attachMode` 分流文案：「完全退出（含本程序拉起的后端）」/「退出 OrcaMind（不停止已在运行的服务）」，并写日志。
- 收进托盘时显式 `setBackgroundThrottling(true)` + 停止朗读。
- **未做**：隐藏 N 分钟后销毁主窗口（较大改动）。

### 4.6 就绪轮询
- 新增共享的 `waitForServerReady(token)`：250ms 起步、×1.6 退避、2s 封顶；`bootstrap()` 与 `restartServer()` 两处循环都去重到它。
- `BOOT_TIMEOUT_MS` 取 **45s** 而非指南建议的 30s：实测本机冷启动通常 9–12 秒、最慢样本 28 秒（`main.log`），30s 会把慢启动误判成失败。45s 内探测次数从约 90 次降到约 25 次。
- `targetUrl()` 的 250ms/5s 轮询保留（指南允许）。

### 4.7 日志
- `log()` 改为内存队列 + **1 秒批量** `appendFileSync`；文件大小在内存累计，不再每条 `existsSync + statSync`；5MB 轮转只在批量写盘时判断一次。
- 退出前 `flushLogsSync()`（`before-quit` + `process.on('exit')`），定时器 `unref()` 不拖住退出。

### 4.8 preload
- `active-model-changed` 加 `lastNotifiedModel` 去重（原来每次 mouseup/click 都发 IPC）；顺手给 `locale-changed` 也加了同样的去重。

### 4.9 TTS
- `ws.onmessage` 的音频块做类型归一化：ArrayBuffer / Buffer / Blob 三种形态都支持（原实现无条件 `event.data.arrayBuffer()`，拿到 Buffer 就逐块抛错并被空 catch 吞掉 = 音频全丢、永远降级本地语音）。
- 解析失败计数并**进 `main.log`**：`synthesizeEdgeTts` 新增可选 `logger`，`main.js` 两个调用点都传入；空音频的报错会带上「N 个块解析失败」。
- **未采纳**指南的「base64 作为 `executeJavaScript` 第三参传入」：Electron 的 `webContents.executeJavaScript(code[, userGesture])` **没有第三个参数**，该写法不成立。音频注入维持现状（一次性开销，不是持续负载）。

## 三、验证结果

- `node --check`：`desktop/main.js`、`preload.js`、`tts-service.js`、`shell-i18n.js`、编译后的 `lib/magicrew-adapter.js` 全部通过。
- 打包：`npm run dist` 成功；旧 exe 备份为 `desktop/dist/OrcaMind.exe.bak-pre-perf-fix-20261127`。
- 产物校验：`desktop/scripts/verify-package.js`（本次补充了性能项断言）→ **ALL PACKAGED CHECKS PASSED**，确认 asar 里真的带上了 GPU/退避/销毁/日志改动，且 `POLL_INTERVAL_MS`、`animation: grid-drift`、`backdrop-filter: blur(20px)` 无残留。
- 视觉：`loading.html` 已渲染截图确认正常（`desktop/preview-perf-loading.png`）。错误页**加载正常**，但预览脚本的 `capturePage()` 报 `UnknownVizError`（合成器截图问题，非页面错误）⇒ 错误页截图未产出。
- 后端：`magicrew-adapter.spec.ts` **29/29 通过**（含新增退备用例）。
- 变异验证（本仓纪律，确认新用例不是假绿）：
  | 变异 | 结果 |
  |---|---|
  | 去掉 30 分钟封顶 | ✅ 变红（`expected 6 to be 7`，正好落在封顶那一格） |
  | 退避退回固定 60s | ✅ 变红（`expected 3 to be 2`，120s 窗口内被重发） |
  | 删掉成功时的 streak 归零 | ✅ 变红 —— 但**第一版用例是假绿**：成功走了 `refresh()`，被它自己的清零掩盖；已改为让负缓存自然到期后拉成功，变异才红 |

## 四、要注意的两点

1. **改动要重启才生效**：桌面壳用新打包的 `desktop/dist/OrcaMind.exe`；插件改动在 `lib/`（已 tsc 编译，`lib/` 本身被 .gitignore），需要重启 harness 后端服务。另：`tsc` 会连带把 `src/` 里既有的未提交改动（如 `doubao-upstream.ts`）一并编译进 `lib/`，这是全量 tsc 的固有行为。
2. **attach 语义不变**：后端若是壳启动前就在跑的（attach 模式），退出时按设计不回收——「关窗后服务还在」在这种情况下是预期行为，托盘菜单文案已写明。

## 五、后续可做（本次未做）

- 任务管理器确认风扇负载究竟在 `OrcaMind.exe` 还是 `node.exe`，决定是否需要进一步压后端其他 provider 的定时任务。
- 翻译浮窗去透明/去置顶（需目视回归）。
- 托盘隐藏超时后销毁主窗口；「关闭自动目录刷新」的全局 UI 开关。
- 后端进程链回收核查：`killServer()` 的 `taskkill /T` 是否覆盖孙进程。
