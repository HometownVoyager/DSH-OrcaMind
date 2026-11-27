'use strict';
// Trace desktop/build/icon.png (the real OrcaMind/DSH whale mark) into an SVG path.
// Output: desktop/build/whale-mark.svg  (single-color silhouette + eye cutout)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, '..', 'build', 'icon.png');
const OUT = path.join(__dirname, '..', 'build', 'whale-mark.svg');

function decodePng(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.slice(p + 4, p + 8).toString();
    if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (type === 'IDAT') idat.push(b.slice(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bb = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + bb) & 255;
      else if (ft === 3) v = (v + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const pp = a + bb - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255;
      }
      cur[x] = v;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }
  return { w, h, px };
}

const { w, h, px } = decodePng(SRC);
const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : (px[(y * w + x) * 4 + 3] > 128 ? 1 : 0);

// Pixel-corner lattice edges between filled and empty cells.
const segs = [];
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) segs.push([[x, y], [x + 1, y]]);
    if (!at(x + 1, y)) segs.push([[x + 1, y], [x + 1, y + 1]]);
    if (!at(x, y + 1)) segs.push([[x + 1, y + 1], [x, y + 1]]);
    if (!at(x - 1, y)) segs.push([[x, y + 1], [x, y]]);
  }
}

const key = (p) => p[0] + ',' + p[1];
const starts = new Map();
segs.forEach((s, i) => {
  const k = key(s[0]);
  if (!starts.has(k)) starts.set(k, []);
  starts.get(k).push(i);
});

const used = new Uint8Array(segs.length);
const loops = [];
for (let i = 0; i < segs.length; i++) {
  if (used[i]) continue;
  used[i] = 1;
  const loop = [segs[i][0], segs[i][1]];
  let guard = 0;
  while (guard++ < 500000) {
    const end = loop[loop.length - 1];
    if (key(end) === key(loop[0])) break;
    const cands = (starts.get(key(end)) || []).filter((j) => !used[j]);
    if (!cands.length) break;
    const j = cands[0];
    used[j] = 1;
    loop.push(segs[j][1]);
  }
  if (loop.length > 8) loops.push(loop);
}

// Perpendicular distance from p to the infinite line through a,b.
function distToLine(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const norm = Math.hypot(dx, dy);
  if (norm === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / norm;
}

// Ramer–Douglas–Peucker on an OPEN polyline (endpoints preserved).
function rdpOpen(points, eps) {
  if (points.length < 3) return points.slice();
  const first = points[0], last = points[points.length - 1];
  let maxD = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToLine(points[i], first, last);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdpOpen(points.slice(0, idx + 1), eps);
    const right = rdpOpen(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// Closed-ring simplification: split at the two most distant vertices so the
// degenerate "first == last" case cannot collapse the whole outline.
function simplifyRing(ring, eps) {
  const pts = ring.slice();
  if (pts.length > 1 && key(pts[0]) === key(pts[pts.length - 1])) pts.pop();
  if (pts.length < 6) return pts.concat([pts[0]]);
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = rdpOpen(pts.slice(0, far + 1), eps);
  const b = rdpOpen(pts.slice(far).concat([pts[0]]), eps);
  const out = a.slice(0, -1).concat(b);
  return out;
}

function area(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

const simplified = loops
  .map((l) => simplifyRing(l, 1.15))
  .filter((l) => l.length > 4)
  .sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));

// Largest ring is the body outline; smaller rings are cutouts (eye / belly gaps).
const fmt = (n) => (Math.round(n * 10) / 10).toString();
let d = '';
simplified.forEach((ring, i) => {
  // Force outer ring clockwise and holes counter-clockwise for evenodd-independent fill.
  const a = area(ring);
  const wantPositive = i === 0;
  const pts = (a > 0) === wantPositive ? ring : ring.slice().reverse();
  d += `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let k = 1; k < pts.length; k++) d += `L${fmt(pts[k][0])} ${fmt(pts[k][1])}`;
  d += 'Z';
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <!-- Traced from build/icon.png (OrcaMind whale mark); single color via currentColor. -->
  <path fill="currentColor" fill-rule="evenodd" d="${d}"/>
</svg>
`;
fs.writeFileSync(OUT, svg);
console.log('rings:', simplified.map((r) => `${r.length}pts area=${Math.round(area(r))}`).join(' | '));
console.log('path bytes:', d.length, '->', OUT);
