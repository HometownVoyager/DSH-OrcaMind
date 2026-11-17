// 计算源码依赖指纹：pnpm-lock.yaml + pnpm-workspace.yaml + patches/* 任一变化 → 指纹变。
// 供 更新-Harness.bat 判断"依赖是否需要重装"：
//   node deps-stamp.mjs <sourceDir>                → stdout 打印 16 位指纹
//   node deps-stamp.mjs <sourceDir> --save <file>  → 同时把指纹写入 <file>（无换行）
// 任一文件读取失败 → 非零退出、无输出（bat 侧视为"需要安装"的兜底）。
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const src = process.argv[2];
if (!src || !existsSync(join(src, 'pnpm-lock.yaml'))) {
  console.error('usage: node deps-stamp.mjs <sourceDir> [--save <markerFile>]');
  process.exit(1);
}

const hash = createHash('sha256');
const feed = (name, buf) => {
  hash.update(name);
  hash.update('\0');
  hash.update(buf);
  hash.update('\0');
};

feed('pnpm-lock.yaml', readFileSync(join(src, 'pnpm-lock.yaml')));
const ws = join(src, 'pnpm-workspace.yaml');
if (existsSync(ws)) feed('pnpm-workspace.yaml', readFileSync(ws));
const patches = join(src, 'patches');
if (existsSync(patches)) {
  for (const f of readdirSync(patches).sort()) {
    const p = join(patches, f);
    if (statSync(p).isFile()) feed(`patches/${f}`, readFileSync(p));
  }
}

const stamp = hash.digest('hex').slice(0, 16);
const saveIdx = process.argv.indexOf('--save');
if (saveIdx > -1 && process.argv[saveIdx + 1]) {
  writeFileSync(process.argv[saveIdx + 1], stamp);
}
console.log(stamp);
