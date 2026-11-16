#!/usr/bin/env node
// dsh-image-mcp —— DSH 生图 MCP 服务器（stdio, 零依赖）
// 工具：
//   generate_nano_banana_2      NB 2.1 完整版：先试 gemini-nano-banana-2.1（2026-10-06 GA，后端尚未推送），
//                               再试旧完整版候选，最终回落到后端当前唯一可用的图像模型
//   generate_nano_banana_2_lite NB2 Lite：gemini-3.1-flash-image（实测可用）
//   generate_comfyui            本机 ComfyUI（自动优先 Qwen Image 2.1 工作流，也支持 SD1.5 checkpoint）
// 所有工具都支持 save_dir / filename 参数把成图落到指定位置（相对路径以 DSH 工作区根为基准）。
// 环境变量：
//   DSH_IMAGE_CRED_PATH      Antigravity OAuth 凭据 JSON（默认 DSH_HOME/storages/antigravity-oauth.json）
//   DSH_IMAGE_ENDPOINTS      逗号分隔的 CloudCode 端点（默认官方生产 + sandbox）
//   DSH_IMAGE_NB2_MODELS     完整版 NB2 模型 ID 链（逗号分隔，最后一个是回落）
//   DSH_IMAGE_LITE_MODELS    Lite 模型 ID 链
//   DSH_IMAGE_BASE_DIR       相对 save_dir 的基准目录（默认 DSH 工作区根，即本文件的上两级）
//   DSH_IMAGE_SAVE_DIR       默认落盘目录（save_dir 未指定时用；默认 我的图片\DSH-Images）
//   DSH_IMAGE_COMFY_URL      ComfyUI 地址（默认自动尝试 127.0.0.1:8000 / 8188）
//   DSH_IMAGE_COMFY_WORKFLOW API 格式工作流模板；字符串占位符 %prompt% %negative_prompt% %checkpoint%
//                            与数值占位符 %width% %height% %steps% %cfg% %seed% %batch%（写法见 README）

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, extname, isAbsolute, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const log = (...a) => process.stderr.write(`[dsh-image-mcp] ${a.join(' ')}\n`);

// ---------- Antigravity OAuth（与 dsh-antigravity 插件同一套凭据） ----------
// 2026-11-17 起凭据不再内嵌：读本目录 oauth-client.local.json（不入库）或环境变量。
// 客户端凭据是 Antigravity IDE 自带的公共 client 身份，用户令牌仍存 antigravity-oauth.json，不受影响。

const OAUTH_LOCAL = (() => {
  try {
    return JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'oauth-client.local.json'), 'utf8'),
    );
  } catch {
    return {};
  }
})();
const CLIENT_ID = process.env.DSH_IMAGE_CLIENT_ID || OAUTH_LOCAL.clientId || '';
const CLIENT_SECRET = process.env.DSH_IMAGE_CLIENT_SECRET || OAUTH_LOCAL.clientSecret || '';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const ENDPOINTS = (process.env.DSH_IMAGE_ENDPOINTS || '')
  .split(',').map((s) => s.trim()).filter(Boolean).length > 0
  ? (process.env.DSH_IMAGE_ENDPOINTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  : ['https://cloudcode-pa.googleapis.com', 'https://daily-cloudcode-pa.sandbox.googleapis.com'];

const NB2_CHAIN = (process.env.DSH_IMAGE_NB2_MODELS || 'gemini-nano-banana-2.1,gemini-3.1-pro-image,gemini-3-pro-image-preview,gemini-3.1-flash-image')
  .split(',').map((s) => s.trim()).filter(Boolean);
const LITE_CHAIN = (process.env.DSH_IMAGE_LITE_MODELS || 'gemini-3.1-flash-image').split(',').map((s) => s.trim()).filter(Boolean);

const BASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); // DSH 工作区根
const SAVE_DIR = process.env.DSH_IMAGE_SAVE_DIR || join(homedir(), 'Pictures', 'DSH-Images');

const credPath = () =>
  process.env.DSH_IMAGE_CRED_PATH ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'antigravity-oauth.json');

let creds = null;
function loadCreds() {
  if (!creds) {
    const p = credPath();
    if (!existsSync(p)) throw new Error('找不到 Antigravity OAuth 凭据：' + p);
    creds = JSON.parse(readFileSync(p, 'utf8'));
  }
  return creds;
}

async function refreshToken() {
  const c = loadCreds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: c.refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth 刷新失败 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  c.access = data.access_token;
  c.expires = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  try {
    writeFileSync(credPath(), JSON.stringify(c, null, 2));
  } catch (e) {
    log('凭据回写失败（不影响本次调用）:', e.message);
  }
  return c.access;
}

async function ensureToken() {
  const c = loadCreds();
  if (!c.refresh) throw new Error('凭据缺少 refresh token，请在 DSH 设置里重新登录 Antigravity');
  if (c.access && typeof c.expires === 'number' && c.expires > Date.now() + 120000) return c.access;
  return refreshToken();
}

// ---------- CloudCode 生图（streamGenerateContent SSE） ----------

const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT', 'CIVIC_INTEGRITY'].map(
  (c) => ({ category: `HARM_CATEGORY_${c}`, threshold: 'OFF' }),
);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function buildBody(projectId, model, prompt, opts) {
  const parts = [{ text: prompt }];
  for (const p of opts.inputImages || []) {
    const mime = MIME_BY_EXT[extname(p).toLowerCase()];
    if (!mime) throw new Error(`不支持的输入图片格式：${p}（仅 png/jpg/webp）`);
    const buf = readFileSync(p);
    if (buf.length > 10 * 1024 * 1024) throw new Error(`输入图片过大（>10MB）：${p}`);
    parts.push({ inlineData: { data: buf.toString('base64'), mimeType: mime } });
  }
  return {
    project: projectId,
    model,
    request: {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: opts.aspectRatio || '1:1', imageSize: opts.resolution || '1K' },
      },
      safetySettings: SAFETY,
    },
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: `req_${Date.now()}_${randomUUID().slice(0, 8)}`,
  };
}

function extractImageFromSse(raw) {
  let textSeen = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') continue;
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }
    if (data.error) throw new Error(`后端返回错误 ${data.error.code}：${String(data.error.message).slice(0, 300)}`);
    for (const cand of data.response?.candidates || []) {
      for (const part of cand.content?.parts || []) {
        const inl = part.inlineData;
        if (inl?.data && String(inl.mimeType || '').startsWith('image/')) {
          return { mime: inl.mimeType, base64: inl.data };
        }
        if (part.text) textSeen += part.text;
      }
    }
  }
  throw new Error('响应中没有图片' + (textSeen ? `；模型文本：${textSeen.slice(0, 200)}` : ''));
}

async function generateViaAntigravity(modelChain, prompt, opts) {
  await ensureToken();
  const c = loadCreds();
  const projectId = c.projectId || 'aicode-consumers';
  const errors = [];
  let refreshedOnce = false;

  for (const model of modelChain) {
    for (const endpoint of ENDPOINTS) {
      let res;
      const post = () =>
        fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.access}`, 'Content-Type': 'application/json', 'User-Agent': 'antigravity' },
          body: JSON.stringify(buildBody(projectId, model, prompt, opts)),
          signal: AbortSignal.timeout(180000),
        });
      try {
        res = await post();
      } catch (e) {
        errors.push(`${model}@${endpoint}: ${e.message}`);
        continue;
      }
      if (res.status === 401 && !refreshedOnce) {
        refreshedOnce = true;
        await refreshToken();
        try {
          res = await post();
        } catch (e) {
          errors.push(`${model}@${endpoint}(retry): ${e.message}`);
          continue;
        }
      }
      if (!res.ok) {
        errors.push(`${model}@${endpoint}: HTTP ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`);
        continue;
      }
      try {
        const img = extractImageFromSse(await res.text());
        return { ...img, model };
      } catch (e) {
        errors.push(`${model}@${endpoint}: ${e.message}`);
      }
    }
  }
  throw new Error('所有端点/模型都失败了：\n' + errors.map((e) => ' - ' + e).join('\n'));
}

// ---------- 落盘 ----------

function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '-').trim();
}

function resolveSaveDir(saveDir) {
  if (!saveDir) return SAVE_DIR;
  return isAbsolute(saveDir) ? saveDir : join(BASE_DIR, saveDir);
}

// 自动文件名必须保证唯一：批量出图时多张图可能落在同一毫秒，直接用时间戳会互相覆盖导致丢图
function uniqueTarget(dir, base, ext) {
  let candidate = join(dir, base + ext);
  let n = 1;
  while (existsSync(candidate)) {
    n += 1;
    candidate = join(dir, `${base}-${n}${ext}`);
  }
  return candidate;
}

function saveImage(data, mime, tag, saveDir, filename) {
  const ext = mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png';
  const dir = resolveSaveDir(saveDir);
  mkdirSync(dir, { recursive: true });
  let file;
  if (filename) {
    const clean = sanitizeName(filename);
    const stem = clean.toLowerCase().endsWith(ext) ? clean.slice(0, -ext.length) : clean;
    file = uniqueTarget(dir, stem, ext);
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    file = uniqueTarget(dir, `${tag}-${stamp}`, ext);
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
  writeFileSync(file, buf);
  return { file, bytes: buf.length };
}

// ---------- ComfyUI ----------

function comfyCandidates() {
  const list = [];
  if (process.env.DSH_IMAGE_COMFY_URL) list.push(process.env.DSH_IMAGE_COMFY_URL.replace(/\/+$/, ''));
  if (process.env.COMFYUI_URL) list.push(process.env.COMFYUI_URL.replace(/\/+$/, ''));
  if (process.env.COMFY_LOCAL_URL) list.push(process.env.COMFY_LOCAL_URL.replace(/\/+$/, ''));
  list.push('http://127.0.0.1:8000', 'http://127.0.0.1:8188', 'http://localhost:8000', 'http://localhost:8188');
  return [...new Set(list)];
}

let comfyBaseCache = null;
async function comfyBase(forceRefresh = false) {
  if (comfyBaseCache && !forceRefresh) {
    try {
      const ping = await fetch(`${comfyBaseCache}/system_stats`, { signal: AbortSignal.timeout(1000) });
      if (ping.ok) return comfyBaseCache;
    } catch {
      comfyBaseCache = null;
    }
  }
  for (const base of comfyCandidates()) {
    try {
      const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        comfyBaseCache = base;
        return base;
      }
    } catch {}
  }
  comfyBaseCache = null;
  throw new Error(
    '本机 ComfyUI 没有响应（试过 ' + comfyCandidates().join(', ') + '）。请先启动 ComfyUI，或在 DSH_IMAGE_COMFY_URL 里写明地址。',
  );
}

// ---------- 参考图上传（ComfyUI 的 LoadImage 只能读它自己的 input 目录）----------

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);
const REF_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
};

// 把本地参考图送进 ComfyUI 的 input 目录，返回可直接喂 LoadImage 的文件名。
// LoadImage 只接受「位于 ComfyUI input 目录内的名字」：实测传工作区绝对路径会被
// get_annotated_filepath() 的路径穿越检查挡掉（HTTP 400 Invalid image file），
// 所以必须先经 /upload/image 上传。上传是幂等的：同名同内容会命中服务端 hash 去重。
async function uploadRefImage(base, absPath) {
  const ext = extname(absPath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    throw new Error('参考图格式不支持：' + absPath + '（仅 png/jpg/jpeg/webp/bmp/gif）');
  }
  if (!existsSync(absPath)) throw new Error('参考图不存在：' + absPath);
  const size = statSync(absPath).size;
  if (size > 20 * 1024 * 1024) throw new Error('参考图过大（>20MB）：' + absPath);

  const fileName = basename(absPath);
  const buf = readFileSync(absPath);
  const fd = new FormData();
  fd.set('image', new Blob([buf], { type: REF_MIME[ext] || 'application/octet-stream' }), fileName);
  fd.set('type', 'input');
  // overwrite=true：文件名冲突时直接覆盖，避免服务端生成 'name (1).png' 这类变体
  fd.set('overwrite', 'true');

  try {
    const res = await fetch(base + '/upload/image', {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    if (!data || !data.name) throw new Error('响应缺少 name');
    return data.name;
  } catch (e) {
    throw new Error('参考图上传失败（' + fileName + '）：' + e.message);
  }
}

let objectInfoCache = null;
let objectInfoCacheTime = 0;
const OBJECT_INFO_CACHE_TTL_MS = 60000;

async function fetchObjectInfo(base, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && objectInfoCache && objectInfoCache.base === base && now - objectInfoCacheTime < OBJECT_INFO_CACHE_TTL_MS) {
    return objectInfoCache.data;
  }
  // 优先按需拉取生图路由关键节点：单次 /object_info/<Node> 只返回一个节点，
  // 相比全量 /object_info（1000+ 节点、数 MB JSON）可省下绝大部分传输与解析开销。
  //
  // ⚠️ 必须等待全部关键节点返回，绝不可「凑够几个就 abort 其余」：
  // 历史实现按返回速度取前 3 个就取消剩余请求，而 CLIPLoader 的返回体最大（含全部 type
  // 列表与权重清单）几乎总是最慢，于是每次都会被中途取消 —— 那份缺 CLIPLoader 的残缺响应
  // 还会被写进 60s 的 objectInfoCache，导致下游 buildMossGraph / buildQwenGraph /
  // buildSd15Graph 取不到 CLIPLoader 的 type 与权重列表，非模板路径几乎必然报错。
  // 本机 127.0.0.1 并发拉 8 个节点开销极低，且结果会缓存 60s，等待全部返回的代价可忽略。
  const criticalNodes = [
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'CheckpointLoaderSimple',
    'TextEncodeQwenImage21',
    'QwenImage21Cache',
    'EmptySD3LatentImage',
    'EmptyFlux2LatentImage',
  ];
  try {
    const nodeFetches = await Promise.all(
      criticalNodes.map(async (node) => {
        try {
          const res = await fetch(`${base}/object_info/${node}`, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) return null;
          const d = await res.json();
          if (!d?.[node]) return null;
          return { [node]: d[node] };
        } catch {
          return null;
        }
      }),
    );
    const merged = Object.assign({}, ...nodeFetches.filter(Boolean));
    // 只有在关键节点全部到齐时才使用定向结果，否则宁可回落全量接口，
    // 避免把残缺数据写进缓存污染后续 60s 内的所有调用。
    if (criticalNodes.every((n) => merged[n])) {
      objectInfoCache = { base, data: merged };
      objectInfoCacheTime = now;
      return merged;
    }
    log('object_info 定向拉取不完整（缺失：' + criticalNodes.filter((n) => !merged[n]).join(', ') + '），回落全量接口');
  } catch {
    // 节点定向拉取异常时平滑回落全量接口
  }

  const res = await fetch(`${base}/object_info`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`ComfyUI /object_info HTTP ${res.status}`);
  const data = await res.json();
  objectInfoCache = { base, data };
  objectInfoCacheTime = now;
  return data;
}
function listFrom(info, classType, inputName) {
  const entry = info?.[classType]?.input?.required?.[inputName];
  return Array.isArray(entry?.[0]) ? entry[0] : [];
}

function substitutePlaceholders(node, values) {
  if (typeof node === 'string') {
    const key = node.replace(/^%|%$/g, '');
    if (node.startsWith('%') && node.endsWith('%') && key in values) return values[key];
    return node;
  }
  if (Array.isArray(node)) return node.map((n) => substitutePlaceholders(n, values));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = substitutePlaceholders(v, values);
    return out;
  }
  return node;
}

// 查找工作流中 KSampler / KSamplerAdvanced 关联的正负条件节点 ID
function findConditioningNodes(graph) {
  const posNodeIds = new Set();
  const negNodeIds = new Set();

  // 用 seen 集合防重复访问：模板里 Reroute / 共享上游节点会形成菱形连线，
  // 原来纯粹按 depth 递归会在每个分叉上重复展开整棵子树，节点一多就是指数级开销。
  const seen = new Set();

  function traceSource(nodeId, depth = 0) {
    if (seen.has(nodeId)) return [];
    seen.add(nodeId);
    if (depth > 6) return [];
    const node = graph[nodeId];
    if (!node) return [];
    const ct = String(node.class_type || '');
    if (['CLIPTextEncode', 'TextEncodeQwenImage21', 'MOSSImageLayoutPrompt'].includes(ct)) {
      const sources = [nodeId];
      // 若该节点的文本输入连向了上游排版节点（如 MOSSImageLayoutPrompt），穿透追踪真正提示词源
      if (node.inputs) {
        for (const val of Object.values(node.inputs)) {
          if (Array.isArray(val) && val.length >= 1 && (typeof val[0] === 'string' || typeof val[0] === 'number') && graph[String(val[0])]) {
            sources.push(...traceSource(String(val[0]), depth + 1));
          }
        }
      }
      return sources;
    }
    const sources = [];
    if (node.inputs) {
      for (const val of Object.values(node.inputs)) {
        if (Array.isArray(val) && val.length >= 1 && (typeof val[0] === 'string' || typeof val[0] === 'number') && graph[String(val[0])]) {
          sources.push(...traceSource(String(val[0]), depth + 1));
        }
      }
    }
    return sources;
  }



  for (const node of Object.values(graph)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue;
    const ct = String(node.class_type || '');
    if (ct.includes('KSampler') || ct.includes('Sampler')) {
      if (Array.isArray(node.inputs.positive) && node.inputs.positive[0] != null) {
        for (const id of traceSource(String(node.inputs.positive[0]))) posNodeIds.add(String(id));
      }
      if (Array.isArray(node.inputs.negative) && node.inputs.negative[0] != null) {
        for (const id of traceSource(String(node.inputs.negative[0]))) negNodeIds.add(String(id));
      }
    }
  }

  return { posNodeIds, negNodeIds };
}

// 智能兜底注入：精准识别正负向条件节点，注入提示词、负向词、种子与尺寸，绝不破坏节点连线
function applyTemplateOverrides(graph, args) {
  if (!graph || typeof graph !== 'object') return;
  const { posNodeIds, negNodeIds } = findConditioningNodes(graph);

  for (const [id, node] of Object.entries(graph)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue;
    const ct = String(node.class_type || '');
    const isExplicitPos = posNodeIds.has(String(id));
    const isExplicitNeg = negNodeIds.has(String(id));

    // 1. 负向提示词注入（优先判定负向，防止被正向词误覆盖；连线引用绝对不可覆盖为字符串）
    if (args.negative_prompt !== undefined) {
      if (ct === 'CLIPTextEncode') {
        const isLinked = Array.isArray(node.inputs.text);
        if (!isLinked) {
          const isNegText = node.inputs.text === '' || (typeof node.inputs.text === 'string' && /negative|bad|worst|lowres|deformed/i.test(node.inputs.text));
          if (isExplicitNeg || (!isExplicitPos && isNegText)) {
            node.inputs.text = args.negative_prompt;
            continue; // 已作为负向节点处理，跳过后续正向注入
          }
        }
      }
    }

    // 2. 正向提示词注入（连线引用绝对不可覆盖为字符串，确保排版/Layout上游节点链路完整）
    if (args.prompt) {
      if (ct === 'CLIPTextEncode') {
        const isLinked = Array.isArray(node.inputs.text);
        if (!isLinked) {
          if (isExplicitPos || (!isExplicitNeg && typeof node.inputs.text === 'string' && !node.inputs.text.includes('%'))) {
            node.inputs.text = args.prompt;
          }
        }
      } else if (ct === 'MOSSImageLayoutPrompt') {
        if (typeof node.inputs.prompt === 'string' || !node.inputs.prompt) {
          node.inputs.prompt = args.prompt;
        }
        if (args.width !== undefined) node.inputs.width = args.width;
        if (args.height !== undefined) node.inputs.height = args.height;
      } else if (ct === 'TextEncodeQwenImage21') {
        if (typeof node.inputs.prompt === 'string') {
          node.inputs.prompt = args.prompt;
        }
        if (args.negative_prompt !== undefined && typeof node.inputs.negative_prompt === 'string') {
          node.inputs.negative_prompt = args.negative_prompt;
        }
      }
    }

    // 3. 采样器与种子
    if (ct === 'KSampler' || ct === 'KSamplerAdvanced') {
      if (args.seed !== undefined) node.inputs.seed = args.seed;
      if (args.steps !== undefined) node.inputs.steps = args.steps;
      if (args.cfg !== undefined) node.inputs.cfg = args.cfg;
    }

    // 4. 潜空间尺寸与批次、以及排版标注框节点的尺寸联动
    if (ct === 'EmptyFlux2LatentImage' || ct === 'EmptyLatentImage' || ct === 'EmptySD3LatentImage' || ct === 'CreateBoundingBoxes') {
      if (ct === 'CreateBoundingBoxes') {
        // 画布尺寸变了就同步缩放标注框，否则框坐标仍按旧画布的绝对像素，排版静默错位
        if (args.width !== undefined) {
          if (scaleBoundingBoxesState(node, args.width, args.height ?? node.inputs.height)) {
            log('CreateBoundingBoxes 标注框已按新尺寸等比缩放');
          }
          node.inputs.width = args.width;
        }
        if (args.height !== undefined) node.inputs.height = args.height;
      } else {
        if (args.width !== undefined) node.inputs.width = args.width;
        if (args.height !== undefined) node.inputs.height = args.height;
        if (args.batch_size !== undefined) node.inputs.batch_size = args.batch_size;
      }
    }

  }
}

// SD1.5 经典文生图
function sd15Graph(args, checkpoint) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: args.prompt, clip: ['4', 1] } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: args.negative_prompt || '', clip: ['4', 1] } },
    7: { class_type: 'EmptyLatentImage', inputs: { width: args.width, height: args.height, batch_size: args.batch_size } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: args.seed,
        steps: args.steps,
        cfg: args.cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-mcp', images: ['8', 0] } },
  };
}

// MOSS-Image 文生图（OpenMOSS 5B DiT）
function mossGraph(args, files) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: files.model, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: files.textEncoder, type: 'moss_image', device: 'default' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: args.prompt, clip: ['2', 0] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: args.negative_prompt || '', clip: ['2', 0] } },
    5: { class_type: 'EmptyFlux2LatentImage', inputs: { width: args.width, height: args.height, batch_size: args.batch_size } },
    6: {
      class_type: 'SkipLayerGuidanceDiTSimple',
      inputs: {
        model: ['1', 0],
        double_layers: '22',
        single_layers: '',
        start_percent: 0,
        end_percent: 0.5,
      },
    },
    7: {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: args.seed,
        steps: args.steps,
        cfg: args.cfg,
        sampler_name: 'er_sde',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    8: { class_type: 'VAELoader', inputs: { vae_name: files.vae } },
    9: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['8', 0] } },
    10: { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-mcp', images: ['9', 0] } },
  };
}

// 为参考图生成 LoadImage 节点，并把它们接到 TextEncodeQwenImage21 的 images 自动增长口。
// 自动增长口（COMFY_AUTOGROW_V3）在 API 图里的写法是展平的 "images.image_1" 键：
// 传嵌套对象或数组都会被 build_nested_inputs() 处理成空值，参考图静默丢失
// （不报错、图却能生成，是最难发现的静默错误）。槽位上限 16（names = image_1..image_16）。
const AUTOGROW_MAX_SLOTS = 16;
const REF_NODE_ID_BASE = 20; // LoadImage 节点从 20 起编号，避开主图 1-10 的固定编号

// CreateBoundingBoxes 的 editor_state 里存的是**绝对像素坐标**。只改画布 width/height
// 而不动这些坐标，标注框会留在原处并相对错位（改 2048 时框全挤在左上角），
// 且这是静默出错——图照出，排版却是坏的。改尺寸必须连同框坐标一起等比缩放。
function scaleBoundingBoxesState(node, newW, newH) {
  const raw = node.inputs.editor_state;
  let boxes;
  if (Array.isArray(raw)) boxes = raw;
  else if (typeof raw === 'string') {
    try { boxes = JSON.parse(raw); } catch { return false; }
  } else return false;
  if (!Array.isArray(boxes) || boxes.length === 0) return false;

  const oldW = Number(node.inputs.width);
  const oldH = Number(node.inputs.height);
  if (!oldW || !oldH || oldW === newW && oldH === newH) return false;

  const sx = newW / oldW;
  const sy = newH / oldH;
  const scaled = boxes.map((b) => ({
    ...b,
    x: Math.round(b.x * sx),
    y: Math.round(b.y * sy),
    width: Math.round(b.width * sx),
    height: Math.round(b.height * sy),
  }));
  // 保持原样的数据类型（模板里既有数组也有 JSON 字符串两种写法）
  node.inputs.editor_state = Array.isArray(raw) ? scaled : JSON.stringify(scaled);
  return true;
}

function refImageNodes(refs) {
  const nodes = {};
  const ports = {};
  refs.forEach((name, i) => {
    const nodeId = String(REF_NODE_ID_BASE + i);
    nodes[nodeId] = { class_type: 'LoadImage', inputs: { image: name } };
    ports['images.image_' + (i + 1)] = [nodeId, 0];
  });
  return { nodes, ports };
}

// Qwen Image 2.1（UNET → QwenImage21Cache → KSampler；TextEncodeQwenImage21 出正负条件）
function qwenGraph(args, files, info) {
  const useCache = Boolean(info.QwenImage21Cache);
  const latentNode = info.EmptySD3LatentImage ? 'EmptySD3LatentImage' : 'EmptyLatentImage';
  const latentId = 6;
  const modelId = useCache ? 2 : 1;

  // 参考图（i2i / 图像编辑）：refs 是「已上传到 ComfyUI input 目录」的文件名列表
  const refs = args.refs || [];
  const { nodes: refNodes, ports: refPorts } = refImageNodes(refs);

  // 有参考图时优先用 TextEncodeQwenImage21 自己算出的潜空间：它的第 3 个输出是
  // 「按第一张参考图尺寸」的空 latent，节点注释明说 any other size shifts the edit，
  // 沿用 t2i 的固定尺寸 EmptySD3LatentImage 会让编辑结果整体偏移。
  const useRefLatent = refs.length > 0;

  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: files.model, weight_dtype: 'default' } },
    ...(useCache ? { 2: { class_type: 'QwenImage21Cache', inputs: { model: ['1', 0], device: 'auto', dtype: 'default' } } } : {}),
    3: { class_type: 'CLIPLoader', inputs: { clip_name: files.textEncoder, type: 'qwen_image', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: files.vae } },
    5: {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['3', 0],
        vae: ['4', 0],
        prompt: args.prompt,
        negative_prompt: args.negative_prompt || '',
        // resolution 是「总像素预算」而不是宽高。节点 schema 标的上限 4096 只是 ComfyUI
        // 的通用上限，模型原生只到 2048，越界会得到畸形构图；这里按 2048 夹。
        resolution: Math.min(2048, Math.max(0, Math.ceil(Math.max(args.width || 1024, args.height || 1024) / 32) * 32)),
        ...refPorts,
      },
    },
    ...refNodes,
    ...(useRefLatent ? {} : { [latentId]: { class_type: latentNode, inputs: { width: args.width, height: args.height, batch_size: args.batch_size } } }),
    7: {
      class_type: 'KSampler',
      inputs: {
        seed: args.seed,
        steps: args.steps,
        cfg: args.cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: [String(modelId), 0],
        positive: ['5', 0],
        negative: ['5', 1],
        latent_image: useRefLatent ? ['5', 2] : [String(latentId), 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['4', 0] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh-mcp', images: ['8', 0] } },
  };
}

// Qwen-Image-2.1 的 Prompt Enhancer 专用权重（comfy-org 发布的
// qwen3.5_9b_qwen_image_2.1_pe_{t2i,i2i}.*）。它们**不能**当生成用的文本编码器：
// 文件名前缀与 MOSS 真正在用的 qwen3.5_9b_w4a8_gptq 相同，且在 ComfyUI clip_name 列表里排在
// 前面，任何宽泛的 /qwen3\.5/i 匹配都会误选它们，CLIPLoader 随即报
// "Tensor ... extends past the end of the file"。选编码器时必须先把它们排除。
const isPromptEnhancer = (name) => /_pe_(t2i|i2i)/i.test(String(name));

// 在候选列表里按 pattern 顺序挑选，但永远跳过 Prompt Enhancer 权重
function pickEncoder(list, patterns) {
  const usable = list.filter((n) => !isPromptEnhancer(n));
  return pickDefault(usable.length ? usable : list, patterns);
}

function pickDefault(list, patterns) {
  for (const p of patterns) {
    const hit = list.find((n) => p.test(n));
    if (hit) return hit;
  }
  return list[0];
}

function buildMossGraph(args, info) {
  const unets = listFrom(info, 'UNETLoader', 'unet_name');
  const clips = listFrom(info, 'CLIPLoader', 'clip_name');
  const vaes = listFrom(info, 'VAELoader', 'vae_name');
  const types = listFrom(info, 'CLIPLoader', 'type');
  if (!types.includes('moss_image')) {
    throw new Error(`CLIPLoader 不支持 type "moss_image"（可用：${types.join(', ') || '未知'}）`);
  }
  const model = args.model
    ? pickDefault(unets, [new RegExp(args.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')])
    : pickDefault(unets, [/moss_image_sft/i, /moss_image_base/i, /moss_image/i]);
  const textEncoder = (args.text_encoder || args.textEncoder)
    ? pickDefault(clips, [new RegExp((args.text_encoder || args.textEncoder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')])
    : pickEncoder(clips, [/qwen3\.5.*gptq/i, /moss/i, /qwen3\.5/i, /qwen.*9b/i]);
  const vae = args.vae
    ? pickDefault(vaes, [new RegExp(args.vae.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')])
    : pickDefault(vaes, [/flux2-vae/i, /flux2/i, /flux/i]);
  if (!model || !textEncoder || !vae) {
    throw new Error(`MOSS-Image 组件不全：unet=${model || '无'}, text_encoder=${textEncoder || '无'}, vae=${vae || '无'}`);
  }
  const mossArgs = {
    ...args,
    steps: args.steps ?? 25,
    cfg: args.cfg ?? 2.5,
    width: args.width ?? 1024,
    height: args.height ?? 1024,
  };
  return mossGraph(mossArgs, { model, textEncoder, vae });
}

function buildQwenGraph(args, info) {
  // 参考图数量上限 = 自动增长口的槽位数（16）。超出必须报错，静默截断会让用户以为
  // 所有参考图都生效了。
  const refs = args.refs || [];
  if (refs.length > AUTOGROW_MAX_SLOTS) {
    throw new Error('参考图最多 ' + AUTOGROW_MAX_SLOTS + ' 张，当前 ' + refs.length + ' 张');
  }

  if (!info.TextEncodeQwenImage21) {
    throw new Error('当前 ComfyUI 没有 TextEncodeQwenImage21 节点（Qwen Image 2.1 需要 ComfyUI 0.37+）');
  }
  const unets = listFrom(info, 'UNETLoader', 'unet_name');
  const clips = listFrom(info, 'CLIPLoader', 'clip_name');
  const vaes = listFrom(info, 'VAELoader', 'vae_name');
  const types = listFrom(info, 'CLIPLoader', 'type');
  if (!types.includes('qwen_image')) {
    throw new Error(`CLIPLoader 不支持 type "qwen_image"（可用：${types.join(', ') || '未知'}）`);
  }
  const model = args.model ? pickDefault(unets, [new RegExp(args.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]) : pickDefault(unets, [/qwen_image_2\.1.*turbo/i, /qwen_image_2\.1/i, /qwen_image/i]);
  const textEncoder = (args.textEncoder || args.text_encoder) ? pickDefault(clips, [new RegExp((args.textEncoder || args.text_encoder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]) : pickEncoder(clips, [/qwen3vl.*int8/i, /qwen3vl/i, /qwen.*vl/i, /qwen/i]);
  const vae = args.vae ? pickDefault(vaes, [new RegExp(args.vae.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]) : pickDefault(vaes, [/qwen_image_2\.1_vae/i, /qwen_image.*vae/i, /qwen/i]);
  if (!model || !textEncoder || !vae) {
    throw new Error(`Qwen Image 组件不全：unet=${model || '无'}, text_encoder=${textEncoder || '无'}, vae=${vae || '无'}`);
  }
  const isTurbo = /turbo/i.test(model);
  const qwenArgs = {
    ...args,
    steps: args.steps ?? (isTurbo ? 8 : 40),
    cfg: args.cfg ?? 1,
    width: args.width ?? 1024,
    height: args.height ?? 1024,
  };
  return qwenGraph(qwenArgs, { model, textEncoder, vae }, info);
}

function buildSd15Graph(args, info) {
  const checkpoints = listFrom(info, 'CheckpointLoaderSimple', 'ckpt_name');
  // 过滤掉 inpainting 专用局部重绘模型（输入需要 9 通道，标准文生图走 4 通道 EmptyLatentImage 会报维度不匹配崩溃）
  const validCheckpoints = checkpoints.filter((c) => !/inpaint/i.test(c));
  // 选模顺序：先按 SDXL/SD1.5 语义挑合适的底模，再用扩展名兜底。
  // 原来是「先找第一个 .safetensors」，会把列表里靠前的任意权重（比如 SD1.5 或更差的
  // 杂项模型）当成默认，而 .ckpt 的 SD1.5 好模型反而被跳过。
  const pickCheckpoint = (list) =>
    list.find((c) => /xl|sdxl/i.test(c)) ||
    list.find((c) => /v1-5|v1_5|sd15|sd-1/i.test(c)) ||
    list.find((c) => /\.safetensors$/i.test(c)) ||
    list[0];
  const checkpoint =
    args.checkpoint && checkpoints.includes(args.checkpoint)
      ? args.checkpoint
      : pickCheckpoint(validCheckpoints);
  if (!checkpoint) {
    if (checkpoints.length > 0 && checkpoints.every((c) => /inpaint/i.test(c))) {
      throw new Error(
        `ComfyUI 中仅找到局部重绘模型（${checkpoints.join(', ')}），不支持标准文生图（通道不匹配）。请在 models/checkpoints 放置标准 SD1.5/SDXL 模型，或使用本地现有的 MOSS-Image / Qwen Image 2.1。`,
      );
    }
    throw new Error('ComfyUI 里找不到任何 checkpoint 模型（models/checkpoints 为空？）');
  }
  // SDXL 底模原生分辨率是 1024²，沿用 SD1.5 的 512² 会明显糊；按名字区分给出合适默认值
  const isSdxl = /xl|sdxl/i.test(checkpoint);
  const defaultSize = isSdxl ? 1024 : 512;
  const sdArgs = {
    ...args,
    steps: args.steps ?? (isSdxl ? 25 : 20),
    cfg: args.cfg ?? 7,
    width: args.width ?? defaultSize,
    height: args.height ?? defaultSize,
  };
  return sd15Graph(sdArgs, checkpoint);
}

// 按节点类型识别工作流管线（不看整串文本，避免被文本编码器文件名误导）
function detectPipelineKinds(graph) {
  const out = { qwen: false, moss: false, sd15: false, turbo: false };
  if (!graph || typeof graph !== 'object') return out;
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== 'object') continue;
    const ct = String(node.class_type || '');
    if (ct === 'TextEncodeQwenImage21' || ct === 'QwenImage21Cache') out.qwen = true;
    else if (ct === 'MOSSImageLayoutPrompt') out.moss = true;
    else if (ct === 'CheckpointLoaderSimple') out.sd15 = true;
    // Turbo 只能从 CLIPLoader 的 type=qwen_image + 权重名判断：优先看显式 model 名
    if (ct === 'UNETLoader' && /turbo/i.test(String(node.inputs?.unet_name || ''))) out.turbo = true;
  }
  // Qwen 优先于 SD15：同时出现时以 Qwen 为准，与下面 auto 路由的优先级一致
  if (out.qwen) out.sd15 = false;
  return out;
}

// 把入参里的参考图路径解析成绝对路径，顺便做数量校验。
// 与 NB 系列工具一致：接受绝对路径，也接受相对 DSH 工作区根的路径。
async function resolveRefs(inputImages) {
  if (!inputImages || inputImages.length === 0) return [];
  if (inputImages.length > 16) {
    throw new Error('参考图最多 16 张，当前 ' + inputImages.length + ' 张');
  }
  return inputImages.map((p) => (isAbsolute(p) ? p : join(BASE_DIR, p)));
}

async function generateViaComfy(args) {
  const base = await comfyBase();

  const tplPath = args.workflow_path
    ? (isAbsolute(args.workflow_path) ? args.workflow_path : join(BASE_DIR, args.workflow_path))
    : (process.env.DSH_IMAGE_COMFY_WORKFLOW ? (isAbsolute(process.env.DSH_IMAGE_COMFY_WORKFLOW) ? process.env.DSH_IMAGE_COMFY_WORKFLOW : join(BASE_DIR, process.env.DSH_IMAGE_COMFY_WORKFLOW)) : null);

  if (tplPath && existsSync(tplPath)) {
    const raw = JSON.parse(readFileSync(tplPath, 'utf8'));
    // 解包外层 {"prompt": {...}} 包装，防止传给 ComfyUI 时产生双重嵌套报错
    const template = (raw && typeof raw === 'object' && raw.prompt && typeof raw.prompt === 'object' && !Array.isArray(raw.prompt))
      ? raw.prompt
      : raw;

    // UI 导出格式不是 API 格式：提交给 /prompt 必然失败，这里提前给出可操作的报错
    if (!Array.isArray(template) && (Array.isArray(template.nodes) || Array.isArray(template.links))) {
      throw new Error(
        `${tplPath} 是 ComfyUI 界面导出格式（含 nodes/links），不是 API 格式，无法提交给 /prompt。` +
        '请在 ComfyUI 里用「Save (API Format)」重新导出，或改用 Workflows/ 下的 API 格式模板（如 Workflows/moss-image/moss-image-sft-t2i.json）。',
      );
    }

    // 只按节点类型判断管线：整串 JSON 匹配 /qwen/i 会命中文本编码器文件名（如 qwen3.5_9b_w4a8_gptq），
    // 使 MOSS 模板被误判成 Qwen，进而套用 40 步 / cfg 1.0 的错误默认值（静默出错，不报错）
    const kinds = detectPipelineKinds(template);
    const defaultSteps = args.steps ?? (kinds.turbo ? 8 : kinds.qwen ? 40 : kinds.sd15 ? 20 : 25);
    const defaultCfg = args.cfg ?? (kinds.qwen ? 1.0 : kinds.sd15 ? 7 : 2.5);
    const defaultSize = kinds.sd15 ? 512 : 1024;

    const graph = substitutePlaceholders(template, {
      prompt: args.prompt,
      negative_prompt: args.negative_prompt || '',
      checkpoint: args.checkpoint || '',
      width: args.width || defaultSize,
      height: args.height || defaultSize,
      steps: defaultSteps,
      cfg: defaultCfg,
      seed: args.seed,
      batch: args.batch_size || 1,
    });
    // 智能兜底注入：未写占位符的通用节点也能正确注入提示词和种子
    applyTemplateOverrides(graph, args);
    return runComfyPrompt(base, graph);
  }

  // 参考图：先上传到 ComfyUI 的 input 目录，得到可直接喂 LoadImage 的文件名
  const rawRefs = await resolveRefs(args.input_images);
  const refs = [];
  for (const p of rawRefs) {
    refs.push(await uploadRefImage(base, p));
  }
  if (refs.length > 0) {
    log('参考图已上传：' + refs.join(', '));
  }

  const info = await fetchObjectInfo(base);
  const unets = listFrom(info, 'UNETLoader', 'unet_name');
  const clipTypes = listFrom(info, 'CLIPLoader', 'type');

  const textEnc = args.text_encoder || args.textEncoder;

  // 参考图只能走 Qwen Image 2.1：MOSS-Image / SD1.5 的构图函数没有参考图入口，
  // 静默忽略会让用户以为参考图生效了（图照出，但和参考图完全无关），必须显式报错。
  // 这个守卫必须放在下面所有显式路由分支之前，否则 pipeline='moss_image' 会直接 return 掉。
  if (refs.length > 0) {
    if (args.pipeline && args.pipeline !== 'qwen_image' && args.pipeline !== 'auto') {
      throw new Error('只有 Qwen Image 2.1 管线支持参考图；当前 pipeline="' + args.pipeline + '"。请改用 pipeline="qwen_image" 或省略 pipeline（auto）。');
    }
    if (args.checkpoint) {
      throw new Error('SD checkpoint 管线不支持参考图；请去掉 checkpoint 参数走 Qwen Image 2.1。');
    }
    // 显式指定 MOSS 权重或 MOSS 用的 Qwen3.5 文本编码器，也意味着走 MOSS 管线
    if (args.model && /moss/i.test(args.model)) {
      throw new Error('MOSS-Image 管线不支持参考图；请改用 Qwen Image 2.1（去掉 model 或指定 qwen_image 权重）。');
    }
    if (textEnc && /moss|qwen3\.5/i.test(textEnc)) {
      throw new Error('指定的文本编码器属于 MOSS 管线，不支持参考图；请改用 Qwen Image 2.1。');
    }
  }

  if (args.pipeline === 'moss_image') return runComfyPrompt(base, buildMossGraph(args, info));
  if (args.pipeline === 'qwen_image') return runComfyPrompt(base, buildQwenGraph({ ...args, refs }, info));
  if (args.pipeline === 'sd15' || args.checkpoint) return runComfyPrompt(base, buildSd15Graph(args, info));


  // 参数推断路由
  if (args.model && /moss/i.test(args.model)) return runComfyPrompt(base, buildMossGraph(args, info));
  if (args.model && /qwen/i.test(args.model)) return runComfyPrompt(base, buildQwenGraph({ ...args, refs }, info));
  if (textEnc && /moss|qwen3\.5/i.test(textEnc)) return runComfyPrompt(base, buildMossGraph(args, info));
  if (textEnc && /qwen3vl/i.test(textEnc)) return runComfyPrompt(base, buildQwenGraph({ ...args, refs }, info));

  // auto 模式智能路由：
  const hasMoss = unets.some((n) => /moss_image/i.test(n)) && clipTypes.includes('moss_image');
  const hasQwen = unets.some((n) => /qwen_image/i.test(n)) && Boolean(info.TextEncodeQwenImage21);

  if (hasMoss && hasQwen) {
    // 有参考图时强制 Qwen：即使提示词是中文也走 Qwen，因为 MOSS 吃不下参考图
    if (refs.length > 0) return runComfyPrompt(base, buildQwenGraph({ ...args, refs }, info));
    // 都有：包含中文优先走 MOSS-Image（原生中文海报与文字排版更强），否则 Qwen Image
    const isChinese = /[\u4e00-\u9fa5]/.test(args.prompt);
    if (isChinese) return runComfyPrompt(base, buildMossGraph(args, info));
    return runComfyPrompt(base, buildQwenGraph({ ...args, refs }, info));
  }
  if (hasMoss) return runComfyPrompt(base, buildMossGraph(args, info));
  if (hasQwen) return runComfyPrompt(base, buildQwenGraph({ ...args, refs }, info));
  return runComfyPrompt(base, buildSd15Graph(args, info));
}

function checkComfyHistoryError(hEntry) {
  if (!hEntry) return null;
  if (hEntry.status?.status_str === 'error') {
    const msgs = (hEntry.status?.messages || []).map((m) => JSON.stringify(m)).join('; ');
    return `ComfyUI 执行出错：${msgs.slice(0, 600)}`;
  }
  if (hEntry.status?.completed === false && hEntry.status?.messages?.length) {
    const msgs = (hEntry.status?.messages || []).map((m) => JSON.stringify(m)).join('; ');
    return `ComfyUI 执行未完成：${msgs.slice(0, 600)}`;
  }
  return null;
}

async function runComfyPrompt(base, graph) {
  const submit = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'dsh-image-mcp' }),
  });
  const submitText = await submit.text();
  if (!submit.ok) throw new Error(`ComfyUI /prompt 拒绝（HTTP ${submit.status}）：${submitText.slice(0, 400)}`);
  let promptId;
  try {
    promptId = JSON.parse(submitText).prompt_id;
  } catch {
    throw new Error('ComfyUI /prompt 响应异常：' + submitText.slice(0, 200));
  }

  const deadline = Date.now() + 570000;
  let history = null;
  let pollCount = 0;
  // 先查后睡：ComfyUI 命中缓存或 Turbo 少步数时可能几百毫秒就完成，
  // 若先睡 1.5s 每次都要白等。同时首轮用短间隔、后续逐步退避到 3s。
  while (Date.now() < deadline) {
    pollCount++;
    try {
      const hRes = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(5000) });
      if (hRes.ok) {
        const h = await hRes.json();
        if (h[promptId]) {
          const err = checkComfyHistoryError(h[promptId]);
          if (err) throw new Error(err);
          history = h[promptId];
          break;
        }
      }
    } catch (e) {
      if (/执行出错|执行未完成/.test(e.message)) throw e;
    }
    const waitMs = pollCount === 1 ? 400 : pollCount <= 4 ? 1200 : 3000;
    await new Promise((r) => setTimeout(r, waitMs));

    // 每 ~15 秒轻量检查一次队列状态
    if (pollCount % 5 === 0) {
      try {
        const qRes = await fetch(`${base}/queue`, { signal: AbortSignal.timeout(3000) });
        if (qRes.ok) {
          const q = await qRes.json();
          const inRunning = (q.queue_running || []).some((item) => item[1] === promptId);
          const inPending = (q.queue_pending || []).some((item) => item[1] === promptId);
          if (!inRunning && !inPending && !history) {
            // 既不在执行中也不在队列中，任务可能刚执行完成正在落库 history（大模型/多图落盘可能耗时数秒），给予最多 8 次宽限重试
            let settled = false;
            for (let retry = 0; retry < 8; retry++) {
              await new Promise((r) => setTimeout(r, 1500));
              try {
                const fRes = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(5000) });
                if (fRes.ok) {
                  const finalCheck = await fRes.json();
                  if (finalCheck[promptId]) {
                    const err = checkComfyHistoryError(finalCheck[promptId]);
                    if (err) throw new Error(err);
                    history = finalCheck[promptId];
                    settled = true;
                    break;
                  }
                }
              } catch (errCheck) {
                if (/执行出错|执行未完成/.test(errCheck.message)) throw errCheck;
              }
            }
            if (settled) break;
            throw new Error(`任务 ${promptId} 已离开 ComfyUI 队列但未产出结果（可能被手动中断、显存不足或服务端异常退出）`);
          }
        }
      } catch (e) {
        if (/已离开 ComfyUI 队列|执行出错|执行未完成/.test(e.message)) throw e;
      }
    }
  }
  if (!history) throw new Error('等待 ComfyUI 出图超时（570s）');

  // 优化图片提取：优先提取 SaveImage 正式成图，避免被中间步骤的 PreviewImage 预览图抢占
  const outputImgs = [];
  const tempImgs = [];
  for (const nodeOut of Object.values(history.outputs || {})) {
    for (const img of nodeOut.images || []) {
      const imgType = img.type || 'output';
      if (imgType === 'output') outputImgs.push(img);
      else if (imgType === 'temp') tempImgs.push(img);
    }
  }
  // 上限由 batch_size（callTool 已夹到 4）与 ComfyUI 实际产出共同决定。
  // 原来无条件 slice(0, 4)：batch_size 合法取到 4 但历史里可能因重试/SaveImage 多节点
  // 返回更多张，多出来的会被静默丢掉——用户要 4 张只拿到 2 张却毫无提示。
  // 这里只在产出超过 MAX_RETURN_IMAGES 时截断并明确告知，而不是无声丢弃。
  const MAX_RETURN_IMAGES = 4;
  const picked = outputImgs.length > 0 ? outputImgs : tempImgs;
  const truncated = picked.length > MAX_RETURN_IMAGES;
  const targetImgs = picked.slice(0, MAX_RETURN_IMAGES);
  if (truncated) {
    log('ComfyUI 产出 ' + picked.length + ' 张，仅取回前 ' + MAX_RETURN_IMAGES + ' 张');
  }
  const images = [];
  const fetchPromises = targetImgs.map((img) => {
    const imgType = img.type || 'output';
    const url = `${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(imgType)}`;
    return fetch(url, { signal: AbortSignal.timeout(30000) })
      .then(async (view) => {
        if (!view.ok) return null;
        const buf = Buffer.from(await view.arrayBuffer());
        return { buf, mime: view.headers.get('content-type') || 'image/png' };
      })
      .catch(() => null);
  });
  const fetched = await Promise.all(fetchPromises);
  for (const item of fetched) {
    if (item) images.push(item);
  }
  if (!images.length) throw new Error('ComfyUI 完成但没有产出图片');
  return { images };
}

// ---------- MCP 工具定义 ----------

const SAVE_PARAMS = {
  save_dir: {
    type: 'string',
    description:
      '可选：成图保存目录。绝对路径，或相对 DSH 工作区根的相对路径（如 "generated-images" 或 "Figure/DSH-Images"）。缺省存到 我的图片\\DSH-Images。',
  },
  filename: {
    type: 'string',
    description: '可选：文件名（可不含扩展名，按需自动补；非法字符会替换成 -）。缺省用 工具名-时间戳。',
  },
};

const IMAGE_PARAMS = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: '图像描述（生图提示词，建议写清楚主体/风格/构图）' },
    aspect_ratio: {
      type: 'string',
      enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
      description: '宽高比，默认 1:1',
    },
    resolution: { type: 'string', enum: ['1K', '2K', '4K'], description: '分辨率档位，默认 1K' },
    input_images: {
      type: 'array',
      items: { type: 'string' },
      description: '可选：用于编辑/合成的本地图片路径（绝对路径，最多 4 张）',
    },
    ...SAVE_PARAMS,
  },
  required: ['prompt'],
};

const COMFY_PARAMS = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: '正向提示词' },
    negative_prompt: { type: 'string', description: '反向提示词' },
    width: { type: 'integer', description: '宽度；Qwen/MOSS 默认 1024，SDXL 默认 1024，SD15 默认 512' },
    height: { type: 'integer', description: '高度；Qwen/MOSS 默认 1024，SDXL 默认 1024，SD15 默认 512' },
    steps: { type: 'integer', description: '采样步数；MOSS 默认 25 步，Qwen Turbo 默认 8 步，标准版默认 40，SDXL 默认 25，SD15 默认 20' },
    cfg: { type: 'number', description: 'CFG；MOSS 默认 2.5，Qwen 默认 1，SD15 默认 7' },
    seed: { type: 'integer', description: '随机种子，缺省随机' },
    batch_size: { type: 'integer', description: '一次出几张，默认 1（最多取回 4 张）' },
    pipeline: { type: 'string', enum: ['auto', 'moss_image', 'qwen_image', 'sd15'], description: '工作流：auto（默认，根据模型可用性及中英文自动路由：中文/排版优先走 MOSS-Image，英文/通用优先走 Qwen Image 2.1）、moss_image、qwen_image、sd15' },
    model: { type: 'string', description: 'diffusion model 文件名（支持正则或模糊匹配，如 moss_image_sft 或 qwen_image_turbo）' },
    text_encoder: { type: 'string', description: '文本编码器文件名（缺省自动匹配）' },
    vae: { type: 'string', description: 'VAE 文件名（缺省自动匹配）' },
    checkpoint: { type: 'string', description: 'sd15：checkpoint 文件名；缺省自动选第一个' },
    input_images: {
      type: 'array',
      items: { type: 'string' },
      description: '可选：参考图路径（绝对路径，1-16 张）。传入即进入图生图/图像编辑模式：图片会自动上传到 ComfyUI 并接到 TextEncodeQwenImage21 的参考图口。目前仅 Qwen Image 2.1 管线支持，MOSS-Image 与 SD1.5 不支持参考图。',
    },
    workflow_path: { type: 'string', description: '可选：自定义工作流 JSON 路径（支持绝对路径或相对工作区根路径，如 Workflows/moss-image/moss-image-sft-t2i.json）。提供时优先执行该工作流' },
    ...SAVE_PARAMS,
  },
  required: ['prompt'],
};

const TOOLS = [
  {
    name: 'generate_nano_banana_2',
    description:
      '用 Nano Banana 2.1（完整版）生成或编辑图片，支持 1K/2K/4K 分辨率。注意：NB 2.1（gemini-nano-banana-2.1）已于 2026-10-06 在公开 API GA，但 Antigravity 后端尚未推送（实测 404）；调用先试 2.1 ID，再试旧完整版候选，最后自动回落到当前唯一可用的 gemini-3.1-flash-image——后端推送后无需改代码即自动用上 2.1。消耗 Antigravity 的 Gemini 额度池。可用 save_dir/filename 指定保存位置。',
    inputSchema: IMAGE_PARAMS,
  },
  {
    name: 'generate_nano_banana_2_lite',
    description:
      '用 Nano Banana 2 Lite（Gemini 3.1 Flash Image，实测可用）生成或编辑图片，速度最快、额度消耗最低。消耗 Antigravity 的 Gemini 额度池。可用 save_dir/filename 指定保存位置。',
    inputSchema: IMAGE_PARAMS,
  },
  {
    name: 'generate_comfyui',
    description:
      '用本机 ComfyUI 生图（需要 ComfyUI 正在运行）。传 input_images 即进入图生图/图像编辑模式（Qwen Image 2.1 走 TextEncodeQwenImage21 的参考图口，最多 16 张）。auto 模式智能路由：中文或海报排版优先走 MOSS-Image（OpenMOSS 5B SFT/Base，25步 er_sde+simple，cfg 2.5），英文或通用生图优先走 Qwen Image 2.1（Turbo 8 步 / 标准 40 步，cfg 1），无上述模型时回落 SD1.5；也支持用 workflow_path 或环境变量 DSH_IMAGE_COMFY_WORKFLOW 加载外部工作流模板。不消耗在线额度。可用 save_dir/filename 指定保存位置。',
    inputSchema: COMFY_PARAMS,
  },
];

// ---------- MCP stdio JSON-RPC ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function savedSummary(saved) {
  return `${saved.file}（${Math.round(saved.bytes / 1024)} KB）`;
}

async function callTool(name, args) {
  if (name === 'generate_nano_banana_2' || name === 'generate_nano_banana_2_lite') {
    const chain = name === 'generate_nano_banana_2' ? NB2_CHAIN : LITE_CHAIN;
    const inputImages = (args.input_images || []).map((p) => resolve(p));
    const img = await generateViaAntigravity(chain, args.prompt, {
      aspectRatio: args.aspect_ratio,
      resolution: args.resolution,
      inputImages,
    });
    const saved = saveImage(img.base64, img.mime, name.replaceAll('_', '-'), args.save_dir, args.filename);
    return {
      content: [
        { type: 'image', data: img.base64, mimeType: img.mime },
        {
          type: 'text',
          text: `已生成（后端模型 ${img.model}，${args.aspect_ratio || '1:1'}，${args.resolution || '1K'}）；已保存：${savedSummary(saved)}`,
        },
      ],
    };
  }
  if (name === 'generate_comfyui') {
    const comfyArgs = {
      prompt: args.prompt,
      negative_prompt: args.negative_prompt,
      width: args.width,
      height: args.height,
      steps: args.steps,
      cfg: args.cfg,
      seed: args.seed ?? Math.floor(Math.random() * 2 ** 48),
      batch_size: Math.min(args.batch_size ?? 1, 4),
      pipeline: args.pipeline,
      model: args.model,
      text_encoder: args.text_encoder || args.textEncoder,
      textEncoder: args.text_encoder || args.textEncoder,
      vae: args.vae,
      checkpoint: args.checkpoint,
      workflow_path: args.workflow_path,
      input_images: args.input_images,
    };
    const { images } = await generateViaComfy(comfyArgs);
    const content = [];
    const paths = [];
    for (let i = 0; i < images.length; i++) {
      const { buf, mime } = images[i];
      content.push({ type: 'image', data: buf.toString('base64'), mimeType: mime });
      const suffix = images.length > 1 ? `-${i + 1}` : '';
      const saved = saveImage(
        buf,
        mime,
        'comfyui',
        args.save_dir,
        args.filename ? `${args.filename}${suffix}` : undefined,
      );
      paths.push(savedSummary(saved));
    }
    content.push({ type: 'text', text: `ComfyUI 已生成 ${images.length} 张；已保存：${paths.join('、')}` });
    return { content };
  }
  throw new Error(`未知工具：${name}`);
}

const lineReader = createInterface({ input: process.stdin });
lineReader.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    error(null, -32700, 'Parse error');
    return;
  }
  const batch = Array.isArray(msg) ? msg : [msg];
  for (const m of batch) handleMessage(m);
});

function handleMessage(m) {
  if (!m || typeof m !== 'object') return;
  const { id, method, params } = m;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'dsh-image-mcp', version: '1.3.0' },
      instructions:
        '生图工具集：generate_nano_banana_2（完整版 NB2，自动回落）、generate_nano_banana_2_lite（NB2 Lite，实测可用）、generate_comfyui（本机 ComfyUI，auto 智能路由 MOSS-Image / Qwen Image 2.1，支持 workflow_path 模板）。生成结果以图片块返回，可用 save_dir/filename 落到指定目录（相对路径基于 DSH 工作区根）。',
    });
    return;
  }
  if (method === 'ping') {
    result(id, {});
    return;
  }
  if (method === 'tools/list') {
    result(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    callTool(name, args)
      .then((r) => result(id, r))
      .catch((e) => {
        log('tools/call 失败:', e.message);
        result(id, { content: [{ type: 'text', text: '生图失败：' + e.message }], isError: true });
      });
    return;
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return;
  if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
}

lineReader.on('close', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

log('启动完成；凭据:', credPath(), '; 默认落盘:', SAVE_DIR, '; 工作区基准:', BASE_DIR, '; 端点:', ENDPOINTS.join(', '));
