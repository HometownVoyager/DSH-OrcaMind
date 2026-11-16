'use strict';

// 生成应用图标（纯 Node 实现，零依赖）：
//   build/icon.png  256x256 —— 窗口图标 + electron-builder 打包用（自动转 .ico）
//   build/tray.png  32x32  —— 系统托盘
// 图案：深蓝渐变圆角方块 + 白色字母 D

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'build');

// ---------- 最小 PNG 编码 ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePNG(file, size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  // 每行前加 filter 字节 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

// ---------- 绘制 ----------

function draw(size) {
  const px = Buffer.alloc(size * size * 4); // 初始全透明
  const R = size * 0.22; // 圆角半径
  const inner = [R, R, size - R, size - R]; // 圆角矩形内矩形
  // 字母 D：左侧竖条 + 右侧半圆环（中心在方块中点）
  const bar = [0.36, 0.26, 0.48, 0.74]; // x0,y0,x1,y1（相对比例）
  const cx = 0.5 * size;
  const cy = 0.5 * size;
  const Ro = 0.24 * size; // 外半径
  const Ri = 0.12 * size; // 内半径
  // 渐变：顶部深蓝 → 底部亮蓝
  const top = [0x0e, 0x1b, 0x3d];
  const bottom = [0x2f, 0x6b, 0xff];

  for (let y = 0; y < size; y++) {
    const py = y + 0.5;
    for (let x = 0; x < size; x++) {
      const p = x + 0.5;
      // 圆角矩形 SDF：先夹到内矩形，再算距离
      const qx = Math.max(inner[0], Math.min(p, inner[2]));
      const qy = Math.max(inner[1], Math.min(py, inner[3]));
      const d = Math.hypot(p - qx, py - qy) - R;
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - d)); // 边缘 1px 抗锯齿
      if (bgAlpha <= 0) continue;

      const t = py / size;
      const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
      const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
      const b = Math.round(top[2] + (bottom[2] - top[2]) * t);

      // 字母 D：竖条 或 右半圆环
      const inBar =
        p >= bar[0] * size && p <= bar[1] * size && py >= bar[2] * size && py <= bar[3] * size;
      const dist = Math.hypot(p - cx, py - cy);
      const inBowl = p >= cx && dist >= Ri && dist <= Ro;
      const letter = inBar || inBowl;

      const o = (y * size + x) * 4;
      if (letter) {
        px[o] = 0xff;
        px[o + 1] = 0xff;
        px[o + 2] = 0xff;
        px[o + 3] = Math.round(bgAlpha * 255);
      } else {
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = Math.round(bgAlpha * 255);
      }
    }
  }
  return px;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
writePNG(path.join(OUT_DIR, 'icon.png'), 256, draw(256));
writePNG(path.join(OUT_DIR, 'tray.png'), 32, draw(32));
console.log('已生成 build/icon.png (256x256) 和 build/tray.png (32x32)');
