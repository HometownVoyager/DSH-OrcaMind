'use strict';
// Render build/whale-mark.svg next to the source PNG for visual comparison.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'whale-mark.svg'), 'utf8');
  const png = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#151517;color:#f4f6f9;font-family:'Segoe UI',sans-serif;display:flex;gap:40px;align-items:center;justify-content:center;height:100vh}
    .box{text-align:center}
    .dark,.light{width:220px;height:220px;display:grid;place-items:center;border-radius:16px}
    .dark{background:#151517;border:1px solid rgba(255,255,255,.12);color:#f4f6f9}
    .light{background:#f9fafb;border:1px solid rgba(0,0,0,.1);color:#0f0f12}
    svg,img{width:170px;height:170px}
    p{font-size:12px;opacity:.7;margin-top:10px}
  </style></head><body>
    <div class="box"><div class="light">${svg}</div><p>traced SVG · light</p></div>
    <div class="box"><div class="dark">${svg}</div><p>traced SVG · dark</p></div>
    <div class="box"><div class="light"><img src="data:image/png;base64,${png}"></div><p>source icon.png</p></div>
  </body></html>`;
  const win = new BrowserWindow({ width: 900, height: 420, backgroundColor: '#151517' });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});
