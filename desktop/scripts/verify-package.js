'use strict';
// Verify the packaged asar actually contains the new shell pages/styles.
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

const asarPath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
if (!fs.existsSync(asarPath)) {
  console.error('MISSING ' + asarPath);
  process.exit(1);
}

const checks = [
  { file: 'loading.html', must: ['DEEPSEEK HARNESS ORCAMIND', 'shell-progress-action', 'id="stage"', 'id="pct"', 'id="bar"'] },
  { file: 'error.html', must: ['DEEPSEEK HARNESS ORCAMIND', 'shell-mark--error', 'shell-badge', 'shell-sweat', 'id="msg"'] },
  { file: 'shell-theme.css', must: ['.shell-progress-action', '.shell-badge', '.shell-bar', '.shell-sweat', '--shell-danger'] },
  { file: 'shell-i18n.client.js', must: ['loading.stage.waiting', 'error.detail'] },
  { file: 'shell-i18n.js', must: ['loading.stage.waiting', 'error.serverExit', 'tray.closeBehavior', 'tray.closeQuit', 'tray.closeTray', 'tray.quitAttach'] },
  { file: 'main.js', must: ['closeBehavior', "CLOSE_BEHAVIOR_FILE", "restartingFrontend", 'ensureWebSession'] },
  // 2026-11-27 性能修复：打包产物里必须真的带上这些改动，且旧实现不得残留。
  { file: 'main.js', must: ['GPU_MODE', 'scheduleTranslateTeardown', 'cancelTranslateTeardown', 'waitForServerReady', 'flushLogsSync', 'POLL_MAX_MS'], mustNot: ['POLL_INTERVAL_MS'] },
  { file: 'shell-theme.css', must: ['backdrop-filter: none', 'translateY(12vh)'], mustNot: ['animation: grid-drift', 'backdrop-filter: blur(20px)'] },
  { file: 'preload.js', must: ['lastNotifiedModel', 'lastNotifiedLocale'] },
  { file: 'tts-service.js', must: ['chunkParseErrors', 'logger'] },
  { file: 'desktop.config.json', must: ['gpuMode'] },
];

let failed = 0;
for (const check of checks) {
  let content = '';
  try {
    content = asar.extractFile(asarPath, check.file).toString('utf8');
  } catch (err) {
    console.log(`MISSING FILE  ${check.file}  (${err.message})`);
    failed++;
    continue;
  }
  const missing = check.must.filter((m) => !content.includes(m));
  if (missing.length) {
    console.log(`FAIL  ${check.file}  missing: ${missing.join(' | ')}`);
    failed++;
  } else {
    console.log(`OK    ${check.file}  (${content.length} bytes)`);
  }
  const stale = (check.mustNot || []).filter((m) => content.includes(m));
  if (stale.length) {
    console.log(`STALE ${check.file} still contains: ${stale.join(' | ')}`);
    failed++;
  }
}

// The removed rings must not linger in the packaged pages.
const commonStale = ['shell-progress-ring', 'shell-orbit--outer', 'shell-orbit--inner', 'shell-subtitle'];
for (const file of ['loading.html', 'error.html']) {
  const content = asar.extractFile(asarPath, file).toString('utf8');
  const stale = commonStale.filter((m) => content.includes(m));
  if (stale.length) {
    console.log(`STALE ${file} still references: ${stale.join(' | ')}`);
    failed++;
  }
}
// Error page must not contain the removed label / hint / browser button.
const errorContent = asar.extractFile(asarPath, 'error.html').toString('utf8');
const errorStale = ['id="msg-label"', 'id="hint"', 'id="browser"'].filter((m) => errorContent.includes(m));
if (errorStale.length) {
  console.log(`STALE error.html still references: ${errorStale.join(' | ')}`);
  failed++;
}

console.log(failed === 0 ? '\nALL PACKAGED CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
