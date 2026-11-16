'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopTranslate', {
  getInitialTheme: () => ipcRenderer.sendSync('translate-get-initial-theme'),
  onTranslateRequest: (cb) => {
    ipcRenderer.removeAllListeners('translate-request');
    ipcRenderer.on('translate-request', (_e, data) => cb(data));
  },
  onThemeUpdated: (cb) => {
    ipcRenderer.removeAllListeners('theme-updated');
    ipcRenderer.on('theme-updated', (_e, data) => cb(data));
  },
  onLocaleUpdated: (cb) => {
    ipcRenderer.removeAllListeners('locale-updated');
    ipcRenderer.on('locale-updated', (_e, data) => cb(data));
  },
  onStopSpeaking: (cb) => {
    ipcRenderer.removeAllListeners('stop-speaking');
    ipcRenderer.on('stop-speaking', () => cb());
  },
  getModels: () => ipcRenderer.invoke('translate-get-models'),
  doTranslate: (data) => ipcRenderer.invoke('translate-do-translate', data),
  copyText: (text) => ipcRenderer.send('translate-copy', text),
  openBing: (data) => ipcRenderer.send('translate-open-bing', data),
  close: () => ipcRenderer.send('translate-close'),
  getTtsSettings: () => ipcRenderer.invoke('tts-get-settings'),
  saveTtsSettings: (data) => ipcRenderer.invoke('tts-save-settings', data),
  ttsSynthesize: (data) => ipcRenderer.invoke('tts-synthesize', data),
});
