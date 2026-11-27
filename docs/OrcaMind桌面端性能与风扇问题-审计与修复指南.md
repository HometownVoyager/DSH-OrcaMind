# OrcaMind 桌面端性能/风扇问题 —— 审计结论与修复指南

> 面向后续会话的执行文档。本文记录 2026-11-27 对 `desktop/`（OrcaMind Electron 套壳）的精细分领域审计结果，并给出可直接落地的修复步骤、代码补丁与验证方法。
>
> 一句话结论：**套壳里没有失控的 JS 循环**；可见的壳侧浪费集中在「启动页逐帧重绘的 CSS 动画」和「透明置顶翻译窗只隐藏不销毁」，而真正「关了窗口还在转」的持续负载来自**脱离桌面端常驻的 harness Node 服务及其插件的定时目录拉取**，以及**完全没有 GPU 策略**导致的环境相关回退。

---

## 目录

- [1. 背景与范围](#1-背景与范围)
- [2. 证据基线（审计时的现场状态）](#2-证据基线审计时的现场状态)
- [3. 根因总表](#3-根因总表)
- [4. 逐项修复指引](#4-逐项修复指引)
  - [4.1 P0-A 增加明确 GPU 策略](#41-p0-a-增加明确-gpu-策略)
  - [4.2 P0-B 翻译浮窗隐藏后销毁](#42-p0-b-翻译浮窗隐藏后销毁)
  - [4.3 P0-C 后端常驻与插件定时拉取（范围在 desktop 之外）](#43-p0-c-后端常驻与插件定时拉取范围在-desktop-之外)
  - [4.4 P1 启动页 CSS 动画改为合成器友好](#44-p1-启动页-css-动画改为合成器友好)
  - [4.5 P2 托盘关闭语义与生命周期](#45-p2-托盘关闭语义与生命周期)
  - [4.6 P2 就绪轮询改指数退避](#46-p2-就绪轮询改指数退避)
  - [4.7 P2 日志同步写盘降频](#47-p2-日志同步写盘降频)
  - [4.8 P3 preload 活跃模型探测去重](#48-p3-preload-活跃模型探测去重)
  - [4.9 P3 TTS 小 bug](#49-p3-tts-小-bug)
- [5. 明确排除的假设](#5-明确排除的假设)
- [6. 推荐执行顺序与验收](#6-推荐执行顺序与验收)
- [7. 快速诊断命令速查](#7-快速诊断命令速查)

---

## 1. 背景与范围

用户主诉：**开启桌面端时风扇转速大幅提升**。

审计对象：`D:\Tools\DeepSeek Harness\desktop\` 下的 OrcaMind 套壳，以及根目录启动脚本、运行时日志与进程状态。

已逐行通读的文件：

| 文件 | 行数 | 结论 |
|---|---|---|
| `desktop/main.js` | 2375 | 主进程，无死循环；GPU 零配置；翻译窗只隐藏不销毁 |
| `desktop/preload.js` | 149 | 有主题去重，但活跃模型探测无去重（轻微） |
| `desktop/preload-translate.js` | 31 | 干净 |
| `desktop/tts-service.js` | 449 | 干净；打开应用时根本不调用 |
| `desktop/translate.html` | 2021 | 无 setInterval/Observer 泄漏；少量条件性动画 |
| `desktop/loading.html` | 142 | rAF 进度动画自终止，非死循环 |
| `desktop/error.html` | 86 | 复用 shell-theme.css 动画 |
| `desktop/shell-theme.css` | 444 | **6 条无限动画 + 大面积 backdrop-filter** |
| `desktop/shell-i18n.js` / `shell-i18n.client.js` | 106 / 64 | 纯字符串查表，干净 |
| `desktop/package.json` / `desktop.config.json` | 62 / 4 | Electron ^43.4.0；无 GPU 相关配置 |

三个并行领域审计（Electron/GPU、前端渲染、TTS）一致确认：**没有 `setInterval`、没有永不清除的定时器、没有崩溃重启循环、没有监听器泄漏**。不要把这些当作原因去查。

---

## 2. 证据基线（审计时的现场状态）

以下数字来自现场，后续会话可重新采集对比（命令见第 7 节）：

- 日志：`C:\Users\HometownVoyager\AppData\Roaming\OrcaMind\main.log`，18973 行 / 约 2 MB。
  - `magicrew 目录拉取失败`：**2743 次**
  - `model listing`：**1074 次**
  - `OrcaMind 启动`：**322 次**（历史重启极其频繁）
  - 目录拉取失败呈约 10 分钟一次的突发，每次连发 3–6 条重试；审计当日 14:05 仍在发生。
- `close-behavior.json` = `{"closeBehavior":"quit"}`（当前关窗会退出；若为 `tray` 则会常驻）。
- 进程快照（审计时）：**没有任何 Electron/OrcaMind 进程在运行**，但以下 Node 进程仍在：
  - PID 5860 `node "serve-harness.mjs" --port 3080`
  - PID 404 `node "...\source\apps\cli\lib\bin.js" web --no-open --port 3080`
  - PID 16456 `Plugins/dsh-image-mcp/server.mjs`
  - PID 18264 `source\packages\subprocess\subprocess-local\lib\runner.js`
  - 结论：桌面端退出后整条后端服务链仍存活，模型目录定时拉取仍在跑。

---

## 3. 根因总表

| 编号 | 优先级 | 领域 | 问题 | 持续性 | 是否在套壳内 |
|---|---|---|---|---|---|
| F1 | P0 | Electron/GPU | 零 GPU 策略，SwiftShader 自动回退无检测/无开关 | 打开后持续 | 是 |
| F2 | P0 | 窗口 | 透明+置顶翻译窗只 `.hide()` 不 `.destroy()` | 用过翻译后持续 | 是 |
| F3 | P0 | 后端/插件 | 模型目录定时拉取重试 + 服务进程脱离壳常驻 | 关窗后仍持续 | **否（在 source/ 与插件）** |
| F4 | P1 | 启动页渲染 | 6 条无限 CSS 动画，网格动画逐帧重绘大遮罩层 | 启动数秒 | 是 |
| F5 | P2 | 生命周期 | 托盘关闭隐藏窗口但不停止渲染/后端 | 用户"关了"仍持续 | 是 |
| F6 | P2 | 启动编排 | 500ms 就绪轮询 + 人为拉长动画 | 启动期 | 是 |
| F7 | P2 | 日志 | 每条 server 输出同步 `statSync`+`appendFileSync` | 突发时卡顿 | 是 |
| F8 | P3 | preload | 每次鼠标点击都发 `active-model-changed` IPC，无去重 | 轻微持续 | 是 |
| F9 | P3 | TTS | 空 catch 吞掉音频块解析错误 | 仅朗读时 | 是 |

---

## 4. 逐项修复指引

### 4.1 P0-A 增加明确 GPU 策略

**位置**：`desktop/main.js:55` 附近（`const config = loadConfig();` 之后），以及 `desktop/desktop.config.json`。

**问题机制**：全文件搜索 `disableHardwareAcceleration` / `appendSwitch` / `hardwareAcceleration` / `use-gl` **零命中**。在虚拟机、RDP、旧驱动环境下 Chromium 会自动回退 SwiftShader（软件渲染），合成走 CPU；而 `dist/win-unpacked/vk_swiftshader.dll` 是每个 Electron 应用都自带的标准文件，**不是代码主动启用的**——不要误判为「壳强制 SwiftShader」。真正的问题是缺乏检测和缓解开关。

**补丁**：

1) `desktop.config.json` 增加字段：
```json
{
  "DSH_ROOT": "D:/Tools/DeepSeek Harness",
  "port": 3080,
  "gpuMode": "auto"
}
```
取值：`auto`（默认，不动）、`software`（强制软件渲染，适合虚拟机/RDP）、`disabled`（`disableHardwareAcceleration()`，完全关 GPU）。

2) `main.js` 在 `loadConfig()` 返回对象里带上 `gpuMode`，并在模块顶层、`app.whenReady()` **之前**应用（关键：`disableHardwareAcceleration` 必须在 ready 前调用）：
```js
const config = loadConfig();

if (config.gpuMode === 'software') {
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else if (config.gpuMode === 'disabled') {
  app.disableHardwareAcceleration();
}
```

**验证**：切换 `gpuMode` 后重启，用任务管理器比较 `OrcaMind.exe` 的 GPU 引擎占用；在 DevTools 的 GPU 信息页确认渲染后端。`auto` 保持不变作为对照。

---

### 4.2 P0-B 翻译浮窗隐藏后销毁

**位置**：`desktop/main.js:765–815`（`ensureTranslateWindow`）、`main.js:808–813`（blur）、`main.js:2272–2276`（`translate-close` IPC）；窗口创建参数在 `main.js:767–785`。

**问题机制**：`transparent: true`（773）、`frame: false`（772）、`alwaysOnTop: true`（776）强制每帧与桌面 alpha 混合，`alwaysOnTop` 还破坏遮挡检测优化；透明窗口必须由合成器持续处理。blur 与 close 都只做 `.hide()`，渲染进程和合成表面保留到会话结束——用过划词翻译后负载永久存在。

**补丁**：

1) 增加隐藏后延迟销毁的 helpers（放在 `let translateWin = null;` 附近，约 `main.js:763`）：
```js
let translateHideTimer = null;
function scheduleTranslateTeardown() {
  clearTimeout(translateHideTimer);
  translateHideTimer = setTimeout(() => {
    translateHideTimer = null;
    if (translateWin && !translateWin.isDestroyed() && !translateWin.isVisible()) {
      try { translateWin.destroy(); } catch (_) {}
      translateWin = null;
    }
  }, 30000); // 隐藏 30 秒后回收
}
function cancelTranslateTeardown() {
  clearTimeout(translateHideTimer);
  translateHideTimer = null;
}
```

2) blur handler（`main.js:808–813`）在 `translateWin.hide();` 后追加 `scheduleTranslateTeardown();`。

3) `translate-close` IPC（`main.js:2272–2276`）同样追加 `scheduleTranslateTeardown();`。

4) `showTranslateWindow()`（`main.js:817–884`）开头调用 `cancelTranslateTeardown();`，确保复用窗口时不会被回收。

5) `main.js:783` 的 `sandbox: false` 建议改为 `true`（该浮窗只用 preload 桥，不需要 Node 集成）。

**可选（收益更大但需回归 UI）**：评估去掉 `transparent: true` 与 `alwaysOnTop: true`，改用不透明背景窗口。透明分层是持续 GPU 合成的根因；置顶会阻止系统对完全被遮挡窗口做跳过优化。改动前请目视确认浮窗视觉可接受。

**验证**：打开翻译窗 → 关闭 → 过 30 秒，用任务管理器确认 Electron 渲染进程数下降；再次划词应能正常重建。

---

### 4.3 P0-C 后端常驻与插件定时拉取（范围在 desktop 之外）

**这部分不是套壳代码，但它是「关窗后风扇仍高」的最可能根因，务必先定位再决定是否改。**

**证据**：日志中 `magicrew 目录拉取失败` 2743 次、`model listing` 1074 次，约每 10 分钟突发重试；审计时无 Electron 进程但 `serve-harness.mjs` / `bin.js web` / `dsh-image-mcp` / `subprocess runner` 四个 Node 进程仍在。

**排查步骤**：

1) 先确认"风扁来源"——打开任务管理器 → 详细信息 → 按 CPU/GPU 排序，看占用是 `OrcaMind.exe` 的渲染/GPU 进程，还是 `node.exe`。若是后者，跳过套壳修复，直接处理内核/插件。
2) 在 `source/` 和 `Plugins/` 中定位定时拉取的发起者（关键词：`magicrew`、`目录拉取失败`、`model listing`、定时器）。日志里 `Error: 模型目录业务码 2155`/`6008` 说明远端返回非预期数据却反复重试，是典型的无退避失败重试。
3) 修复方向：
   - 给目录拉取失败加**指数退避 + 失败次数封顶**，避免在模型源故障时持续重试；
   - 明确失败后的缓存有效期，避免每次模型列表请求都触发远端拉取；
   - 提供关闭自动模型目录刷新的开关。
4) 进程生命周期：桌面端退出（`before-quit`）时，若后端是本壳拉起的（`attachMode === false`），应确保子进程链被回收。当前 `killServer()`（`main.js:394–408`）用 `taskkill /pid <pid> /T /F` 杀进程树，但审计发现服务脱离后仍存活——需核查 `/T` 是否覆盖孙进程，以及是否存在外部启动的 attach 场景（此时按设计不应回收，但要让用户知晓）。

> 注意：若 `attachMode === true`（服务在壳启动前就已存在），按设计退出时**不回收**是正确行为。此时"关窗还转"是预期语义，应通过 UI/文档告知，而非强行杀掉别人的服务。

---

### 4.4 P1 启动页 CSS 动画改为合成器友好

**位置**：`desktop/shell-theme.css`。这些动画在 `loading.html`（及 `error.html`）显示期间运行，`openWindow()`（`main.js:644–649`）载入前端后随之停止——**只解释启动瞬间的风扇峰值，不解释持续高转**。

**问题点**：

| 行 | 选择器 | 问题 |
|---|---|---|
| 94–114 | `.shell-grid` | `inset:-40%` + `perspective/rotateX(58deg)/scale(1.5)` ≈ 270% 视口，叠加 `mask-image`，`animation: grid-drift 18s infinite` 改 `background-position`（**paint 属性，每帧重绘巨幅遮罩图层**） |
| 116–132 | `.shell-scan` | 改 `top`（**layout 属性**，每帧触发布局+绘制） |
| 262–270 | `.shell-card` | `backdrop-filter: blur(20px) saturate(140%)` 盖在多无限动画之上，需持续重采样模糊（错误页） |
| 143–151 / 158–166 | `.shell-mark::after` / `.shell-whale` | breathe / float，transform+opacity，合成器友好、成本较低 |
| 216–235 | `.dot` | `box-shadow` 扩散动画，重绘；但 `is-ready` 后停止 |
| 354–370 | `.shell-sweat` | `filter: drop-shadow` + transform 动画，错误页 |

**补丁（替换 @keyframes）**：

```css
/* 原 grid-drift 改 background-position → 改为对包装层做 transform（合成器友好） */
.shell-grid {
  /* 保留原有尺寸/遮罩/transform，删除 animation: grid-drift ... */
  animation: none;
}
/* 若需保留漂移视觉，新建一个包装元素承载 translate3d；
   或最简单：静态网格，直接删掉动画。启动页停留仅数秒，静态网格可接受。 */

/* scan：用 transform 代替 top */
.shell-scan {
  top: 0; /* 固定 */
  animation: scan 6s ease-in-out infinite;
}
@keyframes scan {
  0%, 100% { transform: translateY(12vh); opacity: 0; }
  15% { opacity: .55; }
  85% { opacity: .55; }
  50% { transform: translateY(88vh); }
}

/* 错误卡：移除 backdrop-filter */
.shell-card {
  backdrop-filter: none; /* 用半透明/不透明背景即可 */
}
```

**快速验证（确诊手段）**：系统开启「减少动画」后启动 OrcaMind。`shell-theme.css:320–325` 已支持 `prefers-reduced-motion`，若风扇峰值消失即可确认这批动画是根因之一。注意：`backdrop-filter` **不会**被该媒体查询禁用，需单独处理。

---

### 4.5 P2 托盘关闭语义与生命周期

**位置**：`desktop/main.js:617–626`、`2364–2374`、`651–671`。

**问题机制**：`closeBehavior === 'tray'` 时 `e.preventDefault(); win.hide()`；`window-all-closed` 有意保持进程；后端只在 `before-quit` 回收。隐藏后页面 JS、SSE/WebSocket、合成器、后端全部继续运行。当前用户配置是 `quit`，所以此问题**当前未触发**，但要在文档中明确语义，避免误切换。

**修复建议（按侵入性递增）**：
1. 最小：在托盘菜单里明确标注「关闭=收进托盘（后端继续运行）」，并增加「完全退出（含后端）」项直接调用 `app.quit()`。
2. 中等：隐藏到托盘时对主窗口执行 `win.webContents.setBackgroundThrottling(true)`（虽默认即为 true，显式声明以防未来被改），并暂停音频/重型订阅。
3. 较大：隐藏超过 N 分钟后 `win.destroy()` 释放渲染进程，托盘图标保留，重新打开时 `bootstrap()` 重建。

---

### 4.6 P2 就绪轮询改指数退避

**位置**：`desktop/main.js:27–28`、`491–502`、`573–583`、`411–415`。

**现状**：`POLL_INTERVAL_MS = 500`，`BOOT_TIMEOUT_MS = 60000` → 最坏 120 次真实 `http.get`；`targetUrl()` 每 250ms 轮询 5 秒。有 `startupToken` 守卫，不是死循环，但后端启动失败时会刷 60 秒 2Hz 轮询 + 状态推送。

**补丁**：
```js
let delay = 250;
for (let waited = 0; waited < BOOT_TIMEOUT_MS; waited += delay) {
  await sleep(delay);
  delay = Math.min(2000, Math.round(delay * 1.6)); // 250 → 400 → 640 → ... → 2s 封顶
  if (token !== startupToken) return;
  ...
  if (await checkServer(600)) { ... }
}
```
同时把 `BOOT_TIMEOUT_MS` 从 60000 下调到 30000（按实际启动耗时调整）。`targetUrl()` 的 250ms 轮询可保留（仅 5 秒）。

---

### 4.7 P2 日志同步写盘降频

**位置**：`desktop/main.js:226–238`。

**现状**：`log()` 每条都 `fs.existsSync` + `fs.statSync` + `fs.appendFileSync`，且后端 stdout/stderr 的**每一行**都经它（`main.js:372–380`）。模型目录失败突发时会连续刷盘，主线程同步 I/O 造成卡顿尖峰。

**补丁方向**：改为缓冲队列 + 定时（如 1 秒）批量 `appendFileSync`，或改用 `fs.createWriteStream` 异步写；保留 5MB 轮转逻辑但移到定时器中判断。注意退出前 flush。

---

### 4.8 P3 preload 活跃模型探测去重

**位置**：`desktop/preload.js:123–134`、`141–142`。

**现状**：`mouseup` 与 `click` 每次都执行两次 `querySelector` 并 `ipcRenderer.send('active-model-changed', ...)`，无去重；对比主题同步有 `lastNotifiedThemeKey`（`preload.js:49–60`）。

**补丁**：仿照主题做缓存：
```js
let lastNotifiedModel = null;
function checkAndNotifyActiveModel() {
  try {
    ...
    const modelName = btn.textContent.trim();
    if (modelName && modelName !== lastNotifiedModel) {
      lastNotifiedModel = modelName;
      ipcRenderer.send('active-model-changed', { modelName });
    }
  } catch (err) {}
}
```

---

### 4.9 P3 TTS 小 bug

**位置**：`desktop/tts-service.js:378–380`。

**现状**：WebSocket `onmessage` 中的空 `catch {}` 吞掉所有音频块解析错误。若 `event.data` 是 Buffer 而非 Blob，`event.data.arrayBuffer()` 会逐块抛错→音频全丢→一直降级本地语音。

**补丁**（`main.js:352–381` 的 `ws.onmessage`）：当前代码在 `else` 分支无条件调用 `event.data.arrayBuffer()`；若运行时 `event.data` 是 Buffer/ArrayBuffer 就会抛错并被空 catch 吞掉。先做类型归一化，并至少把异常打进日志：
```js
} else {
  try {
    // 归一化：ArrayBuffer / Buffer / Blob 三种形态都支持
    let ab;
    if (typeof ArrayBuffer !== 'undefined' && event.data instanceof ArrayBuffer) {
      ab = event.data;
    } else if (Buffer.isBuffer(event.data)) {
      ab = event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength);
    } else if (event.data && typeof event.data.arrayBuffer === 'function') {
      ab = await event.data.arrayBuffer();
    } else {
      throw new Error('unexpected audio chunk type: ' + typeof event.data);
    }
    const buf = Buffer.from(ab);
    // ……原有 header 解析与 audioChunks.push 逻辑保持不变……
  } catch (err) {
    console.error('[tts] audio chunk parse failed:', err && err.message);
  }
}
```
另可考虑 `main.js:1792–1809` 把 base64 作为 `executeJavaScript` 的**参数**传入（`wc.executeJavaScript(code, true, base64)` 后在 code 里用 `arguments[0]`/箭头参数接收），而不是把整个 MP3 拼进源码字符串——后者会造成大字符串 IPC 传输与 JS 解析的一次性尖峰。

---

## 5. 明确排除的假设

后续会话**不要**把时间花在这些方向上（已逐一核实）：

- ❌ 死循环 / 永不清除的 `setInterval`：全部源码零命中；`targetUrl`、`shell-page-ready` 回放（`main.js:2197–2201`）、loading.html 的 rAF（`loading.html:39–63`）都是有限/自终止的。
- ❌ 服务器崩溃重启循环：`serverProc` exit handler（`main.js:381–388`）只显示错误、不自动重启。
- ❌ 监听器泄漏：`setupZoom`/`setupContextMenu` 随窗口销毁而释放；`preload-translate.js` 每次 `on()` 前先 `removeAllListeners`；translate.html 动态列表先 `innerHTML=''` 再重建，旧节点被 GC。
- ❌ TTS 导致开机风扇：`tts-service.js` 唯一 6s 超时在所有终态路径均被 `cleanup()`（`tts-service.js:311–331`）清除；朗读仅在右键点击/翻译按钮触发（`main.js:1975`），**启动流程（`main.js:2352–2360`）不调用**。
- ❌ translate.html 的轮询：`getTtsSettings`/`getModels`/`doTranslate` 均为事件驱动一次性调用；spinner/pulsePlay 动画只在对应 UI 状态显示时运行。
- ❌ 「壳强制 SwiftShader」：`vk_swiftshader.dll` 是 Electron 标配，代码未主动启用。
- ❌ webPreferences 配置错误：主窗口 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`（`main.js:607–612`），`webSecurity` 等均为安全默认值。

**范围提醒**：`启动-官方桌面端.bat` 走的是 `source\apps\desktop` 的**另一套完整桌面应用**（dev 模式、主脚本约 1MB）。若用户实际用的是它，问题大概率来自那套应用，与本次审查的套壳无关。启动 OrcaMind 套壳的是 `启动-Harness-桌面版.bat`（`desktop/dist/OrcaMind.exe`）。修复前先确认用户用的是哪个入口。

---

## 6. 推荐执行顺序与验收

按顺序执行，每步都验证再进入下一步：

1. **定位负载归属（5 分钟，零改动）**：任务管理器按 CPU/GPU 排序，确认是 `OrcaMind.exe` 还是 `node.exe`。→ 决定走套壳修复(4.1/4.2/4.4)还是后端修复(4.3)。
2. **确诊动画因素（零改动）**：系统开「减少动画」再启动。峰值消失 → 执行 4.4。
3. **修复翻译窗常驻（改动小、收益明确）**：执行 4.2。
4. **增加 GPU 策略开关（改动小）**：执行 4.1，让用户可对Switch。
5. **修复启动轮询与日志（改动中等）**：执行 4.6、4.7。
6. **P3 清理项**：4.8、4.9。
7. **后端根因（若步骤 1 指向 node.exe）**：执行 4.3，需另起会话深入 `source/`/`Plugins/`。
8. **生命周期语义**：4.5（确认用户是否需要 tray 模式后决定侵入程度）。

**验收标准**：
- 启动 10 秒内 CPU/GPU 占用回落到空闲基线；
- 关闭翻译窗 30 秒后渲染进程数下降；
- 关闭桌面窗口后（若 closeBehavior=quit）无残存 `node.exe` 服务链，或明确为 attach 模式且不意外回收；
- `main.log` 中目录拉取失败的重试不再呈 3–6 连发（需 4.3 落地后在内核侧验证）。

**打包注意**：`desktop/package.json` 的 `files` 数组（`package.json:24–37`）列出了所有运行时文件；如新增配置文件/脚本，务必加入该数组，否则打包后缺失。改完用 `npm run dist` 重新生成 `desktop/dist/OrcaMind.exe`，并保留 `.bak` 备份。当前存在 `OrcaMind.exe.bak-*` 多个备份，改动前先确认基线版本。

---

## 7. 快速诊断命令速查

以下命令在 Windows（MSYS Bash / PowerShell）下可用：

```bash
# 1) 日志规模与关键计数
cd "/c/Users/HometownVoyager/AppData/Roaming/OrcaMind"
wc -l main.log
grep -c "目录拉取失败" main.log
grep -c "model listing" main.log
grep -c "OrcaMind 启动" main.log
grep "OrcaMind 启动" main.log | tail -20     # 启动频率
grep -E "服务进程退出|重启服务|重启前端壳" main.log | tail -20

# 2) 每小时失败次数分布
grep "目录拉取失败，回退静态表" main.log | sed -E 's/^\[([0-9]+):[0-9]+:[0-9]+\].*/\1/' | sort | uniq -c

# 3) 当前残留进程（PowerShell）
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -match 'node|electron|OrcaMind' } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | Format-List"

# 4) 关闭行为
cat close-behavior.json
```

Git 状态提示：`desktop/main.js`、`loading.html`、`error.html`、`package.json`、`preload.js` 均相对初始存档有未提交修改（约 +679/-173 行），新增了 shell-i18n / shell-theme.css 等文件。改动前先 `git diff -- desktop/` 确认基线，避免覆盖用户未提交的工作。

---

*审计执行时间：2026-11-27 14:13–14:46（Asia/Shanghai）。本文所有行号基于审计时的文件版本；若后续会话前文件有变动，请先重新核对行号。*
