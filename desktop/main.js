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

let currentTtsSettings = null; // 语音朗读设置（语速/音色），在 app.whenReady 后从 userData 读取并在使用时记忆留存

const APP_TITLE = 'OrcaMind';
const DEFAULT_PORT = 3080;
const BOOT_TIMEOUT_MS = 60000; // 服务启动最长等待
const POLL_INTERVAL_MS = 500;

// ---------- 配置 ----------

// 读取 exe 旁（打包后）或 desktop/ 下（开发）的 desktop.config.json，再叠加环境变量。
// 可用字段：{ "DSH_ROOT": "D:/Tools/DeepSeek Harness", "port": 3080 }
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
  };
}

const config = loadConfig();
const BASE_URL = `http://${config.host}:${config.port}`;

// ---------- 状态 ----------

let win = null; // 主窗口
let tray = null; // 托盘
let serverProc = null; // 我们拉起的服务进程（attach 模式下为 null）
let attachMode = false; // true = 服务在启动前就已存在，退出时不回收
let authUrl = null; // 服务进程 stdout 里解析出的带 token 的 BASE_URL（dsh web 0.1.2 起需要认证）
let quitting = false; // 正在退出
let restarting = false; // 正在重启服务
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

function log(...args) {
  const line = `[${new Date().toLocaleTimeString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    const file = path.join(app.getPath('userData'), 'main.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
      try { fs.renameSync(file, file + '.1'); } catch (_) {}
    }
    fs.appendFileSync(file, line + '\n');
  } catch {
    /* 日志写失败不影响运行 */
  }
}

function logPath() {
  return path.join(app.getPath('userData'), 'main.log');
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
      showError(`服务进程异常退出（code=${code}）。可点下方「重试启动」，或从托盘菜单「重启服务」。`);
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

// 启动主流程：先探测，已运行就挂载；否则拉起服务并等待就绪
async function bootstrap() {
  killServer(); // 清理上一次尝试遗留的进程
  restarting = false;
  if (await checkServer()) {
    attachMode = true;
    log(`检测到 Harness 服务已在 ${BASE_URL} 运行，直接挂载（退出时不影响该服务）`);
    openWindow(BASE_URL);
    return;
  }
  attachMode = false;
  showLoading('正在启动 DeepSeek Harness 服务…');
  const err = await startServer();
  if (err) {
    showError(err);
    return;
  }
  log('等待服务就绪 …');
  for (let waited = 0; waited < BOOT_TIMEOUT_MS; waited += POLL_INTERVAL_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (await checkServer(600)) {
      openWindow(await targetUrl()); // 带 token 的 BASE_URL 首次认证（之后 30 天 cookie 有效）
      return;
    }
  }
  showError(`服务启动超时（${BOOT_TIMEOUT_MS / 1000} 秒）。详情见日志：${logPath()}`);
}

async function restartServer() {
  if (!serverProc) return;
  restarting = true;
  log('重启服务 …');
  showLoading('正在重启服务…');
  killServer();
  await sleep(1500);
  const err = await startServer();
  if (err) {
    restarting = false;
    showError(err);
    return;
  }
  for (let waited = 0; waited < BOOT_TIMEOUT_MS; waited += POLL_INTERVAL_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (await checkServer(600)) {
      restarting = false;
      openWindow(await targetUrl());
      return;
    }
  }
  restarting = false;
  showError('服务重启超时。');
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
  win.on('close', () => app.quit());
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

function showLoading(msg) {
  const w = ensureWindow();
  w.loadFile(path.join(__dirname, 'loading.html'), { query: { msg } });
  w.show();
}

function showError(msg) {
  const w = ensureWindow();
  w.loadFile(path.join(__dirname, 'error.html'), { query: { msg } });
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
      sandbox: false,
    },
  });
  translateWin.loadFile(path.join(__dirname, 'translate.html'));

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
    }
  });
  return translateWin;
}

function showTranslateWindow(payload, triggerBounds) {
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
    OPENCODE_GO_API_KEY: process.env.OPENCODE_GO_API_KEY || '',
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
      else if (m.provider === 'opencode-go') providerLabel = 'OpenCode-Go';
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
      { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', provider: 'opencode-go', providerLabel: 'OpenCode-Go' },
      { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', provider: 'opencode-go', providerLabel: 'OpenCode-Go' },
      { id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash', provider: 'opencode-go', providerLabel: 'OpenCode-Go' },
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
            else if (group.id === 'opencode-go') providerLabel = 'OpenCode-Go';
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
      resolvedProvider = 'opencode-go';
    }
  }

  log(`[translateWithModel] 执行翻译: model=${resolvedModel}, provider=${resolvedProvider}`);

  // 3. 执行特定模型调用
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

    // 3.4 OpenCode-Go 网关上的全部模型
    if (resolvedProvider === 'opencode-go') {
      if (!creds.OPENCODE_GO_API_KEY) {
        return {
          error: '未配置 OPENCODE_GO_API_KEY 凭据，无法调用 OpenCode 模型。',
          failedModel: resolvedModel,
          canFallbackToFast: true,
        };
      }
      const url = 'https://opencode.ai/zen/go/v1/chat/completions';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const sessId = 'sess-' + crypto.randomUUID();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.OPENCODE_GO_API_KEY}`,
          'x-opencode-session': sessId,
          'x-deepseek-harness-session-id': sessId,
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: 'system', content: `You are a professional, direct translator. Translate into ${targetName}. Output ONLY the direct translation. Do NOT output any thinking, reasoning, explanation, or notes.` },
            { role: 'user', content: text.trim() }
          ],
          temperature: 0.1,
          max_tokens: 512,
          reasoning_effort: 'none',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        let errDetail = '';
        try {
          const errJson = await res.json();
          errDetail = errJson?.error?.message || errJson?.message || JSON.stringify(errJson);
        } catch (_) {
          errDetail = await res.text();
        }
        return {
          error: `[OpenCode-Go ${res.status}] ${errDetail || '调用失败'}`,
          failedModel: resolvedModel,
          canFallbackToFast: true,
        };
      }
      const data = await res.json();
      const out = data?.choices?.[0]?.message?.content;
      if (out && out.trim()) {
        return { text: out.trim(), usedModel: resolvedModel };
      }
      return { error: 'OpenCode 模型返回内容为空', failedModel: resolvedModel, canFallbackToFast: true };
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
    const audioBuf = await ttsService.synthesizeEdgeTts(text, { voice, rate, timeout: 6000 });
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
  tray.setToolTip(APP_TITLE);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const isZh = currentLocale === 'zh';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isZh ? '打开 Harness 窗口' : 'Open Harness Window',
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
        label: isZh ? `在浏览器中打开 Web 版（${config.port} 端口）` : `Open Web GUI in Browser (Port ${config.port})`,
        click: () => shell.openExternal(BASE_URL),
      },
      { type: 'separator' },
      {
        label: isZh ? '重启服务' : 'Restart Service',
        enabled: !!serverProc && !attachMode,
        click: () => restartServer(),
      },
      {
        label: isZh ? '退出' : 'Quit',
        click: () => app.quit(),
      },
    ])
  );
}

// ---------- IPC（错误页重试 / 打开浏览器 / 划词翻译） ----------

ipcMain.on('retry', () => bootstrap());
ipcMain.on('open-browser', () => shell.openExternal(BASE_URL));

ipcMain.on('theme-changed', (_e, { isDark, themeSource }) => {
  currentTheme = isDark ? 'dark' : 'light';
  nativeTheme.themeSource = themeSource || currentTheme;
  log(`[theme] 主题变更: isDark=${isDark}, themeSource=${themeSource}, currentTheme=${currentTheme}`);
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
    log(`OrcaMind 启动，目标地址 ${BASE_URL}`);
    log(`execPath=${process.execPath} PORTABLE_EXECUTABLE_DIR=${process.env.PORTABLE_EXECUTABLE_DIR || '(未设置)'}`);
    log(`Harness 目录：${findHarnessRoot() || '（未找到）'}`);
    log(`日志文件：${logPath()}`);
    createTray();
    bootstrap();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  killServer();
});
