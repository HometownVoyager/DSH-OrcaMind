'use strict';
// Standalone preview of shell-owned pages. Usage:
//   electron scripts/preview-loading.js [dark|light] [zh|en] [loading|error] [out.png]
// When an output path is given, the window content is captured (capturePage) and
// the app quits afterwards — no window needs to be visible on screen.
// The resolved theme is printed so the capture can be sanity-checked.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const theme = args[0] || 'dark';
const locale = args[1] || 'zh';
const page = args[2] || 'loading';
const out = args[3] || '';

app.disableHardwareAcceleration();

// A dedicated user-data-dir keeps preview runs from colliding with a running
// OrcaMind instance (single-instance lock) or a stale profile.
app.setPath('userData', path.join(require('os').tmpdir(), 'orca-preview-' + process.pid));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    title: 'OrcaMind Startup Preview',
    backgroundColor: theme === 'dark' ? '#151517' : '#f9fafb',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const file = page === 'error' ? 'error.html' : 'loading.html';
  const query = page === 'error'
    ? { locale, theme, msg: '找不到 DeepSeek Harness 安装目录。\n请把本程序放到 Harness 目录下，或指定 DSH_ROOT。' }
    : { locale, theme };
  win.loadFile(path.join(__dirname, '..', file), { query });
  win.webContents.on('did-finish-load', async () => {
    if (page === 'loading') {
      // Drive a realistic mid-startup state so the "current action" line,
      // the progress bar and the percentage are all exercised.
      setTimeout(() => {
        win.webContents.executeJavaScript(`
          window.shellLoading.setStage('wait', '', false);
          window.shellLoading.setProgress(46);
        `);
      }, 200);
    }
    if (!out) return;
    // Give fonts/layout a beat to settle before grabbing the frame.
    await new Promise((r) => setTimeout(r, 1500));
    const resolved = await win.webContents.executeJavaScript(`(() => ({
      themeAttr: document.body.getAttribute('data-ds-dark-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(document.body).getPropertyValue('--shell-accent').trim(),
    }))()`);
    console.log('resolved ' + JSON.stringify(resolved));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.resolve(out), image.toPNG());
    console.log('captured ' + path.resolve(out));
    app.quit();
  });
});
