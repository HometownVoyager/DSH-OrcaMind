'use strict';

// Shared locale strings for OrcaMind shell-owned pages (loading/error) and tray menu.
// Keys are kept flat and English-named; values are the actual display strings.
const STRINGS = {
  zh: {
    'app.name': 'OrcaMind',
    'common.retry': '重试启动',
    'common.openBrowser': '在浏览器中打开',
    'common.cancel': '取消',

    'loading.eyebrow': 'DEEPSEEK HARNESS ORCAMIND',
    'loading.title': '正在唤醒 OrcaMind',
    'loading.progress': '启动进度',
    'loading.ready': '就绪，正在进入…',
    'loading.stage.check': '检查本地服务',
    'loading.stage.checking': '正在探测 LocalHost 服务…',
    'loading.stage.check.done': '本地服务已就绪',
    'loading.stage.attach': '已检测到运行中的服务',
    'loading.stage.locate': '定位 Harness 安装目录',
    'loading.stage.locating': '正在定位安装目录…',
    'loading.stage.spawn': '启动后端服务',
    'loading.stage.spawning': '正在拉起本地服务进程…',
    'loading.stage.wait': '等待服务就绪',
    'loading.stage.waiting': '正在等待端口响应…',
    'loading.stage.auth': '建立安全会话',
    'loading.stage.authing': '正在获取访问凭据…',
    'loading.stage.load': '载入前端界面',
    'loading.stage.loading': '正在加载工作台…',

    'error.title': '启动失败',
    'error.unknown': '未知错误',
    'error.detail': '错误详情',
    'error.hint': '请检查日志后重试，或在浏览器中打开 Web 版。',
    'error.serverExit': '服务进程异常退出（code={code}）。可点下方「重试启动」，或从托盘菜单「重启服务」。',

    'tray.open': '打开 Harness 窗口',
    'tray.openBrowser': '在浏览器中打开 Web 版（{port} 端口）',
    'tray.restartFrontend': '重启 OrcaMind 前端（保留后端）',
    'tray.restartService': '重启服务',
    'tray.closeBehavior': '关闭窗口时',
    'tray.closeQuit': '彻底退出 OrcaMind',
    'tray.closeTray': '收到系统托盘（界面与后端都继续运行）',
    'tray.quit': '完全退出（含本程序拉起的后端）',
    'tray.quitAttach': '退出 OrcaMind（不停止已在运行的服务）',
    'tray.tooltip': 'OrcaMind — DeepSeek Harness 桌面端',
  },
  en: {
    'app.name': 'OrcaMind',
    'common.retry': 'Retry Startup',
    'common.openBrowser': 'Open in Browser',
    'common.cancel': 'Cancel',

    'loading.eyebrow': 'DEEPSEEK HARNESS ORCAMIND',
    'loading.title': 'Waking up OrcaMind',
    'loading.progress': 'Startup progress',
    'loading.ready': 'Ready — opening workspace…',
    'loading.stage.check': 'Check local service',
    'loading.stage.checking': 'Probing LocalHost service…',
    'loading.stage.check.done': 'Local service is ready',
    'loading.stage.attach': 'Running service detected',
    'loading.stage.locate': 'Locate Harness installation',
    'loading.stage.locating': 'Locating the installation…',
    'loading.stage.spawn': 'Start backend service',
    'loading.stage.spawning': 'Spawning the local service process…',
    'loading.stage.wait': 'Wait for service readiness',
    'loading.stage.waiting': 'Waiting for the port to respond…',
    'loading.stage.auth': 'Establish secure session',
    'loading.stage.authing': 'Retrieving access credentials…',
    'loading.stage.load': 'Load frontend interface',
    'loading.stage.loading': 'Loading the workspace…',

    'error.title': 'Startup failed',
    'error.unknown': 'Unknown error',
    'error.detail': 'Error details',
    'error.hint': 'Check the log and retry, or open the Web GUI in your browser.',
    'error.serverExit': 'The service process exited unexpectedly (code={code}). Click "Retry Startup" below, or use "Restart Service" from the tray menu.',

    'tray.open': 'Open Harness Window',
    'tray.openBrowser': 'Open Web GUI in Browser (Port {port})',
    'tray.restartFrontend': 'Restart OrcaMind Frontend (Keep Backend)',
    'tray.restartService': 'Restart Service',
    'tray.closeBehavior': 'When closing the window',
    'tray.closeQuit': 'Quit OrcaMind entirely',
    'tray.closeTray': 'Minimize to system tray (UI and backend keep running)',
    'tray.quit': 'Quit completely (incl. backend started by this app)',
    'tray.quitAttach': 'Quit OrcaMind (leave the already-running service alone)',
    'tray.tooltip': 'OrcaMind — DeepSeek Harness Desktop',
  },
};

function normalize(locale) {
  return locale === 'en' ? 'en' : 'zh';
}

function t(locale, key, vars) {
  const dict = STRINGS[normalize(locale)] || STRINGS.zh;
  let value = dict[key];
  if (value == null) value = STRINGS.zh[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.split(`{${k}}`).join(String(v));
    }
  }
  return value;
}

module.exports = { t, normalize, STRINGS };
