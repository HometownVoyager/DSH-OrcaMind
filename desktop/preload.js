'use strict';

// 最小化预加载脚本：暴露基础操作，并自动同步 DSH 主题、语言及会话状态给主进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  retry: () => ipcRenderer.send('retry'),
  openBrowser: () => ipcRenderer.send('open-browser'),
});

// 主题状态自动感知与同步
function detectTheme() {
  const root = document.documentElement;
  const themeSource = root ? root.getAttribute('data-ds-theme-source') : null;
  const hasDarkAttr = Boolean(document.body && document.body.hasAttribute('data-ds-dark-theme'));
  const colorScheme = (root && root.style && root.style.colorScheme) || '';

  let isDark = false;
  if (themeSource === 'dark') {
    isDark = true;
  } else if (themeSource === 'light') {
    isDark = false;
  } else if (themeSource === 'system') {
    // 跟随系统：DSH 已将根据系统偏好解析后的深浅色反映在 body[data-ds-dark-theme] 与 colorScheme
    isDark = hasDarkAttr || colorScheme === 'dark';
  } else {
    // 尚未挂载 data-ds-theme-source 属性时的初始兜底判断
    if (hasDarkAttr) {
      isDark = true;
    } else if (colorScheme === 'dark') {
      isDark = true;
    } else if (colorScheme === 'light') {
      isDark = false;
    } else {
      isDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }

  return { isDark, themeSource: themeSource || (isDark ? 'dark' : 'light') };
}

let lastNotifiedThemeKey = null;

function checkAndNotifyTheme() {
  try {
    const { isDark, themeSource } = detectTheme();
    const key = `${isDark}-${themeSource}`;
    if (key !== lastNotifiedThemeKey) {
      lastNotifiedThemeKey = key;
      ipcRenderer.send('theme-changed', { isDark, themeSource });
    }
  } catch (err) {}
}

function setupThemeObserver() {
  try {
    checkAndNotifyTheme();

    const observer = new MutationObserver(() => {
      checkAndNotifyTheme();
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-ds-theme-source', 'style'],
      });
    }

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'style'],
      });
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-ds-dark-theme', 'style'],
          });
        }
        checkAndNotifyTheme();
      }, { once: true });
    }

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', checkAndNotifyTheme);
    }
  } catch (err) {}
}

// 语言状态自动感知与同步（zh / en）
function checkAndNotifyLocale() {
  try {
    const htmlLang = (document.documentElement && document.documentElement.lang) || '';
    const navLang = (typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) || '';
    const isZh = htmlLang.startsWith('zh') || (!htmlLang && navLang.startsWith('zh'));
    ipcRenderer.send('locale-changed', { locale: isZh ? 'zh' : 'en' });
  } catch (err) {}
}

function setupLocaleObserver() {
  try {
    checkAndNotifyLocale();
    if (document.documentElement) {
      const observer = new MutationObserver(() => {
        checkAndNotifyLocale();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
  } catch (err) {}
}

// 当前活跃对话模型探测
function checkAndNotifyActiveModel() {
  try {
    const btn = document.querySelector('button[aria-haspopup="menu"] span') ||
                document.querySelector('[data-slot="conversation.composer.bar"] button span');
    if (btn && btn.textContent) {
      const modelName = btn.textContent.trim();
      if (modelName) {
        ipcRenderer.send('active-model-changed', { modelName });
      }
    }
  } catch (err) {}
}

function initPreload() {
  setupThemeObserver();
  setupLocaleObserver();
  checkAndNotifyActiveModel();
  // 页面点击或选中文本时顺便探测一次当前选择的模型
  window.addEventListener('mouseup', checkAndNotifyActiveModel, { passive: true });
  window.addEventListener('click', checkAndNotifyActiveModel, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPreload);
} else {
  initPreload();
}
