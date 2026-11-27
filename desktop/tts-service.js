'use strict';

// 微软 Edge 在线神经网络语音合成 (Edge TTS) + 离线兜底服务
// 纯原生 Node.js / Electron 实现，零外部 npm 依赖

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WIN_EPOCH = 11644473600n;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = '143';
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

// ---------- DRM 加密模块 (Sec-MS-GEC v2 算法) ----------
const _U32 = 0xFFFFFFFFn;

const _SHA256_INITIAL = [
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
];
const _SHA256_STATE = [
  0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
  0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
];
const _SHA256_SCHEDULE = [
  0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
  0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
  0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
  0xD258B060, 0x72766564,
];
const _SHA256_ROUND_CONSTANTS = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];
const _SHA256_ADJUSTMENT = 0xC9DC06A7;
const _SHA256_BLOCK_CONSTANTS = [
  ..._SHA256_ROUND_CONSTANTS.slice(0, 14),
  _SHA256_ADJUSTMENT,
  ..._SHA256_ROUND_CONSTANTS.slice(15),
];
const _SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80;
const _SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0;

const _CS64_COEFFICIENTS = [
  [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167],
];
const _CS64_FACTOR = 0x82893933;
const _CS64_ADJUSTMENT0 = 0xF2F90B1A;
const _CS64_ADJUSTMENT1 = 0x0B1A0000;

function rotr(x, n) {
  x = x >>> 0;
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function rol16(x) {
  x = x >>> 0;
  return ((x << 16) | (x >>> 16)) >>> 0;
}

function bigSigma0(x) {
  return (rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)) >>> 0;
}

function bigSigma1(x) {
  return (rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)) >>> 0;
}

function sigma0(x) {
  return (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
}

function sigma1(x) {
  return (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;
}

function wordsLe4Even(buf) {
  const rem = buf.length % 4;
  const padLen = rem === 0 ? 0 : 4 - rem;
  const padded = padLen > 0 ? Buffer.concat([buf, Buffer.alloc(padLen)]) : buf;
  const words = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(padded.readUInt32LE(i));
  }
  if (words.length % 2 !== 0) words.push(0);
  return words;
}

function sha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state.map((x) => x >>> 0);
  const constants = firstRound === 14 ? _SHA256_BLOCK_CONSTANTS : _SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) {
    const t1 = (h + bigSigma1(e) + (g ^ (e & (f ^ g))) + constants[i] + words[i]) >>> 0;
    const t2 = (bigSigma0(a) + ((a & b) | (c & (a | b)))) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSha256Schedule(words, firstWord = 16) {
  for (let index = firstWord; index < 64; index++) {
    const x = words[index - 2], y = words[index - 15];
    words.push((sigma1(x) + words[index - 7] + sigma0(y) + words[index - 16]) >>> 0);
  }
}

function sha256Init(data) {
  const words = new Array(14).fill(0);
  words.push(data.readUIntBE(0, 3));
  words.push(data.readUInt32BE(3));
  for (let index = 16; index < 30; index++) {
    let val = _SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) val += (index === 16 ? (sigma1(words[index - 2]) ^ _SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[index - 2]));
    if (index - 7 >= 14) val += words[index - 7];
    if (index - 15 >= 14) val += (index === 29 ? (sigma0(words[index - 15]) ^ _SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[index - 15]));
    words.push(val >>> 0);
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + _SHA256_ADJUSTMENT - _SHA256_ROUND_CONSTANTS[14]) >>> 0);
  expandSha256Schedule(words, 31);
  const working = sha256Rounds(_SHA256_STATE, words, 14);
  return _SHA256_INITIAL.map((x, i) => (x + working[i]) >>> 0);
}

function sha256Digest(data) {
  const length = 57 + data.length;
  const padLen = (55 - (length % 64) + 64) % 64;
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(padLen), Buffer.alloc(8)]);
  padded.writeBigUInt64BE(BigInt(length * 8), padded.length - 8);
  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = [];
    for (let i = 0; i < 64; i += 4) {
      words.push(padded.readUInt32BE(offset + i));
    }
    expandSha256Schedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((x, i) => (x + working[i]) >>> 0);
  }
  const buf = Buffer.alloc(32);
  state.forEach((w, i) => buf.writeUInt32BE(w, i * 4));
  return buf;
}

function mul32(a, b) {
  return Number((BigInt(a >>> 0) * BigInt(b >>> 0)) & _U32);
}

function cs64Digest(data, digest) {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors = [mul32(keyA, _CS64_FACTOR), mul32(keyB, _CS64_FACTOR)];
  const terms = _CS64_COEFFICIENTS.map(([coeff], i) => mul32(coeff, factors[i % 2]));
  const offsets = _CS64_COEFFICIENTS.map(([, off]) => off >>> 0);
  const extraData = Buffer.concat([Buffer.from([0]), data]);
  const words = wordsLe4Even(extraData);
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    let term = mul32(word, index % 2 === 0 ? keyA : keyB);
    let offset = mul32(rol16(word), index % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
    if (index === 0) {
      term = (term + mul32(_CS64_ADJUSTMENT0, factors[0])) >>> 0;
      offset = (offset + _CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  }
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];
    let t = rol16((offsets[index] + x) >>> 0);
    const q1 = mul32(t, 0x76F50F34);
    swapAcc = (swapAcc + mul32(rol16(q1), 0xC3EFEA97) + q1) >>> 0;
    t = rol16((offsets[index + 1] + y) >>> 0);
    const q2 = mul32(t, 0x1881CE3C);
    swapLast = (mul32(rol16(q2), 0x35BD1EC9) + q2) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (mul32(state, keyA) + x) >>> 0;
    state = mul32(rol16(state), 0xCF98B111);
    state = mul32(rol16(state), 0x87085B9F);
    state = mul32(rol16(state), 0x12CEB96D);
    state = mul32(rol16(state), 0x257E1D83);
    acc = (acc + state) >>> 0;
    t = (mul32(state, keyB) + y) >>> 0;
    t = mul32(rol16(t), 0xA27416F5);
    t = mul32(rol16(t), 0xD38396FF);
    state = mul32(rol16(mul32(rol16(t), 0x7C932B89)), 0xBFA49F69);
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function generateSecMsGecV2(unixTimestamp) {
  let ticks = unixTimestamp !== undefined
    ? BigInt(Math.floor(unixTimestamp))
    : BigInt(Math.floor(Date.now() / 1000));
  ticks += WIN_EPOCH;
  ticks -= (ticks % 300n);
  ticks *= 10000000n;
  const strToHash = Buffer.from(`${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const digest = sha256Digest(strToHash);
  const [cs0, cs1] = cs64Digest(strToHash, digest);
  const csBuf = Buffer.alloc(8);
  csBuf.writeUInt32LE(cs0, 0);
  csBuf.writeUInt32LE(cs1, 4);
  return `${csBuf.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}

// ---------- 预设音色与语速常量 ----------
const PRESET_VOICES = [
  { id: 'auto', nameZh: '智能推荐 (中文晓晓 / 英文Jenny)', nameEn: 'Auto (Xiaoxiao / Jenny)', category: 'smart' },
  { id: 'zh-CN-XiaoxiaoNeural', nameZh: '晓晓 (温柔自然·女声)', nameEn: 'Xiaoxiao (Gentle Female)', category: 'zh' },
  { id: 'zh-CN-YunxiNeural', nameZh: '云希 (阳光活泼·男声)', nameEn: 'Yunxi (Lively Male)', category: 'zh' },
  { id: 'zh-CN-YunjianNeural', nameZh: '云健 (沉稳影视·男声)', nameEn: 'Yunjian (Calm Male)', category: 'zh' },
  { id: 'zh-CN-XiaoyiNeural', nameZh: '晓伊 (清新明快·女声)', nameEn: 'Xiaoyi (Fresh Female)', category: 'zh' },
  { id: 'zh-CN-YunyangNeural', nameZh: '云扬 (专业新闻·男声)', nameEn: 'Yunyang (News Male)', category: 'zh' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', nameZh: '晓北 (东北口音·女声)', nameEn: 'Xiaobei (Northeast Female)', category: 'zh' },
  { id: 'zh-HK-HiuMaanNeural', nameZh: '晓曼 (粤语·女声)', nameEn: 'HiuMaan (Cantonese Female)', category: 'zh' },
  { id: 'zh-TW-HsiaoChenNeural', nameZh: '晓臻 (台湾国语·女声)', nameEn: 'HsiaoChen (Taiwan Female)', category: 'zh' },
  { id: 'en-US-JennyNeural', nameZh: 'Jenny (英语美音·女声)', nameEn: 'Jenny (US English Female)', category: 'en' },
  { id: 'en-US-GuyNeural', nameZh: 'Guy (英语美音·男声)', nameEn: 'Guy (US English Male)', category: 'en' },
  { id: 'local', nameZh: '系统原生 (离线SAPI/OneCore)', nameEn: 'System Voice (Offline)', category: 'local' },
];

const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1.0, label: '1.0x (正常)' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 1.75, label: '1.75x' },
  { value: 2.0, label: '2.0x' },
];

function resolveVoiceForText(text, voiceSetting) {
  if (!voiceSetting || voiceSetting === 'auto') {
    const isZh = /[\u4e00-\u9fa5]/u.test(text || '');
    return isZh ? 'zh-CN-XiaoxiaoNeural' : 'en-US-JennyNeural';
  }
  return voiceSetting;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatRate(rateNum) {
  const r = typeof rateNum === 'number' && Number.isFinite(rateNum) ? rateNum : 1.0;
  const pct = Math.round((r - 1.0) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

// ---------- 核心语音合成方法 ----------
function synthesizeEdgeTts(text, options = {}) {
  const {
    voice = 'zh-CN-XiaoxiaoNeural',
    rate = 1.0,
    volume = '+0%',
    pitch = '+0Hz',
    timeout = 10000,
    logger = null, // 可选：主进程传入 log 以便异常落进 main.log，缺省走 console
  } = options;

  return new Promise((resolve, reject) => {
    if (!text || !text.trim()) {
      return reject(new Error('Text is empty'));
    }

    const cleanText = text.trim();
    const resolvedVoice = resolveVoiceForText(cleanText, voice);

    if (resolvedVoice === 'local') {
      return reject(new Error('Voice is configured as local'));
    }

    const connId = crypto.randomUUID().replace(/-/g, '');
    const gec = generateSecMsGecV2();
    const wssUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const headers = {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
      Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`,
    };

    let ws = null;
    let timer = null;
    let settled = false;
    const audioChunks = [];
    let chunkParseErrors = 0;

    const logWarn = (msg) => {
      try {
        if (typeof logger === 'function') logger(msg);
        else console.error(msg);
      } catch {}
    };
    const emptyAudioError = () => new Error(
      chunkParseErrors > 0
        ? `Edge TTS returned empty audio (${chunkParseErrors} audio chunks failed to parse)`
        : 'Edge TTS returned empty audio'
    );

    const cleanup = () => {
      clearTimeout(timer);
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Edge TTS synthesis timed out (${timeout}ms)`));
      }
    }, timeout);

    try {
      ws = new WebSocket(wssUrl, { headers });
    } catch (err) {
      settled = true;
      cleanup();
      return reject(err);
    }

    ws.onopen = () => {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;

      const configMsg = `X-Timestamp:${dateStr}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
      ws.send(configMsg);

      const reqId = crypto.randomUUID().replace(/-/g, '');
      const rateStr = typeof rate === 'string' ? rate : formatRate(rate);
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${escapeXml(resolvedVoice)}'><prosody pitch='${pitch}' rate='${rateStr}' volume='${volume}'>${escapeXml(cleanText)}</prosody></voice></speak>`;
      const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateStr}Z\r\nPath:ssml\r\n\r\n${ssml}`;
      ws.send(ssmlMsg);
    };

    ws.onmessage = async (event) => {
      if (settled) return;
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          settled = true;
          const totalBuffer = Buffer.concat(audioChunks);
          cleanup();
          if (totalBuffer.length > 0) {
            resolve(totalBuffer);
          } else {
            reject(emptyAudioError());
          }
        }
      } else {
        try {
          // 类型归一化：运行时的 WebSocket 可能给 Blob（浏览器形态）、Buffer 或
          // ArrayBuffer（Node/undici 形态）。原实现无条件调用 event.data.arrayBuffer()，
          // 一旦拿到 Buffer 就会逐块抛错，再被空 catch 吞掉 —— 表现为音频全丢、
          // 永远降级本地语音。这里三种形态都支持，并把异常打进日志。
          const data = event.data;
          let ab;
          if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
            ab = data;
          } else if (Buffer.isBuffer(data)) {
            ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
          } else if (data && typeof data.arrayBuffer === 'function') {
            ab = await data.arrayBuffer();
          } else {
            throw new Error('unexpected audio chunk type: ' + Object.prototype.toString.call(data));
          }
          const buf = Buffer.from(ab);
          if (buf.length >= 2) {
            const headerLen = buf.readUInt16BE(0);
            const header = buf.subarray(2, 2 + headerLen).toString('utf-8');
            if (header.includes('Path:audio')) {
              const audioData = buf.subarray(2 + headerLen);
              if (audioData.length > 0) {
                audioChunks.push(audioData);
              }
            }
          }
        } catch (err) {
          chunkParseErrors += 1;
          logWarn(`[tts] 音频块解析失败（已跳过该块）：${err && err.message ? err.message : String(err)}`);
        }
      }
    };

    ws.onerror = (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err || new Error('WebSocket connection error'));
      }
    };

    ws.onclose = (event) => {
      if (!settled) {
        settled = true;
        cleanup();
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error(`WebSocket closed unexpectedly (code ${event.code})${chunkParseErrors > 0 ? `; ${chunkParseErrors} audio chunks failed to parse` : ''}`));
        }
      }
    };
  });
}

// ---------- 偏好设置持久化 (跨会话记忆留存) ----------
function getSettingsFilePath(userDataDir) {
  return path.join(userDataDir, 'tts-settings.json');
}

function loadTtsSettings(userDataDir) {
  try {
    const file = getSettingsFilePath(userDataDir);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        rate: typeof data.rate === 'number' && Number.isFinite(data.rate) ? data.rate : 1.0,
        voice: typeof data.voice === 'string' && data.voice ? data.voice : 'auto',
      };
    }
  } catch {}
  return { rate: 1.0, voice: 'auto' };
}

function saveTtsSettings(userDataDir, newSettings) {
  try {
    const current = loadTtsSettings(userDataDir);
    const updated = {
      rate: typeof newSettings.rate === 'number' && Number.isFinite(newSettings.rate) ? newSettings.rate : current.rate,
      voice: typeof newSettings.voice === 'string' && newSettings.voice ? newSettings.voice : current.voice,
    };
    const file = getSettingsFilePath(userDataDir);
    fs.writeFileSync(file, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    return loadTtsSettings(userDataDir);
  }
}

module.exports = {
  PRESET_VOICES,
  SPEED_OPTIONS,
  generateSecMsGecV2,
  resolveVoiceForText,
  synthesizeEdgeTts,
  loadTtsSettings,
  saveTtsSettings,
  formatRate,
};
