'use strict';

// OrcaMind —— DeepSeek Harness 桌面版（Electron 固定薄壳）
//
// 设计：壳永远不用跟着内核重编。它只做三件事：
//   1. 探测 / 挂载 127.0.0.1:3080 上的 Web 服务（已在跑就 attach，退出不碰它）；
//   2. 未运行时调用仓库根的稳定入口 serve-harness.mjs 拉起服务（与 bat 同一入口）；
//   3. 提供无浏览器 chrome 的窗口、托盘、缩放与错误/加载页。
// 更新内核 = 改 source/ 或根目录脚本；打包 EXE 只负责好看和启动体验。
// 现有 Web 版（.bat/.sh + 浏览器）完全不受影响。

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, clipboard, screen, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ttsService = require('./tts-service');
const { t: i18nT } = require('./shell-i18n');

let currentTtsSettings = null; // 语音朗读设置（语速/音色），在 app.whenReady 后从 userData 读取并在使用时记忆留存

const APP_TITLE = 'OrcaMind';
const DEFAULT_PORT = 3080;
// 实测本机冷启动（启动服务 → 后端就绪）通常 9–12 秒，最慢样本 28 秒，
// 因此超时不宜低于 45s；轮询改为指数退避，避免后端启动失败时刷 2Hz 探测。
const BOOT_TIMEOUT_MS = 45000; // 服务启动最长等待
const POLL_START_MS = 250;
const POLL_MAX_MS = 2000;

// ---------- 配置 ----------

// 读取 exe 旁（打包后）或 desktop/ 下（开发）的 desktop.config.json，再叠加环境变量。
// 可用字段：{ "DSH_ROOT": "D:/Tools/DeepSeek Harness", "port": 3080, "gpuMode": "auto" }
function loadConfig() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'desktop.config.json'),
    path.join(__dirname, 'desktop.config.json'),
  ];
  const cfg = {};
  for (const f of candidates) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch {
      /* 配置文件不存在或损坏时忽略 */
    }
  }
  const port = Number(process.env.DSH_PORT || cfg.port || DEFAULT_PORT);
  return {
    host: '127.0.0.1',
    port: Number.isInteger(port) ? port : DEFAULT_PORT,
    root: process.env.DSH_ROOT || cfg.DSH_ROOT || null,
    gpuMode: process.env.DSH_GPU_MODE || cfg.gpuMode || 'auto',
  };
}

const config = loadConfig();

// ---------- GPU 策略（必须在 app.whenReady() 之前应用） ----------
// auto     缺省：不加任何开关，保持 Chromium 原行为（对照组）；
// software 强制 SwiftShader 软件渲染，适合虚拟机 / RDP / 旧驱动导致 GPU 进程异常的环境；
// disabled 调用 disableHardwareAcceleration()，完全关闭硬件加速。
// 注意：dist 里的 vk_swiftshader.dll 是每个 Electron 应用都自带的标准文件，
// 不代表壳主动启用了软件渲染；这里提供的是「检测 + 可切换」的缓解手段。
const GPU_MODE = ['auto', 'software', 'disabled'].includes(config.gpuMode) ? config.gpuMode : 'auto';
if (GPU_MODE === 'software') {
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else if (GPU_MODE === 'disabled') {
  app.disableHardwareAcceleration();
}

const BASE_URL = `http://${config.host}:${config.port}`;

// ---------- DSH Web 会话认证 ----------
//
// dsh web 0.1.2+ 会在首页要求带 token 的 URL 才能种下认证 Cookie；token 是每次
// 后端进程启动时随机生成、只存在于该进程 stdout（attach 模式下壳拿不到），
// 而签名密钥持久保存在 DSH home 的 .credentials.yaml 中。这里直接用该密钥
// 自行签发一个与权威同名同签名的会话 Cookie，注入 Electron 的 session，
// 就能让任意已运行的后端（含外部启动 / 官方 WEBUI）直接放行，无需 token。
// 票据本身不含权限提升，只是复用 DSH 自己信任的凭据，随密钥轮换自动失效。
const DSH_AUTH_COOKIE_PREFIX = 'dsh-auth-';
const DSH_AUTH_COOKIE_MAX_AGE_DAYS = 30;
const DSH_AUTH_CREDENTIAL_KEY = 'client-connection/browser-session';

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

// 从 ~/.dsh/.credentials.yaml 读取持久化签名密钥（与 DSH 的 credentialKey('client-connection','browser-session') 对应）
function readWebSessionSecret() {
  const yamlPath = path.join(os.homedir(), '.dsh', '.credentials.yaml');
  let text;
  try {
    text = fs.readFileSync(yamlPath, 'utf8');
  } catch (e) {
    log('[auth] 无法读取 DSH 凭据文件：' + e.message);
    return null;
  }
  // 轻量按行解析：找到记录键后，在其块内（缩进更深的下一级 key 之前）取 secret 字段。
  // 不用通用 YAML 库，避免给薄壳引入依赖。
  const lines = text.split(/\r?\n/);
  let inRecord = false;
  let recordIndent = 0;
  let secretValue = null;
  for (const line of lines) {
    const m = /^(\s*)([A-Za-z0-9_./-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    if (!inRecord) {
      if (indent === 2 && key === DSH_AUTH_CREDENTIAL_KEY) {
        inRecord = true;
        recordIndent = indent;
      }
      continue;
    }
    // 记录块结束：遇到同级或更浅的 key
    if (indent <= recordIndent) break;
    if (key === 'secret' && /^[A-Za-z0-9_-]{43}$/.test(m[3].trim())) {
      secretValue = m[3].trim();
      break;
    }
  }
  if (!secretValue) {
    log('[auth] DSH 凭据中未找到 browser-session 签名密钥');
    return null;
  }
  const bytes = decodeBase64url(secretValue);
  if (!bytes || bytes.length !== 32) {
    log('[auth] DSH 签名密钥格式异常');
    return null;
  }
  return bytes;
}

// 生成 DSH 可接受的会话 Cookie（复用 DSH 的签名格式与 authority 规则）
function makeSessionCookie(secret) {
  const authority = config.host === '127.0.0.1' || config.host === 'localhost'
    ? `127.0.0.1:${config.port}`
    : `${config.host}:${config.port}`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + DSH_AUTH_COOKIE_MAX_AGE_DAYS * 86400000;
  const payload = { version: 1, authority, issuedAt, expiresAt };
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = base64url(crypto.createHmac('sha256', secret).update(body).digest());
  const value = `v1.${body}.${sig}`;
  const name = DSH_AUTH_COOKIE_PREFIX + base64url(crypto.createHash('sha256').update(authority).digest());
  return { name, value, url: BASE_URL, expirationDate: expiresAt / 1000 };
}

// 把会话 Cookie 注入 Electron session；失败不致命（退回原有带 token URL 流程）。
async function ensureWebSession() {
  try {
    const secret = readWebSessionSecret();
    if (!secret) return false;
    const { session } = require('electron');
    const cookie = makeSessionCookie(secret);
    await session.defaultSession.cookies.set(cookie);
    log('[auth] 已为 DSH Web 会话注入认证 Cookie');
    return true;
  } catch (e) {
    log('[auth] 注入会话 Cookie 失败：' + (e && e.message ? e.message : e));
    return false;
  }
}

// ---------- 状态 ----------

let win = null; // 主窗口
let tray = null; // 托盘
let serverProc = null; // 我们拉起的服务进程（attach 模式下为 null）
let attachMode = false; // true = 服务在启动前就已存在，退出时不回收
let authUrl = null; // 服务进程 stdout 里解析出的带 token 的 BASE_URL（dsh web 0.1.2 起需要认证）
let quitting = false; // 正在退出
let restarting = false; // 正在重启服务
let restartingFrontend = false; // 托盘「重启前端」：销毁窗口重建，不碰后端
let startupToken = 0; // 每次启动递增，避免过期流程回写已重建的窗口

// 关闭窗口行为：'quit' = 彻底退出（默认，与旧版一致）；'tray' = 收进系统托盘，后端继续运行。
const CLOSE_BEHAVIOR_FILE = 'close-behavior.json';
function loadCloseBehavior() {
  try {
    const file = path.join(app.getPath('userData'), CLOSE_BEHAVIOR_FILE);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.closeBehavior === 'tray' ? 'tray' : 'quit';
  } catch {
    return 'quit';
  }
}
function saveCloseBehavior(value) {
  try {
    const file = path.join(app.getPath('userData'), CLOSE_BEHAVIOR_FILE);
    fs.writeFileSync(file, JSON.stringify({ closeBehavior: value }), 'utf8');
  } catch (e) {
    log('[close-behavior] 保存失败：' + (e && e.message ? e.message : e));
  }
}
let closeBehavior = 'quit'; // app.whenReady 后从磁盘载入

// 启动阶段定义：key 用于文案，pct 为该阶段完成时的进度上限。
const STARTUP_STAGES = [
  { key: 'check', pct: 8 },
  { key: 'locate', pct: 20 },
  { key: 'spawn', pct: 34 },
  { key: 'wait', pct: 82 },
  { key: 'auth', pct: 92 },
  { key: 'load', pct: 100 },
];
function loadInitialTheme() {
  try {
    const webPatchPath = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
    if (fs.existsSync(webPatchPath)) {
      const content = fs.readFileSync(webPatchPath, 'utf8');
      const match = content.match(/id:\s*ui-theme[\s\S]*?preference:\s*(light|dark|system)/);
      if (match && match[1]) {
        const pref = match[1];
        if (pref === 'light') return 'light';
        if (pref === 'dark') return 'dark';
        if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      }
    }
  } catch (_) {}
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

let currentTheme = loadInitialTheme(); // 当前主题状态：'dark' | 'light'
nativeTheme.themeSource = currentTheme;
let currentLocale = 'zh'; // 当前语言状态：'zh' | 'en'（默认中文）
let currentActiveChatModel = 'gemini-3.8-flash'; // 当前会话活跃模型
let currentZoomLevel = 0; // 当前缩放级别（供浮窗与菜单联动）
let sessionTranslateSize = null; // 会话级翻译浮窗尺寸记忆 { width, height }

// ---------- 日志 ----------
//
// 后端 stdout/stderr 的每一行都经过 log()（见 startServer）。逐条
// existsSync + statSync + appendFileSync 会在目录拉取失败等日志突发时让主线程
// 反复同步刷盘，形成卡顿尖峰。改为「内存队列 + 1 秒批量落盘」：
//   - console 输出仍即时；
//   - 文件大小在内存中累计，不再每条 statSync；
//   - 5MB 轮转保留，但只在批量写盘时判断一次；
//   - 退出前 flushLogsSync() 写完残余队列，避免丢日志。
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_FLUSH_INTERVAL_MS = 1000;
let logQueue = [];
let logFlushTimer = null;
let logFileBytes = -1; // -1 = 还没读过磁盘上的文件大小
let logFilePath = null;

function logFile() {
  if (!logFilePath) logFilePath = path.join(app.getPath('userData'), 'main.log');
  return logFilePath;
}

function flushLogsSync() {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  if (logQueue.length === 0) return;
  const chunk = logQueue.join('');
  logQueue = [];
  try {
    const file = logFile();
    if (logFileBytes < 0) {
      try {
        logFileBytes = fs.statSync(file).size;
      } catch {
        logFileBytes = 0;
      }
    }
    if (logFileBytes > LOG_MAX_BYTES) {
      try { fs.renameSync(file, file + '.1'); } catch (_) {}
      logFileBytes = 0;
    }
    fs.appendFileSync(file, chunk);
    logFileBytes += Buffer.byteLength(chunk);
  } catch {
    /* 日志写失败不影响运行 */
  }
}

function log(...args) {
  const line = `[${new Date().toLocaleTimeString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    logQueue.push(line + '\n');
    if (!logFlushTimer) {
      logFlushTimer = setTimeout(flushLogsSync, LOG_FLUSH_INTERVAL_MS);
      // 不因为一个待写日志的定时器而拖住退出；退出路径会显式 flush。
      if (typeof logFlushTimer.unref === 'function') logFlushTimer.unref();
    }
  } catch {
    /* 日志缓冲失败不影响运行 */
  }
}

function logPath() {
  return logFile();
}

// ---------- 工具 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 探测服务是否已就绪（任何 HTTP 响应都视为在运行）
function checkServer(timeout = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: config.host, port: config.port, path: '/', timeout },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

// ---------- 定位 Harness 安装目录 ----------

// 根目录标记：稳定入口脚本，或旧版源码/npm 布局（兼容尚未拉 serve-harness 的目录）
function looksLikeHarnessRoot(dir) {
  if (!dir) return false;
  return (
    fs.existsSync(path.join(dir, 'serve-harness.mjs')) ||
    fs.existsSync(path.join(dir, 'source', 'apps', 'cli', 'lib', 'bin.js')) ||
    fs.existsSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh'))
  );
}

// 解析链：desktop.config.json / DSH_ROOT 环境变量 → 开发模式 desktop/ 上级 → 便携 exe 原目录向上 → exe 目录向上
function findHarnessRoot() {
  if (config.root && looksLikeHarnessRoot(config.root)) return config.root;
  const chain = [];
  if (!app.isPackaged) chain.push(path.dirname(__dirname)); // 开发模式：desktop/ 的上级即项目根
  // 便携版 exe 会自解压到临时目录运行，原 exe 位置由 PORTABLE_EXECUTABLE_DIR 提供，并从这里逐级向上
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    let pdir = process.env.PORTABLE_EXECUTABLE_DIR;
    for (let i = 0; i < 8; i++) {
      chain.push(pdir);
      const up = path.dirname(pdir);
      if (up === pdir) break; // 已到驱动器根
      pdir = up;
    }
  }
  let dir = path.dirname(process.execPath);
  // win-unpacked 位于 desktop/dist/win-unpacked，距根目录数层；向上检查 8 层
  for (let i = 0; i < 8; i++) {
    chain.push(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const d of chain) {
    if (looksLikeHarnessRoot(d)) return d;
  }
  return null;
}

// 优先用工作区自带的 Dependency\nodejs\node.exe 启动固定入口；其次系统 node；
// 都缺失时回退到 Electron 内置 Node（ELECTRON_RUN_AS_NODE）
function spawnServerNode(args, cwd) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (child) => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    };
    const bundledNode = path.join(cwd, 'Dependency', 'nodejs', 'node.exe');
    const nodeCmd = fs.existsSync(bundledNode) ? bundledNode : 'node';
    const child = spawn(nodeCmd, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once('spawn', () => done(child));
    child.once('error', (err) => {
      if (err && err.code === 'ENOENT') {
        log('系统 node 不可用，改用 Electron 内置 Node 运行入口');
        done(
          spawn(process.execPath, args, {
            cwd,
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        );
      } else {
        done(child);
      }
    });
  });
}

// ---------- 服务生命周期 ----------

// 拉起服务；返回错误信息或 null
async function startServer() {
  const root = findHarnessRoot();
  if (!root) {
    return (
      '找不到 DeepSeek Harness 安装目录。\n\n' +
      '请把本程序放到 Harness 目录下（或它的 desktop/ 子目录中），\n' +
      '或在程序旁边新建 desktop.config.json 指定安装路径：\n' +
      '  { "DSH_ROOT": "D:/Tools/DeepSeek Harness" }\n' +
      '也可以设置环境变量 DSH_ROOT。'
    );
  }

  const entry = path.join(root, 'serve-harness.mjs');
  if (!fs.existsSync(entry)) {
    return (
      '在安装目录中未找到固定入口 serve-harness.mjs：\n' +
      root +
      '\n\n请确认 DSH_ROOT 指向 DeepSeek Harness 仓库根目录。'
    );
  }

  log(`启动服务：node serve-harness.mjs --port ${config.port}（root=${root}）`);
  authUrl = null; // 新进程有新 token，清掉上一次的
  serverProc = await spawnServerNode([entry, '--port', String(config.port)], root);
  let stdoutTail = ''; // 按行缓冲，防止 BASE_URL 恰好被数据块截断
  serverProc.stdout.on('data', (d) => {
    const s = String(d);
    log('[server]', s.trim());
    stdoutTail = (stdoutTail + s).split('\n').slice(-8).join('\n');
    // dsh web 0.1.2+ 打印 "dsh web: http://127.0.0.1:3080/?token=…"，首次打开必须带 token 才能种下认证 cookie
    const m = /dsh web: (http:\/\/\S+)/u.exec(stdoutTail);
    if (m) authUrl = m[1];
  });
  serverProc.stderr.on('data', (d) => log('[server]', String(d).trim()));
  serverProc.on('exit', (code) => {
    log(`服务进程退出 (code=${code})`);
    if (!quitting && !restarting && serverProc) {
      showError(i18nT(currentLocale, 'error.serverExit', { code }));
    }
    serverProc = null;
    if (tray) rebuildTrayMenu();
  });
  if (tray) rebuildTrayMenu();
  return null;
}

// 回收我们拉起的服务（attach 模式 / 外部服务一律不碰）
function killServer() {
  if (!serverProc) return;
  const pid = serverProc.pid;
  log(`回收服务进程 (pid=${pid})`);
  serverProc = null;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 进程已退出 */
    }
  }
}

// 带 token 的 URL 在 Loader 全部就绪后才打印，晚于端口开始响应；就绪后稍等它出现
async function targetUrl(maxMs = 5000) {
  const step = 250;
  for (let waited = 0; !authUrl && waited < maxMs; waited += step) await sleep(step);
  return authUrl || BASE_URL;
}

// 等待后端就绪：250ms 起步、×1.6 指数退避、2s 封顶。
// 相比固定 500ms 轮询，启动正常时第一次探测仍然很快，启动失败时
// 45 秒内只发约 25 次探测（原实现 90 次），状态推送也同步减少。
// 返回可载入的 URL；超时或被更新的启动流程取代（token 失效）时返回 null。
async function waitForServerReady(token) {
  let delay = POLL_START_MS;
  for (let waited = 0; waited < BOOT_TIMEOUT_MS; waited += delay) {
    await sleep(delay);
    delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.6));
    if (token !== startupToken) return null;
    // 平滑推进到阶段上限，但不越过下一阶段的真实门槛
    const ratio = Math.min(1, waited / BOOT_TIMEOUT_MS);
    const pct = Math.round(STARTUP_STAGES[2].pct + ratio * (STARTUP_STAGES[3].pct - STARTUP_STAGES[2].pct));
    stageUpdate(token, 'wait', pct);
    if (await checkServer(600)) return targetUrl();
  }
  return null;
}

// ---------- 启动进度编排 ----------

// 向加载页推送一次状态；只有当前 token 对应的窗口才接收，防止重启前端后旧流程污染新窗口。
// 加载页尚未就绪时把状态入队，等 shell-page-ready 后按序回放——否则 loadFile 是异步的，
// 紧随其后发出的阶段事件会因页面里还没有 onShellState 监听器而全部丢失，
// 用户只能看到最后回放的一条状态「闪一下就消失」。
let shellStateReady = false;
const shellStateQueue = [];
let shellStateReplayResolve = null;
let shellStateReplayPromise = Promise.resolve();
function pushShellState(token, patch) {
  if (token !== startupToken) return;
  lastShellState = Object.assign({ locale: currentLocale, theme: currentTheme }, patch);
  const w = win;
  if (!w || w.isDestroyed()) return;
  if (!shellStateReady || replayingShellState || !(w.webContents.getURL().includes('loading.html') || w.webContents.getURL().includes('error.html'))) {
    // Coalesce repeated progress ticks of the same stage: replaying dozens of
    // "wait 12% / 14% / …" frames at min dwell would stall startup for seconds.
    const last = shellStateQueue[shellStateQueue.length - 1];
    const coalescible = last && last.stageKey === lastShellState.stageKey
      && !lastShellState.ready && !last.ready
      && last.stageText === lastShellState.stageText;
    if (coalescible) {
      shellStateQueue[shellStateQueue.length - 1] = Object.assign({}, lastShellState);
    } else {
      shellStateQueue.push(Object.assign({}, lastShellState));
    }
    return;
  }
  try {
    w.webContents.send('shell-state', lastShellState);
  } catch (_) {}
}

function stageUpdate(token, stageKey, pct, textOverride) {
  const stage = STARTUP_STAGES.find((s) => s.key === stageKey);
  const text = textOverride || i18nT(currentLocale, stage ? `loading.stage.${stageKey}ing` : 'loading.stage.checking');
  pushShellState(token, {
    stageKey,
    stageText: text,
    progress: pct != null ? pct : (stage ? stage.pct : 0),
  });
}

// 启动主流程：先探测，已运行就挂载；否则拉起服务并等待就绪。
// 无论托管/直连/重启前端，都先显示加载页，后端就绪并经真实 HTTP 探测通过后才载入前端。
async function bootstrap() {
  const token = ++startupToken;
  restarting = false;
  restartingFrontend = false;

  showLoading();
  stageUpdate(token, 'check', STARTUP_STAGES[0].pct);

  if (await checkServer()) {
    attachMode = true;
    log(`检测到 Harness 服务已在 ${BASE_URL} 运行，直接挂载（退出时不影响该服务）`);
    stageUpdate(token, 'check', 12, i18nT(currentLocale, 'loading.stage.attach'));
    return enterFrontend(token, BASE_URL);
  }
  attachMode = false;

  // 清理上一次尝试遗留的进程
  killServer();

  stageUpdate(token, 'locate');
  const err = await startServer();
  if (err) {
    if (token === startupToken) showError(err);
    return;
  }

  stageUpdate(token, 'spawn');
  log('等待服务就绪 …');
  const readyUrl = await waitForServerReady(token);
  if (readyUrl) {
    stageUpdate(token, 'auth');
    return enterFrontend(token, readyUrl);
  }
  if (token === startupToken) {
    showError(i18nT(currentLocale, 'error.hint') + ' ' + i18nT(currentLocale, 'error.unknown') + ` (${BOOT_TIMEOUT_MS / 1000}s) — ${logPath()}`);
  }
}

// 后端已确认就绪后调用：显示完成态，给加载页一点收束时间，再载入前端。
async function enterFrontend(token, url) {
  if (token !== startupToken) return;
  stageUpdate(token, 'auth');
  // 先为已运行/刚拉起的后端种下认证会话，再载入前端，确保进入即可用（不是认证页/重连页）。
  await ensureWebSession();
  stageUpdate(token, 'load', 100);
  pushShellState(token, { ready: true });
  // 若页面还在加载/回放阶段，等它把每个阶段播完（带兜底超时，页面加载失败时不卡死），
  // 再停留让最终「就绪」被看见。
  await Promise.race([shellStateReplayPromise, sleep(3000)]);
  await sleep(900); // 让 100% 与「就绪」被看见，避免瞬间切换
  if (token !== startupToken) return;
  log(`后端就绪，载入前端：${url}`);
  openWindow(url);
}

// 托盘「重启 OrcaMind 前端」：仅重建窗口、重走启动动画，不动后端 LocalHost。
async function restartFrontend() {
  if (quitting || restartingFrontend) return;
  restartingFrontend = true;
  const token = ++startupToken;
  log('重启前端壳（后端保持不变）…');

  if (win && !win.isDestroyed()) {
    const oldWin = win;
    win = null;
    oldWin.removeAllListeners('close');
    oldWin.once('closed', () => { /* 已旧窗口，忽略 */ });
    try { oldWin.destroy(); } catch (_) {}
  }

  // 后端本来就存在时重新探测；不 killServer / 不 startServer。
  showLoading();
  stageUpdate(token, 'check', STARTUP_STAGES[0].pct);
  await sleep(800); // 最短动画展示时间

  if (await checkServer()) {
    attachMode = true;
    stageUpdate(token, 'check', 12, i18nT(currentLocale, 'loading.stage.attach'));
    await enterFrontend(token, BASE_URL);
  } else {
    // 服务意外消失时退化为完整 bootstrap（此时才会重新拉起）
    restartingFrontend = false;
    return bootstrap();
  }
  restartingFrontend = false;
}

async function restartServer() {
  if (!serverProc) return;
  restarting = true;
  const token = ++startupToken;
  log('重启服务 …');
  showLoading();
  stageUpdate(token, 'check', STARTUP_STAGES[0].pct);
  killServer();
  await sleep(1500);
  const err = await startServer();
  if (err) {
    restarting = false;
    if (token === startupToken) showError(err);
    return;
  }
  stageUpdate(token, 'spawn');
  const restartedUrl = await waitForServerReady(token);
  if (restartedUrl) {
    restarting = false;
    return enterFrontend(token, restartedUrl);
  }
  restarting = false;
  if (token === startupToken) showError(i18nT(currentLocale, 'error.unknown') + ' (restart timeout)');
}

// ---------- 窗口 ----------

function assetPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'build', name)
    : path.join(__dirname, 'build', name);
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: APP_TITLE,
    icon: assetPath('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: currentTheme === 'dark' ? '#181a1f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // 保持固定标题
  // 关闭窗口时按用户选择：彻底退出 or 收进托盘（进程常驻、后端不动）。
  // 重启前端会先置 restartingFrontend=true 并 destroy 旧窗口，这条路径不算用户关窗，跳过。
  win.on('close', (e) => {
    if (quitting || restartingFrontend) return;
    if (closeBehavior === 'tray') {
      log('关闭窗口：收进系统托盘（渲染进程与后端都保持运行；要彻底退出请用托盘「完全退出」）');
      e.preventDefault(); // 阻止销毁窗口，仅隐藏
      // 显式声明后台节流（默认即为 true，写死以防未来被改动），并停掉朗读等可暂停的输出。
      try { win.webContents.setBackgroundThrottling(true); } catch (_) {}
      try { stopSpeaking(win.webContents); } catch (_) {}
      win.hide();
    } else {
      app.quit();
    }
  });
  // 外部链接交给系统浏览器，应用内只允许 Harness 自身页面
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(BASE_URL) || url.startsWith('file:')) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  win.webContents.on('did-finish-load', () => log('窗口加载完成'));
  setupZoom(win.webContents);
  setupContextMenu(win);
  return win;
}

function openWindow(url) {
  const w = ensureWindow();
  w.loadURL(url);
  w.show();
  w.focus();
}

function showLoading() {
  shellStateReady = false;
  shellStateQueue.length = 0;
  shellStateReplayResolve = null;
  shellStateReplayPromise = new Promise((resolve) => { shellStateReplayResolve = resolve; });
  const w = ensureWindow();
  w.setBackgroundColor(currentTheme === 'dark' ? '#151517' : '#f9fafb');
  w.loadFile(path.join(__dirname, 'loading.html'), {
    query: { locale: currentLocale, theme: currentTheme },
  });
  w.show();
}

function showError(msg) {
  const w = ensureWindow();
  w.setBackgroundColor(currentTheme === 'dark' ? '#151517' : '#f9fafb');
  w.loadFile(path.join(__dirname, 'error.html'), {
    query: { msg, locale: currentLocale, theme: currentTheme },
  });
  w.show();
}

// ---------- 页面缩放（Ctrl+滚轮 / Ctrl+= / Ctrl+- / Ctrl+0） ----------

// Electron 出于安全默认不执行 Ctrl+滚轮缩放（真正的浏览器才会），只发出 zoom-changed
// 事件，需要在这里响应事件真正调用 setZoomLevel。
const ZOOM_STEP = 0.5; // 每档 0.5 个缩放级别 ≈ ±10%，与浏览器滚轮手感一致
const ZOOM_MIN = -7; // ≈ 25%，与浏览器下限一致
const ZOOM_MAX = 9; // = 500%，与浏览器上限一致

function zoomStateFile() {
  return path.join(app.getPath('userData'), 'zoom-level.json');
}

function loadZoomLevel() {
  try {
    const v = Number(JSON.parse(fs.readFileSync(zoomStateFile(), 'utf8')).level);
    if (Number.isFinite(v)) return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
  } catch {
    /* 无记录或文件损坏时按 100% 处理 */
  }
  return 0;
}

currentZoomLevel = loadZoomLevel(); // 启动时立即同步保存的缩放值

let zoomSaveTimer = null;
function saveZoomLevel(level) {
  clearTimeout(zoomSaveTimer); // 滚轮连续转动时合并成一次写盘
  zoomSaveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(zoomStateFile(), JSON.stringify({ level }));
    } catch {
      /* 保存失败不影响本次使用 */
    }
  }, 500);
}

function applyZoom(step) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, wc.getZoomLevel() + step));
  wc.setZoomLevel(level);
  currentZoomLevel = level;
  saveZoomLevel(level);
  if (translateWin && !translateWin.isDestroyed()) {
    try {
      translateWin.webContents.setZoomLevel(level);
    } catch (_) {}
  }
}

function setupZoom(wc) {
  wc.on('zoom-changed', (_e, direction) => {
    applyZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP);
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    const key = input.key || '';
    if (key === '=' || key === '+' || input.code === 'NumpadAdd') {
      applyZoom(ZOOM_STEP);
      e.preventDefault();
    } else if (key === '-' || key === '_' || input.code === 'NumpadSubtract') {
      applyZoom(-ZOOM_STEP);
      e.preventDefault();
    } else if (key === '0' || input.code === 'Numpad0') {
      wc.setZoomLevel(0);
      currentZoomLevel = 0;
      saveZoomLevel(0);
      if (translateWin && !translateWin.isDestroyed()) {
        try {
          translateWin.webContents.setZoomLevel(0);
        } catch (_) {}
      }
      e.preventDefault();
    }
  });
  // 重启服务、加载 loading/error 页之后仍恢复上次的缩放级别
  wc.on('did-finish-load', () => {
    const level = loadZoomLevel();
    wc.setZoomLevel(level);
    currentZoomLevel = level;
    if (translateWin && !translateWin.isDestroyed()) {
      try {
        translateWin.webContents.setZoomLevel(level);
      } catch (_) {}
    }
  });
}

// ---------- 上下文菜单与划词辅助 ----------

let translateWin = null;

// 透明 + 置顶的翻译浮窗只要还存在，合成器就要持续对它做桌面 alpha 混合，
// 且 alwaysOnTop 会让系统无法对其应用「完全被遮挡就跳过」的优化。
// 因此隐藏之后不能无限期保留渲染进程：30 秒没有再次使用就销毁，
// 下次划词时由 ensureTranslateWindow() 重新创建。
const TRANSLATE_TEARDOWN_MS = 30000;
let translateHideTimer = null;

function cancelTranslateTeardown() {
  if (translateHideTimer) {
    clearTimeout(translateHideTimer);
    translateHideTimer = null;
  }
}

function scheduleTranslateTeardown() {
  cancelTranslateTeardown();
  translateHideTimer = setTimeout(() => {
    translateHideTimer = null;
    if (translateWin && !translateWin.isDestroyed() && !translateWin.isVisible()) {
      log('翻译浮窗已隐藏 30 秒，销毁以释放渲染进程与合成表面');
      try { translateWin.destroy(); } catch (_) {}
      translateWin = null;
    }
  }, TRANSLATE_TEARDOWN_MS);
  if (typeof translateHideTimer.unref === 'function') translateHideTimer.unref();
}

function ensureTranslateWindow() {
  if (translateWin && !translateWin.isDestroyed()) return translateWin;
  translateWin = new BrowserWindow({
    width: 440,
    height: 340,
    minWidth: 300,
    minHeight: 220,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-translate.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // 浮窗只用 preload 桥，不需要 Node 集成
    },
  });
  translateWin.loadFile(path.join(__dirname, 'translate.html'));
  translateWin.on('closed', () => {
    cancelTranslateTeardown();
    translateWin = null;
  });

  // 保证划词翻译窗口首次加载完成时缩放与主题即刻生效
  translateWin.webContents.on('did-finish-load', () => {
    const level = currentZoomLevel || loadZoomLevel() || 0;
    if (translateWin && !translateWin.isDestroyed()) {
      try {
        translateWin.webContents.setZoomLevel(level);
        translateWin.webContents.send('theme-updated', { theme: currentTheme });
        translateWin.webContents.send('locale-updated', { locale: currentLocale });
      } catch (_) {}
    }
  });

  // 记录用户手动调整的窗口尺寸（会话级记忆）
  translateWin.on('resize', () => {
    if (translateWin && !translateWin.isDestroyed() && translateWin.isVisible()) {
      const [w, h] = translateWin.getSize();
      sessionTranslateSize = { width: w, height: h };
    }
  });

  translateWin.on('blur', () => {
    if (translateWin && !translateWin.isDestroyed()) {
      translateWin.webContents.send('stop-speaking');
      translateWin.hide();
      scheduleTranslateTeardown();
    }
  });
  return translateWin;
}

function showTranslateWindow(payload, triggerBounds) {
  cancelTranslateTeardown(); // 复用/重建期间都不允许被回收
  const tw = ensureTranslateWindow();

  currentZoomLevel = currentZoomLevel || loadZoomLevel() || 0;

  // 浮窗尺寸决定：若本会话中用户曾手动调整过尺寸，优先使用记忆尺寸；否则根据主窗口 zoom 缩放
  let wWidth;
  let wHeight;
  if (sessionTranslateSize && typeof sessionTranslateSize.width === 'number' && typeof sessionTranslateSize.height === 'number') {
    wWidth = sessionTranslateSize.width;
    wHeight = sessionTranslateSize.height;
  } else {
    const zoomFactor = Math.pow(1.2, currentZoomLevel || 0);
    const clampedFactor = Math.min(1.5, Math.max(0.8, zoomFactor));
    wWidth = Math.round(440 * clampedFactor);
    wHeight = Math.round(340 * clampedFactor);
  }

  // 浮窗内部元素等比缩放
  try {
    tw.webContents.setZoomLevel(currentZoomLevel || 0);
  } catch (e) {}

  const point = {
    x: triggerBounds && typeof triggerBounds.x === 'number' ? triggerBounds.x : screen.getCursorScreenPoint().x,
    y: triggerBounds && typeof triggerBounds.y === 'number' ? triggerBounds.y : screen.getCursorScreenPoint().y,
  };
  const currentDisplay = screen.getDisplayNearestPoint(point) || screen.getPrimaryDisplay();
  const workArea = currentDisplay.workArea;

  let posX = point.x + 8;
  let posY = point.y + 8;

  // 边界保护：防止弹窗超出屏幕可视工作区
  if (posX + wWidth > workArea.x + workArea.width) {
    posX = workArea.x + workArea.width - wWidth - 8;
  }
  if (posY + wHeight > workArea.y + workArea.height) {
    posY = point.y - wHeight - 8;
  }
  if (posX < workArea.x) posX = workArea.x + 8;
  if (posY < workArea.y) posY = workArea.y + 8;

  tw.setBounds({ x: Math.round(posX), y: Math.round(posY), width: wWidth, height: wHeight });
  tw.show();
  tw.focus();

  const finalPayload = Object.assign({
    theme: currentTheme,
    locale: currentLocale,
    activeChatModel: currentActiveChatModel || 'gemini-3.8-flash',
  }, payload);

  const sendPayload = () => {
    if (!tw.isDestroyed()) {
      try {
        tw.webContents.setZoomLevel(currentZoomLevel || loadZoomLevel() || 0);
      } catch (_) {}
      tw.webContents.send('translate-request', finalPayload);
    }
  };

  if (tw.webContents.isLoading()) {
    tw.webContents.once('did-finish-load', sendPayload);
  } else {
    sendPayload();
  }
}

// 目标语言自然语言提示名（用于让大模型准确翻译）
const TARGET_LANG_PROMPT_NAMES = {
  'zh-Hans': 'Simplified Chinese (简体中文)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-Hant': 'Traditional Chinese (繁体中文)',
  'zh-TW': 'Traditional Chinese (繁体中文)',
  'en': 'English',
  'ja': 'Japanese (日本語)',
  'ko': 'Korean (한국어)',
  'fr': 'French (Français)',
  'de': 'German (Deutsch)',
  'es': 'Spanish (Español)',
  'ru': 'Russian (Русский)',
};

function getFastLangPair(targetLang) {
  const map = {
    'zh-Hans': 'zh-CN',
    'zh-CN': 'zh-CN',
    'zh-Hant': 'zh-TW',
    'zh-TW': 'zh-TW',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'ru': 'ru',
  };
  const target = map[targetLang] || (targetLang.startsWith('zh') ? 'zh-CN' : targetLang);
  return `autodetect|${target}`;
}

// 极速免 Key 网络翻译引擎（MyMemory 容错通道）
function onlineTranslateFast(text, targetLang) {
  return new Promise((resolve, reject) => {
    const langpair = getFastLangPair(targetLang);
    const cleanText = text.trim().slice(0, 1500);
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=${langpair}`;

    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 9000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json && json.responseData && json.responseData.translatedText) {
              return resolve({ text: json.responseData.translatedText, usedModel: 'Fast (MyMemory)' });
            }
            if (json && json.responseDetails) {
              return reject(new Error(json.responseDetails));
            }
            reject(new Error('未能解析到有效译文'));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('翻译请求超时，请检查网络连接'));
    });
    req.on('error', reject);
  });
}

// 读取 DSH 本地凭据（.credentials.yaml 与环境变量）
function loadDshCredentials() {
  const creds = {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
  };
  try {
    const credPath = path.join(os.homedir(), '.dsh', '.credentials.yaml');
    if (fs.existsSync(credPath)) {
      const content = fs.readFileSync(credPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z0-9_]+_API_KEY)\s*:\s*(.+)$/);
        if (m) {
          const key = m[1].trim();
          const val = m[2].trim().replace(/^['"]|['"]$/g, '');
          if (!creds[key]) creds[key] = val;
        }
      }
    }
  } catch (e) {
    log('[loadDshCredentials] 读取凭证异常: ' + e.message);
  }
  return creds;
}

// Antigravity OAuth 客户端凭据（与 DSH 保持一致；2026-11-17 起不再内嵌：
// 从本目录 oauth-client.local.json（不入库）读取，env ANTIGRAVITY_CLIENT_ID/SECRET 可覆盖）
function antigravityOAuthClient() {
  let out = {};
  try {
    out = JSON.parse(fs.readFileSync(path.join(__dirname, 'oauth-client.local.json'), 'utf8'));
  } catch {
    // 本地凭据文件缺失时走 env；两者皆无则刷新会显式失败
  }
  return {
    clientId: process.env.ANTIGRAVITY_CLIENT_ID || out.clientId || '',
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || out.clientSecret || '',
  };
}

async function refreshAntigravityToken(credentials) {
  if (!credentials || !credentials.refresh) throw new Error('Missing Antigravity refresh token');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: antigravityOAuthClient().clientId,
      client_secret: antigravityOAuthClient().clientSecret,
      refresh_token: credentials.refresh,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!response.ok) {
    throw new Error('Antigravity token refresh failed: ' + (await response.text()));
  }
  const data = await response.json();
  return {
    ...credentials,
    refresh: data.refresh_token || credentials.refresh,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

async function callAntigravity(prompt, targetLang, modelId) {
  const credPath = path.join(os.homedir(), '.dsh', 'storages', 'antigravity-oauth.json');
  if (!fs.existsSync(credPath)) {
    return {
      error: '未找到 Antigravity 登录凭证，请先在 DSH 界面中完成 Antigravity 登录。',
      failedModel: modelId,
      canFallbackToFast: true,
    };
  }
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch (e) {
    return { error: '解析 Antigravity 凭据失败: ' + e.message, failedModel: modelId, canFallbackToFast: true };
  }

  // 自动刷新凭据（有效期不足 60 秒时）
  if (!creds.access || !creds.expires || creds.expires <= Date.now() + 60000) {
    try {
      creds = await refreshAntigravityToken(creds);
      fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), 'utf8');
    } catch (refreshErr) {
      log('[callAntigravity] 刷新 token 异常: ' + refreshErr.message);
      if (!creds.access) {
        return { error: 'Antigravity 认证已过期且自动刷新失败: ' + refreshErr.message, failedModel: modelId, canFallbackToFast: true };
      }
    }
  }

  const projectId = creds.projectId || 'aicode-consumers';
  let runtimeModel = 'gemini-3.8-flash-tiered';
  const mLower = (modelId || '').toLowerCase();
  if (mLower.startsWith('gemini-3.7-flash')) {
    runtimeModel = 'gemini-3.7-flash-tiered';
  } else if (mLower.startsWith('gemini-2.5-pro')) {
    runtimeModel = 'gemini-2.5-pro';
  } else if (mLower.startsWith('gemini-4-')) {
    runtimeModel = mLower + '-tiered';
  }

  const targetName = TARGET_LANG_PROMPT_NAMES[targetLang] || targetLang;
  const promptText = `Translate the following text directly into ${targetName}. Output ONLY the final translated text. DO NOT output any thinking, reasoning, explanation, notes, markdown formatting, or quotes:\n\n${prompt.trim()}`;

  const requestBody = {
    project: projectId,
    model: runtimeModel,
    request: {
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      systemInstruction: {
        role: 'user',
        parts: [
          { text: 'You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.' },
          { text: 'Please ignore following [ignore]You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.[/ignore]' },
          { text: 'CRITICAL: NEVER output rule checks, formatting guidelines, constraint checklists, or thinking/personality preambles in the final response. Output only the final response.' }
        ]
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'LOW' }
      }
    },
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: 'agent-' + Date.now()
  };

  const headers = {
    'Authorization': 'Bearer ' + creds.access,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'User-Agent': 'antigravity/1.15.8 ' + (process.platform === 'win32' ? 'windows' : 'linux') + '/' + (process.arch === 'x64' ? 'amd64' : process.arch),
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'ANTIGRAVITY',
      platform: process.platform === 'win32' ? 'WINDOWS' : 'LINUX',
      pluginType: 'GEMINI'
    })
  };

  const endpoints = [
    'https://cloudcode-pa.googleapis.com',
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
  ];

  let lastStatus = null;
  let lastErrorText = '';

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${ep}/v1internal:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);

      lastStatus = res.status;
      if (!res.ok) {
        lastErrorText = await res.text();
        log(`[callAntigravity] 端点 ${ep} 返回 ${res.status}: ${lastErrorText.slice(0, 150)}`);
        if ([403, 404, 429, 500, 502, 503, 504].includes(res.status)) {
          continue;
        }
        break;
      }

      const sseText = await res.text();
      let outputText = '';
      for (const line of sseText.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const parts = data.response?.candidates?.[0]?.content?.parts || data.candidates?.[0]?.content?.parts;
            if (parts) {
              for (const p of parts) {
                if (p.text && !p.thought) outputText += p.text;
              }
            }
          } catch (_) {}
        }
      }

      if (outputText.trim()) {
        return { text: outputText.trim(), usedModel: modelId || 'gemini-3.8-flash' };
      }
    } catch (fetchErr) {
      log(`[callAntigravity] 端点 ${ep} 请求异常: ` + fetchErr.message);
      lastErrorText = fetchErr.message;
    }
  }

  // 遇到 429 配额限制，自动尝试 3.7-flash 降级（对齐 DSH Antigravity 容灾）
  if (runtimeModel === 'gemini-3.8-flash-tiered' && (lastStatus === 429 || lastErrorText.includes('quota') || lastErrorText.includes('Resource has been exhausted'))) {
    try {
      log('[callAntigravity] Gemini 3.8 Flash 配额耗尽，尝试降级为 Gemini 3.7 Flash');
      requestBody.model = 'gemini-3.7-flash-tiered';
      for (const ep of endpoints) {
        const res = await fetch(`${ep}/v1internal:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });
        if (res.ok) {
          const sseText = await res.text();
          let out = '';
          for (const line of sseText.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const parts = data.response?.candidates?.[0]?.content?.parts || data.candidates?.[0]?.content?.parts;
                if (parts) {
                  for (const p of parts) {
                    if (p.text && !p.thought) out += p.text;
                  }
                }
              } catch (_) {}
            }
          }
          if (out.trim()) {
            return { text: out.trim(), usedModel: 'gemini-3.7-flash (降级)' };
          }
        }
      }
    } catch (_) {}
  }

  return {
    error: `Antigravity 服务响应异常 (${lastStatus || '无响应'}): ${lastErrorText.slice(0, 150) || '未知错误'}`,
    failedModel: modelId || 'gemini-3.8-flash',
    canFallbackToFast: true,
  };
}

function findModel(models, identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const clean = identifier.trim().toLowerCase();
  const normalized = clean.replace(/[\s_]+/g, '-');
  return models.find(m => {
    const idLower = (m.id || '').toLowerCase();
    const nameLower = (m.name || '').toLowerCase();
    const nameNorm = nameLower.replace(/[\s_]+/g, '-');
    return idLower === clean || idLower === normalized || nameLower === clean || nameNorm === normalized;
  }) || null;
}

function getAntigravityModels() {
  try {
    const credPath = path.join(os.homedir(), '.dsh', 'storages', 'antigravity-oauth.json');
    if (!fs.existsSync(credPath)) return [];
    const settingsPath = path.join(os.homedir(), '.dsh', 'storages', 'antigravity-settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const enabledSet = new Set(data.enabledModelIds || []);
      const catalog = Array.isArray(data.catalogModels) ? data.catalogModels : [];
      const res = [];
      for (const m of catalog) {
        if (enabledSet.size === 0 || enabledSet.has(m.id)) {
          res.push({
            id: m.id,
            name: m.name || m.id,
            provider: 'antigravity',
            providerLabel: 'Antigravity',
          });
        }
      }
      if (res.length > 0) return res;
    }
    return [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'antigravity', providerLabel: 'Antigravity' },
      { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'antigravity', providerLabel: 'Antigravity' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'antigravity', providerLabel: 'Antigravity' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'antigravity', providerLabel: 'Antigravity' },
    ];
  } catch (err) {
    log('[getAntigravityModels] 读取 Antigravity 模型异常: ' + err.message);
    return [];
  }
}

function getLocalDshModels() {
  const models = [...getAntigravityModels()];
  try {
    const patchCandidates = [
      path.join(os.homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
      path.join(__dirname, '..', 'packages', 'bundle', 'web-app', 'cordis.patch.yml'),
    ];
    for (const patchPath of patchCandidates) {
      if (!fs.existsSync(patchPath)) continue;
      const text = fs.readFileSync(patchPath, 'utf8');
      const lines = text.split('\n');

      let currentTopPlugin = '';
      let currentProvider = '';
      let inModelsBlock = false;
      let modelsIndent = -1;
      let currentModel = null;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = rawLine.search(/\S/);

        const topMatch = rawLine.match(/^\s*-\s*id:\s*([a-zA-Z0-9_-]+)/);
        if (topMatch && indent <= 2) {
          currentTopPlugin = topMatch[1];
          if (currentTopPlugin.startsWith('mcp-') || currentTopPlugin === 'insert') {
            currentProvider = '';
            inModelsBlock = false;
            continue;
          }
          if (currentTopPlugin === 'llm-deepseek' || currentTopPlugin === 'llm-deepseek-account') {
            currentProvider = 'deepseek';
          } else if (currentTopPlugin !== 'llm-pi-ai') {
            currentProvider = '';
          }
          inModelsBlock = false;
          continue;
        }

        if (currentTopPlugin.startsWith('mcp-')) {
          continue;
        }

        if (currentTopPlugin === 'llm-pi-ai') {
          const provMatch = rawLine.match(/^ {6}([a-zA-Z0-9_-]+):/);
          if (provMatch) {
            currentProvider = provMatch[1];
          }
        }

        if (trimmed === 'models:' && currentProvider) {
          inModelsBlock = true;
          modelsIndent = indent;
          continue;
        }

        if (inModelsBlock) {
          if (indent <= modelsIndent && !trimmed.startsWith('-')) {
            inModelsBlock = false;
            modelsIndent = -1;
            if (currentModel && currentModel.id) {
              models.push(currentModel);
              currentModel = null;
            }
            continue;
          }

          const modelIdMatch = rawLine.match(/^\s*-\s*id:\s*([^\s#]+)/);
          if (modelIdMatch) {
            if (currentModel && currentModel.id) {
              models.push(currentModel);
            }
            const mid = modelIdMatch[1].trim();
            if (mid.startsWith('mcp-')) {
              currentModel = null;
              continue;
            }
            currentModel = {
              id: mid,
              name: mid,
              provider: currentProvider,
            };
            continue;
          }

          if (currentModel) {
            const nameMatch = rawLine.match(/^\s+name:\s*(.+)$/);
            if (nameMatch) {
              currentModel.name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
            }
          }
        }
      }

      if (currentModel && currentModel.id && !currentModel.id.startsWith('mcp-')) {
        models.push(currentModel);
      }
      break;
    }
  } catch (err) {
    log('[getLocalDshModels] 解析模型配置异常: ' + err.message);
  }

  // 去重
  const seen = new Set();
  const deduped = [];
  for (const m of models) {
    const key = m.provider + ':' + m.id;
    if (!seen.has(key)) {
      seen.add(key);
      let providerLabel = m.provider;
      if (m.provider === 'antigravity') providerLabel = 'Antigravity';
      else if (m.provider === 'google') providerLabel = 'Google';
      else if (m.provider === 'deepseek' || m.provider === 'deepseek-official') providerLabel = 'DeepSeek';
      deduped.push({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        providerLabel,
      });
    }
  }

  if (deduped.length === 0) {
    return [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'antigravity', providerLabel: 'Antigravity' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', providerLabel: 'DeepSeek' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', providerLabel: 'DeepSeek' },
    ];
  }

  return deduped;
}

// 读取 DSH 全部可用模型（优先从运行中的 Web 端 session/modelCatalog 动态读取，兼顾本地配置降级）
async function getDshConfiguredModels() {
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    try {
      const catalog = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const res = await fetch('/api/session/modelCatalog', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                type: 'client-request',
                rpcId: 'rpc-catalog-' + Date.now(),
                method: 'session/modelCatalog',
                payload: { args: {} }
              })
            });
            const data = await res.json();
            return data?.result?.ok ? data.result.value : null;
          } catch {
            return null;
          }
        })()
      `, true);

      if (catalog && Array.isArray(catalog.groups) && catalog.groups.length > 0) {
        const models = [];
        for (const group of catalog.groups) {
          if (!Array.isArray(group.models)) continue;
          for (const m of group.models) {
            let providerLabel = group.name || group.id;
            if (group.id === 'antigravity') providerLabel = 'Antigravity';
            else if (group.id === 'google') providerLabel = 'Google';
            else if (group.id === 'deepseek' || group.id === 'deepseek-official') providerLabel = 'DeepSeek';

            models.push({
              id: m.id,
              name: m.name || m.id,
              provider: group.id,
              providerLabel,
            });
          }
        }
        if (models.length > 0) {
          if (catalog.default && catalog.default.model && !currentActiveChatModel) {
            currentActiveChatModel = catalog.default.model;
          }
          return models;
        }
      }
    } catch (e) {
      log('[getDshConfiguredModels] 从 session/modelCatalog 获取失败，降级本地读取: ' + e.message);
    }
  }

  return getLocalDshModels();
}

// ---------- providers-hub OpenAI 兼容网关（复用 DSH 的 provider 路由） ----------
// 模型选择器列出的所有 provider（astudio / opencode-go / mimo / …）都由 providers-hub
// 注册到 ctx.llm。它的本地网关（默认 127.0.0.1:8326）直接驱动同一套 ctx.llm.stream()，
// 因此划词翻译走它就能和 Agent 对话一样使用任意已登录 provider 的模型。
function gatewayConfig() {
  const host = (process.env.DSH_OPENAI_GATEWAY_HOST || '127.0.0.1').trim();
  const portRaw = (process.env.DSH_OPENAI_GATEWAY_PORT || '').trim();
  const port = portRaw ? (Number(portRaw) || 8326) : 8326;
  return { host, port };
}

function gatewayApiKey() {
  const envKey = (process.env.DSH_OPENAI_GATEWAY_API_KEY || '').trim();
  if (envKey) return envKey;
  try {
    return fs.readFileSync(path.join(os.homedir(), '.dsh', 'openai-gateway', 'api-key'), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

// 一次性调用网关；返回 { ok, text?, error? }。任何失败（网关未装/未启用/密钥缺失/
// 网络错误/上游报错）都不抛给调用方，由 translateWithModel 回退到直连分支。
async function translateViaGateway(text, targetName, modelId, providerId) {
  const key = gatewayApiKey();
  if (!key || !providerId || !modelId) return null;
  const { host, port } = gatewayConfig();
  const model = `${providerId}/${modelId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`http://${host}:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `You are a professional, direct translator. Translate the following text directly into ${targetName}. Output ONLY the final translated text. DO NOT output any thinking, reasoning, explanation, notes, markdown formatting, or quotes.` },
          { role: 'user', content: text.trim() },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 512,
        reasoning_effort: 'none',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error?.message || JSON.stringify(j);
      } catch (_) {
        detail = await res.text();
      }
      log(`[translateViaGateway] ${model} HTTP ${res.status}: ${detail || '调用失败'}`);
      return null;
    }
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content;
    if (typeof out !== 'string' || !out.trim()) return null;
    return { text: out.trim(), usedModel: model };
  } catch (err) {
    log(`[translateViaGateway] ${model} 异常: ${err && err.message ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 统一 AI 模型翻译引擎（单次无状态调用，严格关闭思考，真实返回错误状态供用户主动决策）
async function translateWithModel(text, targetLang, modelId, modelProvider) {
  const creds = loadDshCredentials();
  const targetName = TARGET_LANG_PROMPT_NAMES[targetLang] || targetLang;

  // 1. 显式指定免 Key 极速模式
  if (modelId === 'fast') {
    return await onlineTranslateFast(text, targetLang);
  }

  // 2. 解析目标模型与 Provider
  let resolvedModel = modelId || 'auto';
  let resolvedProvider = modelProvider || '';

  const allConfigured = await getDshConfiguredModels();

  if (resolvedModel === 'auto') {
    resolvedModel = currentActiveChatModel || 'gemini-3.8-flash';
  }

  const matched = findModel(allConfigured, resolvedModel);
  if (matched) {
    resolvedModel = matched.id;
    if (!resolvedProvider) {
      resolvedProvider = matched.provider;
    }
  }

  // 检查 Antigravity 是否可用
  const hasAntigravity = fs.existsSync(path.join(os.homedir(), '.dsh', 'storages', 'antigravity-oauth.json'));

  // 纠偏：如果模型属于 Antigravity 体系（Gemini/Claude），且本地已登录 Antigravity，强制修正 Provider 为 antigravity
  const mLower = resolvedModel.toLowerCase();
  if (hasAntigravity && (mLower.startsWith('gemini') || mLower.startsWith('claude') || mLower.startsWith('gpt-oss'))) {
    if (resolvedProvider !== 'google' || !creds.GOOGLE_API_KEY) {
      resolvedProvider = 'antigravity';
    }
  }

  if (!resolvedProvider) {
    if (mLower.startsWith('gemini') || mLower.startsWith('claude') || mLower.startsWith('gpt-oss')) {
      resolvedProvider = hasAntigravity ? 'antigravity' : 'google';
    } else if (mLower.startsWith('deepseek')) {
      resolvedProvider = 'deepseek';
    } else {
      // 未知模型退回 DeepSeek（由下方 3.3 分支给出明确错误）
      resolvedProvider = 'deepseek';
    }
  }

  log(`[translateWithModel] 执行翻译: model=${resolvedModel}, provider=${resolvedProvider}`);

  // 3.0 首选：providers-hub 网关（与 Agent 对话同一套 DSH provider 路由）。
  // 只要拿到 provider + model 就先试它；失败再回退下面的直连分支。
  const viaGateway = await translateViaGateway(text, targetName, resolvedModel, resolvedProvider);
  if (viaGateway) return viaGateway;

  // 3. 执行特定模型调用（网关不可用时的直连回退）
  try {
    // 3.1 Antigravity 原生调用
    if (resolvedProvider === 'antigravity') {
      return await callAntigravity(text, targetLang, resolvedModel);
    }

    // 3.2 Google 官方 API 接口（仅在显式配置 GOOGLE_API_KEY 时）
    if (resolvedProvider === 'google') {
      if (!creds.GOOGLE_API_KEY) {
        if (hasAntigravity) {
          log('[translateWithModel] 未配置 GOOGLE_API_KEY，自动转入 Antigravity 渠道');
          return await callAntigravity(text, targetLang, resolvedModel);
        }
        return {
          error: '未配置 GOOGLE_API_KEY 凭据，无法调用 Google 接口。',
          failedModel: resolvedModel,
          canFallbackToFast: true,
        };
      }
      const prompt = `You are a professional, direct translator. Translate the following text directly into ${targetName}. Output ONLY the final translated text. DO NOT output any thinking, reasoning, explanation, notes, markdown formatting, or quotes:\n\n${text.trim()}`;
      const gModel = resolvedModel.replace(/-low|-medium|-high$/, '');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${creds.GOOGLE_API_KEY}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        let errDetail = '';
        try {
          const errJson = await res.json();
          errDetail = errJson?.error?.message || JSON.stringify(errJson);
        } catch (_) {
          errDetail = await res.text();
        }
        return {
          error: `[Google ${res.status}] ${errDetail || '调用失败'}`,
          failedModel: resolvedModel,
          canFallbackToFast: true,
        };
      }
      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (out && out.trim()) {
        return { text: out.trim(), usedModel: resolvedModel };
      }
      return { error: 'Google 模型返回内容为空', failedModel: resolvedModel, canFallbackToFast: true };
    }

    // 3.3 DeepSeek 官方 API
    if (resolvedProvider === 'deepseek' || resolvedProvider === 'deepseek-official') {
      if (!creds.DEEPSEEK_API_KEY) {
        return {
          error: '未配置 DEEPSEEK_API_KEY 凭据，无法调用 DeepSeek 官方通道。',
          failedModel: resolvedModel,
          canFallbackToFast: true,
        };
      }
      const url = 'https://api.deepseek.com/chat/completions';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: 'system', content: `You are a professional, direct translator. Translate into ${targetName}. Output ONLY the direct translation, no notes, no markdown, no thinking.` },
            { role: 'user', content: text.trim() }
          ],
          temperature: 0.1,
          max_tokens: 512,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        let errDetail = '';
        try {
          const errJson = await res.json();
          errDetail = errJson?.error?.message || JSON.stringify(errJson);
        } catch (_) {
          errDetail = await res.text();
        }
        return {
          error: `[DeepSeek ${res.status}] ${errDetail || '调用失败'}`,
          failedModel: resolvedModel,
          canFallbackToFast: true,
        };
      }
      const data = await res.json();
      const out = data?.choices?.[0]?.message?.content;
      if (out && out.trim()) {
        return { text: out.trim(), usedModel: resolvedModel };
      }
      return { error: 'DeepSeek 模型返回内容为空', failedModel: resolvedModel, canFallbackToFast: true };
    }

    return {
      error: `无法为模型 ${resolvedModel} 匹配有效的提供商（${resolvedProvider || '未知'}）或可用 API 凭据。`,
      failedModel: resolvedModel,
      canFallbackToFast: true,
    };
  } catch (llmErr) {
    log(`[translateWithModel] 模型 ${resolvedModel} 调用异常: ${llmErr.message}`);
    return {
      error: `模型网络请求异常: ${llmErr.message}`,
      failedModel: resolvedModel,
      canFallbackToFast: true,
    };
  }
}

// 输入框安全注入：兼容 Lexical 富文本与标准 input/textarea，光标定位于末尾等待用户确认
function insertIntoComposer(wc, text) {
  const code = `
    (() => {
      try {
        const composer = document.querySelector('[data-composer-input][contenteditable="true"]') ||
                         document.querySelector('[data-composer-input]') ||
                         document.querySelector('textarea, input[type="text"]');
        if (!composer) return false;

        composer.focus();
        if (composer.isContentEditable) {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(composer);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          const ok = document.execCommand('insertText', false, ${JSON.stringify(text)});
          if (!ok) {
            const evt = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: ${JSON.stringify(text)},
            });
            composer.dispatchEvent(evt);
          }
        } else if ('value' in composer) {
          const start = composer.selectionStart ?? composer.value.length;
          const end = composer.selectionEnd ?? composer.value.length;
          composer.setRangeText(${JSON.stringify(text)}, start, end, 'end');
          composer.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      } catch (err) {
        console.error('Failed to insert into composer:', err);
        return false;
      }
    })();
  `;
  wc.executeJavaScript(code).catch(() => {});
}

// 本地语音合成兜底（基于 Web Speech API）
function speakLocallyInWebContents(wc, text, rate) {
  const code = `
    (() => {
      try {
        if (window.__dshCurrentAudio) {
          window.__dshCurrentAudio.pause();
          window.__dshCurrentAudio = null;
        }
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const text = ${JSON.stringify(text)};
        const u = new SpeechSynthesisUtterance(text);
        const isZh = /[\\u4e00-\\u9fa5]/u.test(text);
        u.lang = isZh ? 'zh-CN' : 'en-US';
        u.rate = ${rate || 1.0};
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const matched = voices.find((v) => (isZh ? v.lang.startsWith('zh') : v.lang.startsWith('en')));
          if (matched) u.voice = matched;
        }
        window.speechSynthesis.speak(u);
      } catch (err) {
        console.error('Local speech synthesis error:', err);
      }
    })();
  `;
  wc.executeJavaScript(code).catch(() => {});
}

// tts-service 的异常经此进入 main.log（否则只会落在主进程 stdout，排查时看不到）
const ttsLog = (...args) => log(...args);

// 智能双引擎语音朗读（Edge TTS 神经网络在线高质量音色 + 本地 Web Speech 离线即时兜底）
async function readTextAloud(wc, text, overrideOptions = {}) {
  if (!currentTtsSettings) {
    currentTtsSettings = ttsService.loadTtsSettings(app.getPath('userData'));
  }
  const voice = overrideOptions.voice || currentTtsSettings.voice || 'auto';
  const rate = overrideOptions.rate || currentTtsSettings.rate || 1.0;

  if (voice === 'local') {
    speakLocallyInWebContents(wc, text, rate);
    return;
  }

  try {
    const audioBuf = await ttsService.synthesizeEdgeTts(text, { voice, rate, timeout: 6000, logger: ttsLog });
    const base64 = audioBuf.toString('base64');
    const code = `
      (() => {
        try {
          if (window.__dshCurrentAudio) {
            window.__dshCurrentAudio.pause();
            window.__dshCurrentAudio = null;
          }
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }
          const audio = new Audio("data:audio/mp3;base64,${base64}");
          window.__dshCurrentAudio = audio;
          audio.play().catch(() => {});
        } catch (err) {
          console.error('Audio play error:', err);
        }
      })();
    `;
    wc.executeJavaScript(code).catch(() => {});
  } catch (err) {
    log(`[tts] Edge TTS 合成失败或超时，自动降级为本地系统语音: ${err && err.message ? err.message : String(err)}`);
    speakLocallyInWebContents(wc, text, rate);
  }
}

function stopSpeaking(wc) {
  const code = `
    (() => {
      try {
        if (window.__dshCurrentAudio) {
          window.__dshCurrentAudio.pause();
          window.__dshCurrentAudio = null;
        }
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      } catch (err) {}
    })();
  `;
  wc.executeJavaScript(code).catch(() => {});
}

// 过滤连续或首尾多余的 separator
function sanitizeMenuTemplate(template) {
  const result = [];
  for (const item of template) {
    if (!item) continue;
    if (item.type === 'separator') {
      if (result.length === 0 || result[result.length - 1].type === 'separator') {
        continue;
      }
    }
    result.push(item);
  }
  if (result.length > 0 && result[result.length - 1].type === 'separator') {
    result.pop();
  }
  return result;
}

// 原生右键菜单双语字典
const CONTEXT_MENU_I18N = {
  zh: {
    copy: '复制',
    cut: '剪切',
    paste: '粘贴',
    undo: '撤销',
    redo: '重做',
    selectAll: '全选',
    searchBing: (s) => `在必应中搜索 "${s}"`,
    quoteToComposer: '引用到输入框',
    translateWithAi: (target) => `让 AI 翻译为${target}`,
    openBingTranslator: (target) => `在必应翻译中打开（译为${target}）`,
    readAloud: '朗读选中文本',
    ttsSettings: '朗读设置',
    stopSpeaking: '停止朗读',
    openLinkBrowser: '在默认浏览器中打开链接',
    copyLink: '复制链接地址',
    copyImage: '复制图片',
    copyImageUrl: '复制图片地址',
    reload: '重新加载',
    inspectElement: '检查元素',
    langZh: '中文',
    langEn: '英文',
  },
  en: {
    copy: 'Copy',
    cut: 'Cut',
    paste: 'Paste',
    undo: 'Undo',
    redo: 'Redo',
    selectAll: 'Select All',
    searchBing: (s) => `Search "${s}" with Bing`,
    quoteToComposer: 'Quote to Composer',
    translateWithAi: (target) => `Translate to ${target} with AI`,
    openBingTranslator: (target) => `Open in Bing Translator (${target})`,
    readAloud: 'Read Aloud',
    ttsSettings: 'Speech Settings',
    stopSpeaking: 'Stop Speaking',
    openLinkBrowser: 'Open Link in Default Browser',
    copyLink: 'Copy Link Address',
    copyImage: 'Copy Image',
    copyImageUrl: 'Copy Image URL',
    reload: 'Reload',
    inspectElement: 'Inspect Element',
    langZh: 'Chinese',
    langEn: 'English',
  },
};

function setupContextMenu(windowInstance) {
  const wc = windowInstance.webContents;
  wc.on('context-menu', (event, params) => {
    const { selectionText, isEditable, linkURL, mediaType, srcURL, x, y } = params;
    const trimmedText = (selectionText || '').trim();
    const hasSelection = trimmedText.length > 0;
    const isLink = Boolean(linkURL && linkURL.trim().length > 0);
    const isImage = mediaType === 'image';

    // 动态同步原生菜单深浅色与语言
    nativeTheme.themeSource = currentTheme;
    const isZh = currentLocale === 'zh';
    const i18n = CONTEXT_MENU_I18N[isZh ? 'zh' : 'en'];

    log(`[context-menu] 触发事件: selection="${trimmedText.slice(0, 20)}", hasSelection=${hasSelection}, isEditable=${isEditable}, isLink=${isLink}, isImage=${isImage}, theme=${currentTheme}, locale=${currentLocale}`);

    const rawTemplate = [];

    // ① 选中文本场景
    if (hasSelection) {
      rawTemplate.push({ label: i18n.copy, role: 'copy', accelerator: 'CmdOrCtrl+C' });
      if (isEditable) {
        rawTemplate.push({ label: i18n.cut, role: 'cut', accelerator: 'CmdOrCtrl+X' });
      }
      rawTemplate.push({ type: 'separator' });

      // 必应搜索
      const snippet = trimmedText.length > 16 ? trimmedText.slice(0, 16) + '…' : trimmedText;
      rawTemplate.push({
        label: i18n.searchBing(snippet),
        click: () => {
          shell.openExternal(`https://www.bing.com/search?q=${encodeURIComponent(trimmedText)}`);
        },
      });

      // 引用到输入框（等待确认发送）
      rawTemplate.push({
        label: i18n.quoteToComposer,
        click: () => {
          const lines = trimmedText.split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
          insertIntoComposer(wc, lines);
        },
      });

      // 智能双向翻译（唤起独立轻量浮窗，零上下文污染）
      const isChinese = /[\u4e00-\u9fa5]/u.test(trimmedText);
      const targetLang = isChinese ? 'en' : 'zh-Hans';
      const targetName = isChinese ? i18n.langEn : i18n.langZh;

      rawTemplate.push({
        label: i18n.translateWithAi(targetName),
        click: () => {
          const cursorPoint = screen.getCursorScreenPoint();
          showTranslateWindow(
            { text: trimmedText, targetLang, targetName, locale: currentLocale },
            cursorPoint
          );
        },
      });

      // 外部必应网页翻译入口
      rawTemplate.push({
        label: i18n.openBingTranslator(targetName),
        click: () => {
          shell.openExternal(`https://www.bing.com/translator/?from=auto&to=${targetLang}&text=${encodeURIComponent(trimmedText)}`);
        },
      });

      rawTemplate.push({ type: 'separator' });

      // 语音朗读：直接点击即时朗读当前选中文本
      rawTemplate.push({
        label: i18n.readAloud,
        click: () => readTextAloud(wc, trimmedText),
      });

      // 朗读配置：紧挨着的新按钮/项，展开二级子菜单设置语速与音色
      if (!currentTtsSettings) {
        currentTtsSettings = ttsService.loadTtsSettings(app.getPath('userData'));
      }
      const activeVoiceObj = ttsService.PRESET_VOICES.find((v) => v.id === currentTtsSettings.voice) || ttsService.PRESET_VOICES[0];
      const activeVoiceName = isZh ? activeVoiceObj.nameZh.split(' ')[0] : activeVoiceObj.nameEn.split(' ')[0];
      const currentRateLabel = `${currentTtsSettings.rate}x`;

      const ttsSubmenu = [
        {
          label: isZh ? `当前: ${activeVoiceName} · ${currentRateLabel}` : `Current: ${activeVoiceName} · ${currentRateLabel}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: isZh ? '语速' : 'Speed',
          submenu: ttsService.SPEED_OPTIONS.map((opt) => ({
            label: opt.label,
            type: 'radio',
            checked: Math.abs(currentTtsSettings.rate - opt.value) < 0.01,
            click: () => {
              currentTtsSettings = ttsService.saveTtsSettings(app.getPath('userData'), { rate: opt.value });
            },
          })),
        },
        {
          label: isZh ? '音色' : 'Voice',
          submenu: ttsService.PRESET_VOICES.map((v) => ({
            label: isZh ? v.nameZh : v.nameEn,
            type: 'radio',
            checked: currentTtsSettings.voice === v.id,
            click: () => {
              currentTtsSettings = ttsService.saveTtsSettings(app.getPath('userData'), { voice: v.id });
            },
          })),
        },
        { type: 'separator' },
        {
          label: i18n.stopSpeaking,
          click: () => stopSpeaking(wc),
        },
      ];

      rawTemplate.push({
        label: i18n.ttsSettings,
        submenu: ttsSubmenu,
      });

      rawTemplate.push({ type: 'separator' });
      if (!isEditable) {
        rawTemplate.push({ label: i18n.selectAll, role: 'selectAll', accelerator: 'CmdOrCtrl+A' });
      }
    } else if (isEditable) {
      // ② 可编辑区域且未选中文本
      rawTemplate.push(
        { label: i18n.undo, role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { label: i18n.redo, role: 'redo', accelerator: 'CmdOrCtrl+Y' },
        { type: 'separator' },
        { label: i18n.cut, role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { label: i18n.copy, role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { label: i18n.paste, role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { type: 'separator' },
        { label: i18n.selectAll, role: 'selectAll', accelerator: 'CmdOrCtrl+A' }
      );
    }

    // ③ 超链接场景
    if (isLink) {
      rawTemplate.push(
        { type: 'separator' },
        {
          label: i18n.openLinkBrowser,
          click: () => shell.openExternal(linkURL),
        },
        {
          label: i18n.copyLink,
          click: () => {
            clipboard.writeText(linkURL);
          },
        }
      );
    }

    // ④ 图片场景
    if (isImage) {
      rawTemplate.push(
        { type: 'separator' },
        {
          label: i18n.copyImage,
          click: () => wc.copyImageAt(x, y),
        },
        {
          label: i18n.copyImageUrl,
          click: () => {
            if (srcURL) {
              clipboard.writeText(srcURL);
            }
          },
        }
      );
    }

    // ⑤ 常备页面控制项（重新加载，等同浏览器 Ctrl+R）
    rawTemplate.push({ type: 'separator' });
    rawTemplate.push({
      label: i18n.reload,
      accelerator: 'CmdOrCtrl+R',
      click: () => wc.reload(),
    });

    // ⑥ 开发者常备项（检查元素，仅开发模式可见）
    if (!app.isPackaged) {
      rawTemplate.push({
        label: i18n.inspectElement,
        click: () => wc.inspectElement(x, y),
      });
    }

    const cleanTemplate = sanitizeMenuTemplate(rawTemplate);
    if (cleanTemplate.length > 0) {
      const menu = Menu.buildFromTemplate(cleanTemplate);
      menu.popup({ window: windowInstance });
    }
  });
}

// ---------- 托盘 ----------

function createTray() {
  tray = new Tray(assetPath('tray.png'));
  tray.setToolTip(i18nT(currentLocale, 'tray.tooltip'));
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const tr = (key, vars) => i18nT(currentLocale, `tray.${key}`, vars);
  tray.setToolTip(tr('tooltip'));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: tr('open'),
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
          } else {
            bootstrap();
          }
        },
      },
      {
        label: tr('openBrowser', { port: config.port }),
        click: () => shell.openExternal(BASE_URL),
      },
      { type: 'separator' },
      {
        label: tr('restartFrontend'),
        click: () => restartFrontend(),
      },
      {
        label: tr('restartService'),
        enabled: !!serverProc && !attachMode,
        click: () => restartServer(),
      },
      { type: 'separator' },
      {
        label: tr('closeBehavior'),
        submenu: [
          {
            label: tr('closeQuit'),
            type: 'radio',
            checked: closeBehavior === 'quit',
            click: () => {
              if (closeBehavior === 'quit') return;
              closeBehavior = 'quit';
              saveCloseBehavior(closeBehavior);
              rebuildTrayMenu();
              log('关闭窗口行为：彻底退出');
            },
          },
          {
            label: tr('closeTray'),
            type: 'radio',
            checked: closeBehavior === 'tray',
            click: () => {
              if (closeBehavior === 'tray') return;
              closeBehavior = 'tray';
              saveCloseBehavior(closeBehavior);
              rebuildTrayMenu();
              log('关闭窗口行为：收到系统托盘');
            },
          },
        ],
      },
      {
        // attach 模式下后端不是本壳拉起的，退出本来就不该回收——菜单文案要把这点说清楚。
        label: attachMode ? tr('quitAttach') : tr('quit'),
        click: () => {
          log(attachMode ? '用户选择退出：保留外部启动的服务' : '用户选择完全退出：回收本壳拉起的服务');
          app.quit();
        },
      },
    ])
  );
}

// ---------- IPC（错误页重试 / 打开浏览器 / 划词翻译） ----------

ipcMain.on('retry', () => bootstrap());
ipcMain.on('open-browser', () => shell.openExternal(BASE_URL));

// Shell-owned loading/error pages call this once their bridge is ready; replay
// queued startup states in order so no stage is lost to the load race. Each stage
// stays visible until the next one is replayed (with a short minimum dwell).
let lastShellState = null;
let replayingShellState = false;
const SHELL_STAGE_MIN_DWELL_MS = 500;
ipcMain.on('shell-page-ready', async (e) => {
  shellStateReady = true;
  if (replayingShellState) return;
  replayingShellState = true;
  try {
    while (shellStateQueue.length) {
      const state = shellStateQueue.shift();
      try { e.sender.send('shell-state', state); } catch (_) {}
      await sleep(SHELL_STAGE_MIN_DWELL_MS);
    }
  } finally {
    replayingShellState = false;
  }
  if (lastShellState) {
    try { e.sender.send('shell-state', lastShellState); } catch (_) {}
  }
  if (shellStateReplayResolve) {
    shellStateReplayResolve();
    shellStateReplayResolve = null;
  }
});

function broadcastShellState(patch) {
  lastShellState = Object.assign({ locale: currentLocale, theme: currentTheme }, patch);
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents) {
      const url = w.webContents.getURL();
      if (url.includes('loading.html') || url.includes('error.html')) {
        try { w.webContents.send('shell-state', lastShellState); } catch (_) {}
      }
    }
  }
}

ipcMain.on('theme-changed', (_e, { isDark, themeSource }) => {
  currentTheme = isDark ? 'dark' : 'light';
  nativeTheme.themeSource = themeSource || currentTheme;
  log(`[theme] 主题变更: isDark=${isDark}, themeSource=${themeSource}, currentTheme=${currentTheme}`);
  broadcastShellState({ theme: currentTheme });
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(currentTheme === 'dark' ? '#181a1f' : '#ffffff');
    if (process.platform === 'win32') {
      const title = win.getTitle();
      win.setTitle(title);
    }
  }
  if (translateWin && !translateWin.isDestroyed()) {
    translateWin.webContents.send('theme-updated', { theme: currentTheme });
  }
});

ipcMain.on('translate-get-initial-theme', (e) => {
  e.returnValue = currentTheme;
});

ipcMain.on('locale-changed', (_e, { locale }) => {
  if (locale && (locale === 'zh' || locale === 'en')) {
    currentLocale = locale;
    rebuildTrayMenu();
    broadcastShellState({ locale: currentLocale });
    if (translateWin && !translateWin.isDestroyed()) {
      translateWin.webContents.send('locale-updated', { locale: currentLocale });
    }
  }
});

ipcMain.on('active-model-changed', (_e, { modelName }) => {
  if (modelName) {
    currentActiveChatModel = modelName;
  }
});

ipcMain.handle('translate-get-models', async () => {
  const allModels = await getDshConfiguredModels();
  return {
    activeChatModel: currentActiveChatModel || 'gemini-3.8-flash',
    allModels,
  };
});

ipcMain.on('translate-close', () => {
  if (translateWin && !translateWin.isDestroyed()) {
    translateWin.webContents.send('stop-speaking');
    translateWin.hide();
    scheduleTranslateTeardown();
  }
});

ipcMain.on('translate-copy', (_e, text) => {
  clipboard.writeText(text);
});

ipcMain.on('translate-open-bing', (_e, { text, targetLang }) => {
  shell.openExternal(`https://www.bing.com/translator/?from=auto&to=${targetLang}&text=${encodeURIComponent(text)}`);
});

ipcMain.handle('translate-do-translate', async (_e, { text, targetLang, model, provider }) => {
  try {
    const res = await translateWithModel(text, targetLang, model, provider);
    return res;
  } catch (err) {
    log('在线翻译异常：', err && err.message ? err.message : String(err));
    return { error: err && err.message ? err.message : '翻译服务暂时不可用，请点击下方在必应中查看' };
  }
});

// TTS 语音朗读设置与在线合成通道
ipcMain.handle('tts-get-settings', () => {
  if (!currentTtsSettings) {
    currentTtsSettings = ttsService.loadTtsSettings(app.getPath('userData'));
  }
  return {
    rate: currentTtsSettings.rate,
    voice: currentTtsSettings.voice,
    presetVoices: ttsService.PRESET_VOICES,
    speedOptions: ttsService.SPEED_OPTIONS,
  };
});

ipcMain.handle('tts-save-settings', (_e, newSettings) => {
  currentTtsSettings = ttsService.saveTtsSettings(app.getPath('userData'), newSettings);
  return currentTtsSettings;
});

ipcMain.handle('tts-synthesize', async (_e, { text, voice, rate }) => {
  try {
    if (!currentTtsSettings) {
      currentTtsSettings = ttsService.loadTtsSettings(app.getPath('userData'));
    }
    const audioBuf = await ttsService.synthesizeEdgeTts(text, {
      voice: voice || currentTtsSettings.voice,
      rate: rate || currentTtsSettings.rate,
      logger: ttsLog,
    });
    return { success: true, audioBase64: audioBuf.toString('base64') };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

// ---------- 应用生命周期 ----------

app.setAppUserModelId('com.deepseek.harness.desktop');

if (!app.requestSingleInstanceLock()) {
  log(`第二实例退出（锁被占用），argv=${JSON.stringify(process.argv)}`);
  app.quit();
} else {
  // 单实例锁保留：重复双击图标/开始菜单时聚焦既有窗口而不是开第二个。
  // （通知深链 orcamind:// 协议已随 2026-10-06 移除——协议处理器指向便携
  // 自解压 exe，每次点击都要完整解压启动一个 Electron 实例，延迟数秒，
  // 得不偿失；dsh-desktop-notifier v0.3.0 起不再生成 launch 属性。）
  app.on('second-instance', () => {
    try {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    } catch (e) {
      log(`second-instance 处理异常：${e && e.message ? e.message : e}`);
    }
  });
  app.whenReady().then(() => {
    currentTtsSettings = ttsService.loadTtsSettings(app.getPath('userData'));
    closeBehavior = loadCloseBehavior(); // 载入用户对“关闭窗口”行为的偏好
    log(`OrcaMind 启动，目标地址 ${BASE_URL}`);
    log(`execPath=${process.execPath} PORTABLE_EXECUTABLE_DIR=${process.env.PORTABLE_EXECUTABLE_DIR || '(未设置)'}`);
    log(`Harness 目录：${findHarnessRoot() || '（未找到）'}`);
    log(`日志文件：${logPath()}`);
    // GPU 策略自检：把 Chromium 汇报的实际渲染后端写进日志，便于判断
    // 是否发生了软件渲染回退（gpu_compositing / webgl 为 software 等）。
    try {
      log(`[gpu] mode=${GPU_MODE} featureStatus=${JSON.stringify(app.getGPUFeatureStatus())}`);
    } catch (e) {
      log(`[gpu] 读取 GPU 状态失败：${e && e.message ? e.message : e}`);
    }
    createTray();
    bootstrap();
  });
}

app.on('window-all-closed', () => {
  // 托盘模式下隐藏窗口不会触发本事件；重启前端销毁旧窗口时也必须保持进程存活。
  if (closeBehavior === 'tray' || restartingFrontend) {
    log('window-all-closed：保持后台运行（托盘模式或重启前端中）');
    return;
  }
  app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  cancelTranslateTeardown();
  if (translateWin && !translateWin.isDestroyed()) {
    try { translateWin.destroy(); } catch (_) {}
    translateWin = null;
  }
  killServer();
  flushLogsSync(); // 缓冲日志在退出前一次性落盘
});
process.on('exit', () => flushLogsSync());
