'use strict';

// Renderer-side i18n for shell-owned pages. Only plain string lookups are used;
// no Node/Electron APIs are exposed to the page.
(function () {
  var zh = {
    'loading.eyebrow': 'DEEPSEEK HARNESS ORCAMIND',
    'loading.title': '正在唤醒 OrcaMind',
    'loading.progress': '启动进度',
    'loading.ready': '就绪，正在进入…',
    'loading.stage.check': '检查本地服务',
    'loading.stage.checking': '正在探测本地服务…',
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
    'common.retry': '重试启动',
    'common.openBrowser': '在浏览器中打开',
  };
  var en = {
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
    'common.retry': 'Retry Startup',
    'common.openBrowser': 'Open in Browser',
  };

  window.shellI18n = {
    forLocale: function (locale) {
      return locale === 'en' ? en : zh;
    },
  };
})();
