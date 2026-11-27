'use strict';
// Sample pixel colors from a PNG to verify theme rendering.
const fs = require('fs');
const zlib = require('zlib');

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit supported, got ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (!channels) throw new Error('unsupported colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const cur = out.slice(y * stride, y * stride + stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 255; break;
        }
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const file = process.argv[2];
const img = decodePng(file);
console.log(`${file}  ${img.width}x${img.height} channels=${img.channels}`);
const probes = process.argv.slice(3);
const points = probes.length
  ? probes.map((p) => { const [x, y] = p.split(',').map(Number); return { x, y }; })
  : [
      { x: Math.round(img.width * 0.5), y: Math.round(img.height * 0.06) },
      { x: Math.round(img.width * 0.08), y: Math.round(img.height * 0.5) },
      { x: Math.round(img.width * 0.5), y: Math.round(img.height * 0.32) },
    ];
for (const pt of points) {
  const i = pt.y * img.width * img.channels + pt.x * img.channels;
  const px = Array.from(img.data.slice(i, i + img.channels));
  console.log(`  (${pt.x},${pt.y}) = rgb(${px.slice(0, 3).join(',')}) alpha=${px[3] === undefined ? 'n/a' : px[3]}`);
}
