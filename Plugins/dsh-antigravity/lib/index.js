/**
 * Google Antigravity / Cloud Code Assist adapter for DeepSeek Harness.
 *
 * This plugin is intentionally shaped like a DSH Web plugin: Cordis loads this
 * module, `apply()` registers a harness LlmAdapter, and OAuth credentials live
 * under DSH home. It does not require an external Antigravity CLI.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  ToolCallId,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  attributionHeaders,
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError,
} from "@deepseek-ai/dsh-llm";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { idleWatchdog, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export const PROVIDER = "agy";
export const PROVIDER_NAME = "Antigravity (AGY)";
export const name = "dsh-antigravity";
export const inject = ["llm"];

const STREAM_IDLE_TIMEOUT_MS = 300000;
const STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";
const DISCOVERY_TIMEOUT_MS = 8000;
const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// 端点顺序 = 「当前账号到底谁能真正服务」的顺序。实测（免费档 free-tier 账号，
// projectId aicode-consumers）：cloudcode-pa.googleapis.com 上的
// v1internal:streamGenerateContent 对任何模型都稳定回
// 429 RESOURCE_EXHAUSTED（该端点的配额桶按付费档计，与本地可见剩余额度无关，
// 响应里也没有任何 retry/reset 信息）；而 daily-cloudcode-pa.googleapis.com 和
// 它的 sandbox 镜像对同一请求、同一 envelope 正常 200。付费档账号反过来只在 prod
// 端点可用，所以 prod 不删除，只降到最后兜底。
const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];

const REDIRECT_PATH = "/oauth-callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

// OAuth client 凭据不再内嵌（2026-11-17）：读本目录 oauth-client.local.json（不入库），
// env（antigravityEnv）仍优先。缺文件且无 env 时为空串，token 刷新会显式失败。
// 加固：在读取时即做去空白与格式校验；任何来源给出的空/非法 client_id 都不会
// 被发往 Google（否则 Google 会回 400 invalid_request: Could not determine client ID）。
const oauthClientLocalState = { clientId: "", clientSecret: "", error: "" };
try {
  // 修复：原实现用 "./oauth-client.local.json" 相对 lib/index.js 解析，
  // 实际找到的是 lib/oauth-client.local.json（不存在）→ 静默吞掉 ENOENT →
  // clientId="" → Google 返回 400 "Could not determine client ID from request"。
  // 配置文件在插件根目录，必须向上一级。
  const raw = readFileSync(fileURLToPath(new URL("../oauth-client.local.json", import.meta.url)), "utf8");
  const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // 容忍 UTF-8 BOM
  oauthClientLocalState.clientId = typeof parsed.clientId === "string" ? parsed.clientId.trim() : "";
  oauthClientLocalState.clientSecret =
    typeof parsed.clientSecret === "string" ? parsed.clientSecret.trim() : "";
} catch (error) {
  oauthClientLocalState.error = error instanceof Error ? error.message : String(error);
}
const DEFAULT_CLIENT_ID = oauthClientLocalState.clientId;
const DEFAULT_CLIENT_SECRET = oauthClientLocalState.clientSecret;

function oauthClientLocal(key) {
  return oauthClientLocalState[key] || "";
}

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. " +
  "You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.";
const ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION =
  'CRITICAL: NEVER output rule checks, formatting guidelines, constraint checklists, or thinking/personality preambles in the final response. Output only the final response.';

const PLATFORM =
  process.platform === "darwin" ? "MACOS" : process.platform === "win32" ? "WINDOWS" : "LINUX";
const GEMINI_ROLE = {
  user: "user",
  model: "model",
};
const TOOL_CALLING_MODE = {
  none: "NONE",
  any: "ANY",
  auto: "AUTO",
  validated: "VALIDATED",
};

const ROUTING = {
  "gemini-4-argon": {
    off: "gemini-4-argon-tiered",
    routing: {
      minimal: "gemini-4-argon-tiered",
      low: "gemini-4-argon-tiered",
      medium: "gemini-4-argon-tiered",
      high: "gemini-4-argon-tiered",
      xhigh: "gemini-4-argon-tiered",
    },
    defaultRequestId: "gemini-4-argon-tiered",
  },
  "gemini-4-helium": {
    off: "gemini-4-helium-tiered",
    routing: {
      minimal: "gemini-4-helium-tiered",
      low: "gemini-4-helium-tiered",
      medium: "gemini-4-helium-tiered",
      high: "gemini-4-helium-tiered",
      xhigh: "gemini-4-helium-tiered",
    },
    defaultRequestId: "gemini-4-helium-tiered",
  },
  "gemini-4-neon": {
    off: "gemini-4-neon-tiered",
    routing: {
      minimal: "gemini-4-neon-tiered",
      low: "gemini-4-neon-tiered",
      medium: "gemini-4-neon-tiered",
      high: "gemini-4-neon-tiered",
      xhigh: "gemini-4-neon-tiered",
    },
    defaultRequestId: "gemini-4-neon-tiered",
  },
  "gemini-4-krypton": {
    off: "gemini-4-krypton-tiered",
    routing: {
      minimal: "gemini-4-krypton-tiered",
      low: "gemini-4-krypton-tiered",
      medium: "gemini-4-krypton-tiered",
      high: "gemini-4-krypton-tiered",
      xhigh: "gemini-4-krypton-tiered",
    },
    defaultRequestId: "gemini-4-krypton-tiered",
  },
  "gemini-nano-banana-2.1": {
    off: "gemini-nano-banana-2.1",
    routing: {
      minimal: "gemini-nano-banana-2.1",
      low: "gemini-nano-banana-2.1",
      medium: "gemini-nano-banana-2.1",
      high: "gemini-nano-banana-2.1",
      xhigh: "gemini-nano-banana-2.1",
    },
    defaultRequestId: "gemini-nano-banana-2.1",
  },
  "gemini-3.8-flash": {
    off: "gemini-3.8-flash-tiered",
    routing: {
      minimal: "gemini-3.8-flash-tiered",
      low: "gemini-3.8-flash-tiered",
      medium: "gemini-3.8-flash-tiered",
      high: "gemini-3.8-flash-tiered",
      xhigh: "gemini-3.8-flash-tiered",
    },
    defaultRequestId: "gemini-3.8-flash-tiered",
  },
  "claude-opus-4-6": {
    off: "claude-opus-4-6-thinking",
    routing: {
      minimal: "claude-opus-4-6-thinking",
      low: "claude-opus-4-6-thinking",
      medium: "claude-opus-4-6-thinking",
      high: "claude-opus-4-6-thinking",
      xhigh: "claude-opus-4-6-thinking",
    },
    defaultRequestId: "claude-opus-4-6-thinking",
  },
  "claude-sonnet-4-6": {
    off: "claude-sonnet-4-6",
    routing: {
      minimal: "claude-sonnet-4-6",
      low: "claude-sonnet-4-6",
      medium: "claude-sonnet-4-6",
      high: "claude-sonnet-4-6",
      xhigh: "claude-sonnet-4-6",
    },
    defaultRequestId: "claude-sonnet-4-6",
  },
  "gemini-3.7-flash": {
    off: "gemini-3.7-flash-tiered",
    routing: {
      minimal: "gemini-3.7-flash-tiered",
      low: "gemini-3.7-flash-tiered",
      medium: "gemini-3.7-flash-tiered",
      high: "gemini-3.7-flash-tiered",
      xhigh: "gemini-3.7-flash-tiered",
    },
    defaultRequestId: "gemini-3.7-flash-tiered",
  },
  "gemini-3.6-flash": {
    off: "gemini-3.6-flash-low",
    routing: {
      minimal: "gemini-3.6-flash-low",
      low: "gemini-3.6-flash-low",
      medium: "gemini-3.6-flash-medium",
      high: "gemini-3.6-flash-high",
      xhigh: "gemini-3.6-flash-high",
    },
    defaultRequestId: "gemini-3.6-flash-high",
  },
  "gemini-3.5-flash": {
    // 3.5 Flash 本体（extra-low / low / gemini-3-flash-agent 三个 tier）后端已经下线：
    // 实测它们仍返回 HTTP 200，但正文是「Gemini 3.5 Flash is no longer available.
    // Please switch to Gemini 3.7 Flash...」——不是错误，会当成正常回答显示给用户。
    // 该目录里唯一还活着的是 gemini-3.5-flash-lite，所以统一路由到它。
    off: "gemini-3.5-flash-lite",
    routing: {
      minimal: "gemini-3.5-flash-lite",
      low: "gemini-3.5-flash-lite",
      medium: "gemini-3.5-flash-lite",
      high: "gemini-3.5-flash-lite",
      xhigh: "gemini-3.5-flash-lite",
    },
    defaultRequestId: "gemini-3.5-flash-lite",
  },
  "gemini-3.1-pro": {
    off: "gemini-3.1-pro-low",
    routing: {
      minimal: "gemini-3.1-pro-low",
      low: "gemini-3.1-pro-low",
      medium: "gemini-pro-agent",
      high: "gemini-pro-agent",
      xhigh: "gemini-pro-agent",
    },
    defaultRequestId: "gemini-pro-agent",
  },
  "gemini-3.1-flash-image": {
    off: "gemini-3.1-flash-image",
    routing: {
      minimal: "gemini-3.1-flash-image",
      low: "gemini-3.1-flash-image",
      medium: "gemini-3.1-flash-image",
      high: "gemini-3.1-flash-image",
      xhigh: "gemini-3.1-flash-image",
    },
    defaultRequestId: "gemini-3.1-flash-image",
  },
  "gemini-3-flash": {
    off: "gemini-3-flash",
    routing: {
      minimal: "gemini-3-flash",
      low: "gemini-3-flash",
      medium: "gemini-3-flash",
      high: "gemini-3-flash",
      xhigh: "gemini-3-flash",
    },
    defaultRequestId: "gemini-3-flash",
  },
  "gemini-2.5-pro": {
    off: "gemini-2.5-pro",
    routing: {
      minimal: "gemini-2.5-pro",
      low: "gemini-2.5-pro",
      medium: "gemini-2.5-pro",
      high: "gemini-2.5-pro",
      xhigh: "gemini-2.5-pro",
    },
    defaultRequestId: "gemini-2.5-pro",
  },
  "gemini-2.5-flash": {
    off: "gemini-2.5-flash",
    routing: {
      minimal: "gemini-2.5-flash",
      low: "gemini-2.5-flash",
      medium: "gemini-2.5-flash",
      high: "gemini-2.5-flash",
      xhigh: "gemini-2.5-flash",
    },
    defaultRequestId: "gemini-2.5-flash",
  },
  "gpt-oss-120b": {
    off: "gpt-oss-120b-medium",
    routing: {
      minimal: "gpt-oss-120b-medium",
      low: "gpt-oss-120b-medium",
      medium: "gpt-oss-120b-medium",
      high: "gpt-oss-120b-medium",
      xhigh: "gpt-oss-120b-medium",
    },
    defaultRequestId: "gpt-oss-120b-medium",
  },
};

const RUNTIME_MAX_OUTPUT_TOKENS = {
  "gemini-4-argon": 65536,
  "gemini-4-argon-tiered": 65536,
  "gemini-4-helium": 65536,
  "gemini-4-helium-tiered": 65536,
  "gemini-4-neon": 65536,
  "gemini-4-neon-tiered": 65536,
  "gemini-4-krypton": 65536,
  "gemini-4-krypton-tiered": 65536,
  "gemini-nano-banana-2.1": 65536,
  "gemini-3.8-flash": 65536,
  "gemini-3.8-flash-tiered": 65536,
  "gemini-3.7-flash": 65536,
  "gemini-3.7-flash-tiered": 65536,
  "gemini-3.7-flash-low": 65536,
  "gemini-3.7-flash-medium": 65536,
  "gemini-3.7-flash-high": 65536,
  "gemini-3.6-flash": 65536,
  "gemini-3.6-flash-low": 65536,
  "gemini-3.6-flash-medium": 65536,
  "gemini-3.6-flash-high": 65536,
  "gemini-3.5-flash": 65536,
  "gemini-3.5-flash-extra-low": 65536,
  "gemini-3.5-flash-low": 65536,
  "gemini-3-flash-agent": 65536,
  "gemini-3.1-pro": 65535,
  "gemini-3.1-pro-low": 65535,
  "gemini-3.1-pro-high": 65535,
  "gemini-pro-agent": 65535,
  "claude-opus-4-6": 64000,
  "claude-opus-4-6-thinking": 64000,
  "claude-sonnet-4-6": 64000,
  "gpt-oss-120b": 32768,
  "gpt-oss-120b-medium": 32768,
};

const MODELS = [
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-4-helium",
    name: "Gemini 4 Helium",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-4-neon",
    name: "Gemini 4 Neon",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-4-krypton",
    name: "Gemini 4 Krypton",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-nano-banana-2.1",
    name: "Nano Banana 2.1",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoningEfforts: ["low", "high"],
  },
  {
    id: "gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash Image",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "high"],
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    inputModalities: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    inputModalities: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    inputModalities: ["text", "image"],
    contextWindow: 250000,
    maxTokens: 64000,
    reasoningEfforts: ["high"],
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B",
    inputModalities: ["text"],
    contextWindow: 131072,
    maxTokens: 32768,
    reasoningEfforts: ["medium"],
  },
];

const diagnostics = {
  endpoint: "",
  status: undefined,
  projectId: "",
  resolvedRuntimeModel: "",
  availableModels: "",
  matchedModelDebug: "",
  error: "",
};

const projectCache = new Map();
const modelCache = new Map();
const inFlightModelLookups = new Map();
let cachedQuota = undefined;
let webLoginFlow = undefined;

let toolCallCounter = 0;

const DEFAULT_PROXY_PORT = 7890;
const DEFAULT_PROXY_CONFIG = Object.freeze({ enabled: false, port: DEFAULT_PROXY_PORT });
const proxyFetch = undiciFetch;
let currentProxyConfig = { ...DEFAULT_PROXY_CONFIG };
let proxyAgent = undefined;
let proxyConfigError = undefined;
let proxyReady = undefined;

export function credentialPath() {
  return dshHomePath("storages", "antigravity-oauth.json");
}

export function modelSettingsPath() {
  return dshHomePath("storages", "antigravity-settings.json");
}

export function proxySettingsPath() {
  return dshHomePath("storages", "antigravity-proxy.json");
}

function normalizeProxyConfig(raw) {
  const enabled = raw?.enabled === true;
  const source = raw?.port ?? DEFAULT_PROXY_PORT;
  const port = typeof source === "number" ? source : Number(String(source).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("proxy port must be an integer from 1 to 65535");
  }
  return { enabled, port };
}

function proxyConfigView() {
  return {
    enabled: currentProxyConfig.enabled,
    port: currentProxyConfig.port,
    url: `http://127.0.0.1:${currentProxyConfig.port}`,
    ...(proxyConfigError ? { error: proxyConfigError } : {}),
  };
}

function describeFetchError(error) {
  const messages = [];
  let current = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    if (Array.isArray(current.errors)) {
      for (const child of current.errors) {
        const text = child instanceof Error ? child.message : String(child);
        if (text && !messages.includes(text)) messages.push(text);
      }
    }
    const text = current instanceof Error ? current.message : String(current);
    if (text && !messages.includes(text)) messages.push(text);
    if (!current.cause || current.cause === current) break;
    current = current.cause;
  }
  return messages.join(" â ");
}

async function applyProxyConfig(config) {
  const nextAgent = config.enabled
    ? new ProxyAgent(`http://127.0.0.1:${config.port}`)
    : undefined;
  const previous = proxyAgent;
  currentProxyConfig = config;
  proxyAgent = nextAgent;
  proxyConfigError = undefined;
  if (previous) void previous.close().catch(() => undefined);
}

async function loadProxyConfig() {
  try {
    const parsed = JSON.parse(await readFile(proxySettingsPath(), "utf8"));
    if (!isRecord(parsed)) throw new Error("Antigravity proxy config must be a JSON object");
    await applyProxyConfig(normalizeProxyConfig(parsed));
  } catch (error) {
    if (error?.code === "ENOENT") {
      await applyProxyConfig({ ...DEFAULT_PROXY_CONFIG });
    } else {
      proxyConfigError = error instanceof Error ? error.message : String(error);
      currentProxyConfig = { ...DEFAULT_PROXY_CONFIG };
      proxyAgent = undefined;
    }
  }
  return proxyConfigView();
}

function ensureProxyReady() {
  proxyReady ??= loadProxyConfig();
  return proxyReady;
}

export async function getProxyConfig() {
  await ensureProxyReady();
  return proxyConfigView();
}

export async function setProxyConfig(input) {
  await ensureProxyReady();
  const next = normalizeProxyConfig(input);
  const file = proxySettingsPath();
  await mkdir(dirname(file), { recursive: true });
  const tempFile = `${file}.tmp`;
  await writeFile(tempFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(tempFile, file);
  await applyProxyConfig(next);
  return proxyConfigView();
}

export async function antigravityFetch(input, init = {}) {
  await ensureProxyReady();
  if (!currentProxyConfig.enabled || !proxyAgent) return fetch(input, init);
  return proxyFetch(input, { ...init, dispatcher: proxyAgent });
}

export async function testProxyConnection(port = currentProxyConfig.port) {
  let draft;
  try {
    draft = normalizeProxyConfig({ enabled: true, port });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const agent = new ProxyAgent(`http://127.0.0.1:${draft.port}`);
  const started = Date.now();
  try {
    const response = await proxyFetch("https://oauth2.googleapis.com/", {
      method: "GET",
      dispatcher: agent,
      signal: AbortSignal.timeout(15000),
    });
    void response.arrayBuffer().catch(() => undefined);
    return { ok: true, status: response.status, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: describeFetchError(error) };
  } finally {
    await agent.close().catch(() => undefined);
  }
}

const DEFAULT_ENABLED_MODEL_IDS = MODELS.map((model) => model.id);

function antigravityEnv(namePart) {
  return process.env[`ANTIGRAVITY_${namePart}`] || process.env[`NOAGY_${namePart}`];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sanitizeText(text) {
  return String(text ?? "").toWellFormed();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nowRequestId() {
  return `antigravity-${Date.now()}-${randomBytes(6).toString("hex")}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function redactSecrets(text) {
  return String(text)
    .replace(/\bya29\.[A-Za-z0-9._~+/-]+=*/g, "[redacted-access-token]")
    .replace(/\b1\/[A-Za-z0-9_-]{20,}/g, "[redacted-refresh-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /("?(?:access_token|refresh_token|id_token|token|client_secret|code_verifier|authorization)"?\s*[:=]\s*")[^"]*(")/gi,
      "$1[redacted]$2",
    )
    .replace(
      /("?(?:access_token|refresh_token|id_token|token|client_secret|code_verifier|authorization)"?\s*[:=]\s*)[^\s&,}]+/gi,
      "$1[redacted]",
    );
}

function safeError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}

function setLastEndpoint(endpoint) {
  diagnostics.endpoint = endpoint || "";
}

function setLastStatus(status) {
  diagnostics.status = status;
}

function setLastProjectId(projectId) {
  diagnostics.projectId = projectId || "";
}

function setLastResolvedRuntimeModel(modelId) {
  diagnostics.resolvedRuntimeModel = modelId || "";
}

function setLastAvailableModels(text) {
  diagnostics.availableModels = text || "";
}

function setLastMatchedModelDebug(text) {
  diagnostics.matchedModelDebug = text || "";
}

function setLastError(error) {
  diagnostics.error = safeError(error || "");
}

export function getAntigravityDiagnostics() {
  return { ...diagnostics, oauthClient: oauthClientDiagnostics() };
}

function assertSafeApiBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ANTIGRAVITY_BASE_URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`ANTIGRAVITY_BASE_URL must use https (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new Error("ANTIGRAVITY_BASE_URL must not include credentials");
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "googleapis.com" ||
    host.endsWith(".googleapis.com") ||
    host.endsWith(".sandbox.googleapis.com");
  if (!allowed) {
    throw new Error(
      `ANTIGRAVITY_BASE_URL host "${host}" is not allowed. Use a *.googleapis.com endpoint.`,
    );
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path === "/" ? "" : path}`;
}

function endpointCandidates() {
  const explicit = antigravityEnv("BASE_URL")?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}

function resolveCallbackHost(raw = antigravityEnv("CALLBACK_HOST")) {
  const host = (raw || "127.0.0.1").trim().toLowerCase();
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopbackHosts.has(host)) {
    throw new Error(
      `Unsafe ANTIGRAVITY_CALLBACK_HOST="${host}". Only loopback hosts are allowed: 127.0.0.1, ::1, localhost.`,
    );
  }
  return host === "localhost" ? "127.0.0.1" : host;
}

function callbackPort() {
  const raw = antigravityEnv("CALLBACK_PORT");
  if (!raw) return 51121;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ANTIGRAVITY_CALLBACK_PORT: ${raw}`);
  }
  return parsed;
}

function redirectUri() {
  return `http://localhost:${callbackPort()}${REDIRECT_PATH}`;
}

function requireOAuthSetting(value, label) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(
      `Antigravity OAuth ${label} 未配置。请检查插件目录的 oauth-client.local.json 或环境变量 ANTIGRAVITY_${label}。` +
        (oauthClientLocalState.error ? ` (本地文件读取失败: ${oauthClientLocalState.error})` : ""),
    );
  }
  return trimmed;
}

// client_id 必须形如 <数字>.apps.googleusercontent.com。
// 脏值/空白值若被发出去，Google 只会回含糊的 400 invalid_request，
// 因此在这里提前、明确地失败。
function clientId() {
  const id = requireOAuthSetting(
    antigravityEnv("CLIENT_ID") || DEFAULT_CLIENT_ID,
    "CLIENT_ID",
  );
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(id)) {
    throw new Error(`Antigravity OAuth CLIENT_ID 格式非法（长度 ${id.length}），已拒绝发送。`);
  }
  return id;
}

function clientSecret() {
  return requireOAuthSetting(
    antigravityEnv("CLIENT_SECRET") || DEFAULT_CLIENT_SECRET,
    "CLIENT_SECRET",
  );
}

// 只读诊断：仅暴露客户端 ID 的长度与是否配置，绝不打印 secret 或完整 ID/token。
function oauthClientDiagnostics() {
  let id = "";
  let secretOk = false;
  let error = "";
  try {
    id = clientId();
    secretOk = clientSecret().length > 0;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return {
    configured: !!id,
    clientIdLength: id.length,
    clientIdPrefix: id.slice(0, 12),
    clientSecretConfigured: secretOk,
    localFileError: oauthClientLocalState.error || undefined,
    error: error || undefined,
  };
}

function defaultUserAgent() {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/2.31.0 ${os}/${arch}`; // 本机 Antigravity IDE FileVersion 实测 2.31.0；Google 按 UA 里的 semver 卡版本
}

function antigravityHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": antigravityEnv("USER_AGENT") || defaultUserAgent(),
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform: PLATFORM,
      pluginType: "GEMINI",
    }),
  };
}

function attributionHeaderBag() {
  try {
    return attributionHeaders() || {};
  } catch {
    return {};
  }
}

// billion-context（bili）的 dsh-native 会替换 globalThis.fetch，并在每个模型请求上打
// `x-bili-plugin: dsh`。带上这个标记后，bili 的 ACP 内核会接管 google v1internal lane：
// 它把请求体拆成 core 再重建，重建后的 body 让上游只回 2 帧、0 个可见字符、且没有终止
// 帧，于是 bili 就地合成一个 503 "upstream stream ended before a completion event"，
// DSH 侧看到的就是 TRANSPORT。逐字节转发（passthrough）则完全正常。
// 只在确认 bili 的拦截真的装着时才发这个头，避免平白给 Google 送无关头部。
const BILI_INTERCEPT_FLAG = Symbol.for('billion-context.native-fetch-intercept');

function biliPassthroughHeaderBag() {
  if (antigravityEnv("BILI_PASSTHROUGH") === "0") return {};
  try {
    if (globalThis[BILI_INTERCEPT_FLAG] !== true) return {};
  } catch {
    return {};
  }
  return { "x-bili-passthrough": "1" };
}

function jsonOrTextError(text) {
  const parsed = safeJsonParse(text);
  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
    return parsed.error.message;
  }
  return text;
}

function jsonHeaders(token) {
  return {
    ...antigravityHeaders(token),
    Accept: "application/json",
  };
}

function stableProjectId(seed) {
  const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultProjectId(seed = "antigravity-default") {
  return antigravityEnv("PROJECT_ID")?.trim() || stableProjectId(seed);
}

function extractProjectId(data) {
  if (!isRecord(data)) return undefined;
  const direct =
    data.antigravityProjectId ??
    data.projectId ??
    data.backendProjectId ??
    data.userDefinedCloudaicompanionProject ??
    data.cloudaicompanionProject ??
    data.project;
  const directId = asString(direct);
  if (directId) return directId;
  if (isRecord(direct)) {
    const nestedId = asString(direct.id);
    if (nestedId) return nestedId;
  }
  for (const key of ["projects", "projectIds", "cloudaicompanionProjects"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = extractProjectId(item);
        if (nested) return nested;
        const itemId = asString(item);
        if (itemId) return itemId;
      }
    }
  }
  return undefined;
}

async function listCloudAICompanionProjects(token) {
  for (const endpoint of endpointCandidates()) {
    try {
      const response = await antigravityFetch(`${endpoint}/v1internal:listCloudAICompanionProjects`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      setLastStatus(response.status);
      setLastEndpoint(endpoint);
      if (!response.ok) continue;
      return extractProjectId(await response.json());
    } catch (error) {
      setLastError(error);
    }
  }
  return undefined;
}

async function loadCodeAssistUncached(token) {
  const body = JSON.stringify({
    metadata: {
      ideType: "ANTIGRAVITY",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  });
  for (const endpoint of endpointCandidates()) {
    try {
      const response = await antigravityFetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      setLastStatus(response.status);
      setLastEndpoint(endpoint);
      if (!response.ok) continue;
      const project = extractProjectId(await response.json());
      if (project) return project;
      return await listCloudAICompanionProjects(token);
    } catch (error) {
      setLastError(error);
    }
  }
  return undefined;
}

async function loadCodeAssist(token) {
  const cached = projectCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    projectCache.delete(token);
    projectCache.set(token, cached);
    return cached.projectId;
  }
  const projectId = await loadCodeAssistUncached(token);
  projectCache.set(token, { projectId, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  if (projectCache.size > 32) {
    const oldestKey = projectCache.keys().next().value;
    if (oldestKey !== undefined) projectCache.delete(oldestKey);
  }
  return projectId;
}

function resolveProjectId(options) {
  return (
    antigravityEnv("PROJECT_ID")?.trim() ||
    options.warmedProject ||
    options.credentialProjectId ||
    defaultProjectId(options.email || "antigravity-default")
  );
}

function collectModelLabels(value, out = []) {
  if (!value || out.length > 50) return out;
  if (typeof value === "string") {
    if (/gemini|claude|gpt-oss/i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModelLabels(item, out);
    return out;
  }
  if (isRecord(value)) {
    for (const key of ["id", "name", "label", "displayName", "model", "modelId"]) {
      collectModelLabels(value[key], out);
    }
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") collectModelLabels(nested, out);
    }
  }
  return out;
}

function summarizeModelCandidate(value) {
  if (!isRecord(value)) return String(value ?? "none");
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token|auth|credential|secret|email/i.test(key)) continue;
    if (raw === null || ["string", "number", "boolean"].includes(typeof raw)) out[key] = raw;
    else if (Array.isArray(raw)) out[key] = `[array:${String(raw.length)}]`;
    else if (isRecord(raw)) out[key] = `{${Object.keys(raw).slice(0, 12).join(",")}}`;
  }
  return JSON.stringify(out).slice(0, 1200);
}

function isUsableRuntimeModelId(id) {
  return /^(gemini-|claude-|gpt-oss-)/i.test(id) && !/\s/.test(id) && !/^MODEL_/i.test(id);
}

function buildModelMatchRegex(requestedId) {
  const requested = requestedId.toLowerCase();
  if (requested === "gemini-3.7-flash-low") return /gemini[- ]3\.7[- ]flash \(low\)/i;
  if (requested === "gemini-3.7-flash-medium") return /gemini[- ]3\.7[- ]flash \(medium\)/i;
  if (requested === "gemini-3.7-flash-high") return /gemini[- ]3\.7[- ]flash \(high\)/i;
  if (requested === "gemini-3.6-flash-low") return /gemini[- ]3\.6[- ]flash \(low\)/i;
  if (requested === "gemini-3.6-flash-medium") return /gemini[- ]3\.6[- ]flash \(medium\)/i;
  if (requested === "gemini-3.6-flash-high") return /gemini[- ]3\.6[- ]flash \(high\)/i;
  if (requested === "gemini-3.5-flash-extra-low") return /gemini[- ]3\.5[- ]flash \(low\)/i;
  if (requested === "gemini-3.5-flash-low" || requested === "gemini-3.5-flash-medium") {
    return /gemini[- ]3\.5[- ]flash \(medium\)/i;
  }
  if (requested === "gemini-3.5-flash-high" || requested === "gemini-3-flash-agent") {
    return /gemini[- ]3\.5[- ]flash \(high\)/i;
  }
  if (requested.includes("claude-opus-4-6")) return /claude.*opus.*4\.6/i;
  if (requested.includes("claude-sonnet-4-6")) return /claude.*sonnet.*4\.6/i;
  if (requested.includes("gpt-oss-120b")) return /gpt.*oss.*120b/i;
  if (requested === "gemini-3.1-pro-low") return /gemini[- ]3\.1[- ]pro \(low\)/i;
  if (requested === "gemini-3.1-pro-high" || requested === "gemini-pro-agent") {
    return /gemini[- ]3\.1[- ]pro \(high\)/i;
  }
  const escaped = escapeRegExp(requested).replace(/\\-/g, "[- ]");
  return new RegExp(escaped, "i");
}

function dynamicModelFromInfo(modelId, info) {
  if (!isRecord(info)) return { id: modelId };
  setLastMatchedModelDebug(summarizeModelCandidate({ modelId, ...info }));
  const experiments = Array.isArray(info.modelExperiments)
    ? info.modelExperiments.filter((item) => typeof item === "string")
    : undefined;
  return {
    id: modelId,
    experiments,
    apiProvider: asString(info.apiProvider),
    modelProvider: asString(info.modelProvider),
  };
}

function findDynamicModel(value, requestedId) {
  if (!value) return undefined;
  if (isRecord(value) && isRecord(value.models)) {
    const modelsMap = value.models;
    if (isUsableRuntimeModelId(requestedId) && requestedId in modelsMap) {
      return dynamicModelFromInfo(requestedId, modelsMap[requestedId]);
    }
    const targetRegex = buildModelMatchRegex(requestedId);
    for (const [modelId, info] of Object.entries(modelsMap)) {
      if (!isUsableRuntimeModelId(modelId)) continue;
      if (targetRegex.test(modelId)) return dynamicModelFromInfo(modelId, info);
      if (isRecord(info)) {
        const label = info.label ?? info.displayName ?? info.name;
        if (typeof label === "string" && targetRegex.test(label)) {
          return dynamicModelFromInfo(modelId, info);
        }
      }
    }
    return undefined;
  }
  const targetRegex = buildModelMatchRegex(requestedId);
  if (typeof value === "string") {
    return targetRegex.test(value) && isUsableRuntimeModelId(value) ? { id: value } : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDynamicModel(item, requestedId);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") {
        const found = findDynamicModel(nested, requestedId);
        if (found) return found;
      }
    }
  }
  return undefined;
}

async function fetchAvailableRuntimeModelUncached(token, projectId, requestedRuntimeModel) {
  const bodies = [{ project: projectId }];
  const attempts = endpointCandidates().flatMap((endpoint) =>
    bodies.map((body) => ({ endpoint, body })),
  );
  const settled = await Promise.all(
    attempts.map(async ({ endpoint, body }) => {
      try {
        const response = await antigravityFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
          method: "POST",
          headers: antigravityHeaders(token),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!response.ok) return { endpoint, status: response.status, data: undefined };
        return { endpoint, status: response.status, data: await response.json() };
      } catch (error) {
        setLastError(error);
        return { endpoint, status: undefined, data: undefined };
      }
    }),
  );
  let lastLabels = "";
  for (const { endpoint, status, data } of settled) {
    if (status !== undefined) setLastStatus(status);
    if (data === undefined) continue;
    setLastEndpoint(endpoint);
    const labels = [...new Set(collectModelLabels(data))].slice(0, 16);
    if (labels.length) lastLabels = labels.join(",");
    const found = findDynamicModel(data, requestedRuntimeModel);
    if (found) {
      if (lastLabels) setLastAvailableModels(lastLabels);
      return found;
    }
  }
  if (lastLabels) setLastAvailableModels(lastLabels);
  return undefined;
}

async function fetchAvailableRuntimeModel(token, projectId, requestedRuntimeModel) {
  const cacheKey = `${token}::${projectId}::${requestedRuntimeModel}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const inFlight = inFlightModelLookups.get(cacheKey);
  if (inFlight) return inFlight;
  const promise = fetchAvailableRuntimeModelUncached(token, projectId, requestedRuntimeModel).then(
    (result) => {
      modelCache.set(cacheKey, { result, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
      return result;
    },
  );
  inFlightModelLookups.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightModelLookups.delete(cacheKey);
    if (modelCache.size > 64) {
      const now = Date.now();
      for (const [key, entry] of modelCache) {
        if (entry.expiresAt <= now) modelCache.delete(key);
      }
    }
  }
}

function clampFraction(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function remainingPercent(remaining) {
  if (remaining === undefined) return undefined;
  return Math.round(remaining * 1000) / 10;
}

function progressBar(remaining, width = 20) {
  if (remaining === undefined) return `[${"?".repeat(width)}]`;
  const filled = Math.max(0, Math.min(width, Math.round(remaining * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatReset(resetTime) {
  if (!resetTime) return "n/a";
  const timestamp = Date.parse(resetTime);
  if (!Number.isFinite(timestamp)) return resetTime;
  const delta = timestamp - Date.now();
  if (delta <= 0) return "now";
  const totalMinutes = Math.round(delta / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function postJson(path, token, body) {
  let lastErrorText = "";
  for (const endpoint of endpointCandidates()) {
    try {
      const response = await antigravityFetch(`${endpoint}${path}`, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
      });
      setLastEndpoint(endpoint);
      setLastStatus(response.status);
      const text = await response.text();
      const data = safeJsonParse(text) ?? { raw: text };
      if (!response.ok) {
        lastErrorText =
          isRecord(data) && isRecord(data.error) && typeof data.error.message === "string"
            ? data.error.message
            : text;
        if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) {
          throw new Error(`${path} failed (${String(response.status)}): ${lastErrorText.slice(0, 300)}`);
        }
        continue;
      }
      return { endpoint, status: response.status, data };
    } catch (error) {
      lastErrorText = safeError(error);
      setLastError(lastErrorText);
    }
  }
  throw new Error(`${path} failed: ${lastErrorText || "no endpoint available"}`);
}

async function fetchAvailableModelsFromEndpoint(endpoint, token, projectId) {
  try {
    const response = await antigravityFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ project: projectId }),
    });
    const text = await response.text();
    const data = safeJsonParse(text) ?? { raw: text };
    if (!response.ok) {
      const lastErrorText =
        isRecord(data) && isRecord(data.error) && typeof data.error.message === "string"
          ? data.error.message
          : text;
      setLastError(lastErrorText);
      return undefined;
    }
    return { endpoint, status: response.status, data };
  } catch (error) {
    setLastError(error);
    return undefined;
  }
}

// 只认「第一个真正能服务的端点」的目录，不再把多个端点的 models 求并集。
// 并集的后果：prod 端点的付费档专属模型（gemini-4-*、gemini-3.6-flash-*、
// gemini-3.1-pro-*、gemini-pro-agent 等）会混进免费档账号的模型列表里，用户一选就
// 404；而 defaultAgentModelId 又会按端点顺序被最后一个覆盖，同样是错的。
// 顺序即优先级，与 ENDPOINT_FALLBACKS 保持一致。
async function fetchMergedAvailableModels(token, projectId) {
  let lastErrorText = "";
  for (const endpoint of endpointCandidates()) {
    const result = await fetchAvailableModelsFromEndpoint(endpoint, token, projectId);
    if (!result) {
      lastErrorText = diagnostics.error || lastErrorText;
      continue;
    }
    setLastEndpoint(result.endpoint);
    setLastStatus(result.status);
    const models = isRecord(result.data) && isRecord(result.data.models) ? result.data.models : {};
    const defaultAgentModelId =
      isRecord(result.data) && typeof result.data.defaultAgentModelId === "string"
        ? result.data.defaultAgentModelId
        : undefined;
    return {
      endpoint: result.endpoint,
      status: result.status,
      data: { models, defaultAgentModelId },
    };
  }
  throw new Error(
    `/v1internal:fetchAvailableModels failed: no endpoint available${lastErrorText ? `: ${lastErrorText}` : ""}`,
  );
}

function parseQuotaSummary(data) {
  const summary = isRecord(data) ? data : {};
  const groups = [];
  for (const group of Array.isArray(summary.groups) ? summary.groups : []) {
    if (!isRecord(group)) continue;
    const buckets = [];
    for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
      if (!isRecord(bucket)) continue;
      const remaining = clampFraction(bucket.remainingFraction);
      if (remaining === undefined && !bucket.bucketId) continue;
      buckets.push({
        bucketId: String(bucket.bucketId || bucket.displayName || "unknown"),
        displayName: String(bucket.displayName || bucket.bucketId || "Limit"),
        window: bucket.window ? String(bucket.window) : undefined,
        resetTime: bucket.resetTime ? String(bucket.resetTime) : undefined,
        description: bucket.description ? String(bucket.description) : undefined,
        remainingFraction: remaining ?? 0,
      });
    }
    if (!buckets.length && !group.displayName) continue;
    groups.push({
      displayName: String(group.displayName || "Quota group"),
      description: group.description ? String(group.description) : undefined,
      buckets,
    });
  }
  return {
    groups,
    description: summary.description ? String(summary.description) : undefined,
  };
}

function parseModels(data) {
  const raw = isRecord(data) ? data : {};
  const modelsObj = isRecord(raw.models) ? raw.models : {};
  const models = [];
  for (const [modelId, info] of Object.entries(modelsObj)) {
    if (!isRecord(info)) continue;
    if (info.isInternal || String(modelId).startsWith("chat_")) continue;
    const quotaInfo = isRecord(info.quotaInfo) ? info.quotaInfo : {};
    models.push({
      modelId,
      displayName:
        typeof info.displayName === "string"
          ? info.displayName
          : typeof info.label === "string"
            ? info.label
            : typeof info.modelName === "string"
              ? info.modelName
              : undefined,
      remainingFraction: clampFraction(quotaInfo.remainingFraction),
      resetTime: quotaInfo.resetTime ? String(quotaInfo.resetTime) : undefined,
      modelProvider:
        typeof info.modelProvider === "string"
          ? info.modelProvider
          : typeof info.apiProvider === "string"
            ? info.apiProvider
            : undefined,
      supportsThinking: !!info.supportsThinking,
      supportsImages: !!info.supportsImages,
      recommended: !!info.recommended,
    });
  }
  models.sort((a, b) => a.modelId.localeCompare(b.modelId));
  return {
    models,
    defaultAgentModelId:
      raw.defaultAgentModelId || raw.defaultAgentModel
        ? String(raw.defaultAgentModelId || raw.defaultAgentModel)
        : undefined,
  };
}

function extractModelVersion(model) {
  const name = String(model?.name || "");
  const id = String(model?.id || model?.modelId || "");
  const idMatch = id.match(/(?:gemini|claude|gpt)[-_ ]*v?(\d+(?:\.\d+)*)/i)
    || id.match(/\b(\d+(?:\.\d+)+)\b/);
  if (idMatch) return idMatch[1].split(".").map((num) => parseInt(num, 10) || 0);

  const nameMatch = name.match(/(?:gemini|claude|gpt)[-_ ]*v?(\d+(?:\.\d+)*)/i)
    || name.match(/\b(\d+(?:\.\d+)+)\b/);
  if (nameMatch) return nameMatch[1].split(".").map((num) => parseInt(num, 10) || 0);

  return [0];
}

function compareVersionsDesc(v1, v2) {
  const len = Math.max(v1.length, v2.length);
  for (let i = 0; i < len; i++) {
    const num1 = v1[i] !== undefined ? v1[i] : 0;
    const num2 = v2[i] !== undefined ? v2[i] : 0;
    if (num1 !== num2) return num2 - num1;
  }
  return 0;
}

function getFamilyOrder(model) {
  const text = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  if (text.includes("gemini")) return 1;
  if (text.includes("claude")) return 2;
  if (text.includes("gpt")) return 3;
  return 4;
}

function getVariantScore(model) {
  const text = `${model?.name || ""} ${model?.id || ""}`.toLowerCase();
  if (text.includes("ultra")) return 1;
  if (text.includes("pro") && !text.includes("lite")) return 2;
  if (text.includes("flash") && !text.includes("lite") && !text.includes("thinking") && !text.includes("image")) return 3;
  if (text.includes("flash") && text.includes("thinking") && !text.includes("lite")) return 4;
  if (text.includes("image")) return 5;
  if (text.includes("lite") && !text.includes("thinking")) return 6;
  if (text.includes("lite") && text.includes("thinking")) return 7;
  return 10;
}

export function compareAntigravityModels(a, b) {
  const famA = getFamilyOrder(a);
  const famB = getFamilyOrder(b);
  if (famA !== famB) return famA - famB;

  const verA = extractModelVersion(a);
  const verB = extractModelVersion(b);
  const verComp = compareVersionsDesc(verA, verB);
  if (verComp !== 0) return verComp;

  const variantA = getVariantScore(a);
  const variantB = getVariantScore(b);
  if (variantA !== variantB) return variantA - variantB;

  return (a.name || a.id || "").localeCompare(b.name || b.id || "") || (a.id || "").localeCompare(b.id || "");
}

export function compareAntigravityModelOptions(a, b) {
  const aEnabled = Boolean(a?.enabled);
  const bEnabled = Boolean(b?.enabled);
  if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
  return compareAntigravityModels(a, b);
}

function modelNameFromId(id) {
  return String(id)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bOss\b/g, "OSS");
}

function inferModelShape(modelId, info = {}) {
  const id = String(modelId);
  const staticModel = modelById(id);
  if (staticModel) return staticModel;
  const lower = id.toLowerCase();
  const maxTokens = getMaxOutputTokens(id, id);
  const inputModalities = info.supportsImages || /gemini|claude/i.test(id) ? ["text", "image"] : ["text"];
  const reasoningEfforts = lower.includes("gpt-oss")
    ? ["medium"]
    : lower.includes("claude")
      ? ["high"]
      : lower.includes("pro")
        ? ["low", "high"]
        : lower.includes("gemini")
          ? ["low", "medium", "high"]
          : [];
  let name = info.displayName || info.label || info.modelName || modelNameFromId(id);
  if (id === "gemini-3.7-flash-tiered") {
    name = "Gemini 3.7 Flash";
  }
  const idVer = extractModelVersion({ id });
  const nameVer = extractModelVersion({ name });
  if (
    idVer[0] !== 0 &&
    nameVer[0] !== 0 &&
    (idVer[0] !== nameVer[0] || (idVer[1] !== undefined && nameVer[1] !== undefined && idVer[1] !== nameVer[1]))
  ) {
    name = modelNameFromId(id);
  }
  return {
    id,
    name,
    inputModalities,
    contextWindow: lower.includes("claude") ? 200000 : lower.includes("gpt-oss") ? 131072 : 1048576,
    maxTokens,
    reasoningEfforts,
  };
}

function baseModelMatcher(baseId) {
  switch (baseId) {
    case "gemini-3.7-flash":
      return (text) => /gemini[- ]3\.7[- ]flash/i.test(text);
    case "gemini-3.6-flash":
      return (text) => /gemini[- ]3\.6[- ]flash/i.test(text);
    case "gemini-3.5-flash":
      return (text) => /gemini[- ]3\.5[- ]flash|gemini[- ]3[- ]flash[- ]agent/i.test(text);
    case "gemini-3.1-pro":
      return (text) => /gemini[- ]3\.1[- ]pro|gemini[- ]pro[- ]agent/i.test(text);
    case "gemini-3.1-flash-image":
      return (text) => /gemini[- ]3\.1[- ]flash[- ]image/i.test(text);
    case "gemini-3-flash":
      return (text) => /^gemini[- ]3[- ]flash$/i.test(text);
    case "gemini-2.5-pro":
      return (text) => /gemini[- ]2\.5[- ]pro/i.test(text);
    case "gemini-2.5-flash":
      return (text) => /gemini[- ]2\.5[- ]flash|gemini[- ]3\.1[- ]flash[- ]lite/i.test(text);
    case "claude-sonnet-4-6":
      return (text) => /claude[- ]sonnet/i.test(text);
    case "claude-opus-4-6":
      return (text) => /claude[- ]opus/i.test(text);
    case "gpt-oss-120b":
      return (text) => /gpt[- ]oss/i.test(text);
    default:
      return (text) => String(text || "").toLowerCase().includes(baseId.toLowerCase());
  }
}

function parseCatalogModels(data) {
  const raw = isRecord(data) ? data : {};
  const modelsObj = isRecord(raw.models) ? raw.models : {};
  const rawModels = [];
  for (const [modelId, infoRaw] of Object.entries(modelsObj)) {
    if (!isUsableRuntimeModelId(modelId)) continue;
    if (!isRecord(infoRaw)) continue;
    if (infoRaw.isInternal || String(modelId).startsWith("chat_") || String(modelId).startsWith("tab_")) continue;
    const quotaInfo = isRecord(infoRaw.quotaInfo) ? infoRaw.quotaInfo : {};
    const inferred = inferModelShape(modelId, infoRaw);
    rawModels.push({
      id: modelId,
      name: inferred.name,
      inputModalities: inferred.inputModalities,
      contextWindow: inferred.contextWindow,
      maxTokens: inferred.maxTokens,
      reasoningEfforts: inferred.reasoningEfforts,
      available: true,
      remainingFraction: clampFraction(quotaInfo.remainingFraction),
      resetTime: quotaInfo.resetTime ? String(quotaInfo.resetTime) : undefined,
      modelProvider:
        typeof infoRaw.modelProvider === "string"
          ? infoRaw.modelProvider
          : typeof infoRaw.apiProvider === "string"
            ? infoRaw.apiProvider
            : undefined,
    });
  }

  const matchedRawIds = new Set();
  const consolidated = [];

  // 只上架「当前端点目录里真的存在」的模型。以前的实现会给每个 MODELS 静态
  // 条目都补一条 available: true，即使目录里根本没有它 —— 免费档账号因此会
  // 看到 gemini-4-*、gemini-nano-banana-2.1、gemini-3.7-flash、gemini-3.6-flash、
  // gemini-3.1-pro 这些端点只认付费档的 id，选中就 404。账号升级后这些 id 会
  // 重新出现在目录里，自动恢复上架，不需要改代码。
  for (const base of MODELS) {
    const matcher = baseModelMatcher(base.id);
    const matching = rawModels.filter((r) => matcher(r.id) || matcher(r.name));
    if (matching.length === 0) continue;
    for (const m of matching) matchedRawIds.add(m.id);
    const quotaItem = matching.find((m) => typeof m.remainingFraction === "number") || matching[0];
    consolidated.push({
      id: base.id,
      name: base.name,
      inputModalities: base.inputModalities,
      contextWindow: base.contextWindow,
      maxTokens: base.maxTokens,
      reasoningEfforts: base.reasoningEfforts,
      available: true,
      remainingFraction: quotaItem?.remainingFraction,
      resetTime: quotaItem?.resetTime,
      modelProvider: quotaItem?.modelProvider,
    });
  }

  for (const raw of rawModels) {
    if (!matchedRawIds.has(raw.id)) {
      consolidated.push(raw);
    }
  }

  consolidated.sort(compareAntigravityModels);
  return consolidated;
}

function parseTier(value) {
  if (!isRecord(value)) return undefined;
  if (!value.id && !value.name) return undefined;
  return {
    id: value.id ? String(value.id) : undefined,
    name: value.name ? String(value.name) : undefined,
    description: value.description ? String(value.description) : undefined,
  };
}

export async function fetchAccountQuota(store = new FileCredentialStore(), modelSettings) {
  const { token, projectId: credentialProjectId } = await ensureApiKey(store);
  const [assistResult, summary] = await Promise.all([
    postJson("/v1internal:loadCodeAssist", token, {
      metadata: {
        ideType: "ANTIGRAVITY",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    }).catch(() => null),
    postJson("/v1internal:retrieveUserQuotaSummary", token, {}),
  ]);

  const discoveredProject = assistResult ? extractProjectId(assistResult.data) : undefined;
  const projectId = resolveProjectId({
    credentialProjectId,
    warmedProject: discoveredProject ?? null,
  });
  setLastProjectId(projectId);

  const available = await fetchMergedAvailableModels(token, projectId);
  const { groups, description } = parseQuotaSummary(summary.data);
  const { models, defaultAgentModelId } = parseModels(available.data);
  const catalogModels = parseCatalogModels(available.data);
  const assistData = isRecord(assistResult?.data) ? assistResult.data : {};
  const productTier = parseTier(assistData.currentTier);
  const paidTier = parseTier(assistData.paidTier);
  const planLabel = paidTier?.name
    ? `${paidTier.name}${paidTier.id ? ` (${paidTier.id})` : ""}`
    : productTier?.name
      ? `${productTier.name}${productTier.id ? ` (${productTier.id})` : ""}`
      : undefined;

  cachedQuota = {
    projectId,
    endpoint: summary.endpoint,
    productTier,
    paidTier,
    planLabel,
    groups,
    groupDescription: description,
    models,
    catalogModels,
    defaultAgentModelId,
    fetchedAt: Date.now(),
  };

  if (modelSettings) {
    const current = await modelSettings.read();
    const isFirstTime = current.catalogModels.length === 0 && current.enabledModelIds.length === 0;
    const catalogIds = new Set(catalogModels.map((m) => m.id));
    // 千万不要再用「MODELS 里新增的静态 id」补齐 enabledModelIds：那只会在
    // 每次刷新配额时把当前端点根本不支持的模型重新打开（旧实现的 newBaseIds）。
    // 现在只保留「用户勾选过 且 目录里仍然存在」的 id。
    const mergedEnabled = isFirstTime
      ? catalogModels.map((m) => m.id)
      : [...new Set(current.enabledModelIds.filter((id) => catalogIds.has(id)))];
    await modelSettings.setCatalogModels(catalogModels, { enabledModelIds: mergedEnabled });
  }

  return cachedQuota;
}

export function getCachedQuota() {
  return cachedQuota;
}

export function formatQuotaSummary(quota) {
  const lines = [];
  lines.push("Antigravity quota");
  if (quota.planLabel) lines.push(`plan=${quota.planLabel}`);
  lines.push(`project=${quota.projectId}`);
  lines.push(`fetched=${new Date(quota.fetchedAt).toLocaleString()}`);

  if (!quota.groups.length) {
    lines.push("");
    lines.push("No quota groups returned.");
  } else {
    for (const group of quota.groups) {
      lines.push("");
      lines.push(group.displayName);
      for (const bucket of group.buckets) {
        const remaining = remainingPercent(bucket.remainingFraction);
        lines.push(
          `  ${progressBar(bucket.remainingFraction)} ${bucket.displayName}: ${remaining ?? "?"}% left Â· resets ${formatReset(bucket.resetTime)}`,
        );
      }
    }
  }

  const rows = quota.models.filter((model) => !/tab_|chat_/i.test(model.modelId)).slice(0, 24);
  if (rows.length) {
    lines.push("");
    lines.push("Models");
    const maxId = Math.max(...rows.map((model) => model.modelId.length), 8);
    for (const model of rows) {
      const remaining = remainingPercent(model.remainingFraction);
      const flags = [
        model.recommended ? "recommended" : "",
        model.supportsThinking ? "thinking" : "",
        model.supportsImages ? "images" : "",
      ]
        .filter(Boolean)
        .join(",");
      const display = model.displayName && model.displayName !== model.modelId ? `  ${model.displayName}` : "";
      lines.push(
        `${model.modelId.padEnd(maxId)}  rem ${remaining === undefined ? "  ?" : String(remaining).padStart(5)}%  reset ${formatReset(model.resetTime).padEnd(8)}${flags ? `  [${flags}]` : ""}${display}`,
      );
    }
    lines.push("");
    lines.push("Note: remaining % is pool-shared, not a private per-model budget.");
  }
  return lines.join("\n").trimEnd();
}

function getMaxOutputTokens(modelId, runtimeModel) {
  if (runtimeModel && RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel];
  }
  if (RUNTIME_MAX_OUTPUT_TOKENS[modelId] !== undefined) return RUNTIME_MAX_OUTPUT_TOKENS[modelId];
  if (runtimeModel) {
    if (runtimeModel.startsWith("claude-")) return 64000;
    if (runtimeModel.startsWith("gpt-oss-")) return 32768;
    if (runtimeModel.startsWith("gemini-3.1-pro") || runtimeModel === "gemini-pro-agent") {
      return 65535;
    }
    if (runtimeModel.startsWith("gemini-")) return 65536;
  }
  return 8192;
}

function getAntigravityRequestModelId(modelId, effort) {
  const route = ROUTING[modelId];
  if (!route) return modelId;
  if (effort === undefined || effort === "off") {
    return route.off ?? route.routing?.high ?? route.defaultRequestId ?? modelId;
  }
  if (effort === "xhigh") {
    return (
      route.routing?.xhigh ??
      route.routing?.high ??
      route.routing?.medium ??
      route.routing?.low ??
      route.off ??
      route.defaultRequestId ??
      modelId
    );
  }
  return (
    route.routing?.[effort] ??
    route.routing?.high ??
    route.routing?.medium ??
    route.routing?.low ??
    route.off ??
    route.defaultRequestId ??
    modelId
  );
}

// 兜底候选必须落在「当前账号真的调得动」的 id 上。旧实现把 3.8/3.7/3.6 一路
// 降级到 gemini-3.7-flash-* / gemini-3.6-flash-*，而这些 id 只存在于 prod 端点
// 目录（免费档调用必然 404），所以兜底候选注定失败，等于没有兜底。
// 现在统一降到每日实测可用的 gemini-3-flash（daily 端点 200，独立模型而非同族
// tier，所以 3.8 自身被限流/无容量时它仍有较大概率可用）。
function getFallbackRuntimeModel(runtimeModel, effort) {
  const flashFallback = () => getAntigravityRequestModelId("gemini-3-flash", effort);
  if (runtimeModel.startsWith("gemini-4-")) {
    return getAntigravityRequestModelId("gemini-3.8-flash", effort);
  }
  if (runtimeModel === "gemini-nano-banana-2.1") {
    return "gemini-3.1-flash-image";
  }
  if (
    runtimeModel === "gemini-3.8-flash-tiered" ||
    runtimeModel === "gemini-3.8-flash" ||
    runtimeModel.startsWith("gemini-3.8-flash-")
  ) {
    return flashFallback();
  }
  if (
    runtimeModel === "gemini-3.7-flash-tiered" ||
    runtimeModel === "gemini-3.7-flash" ||
    runtimeModel.startsWith("gemini-3.7-flash-") ||
    runtimeModel === "gemini-3.6-flash" ||
    runtimeModel.startsWith("gemini-3.6-flash-")
  ) {
    return flashFallback();
  }
  return undefined;
}

function modelById(modelId) {
  return MODELS.find((model) => model.id === modelId);
}

function defaultReasoningEffort(model) {
  if (!model.reasoningEfforts?.length) return undefined;
  if (model.reasoningEfforts.includes("medium")) return "medium";
  if (model.reasoningEfforts.includes("high")) return "high";
  return model.reasoningEfforts[0];
}

function reasoningInfo(model) {
  if (!model.reasoningEfforts.length) return {};
  const defaultEffort = defaultReasoningEffort(model);
  return {
    reasoning: {
      efforts: model.reasoningEfforts.map((level) => ({
        id: ReasoningEffortId(level),
        name: level.charAt(0).toUpperCase() + level.slice(1),
      })),
      ...(defaultEffort ? { defaultEffort: ReasoningEffortId(defaultEffort) } : {}),
    },
  };
}

function resolveReasoning(model, effort) {
  if (effort === undefined) return defaultReasoningEffort(model);
  if (effort === "off") return effort;
  if (model.reasoningEfforts && model.reasoningEfforts.includes(effort)) return effort;
  // Older sessions may retain an effort no longer exposed by a live catalog.
  if (model.reasoningEfforts && model.reasoningEfforts.includes("high")) return "high";
  return defaultReasoningEffort(model) || "high";
}

function antigravityThinking(modelId, runtimeModel, effort, maxTokens) {
  // tiered 系（含本地映射出的 gemini-4-*-tiered）后端要求必须带 thinkingLevel：
  // effort 缺省或 off 时按最低档下发，不沿用上游「缺省即不下发」的早退。
  const tieredModel =
    runtimeModel.startsWith("gemini-4-") ||
    runtimeModel === "gemini-3.7-flash-tiered" ||
    runtimeModel.endsWith("-tiered");
  if (effort === undefined && !tieredModel) return undefined;
  if (effort === "off" && !tieredModel) return { includeThoughts: false, thinkingBudget: 0 };

  if (tieredModel) {
    return {
      includeThoughts: true,
      thinkingLevel:
        effort === "high" || effort === "xhigh" ? "HIGH" : effort === "medium" ? "MEDIUM" : "LOW",
    };
  }

  let thinkingBudget;
  if (modelId.startsWith("claude-")) {
    // 后端对 claude-* 只认 thinkingBudget（Gemini 式 thinkingLevel 被静默忽略）
    thinkingBudget =
      effort === "low" ? 4096 : effort === "medium" ? 16384 : effort === "high" || effort === "xhigh" ? 32768 : 1024;
  }
  else if (modelId.startsWith("gpt-oss-")) thinkingBudget = 8192;
  else if (modelId.startsWith("gemini-3.1-pro") || runtimeModel === "gemini-pro-agent") {
    thinkingBudget = effort === "high" || effort === "xhigh" ? 10001 : 1001;
  } else if (modelId.startsWith("gemini-3.5-flash") || runtimeModel === "gemini-3-flash-agent") {
    thinkingBudget =
      effort === "high" || effort === "xhigh" ? 10000 : effort === "medium" ? 4000 : 1000;
  } else {
    thinkingBudget = effort === "high" || effort === "xhigh" ? -1 : effort === "medium" ? 4000 : 1000;
  }

  if (maxTokens !== undefined && thinkingBudget > 0 && maxTokens <= thinkingBudget) {
    throw new LlmError(
      `Antigravity maxTokens must exceed the thinking budget (${thinkingBudget}) for ${modelId}/${effort}`,
      "INVALID_REQUEST",
    );
  }
  return { includeThoughts: true, thinkingBudget };
}

function hasImages(messages) {
  return messages.some((message) => {
    try {
      return contentHasImage(message.content);
    } catch {
      return false;
    }
  });
}

function sanitizeToolCallId(id, fallbackName) {
  const cleaned = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const capped = cleaned.slice(0, 64);
  return capped || `${fallbackName || "tool"}_${Date.now()}_${++toolCallCounter}`;
}

function toolCallIdNeeded(modelId, runtimeModel) {
  return (
    modelId.startsWith("claude-") ||
    modelId.startsWith("gpt-oss-") ||
    runtimeModel.startsWith("claude-") ||
    runtimeModel.startsWith("gpt-oss-")
  );
}

function parseArguments(raw) {
  if (isRecord(raw)) return raw;
  if (raw === undefined || raw === null || raw === "") return {};
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
  return isRecord(parsed) ? parsed : {};
}

function imageBlockToPart(block) {
  if (!isRecord(block) || block.type !== "image") return undefined;
  let data = asString(block.dataBase64) || asString(block.data) || asString(block.base64);
  const source = isRecord(block.source) ? block.source : undefined;
  if (!data && source) data = asString(source.dataBase64) || asString(source.data) || asString(source.base64);
  let mimeType =
    asString(block.mediaType) ||
    asString(block.mimeType) ||
    (source ? asString(source.mediaType) || asString(source.mimeType) : undefined) ||
    "image/png";
  if (data?.startsWith("data:")) {
    const match = data.match(/^data:([^;,]+);base64,(.*)$/s);
    if (match) {
      mimeType = match[1] || mimeType;
      data = match[2] || "";
    }
  }
  if (!data) throw new LlmError("antigravity: image content has no readable image bytes", "INVALID_REQUEST");
  return { inlineData: { mimeType, data } };
}

export function withToolResultImages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  let images = [];
  const flush = () => {
    if (images.length > 0) {
      out.push({ role: "user", content: images });
      images = [];
    }
  };
  for (const message of messages) {
    if (message.role === "assistant") flush();
    out.push(message);
    if (message.role === "tool" && Array.isArray(message.content)) {
      const parts = message.content.filter(
        (part) => isRecord(part) && part.type === "image" && (part.dataBase64 || part.data || part.base64)
      );
      if (parts.length > 0) {
        images.push({ type: "text", text: `Images from tool result ${String(message.toolCallId || "")}:` }, ...parts);
      }
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== "tool-result") continue;
        if (Array.isArray(block.content)) {
          const parts = block.content.filter(
            (part) => isRecord(part) && part.type === "image" && (part.dataBase64 || part.data || part.base64)
          );
          if (parts.length > 0) {
            images.push({ type: "text", text: `Images from tool result ${String(block.toolCallId || "")}:` }, ...parts);
          }
        }
      }
    }
  }
  flush();
  return out;
}

export async function resolveImages(messages, attachments, signal) {
  if (!Array.isArray(messages)) return messages;
  const hasImage = (block) =>
    isRecord(block) &&
    (block.type === "image" ||
      (block.type === "tool-result" && Array.isArray(block.content) && block.content.some(hasImage)));
  if (!messages.some((message) => Array.isArray(message.content) && message.content.some(hasImage))) {
    return messages;
  }
  const resolveBlock = async (block) => {
    if (!isRecord(block)) return [block];
    if (block.type === "tool-result" && Array.isArray(block.content)) {
      const resolvedContent = (await Promise.all(block.content.map(resolveBlock))).flat();
      return [{ ...block, content: resolvedContent }];
    }
    if (block.type !== "image") return [block];
    if (block.attachment) {
      if (typeof attachments?.readImage !== "function") {
        throw new LlmError(
          "antigravity: the request carries an attachment-backed image but no attachments service is mounted",
          "UNSUPPORTED",
        );
      }
      const stored = await attachments.readImage(block.attachment, signal);
      if (!stored?.data?.length) {
        throw new LlmError("antigravity: attachment image read returned no bytes", "INVALID_REQUEST");
      }
      return [{
        type: "image",
        mediaType: stored.ref.mediaType,
        dataBase64: Buffer.from(stored.data).toString("base64"),
      }];
    }
    // Fail here, before acquiring credentials or sending a request, if an image cannot be encoded.
    imageBlockToPart(block);
    return [block];
  };

  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      content: Array.isArray(message.content)
        ? (await Promise.all(message.content.map(resolveBlock))).flat()
        : message.content,
    }))
  );
}

function contentToUserParts(content) {
  if (typeof content === "string") return [{ text: sanitizeText(content) }];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text") {
      parts.push({ text: sanitizeText(block.text) });
    } else if (isRecord(block) && block.type === "image") {
      const imagePart = imageBlockToPart(block);
      if (imagePart) parts.push(imagePart);
    }
  }
  return parts;
}

function toolResultText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text") return sanitizeText(block.text);
      if (block.type === "tool-result") return toolResultText(block.content);
      return "";
    })
    .join("");
}

function replayBlockFor(message, index) {
  const source = message.source;
  if (!source || source.kind !== "model") return undefined;
  const state = source.replayState;
  if (!isRecord(state)) return undefined;
  if (state.kind !== "antigravity" || state.version !== 1) return undefined;
  if (state.provider !== PROVIDER || state.model !== source.model) return undefined;
  if (!Array.isArray(state.blocks)) return undefined;
  return state.blocks[index];
}

function assistantParts(message, model, runtimeModel, toolNames) {
  const parts = [];
  if (!Array.isArray(message.content)) return parts;
  for (let index = 0; index < message.content.length; index++) {
    const block = message.content[index];
    if (!isRecord(block)) continue;
    const replay = replayBlockFor(message, index);
    if (block.type === "text" && String(block.text || "").trim()) {
      parts.push({ text: sanitizeText(block.text) });
    } else if (block.type === "reasoning" && String(block.text || "").trim()) {
      if (replay?.type === "reasoning" && replay.thinkingSignature) {
        parts.push({
          thought: true,
          text: sanitizeText(block.text),
          thoughtSignature: replay.thinkingSignature,
        });
      } else {
        parts.push({ text: sanitizeText(block.text) });
      }
    } else if (block.type === "tool-call") {
      const toolId = String(block.id || "");
      toolNames.set(toolId, block.name);
      parts.push({
        functionCall: {
          name: block.name,
          args: parseArguments(block.arguments),
          ...(toolCallIdNeeded(model.id, runtimeModel)
            ? { id: sanitizeToolCallId(toolId, block.name) }
            : {}),
        },
        ...(replay?.type === "tool-call" && replay.thoughtSignature
          ? { thoughtSignature: replay.thoughtSignature }
          : {}),
      });
    }
  }
  return parts;
}

function pushToolResult(contents, result, toolNames, model, runtimeModel) {
  const toolCallId = String(result.toolCallId || "");
  const toolName = toolNames.get(toolCallId) || "unknown";
  const responseText = toolResultText(result.content) || (result.isError ? "Tool failed" : "");
  const part = {
    functionResponse: {
      name: toolName,
      response: result.isError ? { error: responseText } : { output: responseText },
      ...(toolCallIdNeeded(model.id, runtimeModel)
        ? { id: sanitizeToolCallId(toolCallId, toolName) }
        : {}),
    },
  };
  const last = contents[contents.length - 1];
  if (last?.role === GEMINI_ROLE.user && last.parts.some((entry) => "functionResponse" in entry)) {
    last.parts.push(part);
  } else {
    contents.push({ role: GEMINI_ROLE.user, parts: [part] });
  }
}

function convertMessages(options, model, runtimeModel) {
  const contents = [];
  const toolNames = new Map();
  const normalizedMessages = withToolResultImages(options.messages);
  for (const message of normalizedMessages) {
    if (message.role === "assistant") {
      const parts = assistantParts(message, model, runtimeModel, toolNames);
      if (parts.length) contents.push({ role: GEMINI_ROLE.model, parts });
      continue;
    }
    if (message.role === "tool") {
      pushToolResult(contents, message, toolNames, model, runtimeModel);
      continue;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    const nonResultContent = content.filter((block) => !isRecord(block) || block.type !== "tool-result");
    const userParts = contentToUserParts(nonResultContent);
    if (message.role === "system") {
      if (userParts.length) contents.push({ role: GEMINI_ROLE.user, parts: userParts });
      continue;
    }
    if (userParts.length) contents.push({ role: GEMINI_ROLE.user, parts: userParts });
    for (const block of content) {
      if (isRecord(block) && block.type === "tool-result") {
        pushToolResult(contents, block, toolNames, model, runtimeModel);
      }
    }
  }
  return contents;
}

const STRIPPED_SCHEMA_META_KEYS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
]);

function stripSchemaMetaOnly(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!STRIPPED_SCHEMA_META_KEYS.has(key) && key !== "$defs" && key !== "definitions") {
      out[key] = stripSchemaMetaOnly(value);
    }
  }
  return out;
}

function schemaUsesReferences(node) {
  if (Array.isArray(node)) return node.some((entry) => schemaUsesReferences(entry));
  if (!node || typeof node !== "object") return false;
  if (typeof node.$ref === "string") return true;
  if (node.$defs !== undefined || node.definitions !== undefined) return true;
  return Object.values(node).some((value) => schemaUsesReferences(value));
}

function collectSchemaDefs(node, out) {
  if (Array.isArray(node)) {
    for (const entry of node) collectSchemaDefs(entry, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const key of ["$defs", "definitions"]) {
    const table = node[key];
    if (table && typeof table === "object" && !Array.isArray(table)) {
      for (const [name, value] of Object.entries(table)) {
        if (!(name in out)) out[name] = value;
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$defs" || key === "definitions") continue;
    collectSchemaDefs(value, out);
  }
}

function resolveSchemaDef(ref, defs) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  const table = segments[0];
  if (table !== "$defs" && table !== "definitions") return undefined;
  return defs[segments.slice(1).join("/")];
}

// Gemini 的 parametersJsonSchema 不接受指向已删除 $defs 的悬空 $ref（实测直接
// 400 "reference to undefined schema at properties.x"）。旧实现只把 $defs 删掉、
// 却把 $ref 原样留下，于是任何用 $defs 描述工具参数的 MCP/插件工具（billion-context
// 这类带 schema 复用的工具最容易踩到）都会整轮失败。这里把 #/$defs/Name 形式的
// 本地引用就地内联，再丢弃 $defs/definitions 与纯注解关键字。
function inlineSchemaRefs(node, defs, stack) {
  if (Array.isArray(node)) return node.map((entry) => inlineSchemaRefs(entry, defs, stack));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const target = resolveSchemaDef(node.$ref, defs);
    if (target === undefined || stack.includes(node.$ref) || stack.length >= 12) return {};
    const siblings = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== "$ref") siblings[key] = value;
    }
    const nextStack = [...stack, node.$ref];
    const inlined = inlineSchemaRefs(target, defs, nextStack);
    const siblingKeys = Object.keys(siblings);
    if (siblingKeys.length === 0) return inlined;
    const merged = inlined && typeof inlined === "object" && !Array.isArray(inlined) ? { ...inlined } : {};
    for (const key of siblingKeys) merged[key] = inlineSchemaRefs(siblings[key], defs, nextStack);
    return merged;
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED_SCHEMA_META_KEYS.has(key) || key === "$defs" || key === "definitions") continue;
    out[key] = inlineSchemaRefs(value, defs, stack);
  }
  return out;
}

function stripMetaSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  if (!schemaUsesReferences(schema)) return stripSchemaMetaOnly(schema);
  const defs = {};
  collectSchemaDefs(schema, defs);
  return inlineSchemaRefs(schema, defs, []);
}

const CUSTOM_TOOL_SCHEMA_ALLOW = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "enum",
]);

function normalizeCustomToolType(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value.find((entry) => typeof entry === "string" && entry !== "null");
}

function normalizeCustomToolSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(normalizeCustomToolSchema);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!CUSTOM_TOOL_SCHEMA_ALLOW.has(key)) continue;
    if (key === "type") {
      const normalizedType = normalizeCustomToolType(value);
      if (normalizedType !== undefined) out.type = normalizedType;
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = normalizeCustomToolSchema(propSchema);
      }
      out.properties = props;
      continue;
    }
    if (key === "enum" && Array.isArray(value) && !value.every((entry) => typeof entry === "string")) {
      continue;
    }
    out[key] = normalizeCustomToolSchema(value);
  }
  return out;
}

function convertTools(tools, useLegacyParameters) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => {
        const schema = stripMetaSchema(tool.parameters);
        return {
          name: tool.name,
          description: tool.description,
          ...(useLegacyParameters
            ? { parameters: normalizeCustomToolSchema(schema) }
            : { parametersJsonSchema: schema }),
        };
      }),
    },
  ];
}

function mapToolChoiceMode(toolChoice) {
  if (toolChoice === "none") return TOOL_CALLING_MODE.none;
  if (toolChoice === "any" || toolChoice === "required") return TOOL_CALLING_MODE.any;
  return TOOL_CALLING_MODE.auto;
}

export function buildRequest(options, model, projectId, runtimeModel, effort) {
  const request = {
    contents: convertMessages(options, model, runtimeModel),
    systemInstruction: {
      role: GEMINI_ROLE.user,
      parts: [
        { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
        { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
        { text: ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION },
        ...(options.system ? [{ text: sanitizeText(options.system) }] : []),
      ],
    },
  };
  const generationConfig = {};
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  let thinkingConfig;
  try {
    // 预算放不下时不硬失败：留空交给下面的回压逻辑关掉思考（本地 0.0.5 行为）
    thinkingConfig = antigravityThinking(model.id, runtimeModel, effort, options.maxTokens);
  } catch {
    thinkingConfig = undefined;
  }
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  const maxAllowed = getMaxOutputTokens(model.id, runtimeModel);
  generationConfig.maxOutputTokens =
    options.maxTokens !== undefined
      ? Math.min(options.maxTokens, maxAllowed)
      : Math.min(maxAllowed, model.maxTokens || maxAllowed);
  // Anthropic 硬约束：max_tokens 必须大于 thinking.budget_tokens，否则整轮
  // 400 失败（实测后端原文：`max_tokens` must be greater than
  // `thinking.budget_tokens`）。宿主在上下文紧张时会下发较小的 maxTokens
  // （headroom 预留），小预算叠加 4096 起步的 thinkingBudget 就会直接撞上限。
  // 这里按可用输出预算回压 thinkingBudget；连最小思考预算都放不下时干脆关掉思考，
  // 保证请求先能成功。
  if (generationConfig.thinkingConfig && typeof generationConfig.thinkingConfig.thinkingBudget === "number") {
    const outputBudget = generationConfig.maxOutputTokens;
    const availableForThinking = outputBudget - 1024;
    if (availableForThinking < 1024) {
      delete generationConfig.thinkingConfig;
    } else if (generationConfig.thinkingConfig.thinkingBudget > availableForThinking) {
      generationConfig.thinkingConfig = { thinkingBudget: availableForThinking };
    }
  }
  if (Object.keys(generationConfig).length) request.generationConfig = generationConfig;
  if (runtimeModel.startsWith("gemini")) {
    request.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" },
    ];
  }

  const usesLegacyToolSchema = model.id.startsWith("claude-") || model.id.startsWith("gpt-oss-");
  const tools = convertTools(options.tools, usesLegacyToolSchema);
  if (tools) {
    request.tools = tools;
    if (model.id.startsWith("claude-")) {
      request.toolConfig = options.toolChoice
        ? { functionCallingConfig: { mode: mapToolChoiceMode(options.toolChoice) } }
        : { functionCallingConfig: { mode: TOOL_CALLING_MODE.validated } };
    } else if (options.toolChoice) {
      request.toolConfig = { functionCallingConfig: { mode: mapToolChoiceMode(options.toolChoice) } };
    }
  }
  if (options.sessionId) request.sessionId = String(options.sessionId);
  const envelope = {
    project: projectId,
    model: runtimeModel,
    request,
    userAgent: "antigravity",
    requestId: nowRequestId(),
  };
  // requestType="agent" 会把请求计入 Antigravity 的 agent 配额桶。实测（2026-11，
  // free-tier / aicode-consumers）：带该字段时 daily、sandbox、prod 三个端点对所有
  // 模型都稳定回 429 RESOURCE_EXHAUSTED，而 quota 接口显示 remainingFraction=1、
  // 周额度远未到期 —— 是桶级拒绝，不是真额度耗尽。省略该字段（或 "chat"）则
  // daily/sandbox 正常 200，且工具调用与思考保留（已实测 functionCall 正常返回）。
  // 因此默认不带 requestType；需要 agent 语义时可用 ANTIGRAVITY_REQUEST_TYPE=agent
  // 显式开启，请求层也会在 429 时自动换另一档重试一次。
  const requestType = antigravityEnv("REQUEST_TYPE")?.trim();
  if (requestType) envelope.requestType = requestType;
  return envelope;
}

function mapUsage(usage) {
  const inputTokens = Math.max(0, (usage.promptTokenCount || 0) - (usage.cachedContentTokenCount || 0));
  const outputTokens = usage.candidatesTokenCount || 0;
  return {
    inputTokens,
    outputTokens,
    ...(usage.cachedContentTokenCount > 0 ? { cacheReadTokens: usage.cachedContentTokenCount } : {}),
    ...(usage.thoughtsTokenCount !== undefined ? { reasoningTokens: usage.thoughtsTokenCount } : {}),
  };
}

function classifyAntigravityError(message) {
  if (/\b(?:401|403)\b/.test(message)) return "AUTH";
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE;
  if (/\b429\b|rate.?limit/i.test(message)) return "RATE_LIMIT";
  if (/\b400\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";
  if (/\b5\d\d\b/.test(message)) return "SERVER";
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return "TIMEOUT";
  if (/stream ended (?:before|without)\b/i.test(message)) return "TRANSPORT";
  if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message)) return "TRANSPORT";
  return "ANTIGRAVITY_ERROR";
}

function friendlyAntigravityError(status, text) {
  const message = redactSecrets(jsonOrTextError(text)).slice(0, 500);
  if (status === 400) {
    if (/API key not valid|API_KEY_INVALID/i.test(message)) {
      return "Antigravity login expired or credentials are invalid. Next: run /antigravity-login, then retry.";
    }
    if (/Invalid JSON payload|Unknown name/i.test(message)) {
      return `Antigravity request format was rejected by the backend (${message}). Next: switch to a simpler model or update the plugin.`;
    }
    return `Bad request from Antigravity. Backend said: ${message}`;
  }
  if (status === 401) return "Antigravity authentication failed. Next: run /antigravity-login, then retry.";
  if (status === 403) return `Antigravity denied this request. Backend said: ${message}`;
  if (status === 404) return `Antigravity could not find the requested model/resource. Backend said: ${message}`;
  if (status === 408) return "Antigravity timed out. Next: retry the same request.";
  if (status === 409) return "Antigravity reported a conflict. Next: retry once or start a new chat session.";
  if (status === 429) {
    const wait = message.match(/Resets? in ([^.\n]+)/i)?.[1]?.trim();
    // 关键区分：Google 的裸 429 正文是
    //   {"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).",...}}
    // 它既没有 reset 时间也不是 RATE_LIMIT 之外的任何明确信号，而且免费档账号在
    // prod 端点上会 100% 拿到它（对应端点配额桶，不是真实额度耗尽）。旧实现里
    // /quota/i 命中后被改写成 "Quota reached." —— 该字符串在宿主侧会被
    // isQuotaExceededError 判成 QUOTA（不可重试），于是整轮直接失败。这里只把
    // 带明确 reset/Individual quota reached 的响应当成真额度耗尽，其余保持
    // RATE_LIMIT，交给宿主重试或下一个端点。
    const explicitQuota = /Individual quota reached/i.test(message) || (wait !== undefined && /quota/i.test(message));
    if (explicitQuota) return `Quota reached.${wait ? ` Please wait ${wait}.` : ""}`;
    return `Rate limited by Antigravity.${wait ? ` Reset: ${wait}.` : ""}`;
  }
  if (status === 500) return "Antigravity had an internal server error. Next: retry or switch models.";
  if (status === 502) return "Antigravity returned a bad gateway error. Next: retry.";
  if (status === 503) return /No capacity available/i.test(message)
    ? "This model has no capacity right now. Next: retry later or switch models."
    : "Antigravity is temporarily unavailable. Next: retry or switch models.";
  if (status === 504) return "Antigravity timed out upstream. Next: retry.";
  return message || "Antigravity request failed";
}

function formatRequestDiagnostics(extra) {
  return `endpoint=${diagnostics.endpoint || "unknown"}, project=${extra.projectId}, runtimeModel=${extra.runtimeModel}, matched=${diagnostics.matchedModelDebug || "none"}, available=${diagnostics.availableModels || "unknown"}`;
}

function finishReasonOf(rawReason, hasToolCall, hasContent, errorMessage) {
  if (errorMessage && isContextWindowExceededError(errorMessage)) {
    return { kind: "error", failure: { message: errorMessage, code: CONTEXT_WINDOW_EXCEEDED_CODE } };
  }
  if (!hasContent) {
    return {
      kind: "error",
      failure: { message: "Antigravity returned a completed response with no content", code: EMPTY_RESPONSE_CODE },
    };
  }
  if (hasToolCall) return { kind: "tool-calls" };
  if (rawReason === "MAX_TOKENS") return { kind: "max-tokens" };
  if (!rawReason || rawReason === "STOP") return { kind: "stop" };
  return {
    kind: "error",
    failure: { message: `Antigravity finished with reason ${rawReason}`, code: "ANTIGRAVITY_FINISH_REASON" },
  };
}

function replayStateOf(model, runtimeModel, replayBlocks) {
  return {
    kind: "antigravity",
    version: 1,
    provider: PROVIDER,
    model: model.id,
    runtimeModel,
    blocks: replayBlocks,
  };
}

export function processStreamLine(line, state) {
  if (!line.startsWith("data:")) return [];
  const json = line.slice(5).trim();
  if (!json || json === "[DONE]") return [];
  const chunk = safeJsonParse(json);
  if (!isRecord(chunk)) return [];
  if (isRecord(chunk.error)) {
    const message = chunk.error.message || JSON.stringify(chunk.error);
    throw new LlmError(String(message), classifyAntigravityError(String(message)));
  }
  const responseData = isRecord(chunk.response) ? chunk.response : chunk;
  const candidate = Array.isArray(responseData.candidates) ? responseData.candidates[0] : undefined;
  const parts = isRecord(candidate?.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const out = [];

  const closeCurrentBlock = () => {
    if (!state.currentBlock) return;
    const index = state.blocks.length - 1;
    if (state.currentBlock.type === "text") {
      out.push({
        type: "block-end",
        index,
        block: { type: "text", text: state.currentBlock.text },
      });
    } else {
      out.push({
        type: "block-end",
        index,
        block: { type: "reasoning", text: state.currentBlock.text },
      });
    }
    state.currentBlock = null;
  };

  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.text !== undefined) {
      const isThinking = part.thought === true;
      const blockType = isThinking ? "reasoning" : "text";
      if (!state.currentBlock || state.currentBlock.type !== blockType) {
        closeCurrentBlock();
        state.currentBlock = {
          type: blockType,
          text: "",
          thinkingSignature: undefined,
          textSignature: undefined,
        };
        state.blocks.push(state.currentBlock);
        state.replayBlocks.push({ type: blockType });
        out.push({ type: "block-start", index: state.blocks.length - 1, blockType });
      }
      const delta = sanitizeText(part.text);
      state.currentBlock.text += delta;
      state.hasContent = true;
      if (isThinking && part.thoughtSignature) {
        state.currentBlock.thinkingSignature = part.thoughtSignature;
        state.replayBlocks[state.blocks.length - 1].thinkingSignature = part.thoughtSignature;
      } else if (!isThinking && part.thoughtSignature) {
        state.currentBlock.textSignature = part.thoughtSignature;
        state.replayBlocks[state.blocks.length - 1].textSignature = part.thoughtSignature;
      }
      out.push({
        type: isThinking ? "reasoning-delta" : "text-delta",
        index: state.blocks.length - 1,
        text: delta,
      });
    }
    if (isRecord(part.functionCall)) {
      closeCurrentBlock();
      const toolName = asString(part.functionCall.name) || "";
      const toolId = sanitizeToolCallId(part.functionCall.id || "", toolName);
      const args = isRecord(part.functionCall.args) ? part.functionCall.args : {};
      const argsText = JSON.stringify(args);
      const index = state.blocks.length;
      const block = { type: "tool-call", id: ToolCallId(toolId), name: toolName, arguments: argsText };
      state.blocks.push(block);
      state.replayBlocks.push({
        type: "tool-call",
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      });
      state.hasContent = true;
      state.hasToolCall = true;
      out.push({ type: "block-start", index, blockType: "tool-call" });
      out.push({
        type: "tool-call-delta",
        index,
        id: ToolCallId(toolId),
        ...(toolName ? { name: toolName } : {}),
        argumentsDelta: argsText,
      });
      out.push({ type: "block-end", index, block });
    }
  }

  if (candidate?.finishReason) state.finishReason = candidate.finishReason;
  if (isRecord(responseData.usageMetadata)) state.usage = responseData.usageMetadata;
  return out;
}

async function* streamResponseToChunks(response, model, runtimeModel, state) {
  if (!response.body) throw new LlmError("Antigravity response has no body", "TRANSPORT");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emitLine = (line) => processStreamLine(line.replace(/\r$/, ""), state);
  const emitBufferedLines = function* () {
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      yield* emitLine(line);
    }
  };

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (!(result.value instanceof Uint8Array)) continue;
    buffer += decoder.decode(result.value, { stream: true });
    yield* emitBufferedLines();
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    yield* emitLine(buffer.trimEnd());
    buffer = "";
  }

  if (state.currentBlock) {
    const index = state.blocks.length - 1;
    if (state.currentBlock.type === "text") {
      yield { type: "block-end", index, block: { type: "text", text: state.currentBlock.text } };
    } else {
      yield {
        type: "block-end",
        index,
        block: { type: "reasoning", text: state.currentBlock.text },
      };
    }
    state.currentBlock = null;
  }

  if (!state.hasContent) return;
  yield { type: "usage", usage: mapUsage(state.usage || {}) };
  yield {
    type: "finish",
    reason: finishReasonOf(state.finishReason, state.hasToolCall, state.hasContent),
    replayState: replayStateOf(model, runtimeModel, state.replayBlocks),
  };
}

export function createStreamState() {
  return {
    blocks: [],
    replayBlocks: [],
    currentBlock: null,
    finishReason: undefined,
    usage: undefined,
    hasContent: false,
    hasToolCall: false,
  };
}

function oauthCallbackHeaders(contentType = "text/html; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

function sanitizeOAuthProviderError(text) {
  const redacted = redactSecrets(text).trim();
  const parsed = safeJsonParse(redacted);
  if (isRecord(parsed)) {
    const parts = [parsed.error, parsed.error_description].filter(
      (part) => typeof part === "string" && part.length > 0,
    );
    if (parts.length) return parts.join(": ").slice(0, 300);
  }
  return redacted.slice(0, 300) || "unknown OAuth provider error";
}

function base64Url(buffer) {
  return buffer.toString("base64url");
}

function generatePKCE() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getUserEmail(token) {
  try {
    const response = await antigravityFetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    return asString(data.email);
  } catch {
    return undefined;
  }
}

function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };
    const callbackUrl = redirectUri();
    const server = createServer((request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, oauthCallbackHeaders("text/plain; charset=utf-8"));
        response.end("Method Not Allowed");
        return;
      }
      const url = new URL(request.url || "", callbackUrl);
      if (url.pathname !== REDIRECT_PATH) {
        response.writeHead(404, oauthCallbackHeaders());
        response.end("Antigravity OAuth callback route not found.");
        return;
      }
      const providerError = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (providerError) {
        const safe = escapeHtml(providerError.slice(0, 200));
        response.writeHead(400, oauthCallbackHeaders());
        response.end(`Antigravity authentication failed: ${safe}`);
        finish(() => rejectCode(new Error(`OAuth error: ${providerError.slice(0, 200)}`)));
        return;
      }
      if (!code || !state) {
        response.writeHead(400, oauthCallbackHeaders());
        response.end("Antigravity authentication failed: missing code or state.");
        finish(() => rejectCode(new Error("Missing code or state in OAuth callback")));
        return;
      }
      if (state !== expectedState) {
        response.writeHead(400, oauthCallbackHeaders());
        response.end("Antigravity authentication failed: invalid state.");
        finish(() => rejectCode(new Error("OAuth state mismatch")));
        return;
      }
      response.writeHead(200, oauthCallbackHeaders());
      response.end("Antigravity authentication complete. You can close this window and return to DSH.");
      finish(() => resolveCode({ code, state }));
    });
    server.on("error", reject);
    server.listen(callbackPort(), resolveCallbackHost(), () => {
      timeout = setTimeout(() => {
        finish(() => rejectCode(new Error("OAuth callback timed out waiting for browser login")));
        server.close();
      }, OAUTH_CALLBACK_TIMEOUT_MS);
      resolve({ server, waitForCode: () => codePromise });
    });
  });
}

export function openBrowser(url) {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true });
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    }
  } catch {
    // Best effort only.
  }
}

export function browserInteraction(signal) {
  return {
    signal,
    notify(event) {
      if (event.type === "auth_url") openBrowser(event.url);
    },
  };
}

export function terminalInteraction(signal) {
  return {
    signal,
    notify(event) {
      if (event.type !== "auth_url") return;
      console.log(event.instructions || "Open the following URL to sign in:");
      console.log(event.url);
      openBrowser(event.url);
    },
  };
}

export async function loginAntigravity(interaction = browserInteraction()) {
  const { verifier, challenge } = generatePKCE();
  const state = base64Url(randomBytes(32));
  const { server, waitForCode } = await startCallbackServer(state);
  try {
    const callbackUrl = redirectUri();
    const authParams = new URLSearchParams({
      client_id: clientId(),
      response_type: "code",
      redirect_uri: callbackUrl,
      scope: SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    });
    interaction.notify?.({
      type: "auth_url",
      url: `${AUTH_URL}?${authParams.toString()}`,
      instructions: "Complete Google sign-in. DSH will capture the local callback.",
    });

    const { code, state: returnedState } = await waitForCode();
    if (returnedState !== state) throw new Error("OAuth state mismatch");
    if (interaction.signal?.aborted) throw new Error("OAuth login aborted");

    const tokenResponse = await antigravityFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
        code_verifier: verifier,
      }).toString(),
      signal: interaction.signal,
    });
    if (!tokenResponse.ok) {
      throw new Error(
        `Token exchange failed: ${sanitizeOAuthProviderError(await tokenResponse.text())}`,
      );
    }
    const tokenData = await tokenResponse.json();
    if (!tokenData.refresh_token) {
      throw new Error("No refresh token received. Re-run /antigravity-login and allow offline access.");
    }
    const [email, discoveredProject] = await Promise.all([
      getUserEmail(tokenData.access_token),
      loadCodeAssist(tokenData.access_token),
    ]);
    return {
      refresh: tokenData.refresh_token,
      access: tokenData.access_token,
      expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
      projectId: discoveredProject || defaultProjectId(email || "antigravity-default"),
      email,
    };
  } finally {
    server.close();
  }
}

function credentialSummary(credentials) {
  if (!credentials) return { authenticated: false };
  return {
    authenticated: true,
    email: credentialEmail(credentials),
    projectId: credentialProjectId(credentials),
    expires: credentials.expires,
  };
}

async function exchangeOAuthCode(code, verifier, callbackUrl) {
  const tokenResponse = await antigravityFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl,
      code_verifier: verifier,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `Token exchange failed: ${sanitizeOAuthProviderError(await tokenResponse.text())}`,
    );
  }
  const tokenData = await tokenResponse.json();
  if (!tokenData.refresh_token) {
    throw new Error("No refresh token received. Re-run login and allow offline access.");
  }
  const [email, discoveredProject] = await Promise.all([
    getUserEmail(tokenData.access_token),
    loadCodeAssist(tokenData.access_token),
  ]);
  return {
    refresh: tokenData.refresh_token,
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
    projectId: discoveredProject || defaultProjectId(email || "antigravity-default"),
    email,
  };
}

export async function beginWebLogin(store) {
  if (webLoginFlow?.status === "pending") {
    // 加固：旧登录流程可能缓存了 client_id 为空的坏 URL（会稳定复现 400）。
    // 复用前校验；若 URL 无效，丢弃旧流程并重新发起。
    const cachedId = new URL(webLoginFlow.authUrl).searchParams.get("client_id") || "";
    if (/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(cachedId)) {
      return {
        status: webLoginFlow.status,
        authUrl: webLoginFlow.authUrl,
        startedAt: webLoginFlow.startedAt,
      };
    }
    webLoginFlow.status = "error";
    webLoginFlow.error = "丢弃了 client_id 缺失/非法的旧登录流程，已重新生成授权 URL。";
  }

  const { verifier, challenge } = generatePKCE();
  const state = base64Url(randomBytes(32));
  const { server, waitForCode } = await startCallbackServer(state);
  const callbackUrl = redirectUri();
  const authParams = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: callbackUrl,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  const flow = {
    status: "pending",
    authUrl: `${AUTH_URL}?${authParams.toString()}`,
    startedAt: Date.now(),
    error: "",
    clientIdPrefix: clientId().slice(0, 12), // 仅前缀，供诊断
  };
  webLoginFlow = flow;

  void (async () => {
    try {
      const { code, state: returnedState } = await waitForCode();
      if (returnedState !== state) throw new Error("OAuth state mismatch");
      const credentials = await exchangeOAuthCode(code, verifier, callbackUrl);
      await store.write(credentials);
      flow.status = "complete";
      flow.email = credentialEmail(credentials);
      flow.completedAt = Date.now();
      cachedQuota = undefined;
    } catch (error) {
      flow.status = "error";
      flow.error = safeError(error);
      flow.completedAt = Date.now();
    } finally {
      server.close();
    }
  })();

  return {
    status: flow.status,
    authUrl: flow.authUrl,
    startedAt: flow.startedAt,
  };
}

export function getWebLoginStatus() {
  if (!webLoginFlow) return { status: "idle" };
  return {
    status: webLoginFlow.status,
    startedAt: webLoginFlow.startedAt,
    completedAt: webLoginFlow.completedAt,
    email: webLoginFlow.email,
    error: webLoginFlow.error,
    clientIdPrefix: webLoginFlow.clientIdPrefix, // 仅前缀，供诊断确认登录 URL 使用的是哪个 client
  };
}

function credentialProjectId(credentials) {
  return asString(credentials?.projectId);
}

function credentialEmail(credentials) {
  return asString(credentials?.email);
}

function needsRefresh(credentials) {
  return !credentials?.access || !credentials.expires || credentials.expires <= Date.now() + 60000;
}

export async function refreshAntigravityToken(credentials) {
  if (!credentials?.refresh) throw new Error("Missing Antigravity refresh token. Run /antigravity-login.");
  const response = await antigravityFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: credentials.refresh,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Antigravity token refresh failed: ${sanitizeOAuthProviderError(await response.text())}`,
    );
  }
  const data = await response.json();
  const existingProjectId = credentialProjectId(credentials);
  const discoveredProject = existingProjectId ? undefined : await loadCodeAssist(data.access_token);
  const email = credentialEmail(credentials);
  return {
    ...credentials,
    refresh: data.refresh_token || credentials.refresh,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId:
      existingProjectId || discoveredProject || defaultProjectId(email || "antigravity-default"),
  };
}

export function getApiKey(credentials) {
  const email = credentialEmail(credentials);
  return JSON.stringify({
    token: credentials.access,
    projectId: credentialProjectId(credentials) || defaultProjectId(email || "antigravity-default"),
  });
}

export class FileCredentialStore {
  #file;
  #chain = Promise.resolve();

  constructor(file = credentialPath()) {
    this.#file = file;
  }

  path() {
    return this.#file;
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.#file, "utf8"));
      return isRecord(parsed) ? parsed : undefined;
    } catch (error) {
      if (error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(credentials) {
    await mkdir(dirname(this.#file), { recursive: true });
    const tempFile = `${this.#file}.tmp`;
    await writeFile(tempFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    await rename(tempFile, this.#file);
  }

  modify(fn) {
    const next = (async () => {
      await this.#chain.catch(() => {});
      const current = await this.read();
      const updated = await fn(current);
      if (updated !== undefined) await this.write(updated);
      return updated ?? current;
    })();
    this.#chain = next.catch(() => {});
    return next;
  }

  async delete() {
    await this.#chain.catch(() => {});
    try {
      await unlink(this.#file);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }
}

function normalizeModelSettings(raw) {
  const enabledModelIds = Array.isArray(raw?.enabledModelIds)
    ? raw.enabledModelIds.filter((id) => typeof id === "string" && id.length > 0 && !/\s/.test(id))
    : DEFAULT_ENABLED_MODEL_IDS;
  return {
    enabledModelIds: [...new Set(enabledModelIds)],
    updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : 0,
    catalogModels: Array.isArray(raw?.catalogModels)
      ? raw.catalogModels.filter((model) => isRecord(model) && typeof model.id === "string" && model.id.length > 0)
      : [],
  };
}

export class FileModelSettingsStore {
  #file;
  #chain = Promise.resolve();

  constructor(file = modelSettingsPath()) {
    this.#file = file;
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.#file, "utf8"));
      return normalizeModelSettings(isRecord(parsed) ? parsed : undefined);
    } catch (error) {
      if (error && error.code === "ENOENT") return normalizeModelSettings(undefined);
      throw error;
    }
  }

  async write(settings) {
    const normalized = normalizeModelSettings(settings);
    await mkdir(dirname(this.#file), { recursive: true });
    const tempFile = `${this.#file}.tmp`;
    await writeFile(tempFile, JSON.stringify({ ...normalized, updatedAt: Date.now() }, null, 2), { mode: 0o600 });
    await rename(tempFile, this.#file);
    return this.read();
  }

  modify(fn) {
    const next = (async () => {
      await this.#chain.catch(() => {});
      const current = await this.read();
      const updated = await fn(current);
      if (updated !== undefined) return this.write(updated);
      return current;
    })();
    this.#chain = next.catch(() => {});
    return next;
  }

  setEnabledModelIds(enabledModelIds) {
    return this.modify((current) => ({ ...current, enabledModelIds }));
  }

  setCatalogModels(catalogModels, options = {}) {
    return this.modify((current) => ({
      ...current,
      catalogModels,
      ...(Array.isArray(options.enabledModelIds) ? { enabledModelIds: options.enabledModelIds } : {}),
    }));
  }
}

function enabledModelSet(settings) {
  return new Set(normalizeModelSettings(settings).enabledModelIds);
}

function catalogModelsOf(settings) {
  const normalized = normalizeModelSettings(settings);
  return normalized.catalogModels.length ? normalized.catalogModels : MODELS;
}

function configuredModels(settings) {
  const enabled = enabledModelSet(settings);
  return catalogModelsOf(settings).filter((model) => enabled.has(model.id)).sort(compareAntigravityModels);
}

function modelFromSettings(settings, modelId) {
  return catalogModelsOf(settings).find((model) => model.id === modelId) || modelById(modelId) || inferModelShape(modelId);
}

export async function loginAndSave(store, interaction = browserInteraction()) {
  const credentials = await loginAntigravity(interaction);
  await store.write(credentials);
  return credentials;
}

async function ensureApiKey(store) {
  let credentials = await store.read();
  if (!credentials) {
    throw new LlmError("No Antigravity OAuth credentials. Run /antigravity-login.", "AUTH");
  }
  if (needsRefresh(credentials)) {
    credentials = await store.modify(async (current) => {
      if (!current) throw new LlmError("No Antigravity OAuth credentials. Run /antigravity-login.", "AUTH");
      if (!needsRefresh(current)) return current;
      return refreshAntigravityToken(current);
    });
  }
  let warmedProject = null;
  if (!credentialProjectId(credentials) && !antigravityEnv("PROJECT_ID")) {
    warmedProject = await loadCodeAssist(credentials.access);
    if (warmedProject) {
      await store.modify(async (current) => (current ? { ...current, projectId: warmedProject } : current));
    }
  }
  const projectId = resolveProjectId({
    credentialProjectId: credentialProjectId(credentials),
    email: credentialEmail(credentials),
    warmedProject,
  });
  setLastProjectId(projectId);
  return { token: credentials.access, projectId, email: credentialEmail(credentials) };
}

async function resolveRuntimeCandidates(token, projectId, model, effort) {
  const baseRuntimeModel =
    antigravityEnv("RUNTIME_MODEL")?.trim() || getAntigravityRequestModelId(model.id, effort);
  const dynamic = await fetchAvailableRuntimeModel(token, projectId, baseRuntimeModel);
  const initialRuntimeModel =
    dynamic?.id && isUsableRuntimeModelId(dynamic.id) ? dynamic.id : baseRuntimeModel;
  const runtimeCandidates = [initialRuntimeModel];
  const fallback = getFallbackRuntimeModel(initialRuntimeModel, effort);
  if (fallback && fallback !== initialRuntimeModel) runtimeCandidates.push(fallback);
  return runtimeCandidates;
}

// 网络层瞬态错误特征：undici 连接阶段抛 TypeError("fetch failed")（cause.code 为
// ECONNRESET/ETIMEDOUT 等），流中途断开抛 TypeError("terminated")。裸 TypeError
// 会被宿主归码 UNKNOWN、不在默认可重试集合里，整轮直接失败；归码 TRANSPORT 后
// agent loop 的 llm-retry 扩展点按 providerRetryPolicy 自动重试（见适配器覆写）。
const NETWORK_ERROR_HINTS = /fetch failed|terminated|network error|socket hang up|other side closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR/i;

function asTransportError(error) {
  if (error instanceof LlmError && error.code === "TRANSPORT") return error;
  const text = [error?.message, error?.code, error?.cause?.code, error?.cause?.message]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
  if (!NETWORK_ERROR_HINTS.test(text)) return error;
  return new LlmError(`antigravity network error: ${error?.message || String(error)}`, "TRANSPORT", { cause: error });
}

async function fetchStreamResponse(endpoint, headers, body, signal) {
  try {
    return await antigravityFetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers,
      body,
      signal,
    });
  } catch (error) {
    setLastError(error);
    if (signal?.aborted) throw new LlmError("antigravity request aborted by caller", "ABORTED", { cause: error });
    throw asTransportError(error);
  }
}

async function* requestAntigravityChunks(options, model, signal, store, resolveAttachments) {
  const attachments = resolveAttachments?.();
  const resolvedMessages = await resolveImages(options.messages, attachments, signal);
  const resolvedOptions = { ...options, messages: resolvedMessages };

  if (hasImages(resolvedOptions.messages) && !model.inputModalities.includes("image")) {
    throw new LlmError(`antigravity model "${model.id}" does not support image content`, "UNSUPPORTED_CONTENT");
  }

  const { token, projectId } = await ensureApiKey(store);
  const effort = resolveReasoning(model, resolvedOptions.reasoningEffort);
  const runtimeCandidates = await resolveRuntimeCandidates(token, projectId, model, effort);
  const requestHeaders = {
    // antigravity UA 必须最终胜出：attribution 的 user-agent 自 2026-09 底起被 license 门拒绝（403）
    ...attributionHeaderBag(),
    ...antigravityHeaders(token),
    // bili 在场时让 google lane 逐字节转发，否则它的 ACP 内核会改写请求体并截断响应
    ...biliPassthroughHeaderBag(),
    ...(model.id.startsWith("claude-") ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
  };

  let response;
  let lastText = "";
  let firstFailure;
  let runtimeModel = runtimeCandidates[0];
  // requestType 决定请求计入哪个配额桶。默认档（省略）在免费档可用；若整圈端点
  // 直接 429，说明该桶被拒，换另一档再扫一遍端点（仅 429 触发、一次为限）。
  // 用环境变量显式指定时，先按指定值发，429 再退回默认档。
  const primaryRequestType = antigravityEnv("REQUEST_TYPE")?.trim() || undefined;
  const requestTypeVariants =
    primaryRequestType === undefined ? [undefined, "agent"] : [primaryRequestType, undefined];

  for (let emptyAttempt = 0; emptyAttempt <= 2; emptyAttempt++) {
    if (signal?.aborted) throw new LlmError("antigravity request aborted by caller", "ABORTED");
    if (emptyAttempt > 0) {
      const delay = 500 * 2 ** (emptyAttempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    firstFailure = undefined;
    for (let candidateIndex = 0; candidateIndex < runtimeCandidates.length; candidateIndex++) {
      runtimeModel = runtimeCandidates[candidateIndex];
      setLastResolvedRuntimeModel(runtimeModel);
      const requestBody = buildRequest(resolvedOptions, model, projectId, runtimeModel, effort);

      variantLoop: for (const requestType of requestTypeVariants) {
        const body = JSON.stringify({ ...requestBody, ...(requestType ? { requestType } : {}) });
        for (const endpoint of endpointCandidates()) {
          setLastEndpoint(endpoint);
          response = await fetchStreamResponse(endpoint, requestHeaders, body, signal);
          setLastStatus(response.status);
          if (response.ok) break variantLoop;
          lastText = await response.text();
          // 端点顺序即优先级：首个端点的失败原因才是可信的诊断。旧实现只保留
          // 最后一个端点的正文，于是「daily 503 No capacity available」会被末尾
          // prod 端点的无差别 429 覆盖，最终错误信息变成误导性的 "Rate limited"。
          if (firstFailure === undefined) {
            firstFailure = { status: response.status, text: lastText };
          }
          // 不再因为 "Individual quota reached" 提前跳出：sandbox/daily 是独立的
          // 配额桶，真正的额度耗尽只发生在最后兜底的 prod 上，多试一次很便宜。
          if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
        }
        // 该档整圈 429 且还有备用档位时，清掉诊断以便下一档重新记录首个失败。
        if (response?.status === 429 && requestTypeVariants.length > 1) firstFailure = undefined;
      }

      if (response?.ok) break;
      if (candidateIndex + 1 < runtimeCandidates.length) continue;
      break;
    }

    if (!response || !response.ok) {
      const failureStatus = firstFailure?.status ?? response?.status;
      const failureText = firstFailure?.text ?? lastText;
      const friendly = friendlyAntigravityError(failureStatus, failureText);
      // 归码必须同时看「原始状态码」和「面向用户的文案」：503 No capacity 这类
      // 友好的中文/英文句子本身不含 5xx 数字，只按文案归码会落到不可重试的
      // ANTIGRAVITY_ERROR，白白丢掉一次本来该重试的容量抖动。
      throw new LlmError(
        `Antigravity API error (${failureStatus ?? "no response"}, ${formatRequestDiagnostics({ projectId, runtimeModel })}): ${friendly}`,
        classifyAntigravityError(`${failureStatus ?? ""} ${friendly}`),
      );
    }

    const state = createStreamState();
    for await (const chunk of streamResponseToChunks(response, model, runtimeModel, state)) {
      yield chunk;
    }
    if (state.hasContent) return;
  }

  throw new LlmError("Antigravity API returned an empty response", EMPTY_RESPONSE_CODE);
}

export class AntigravityAdapter extends LlmAdapter {
  #store;
  #modelSettings;
  #resolveAttachments;

  constructor(
    store = new FileCredentialStore(),
    modelSettings = new FileModelSettingsStore(),
    resolveAttachments,
  ) {
    super();
    this.#store = store;
    this.#modelSettings = modelSettings;
    this.#resolveAttachments = resolveAttachments;
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME };
  }

  // 覆写宿主默认重试策略（normal 模式，maxRetries 5、延迟上限 10s）。这里取
  // maxRetries 6 + 30s 上限、15s 延迟上限：指数退避（0.5s/1s/2s/4s/8s/15s）合计约
  // 30 秒，足够覆盖一次 VPN 抖动或端点短暂 5xx，又不会在真正额度耗尽时把整轮
  // 拖到两分钟以上反复打同一配额桶（旧值 10 次 / 30s 上限约 2 分钟，正是
  // session-c5613630 里那串 429 重试风暴的来源）。重试计数由 llm-retry 持久化在
  // 会话投影里，跨崩溃可续。上限可用 ANTIAGRAVITY_MAX_RETRIES（或
  // NOAGY_MAX_RETRIES）环境变量覆盖。
  providerRetryPolicy() {
    const parsed = Number.parseInt(antigravityEnv("MAX_RETRIES") ?? "", 10);
    return Object.freeze({
      mode: "normal",
      maxRetries: Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 6,
      retryableCodes: Object.freeze(["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"]),
      initialDelayMs: 500,
      maxDelayMs: 15000,
      jitterRatio: 0.1,
    });
  }

  async listModels(provider) {
    const settings = await this.#modelSettings.read();
    return configuredModels(settings).map((model) => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.inputModalities,
      context: { contextWindow: model.contextWindow },
      defaultMaxTokens: model.maxTokens,
      ...reasoningInfo(model),
    }));
  }

  async resolveModel(provider, modelId, signal) {
    if (signal?.aborted) return Promise.reject(new LlmError("antigravity model resolution aborted", "ABORTED"));
    const settings = await this.#modelSettings.read();
    const model = modelFromSettings(settings, modelId);
    return {
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.inputModalities,
      context: { contextWindow: model.contextWindow },
      defaultMaxTokens: model.maxTokens,
      ...reasoningInfo(model),
    };
  }

  async *stream(options) {
    const settings = await this.#modelSettings.read();
    const model = modelFromSettings(settings, options.model);

    const consumer = new AbortController();
    const upstream =
      options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
    const watchdog = idleWatchdog(upstream, STREAM_IDLE_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_CODE);
    const iterator = requestAntigravityChunks(
      options,
      model,
      watchdog.signal,
      this.#store,
      this.#resolveAttachments,
    )[Symbol.asyncIterator]();

    let exhausted = false;
    try {
      while (true) {
        const result = await watchdog.next(iterator);
        if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
          throw new LlmError(`antigravity stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms`, "TIMEOUT");
        }
        if (result.done) {
          exhausted = true;
          return;
        }
        yield result.value;
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(`antigravity stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms`, "TIMEOUT", { cause: error });
      }
      if (options.signal?.aborted) throw new LlmError("antigravity request aborted by caller", "ABORTED", { cause: error });
      // 兜底归码：这里能接住 ensureApiKey / fetchAvailableRuntimeModel / SSE 读循环
      // 等整条链路上的网络错误，统一交给 llm-retry 判定。
      throw asTransportError(error);
    } finally {
      consumer.abort("antigravity stream consumer stopped");
      if (!exhausted) {
        try {
          await iterator.return(undefined);
        } catch {
          // Ignore upstream cleanup failure after consumer cancellation.
        }
      }
      watchdog[Symbol.dispose]();
    }
  }
}

function doctorText() {
  const current = getAntigravityDiagnostics();
  return [
    `provider=${PROVIDER}`,
    `lastResolvedRuntimeModel=${current.resolvedRuntimeModel || "none"}`,
    `availableModels=${current.availableModels || "none"}`,
    `matchedModel=${current.matchedModelDebug || "none"}`,
    `lastEndpoint=${current.endpoint || "none"}`,
    `lastStatus=${current.status ?? "none"}`,
    `lastProjectId=${current.projectId || "none"}`,
    `lastError=${current.error ? redactSecrets(current.error) : "none"}`,
    `credentialPath=${credentialPath()}`,
    `oauthClientConfigured=${oauthClientDiagnostics().configured}`,
    `oauthClientIdLength=${oauthClientDiagnostics().clientIdLength}`,
    `oauthClientIdPrefix=${oauthClientDiagnostics().clientIdPrefix || "none"}`,
    "transport=native-cloud-code-assist-sse",
    "runtimeCli=not-used",
    "commands=/antigravity-login /antigravity-quota /antigravity-doctor /antigravity-logout",
  ].join("\n");
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function sendMethodNotAllowed(response) {
  sendJson(response, 405, { ok: false, error: "method-not-allowed" });
}

function quotaCardRows(quota) {
  const modelRows = (quota.models || [])
    .filter((model) => !/tab_|chat_/i.test(model.modelId))
    .map((model) => ({
      id: model.modelId,
      label: model.displayName || model.modelId,
      remainingPercent: remainingPercent(model.remainingFraction),
      remainingFraction: model.remainingFraction,
      resetLabel: formatReset(model.resetTime),
      resetTime: model.resetTime,
      provider: model.modelProvider,
      recommended: model.recommended,
      supportsThinking: model.supportsThinking,
      supportsImages: model.supportsImages,
    }));
  const bucketRows = (quota.groups || []).flatMap((group) =>
    (group.buckets || []).map((bucket) => ({
      id: bucket.bucketId,
      label: bucket.displayName,
      group: group.displayName,
      window: bucket.window,
      remainingPercent: remainingPercent(bucket.remainingFraction),
      remainingFraction: bucket.remainingFraction,
      resetLabel: formatReset(bucket.resetTime),
      resetTime: bucket.resetTime,
      description: bucket.description,
    })),
  );
  const groups = (quota.groups || []).map((group) => ({
    displayName: group.displayName,
    description: group.description,
    buckets: (group.buckets || []).map((bucket) => ({
      id: bucket.bucketId,
      label: bucket.displayName,
      window: bucket.window,
      remainingPercent: remainingPercent(bucket.remainingFraction),
      remainingFraction: bucket.remainingFraction,
      resetLabel: formatReset(bucket.resetTime),
      resetTime: bucket.resetTime,
      description: bucket.description,
    })),
  }));
  return { modelRows, bucketRows, groups, groupDescription: quota.groupDescription };
}

function publicModelMatchNeedles(modelId) {
  switch (modelId) {
    case "gemini-3.7-flash":
      return ["gemini-3.7-flash", "gemini 3.7 flash"];
    case "gemini-3.6-flash":
      return ["gemini-3.6-flash", "gemini 3.6 flash"];
    case "gemini-3.5-flash":
      return ["gemini-3.5-flash", "gemini 3.5 flash", "gemini-3-flash-agent"];
    case "gemini-3.1-pro":
      return ["gemini-3.1-pro", "gemini 3.1 pro", "gemini-pro-agent"];
    case "claude-sonnet-4-6":
      return ["claude-sonnet-4-6", "claude sonnet 4.6"];
    case "claude-opus-4-6":
      return ["claude-opus-4-6", "claude opus 4.6"];
    case "gpt-oss-120b":
      return ["gpt-oss-120b", "gpt oss 120b"];
    default:
      return [modelId];
  }
}

function rowsForPublicModel(model, quota) {
  if (!quota) return [];
  const { modelRows } = quotaCardRows(quota);
  const needles = publicModelMatchNeedles(model.id);
  return modelRows.filter((row) => {
    const haystack = `${row.id || ""} ${row.label || ""}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });
}

function publicModelQuotaSummary(model, quota) {
  const rows = rowsForPublicModel(model, quota);
  if (!rows.length) return {};
  const withRemaining = rows.filter((row) => typeof row.remainingFraction === "number");
  const best = (withRemaining.length ? withRemaining : rows).reduce((left, right) => {
    const leftValue = typeof left.remainingFraction === "number" ? left.remainingFraction : -1;
    const rightValue = typeof right.remainingFraction === "number" ? right.remainingFraction : -1;
    return rightValue > leftValue ? right : left;
  });
  return {
    available: true,
    remainingFraction: best.remainingFraction,
    remainingPercent: best.remainingPercent,
    resetLabel: best.resetLabel,
    resetTime: best.resetTime,
  };
}

function modelOptionsPayload(settings, quota) {
  const enabled = enabledModelSet(settings);
  const allModels = [...catalogModelsOf(settings)].sort(compareAntigravityModels);
  const catalogQuotaMap = new Map();
  if (quota?.catalogModels) {
    for (const cm of quota.catalogModels) {
      catalogQuotaMap.set(cm.id, cm);
    }
  }
  const options = allModels.map((model) => {
    const catalogQuota = catalogQuotaMap.get(model.id);
    const fallbackQuota = publicModelQuotaSummary(model, quota);
    const quotaInfo = catalogQuota?.remainingFraction !== undefined
      ? {
          available: true,
          remainingFraction: catalogQuota.remainingFraction,
          remainingPercent: remainingPercent(catalogQuota.remainingFraction),
          resetLabel: catalogQuota.resetTime ? formatReset(catalogQuota.resetTime) : undefined,
          resetTime: catalogQuota.resetTime,
        }
      : fallbackQuota;
    return {
      id: model.id,
      name: model.name,
      inputModalities: model.inputModalities,
      reasoningEfforts: model.reasoningEfforts,
      enabled: enabled.has(model.id),
      ...quotaInfo,
    };
  });
  options.sort(compareAntigravityModelOptions);
  return {
    enabledModelIds: [...enabled],
    options,
  };
}

async function webStatus(store, modelSettings) {
  const credentials = await store.read();
  const quota = getCachedQuota();
  const settings = await modelSettings.read();
  return {
    ...credentialSummary(credentials),
    login: getWebLoginStatus(),
    models: modelOptionsPayload(settings, quota),
    quota:
      quota === undefined
        ? undefined
        : {
            projectId: quota.projectId,
            planLabel: quota.planLabel,
            fetchedAt: quota.fetchedAt,
            ...quotaCardRows(quota),
          },
  };
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = safeJsonParse(text);
  if (!isRecord(parsed)) throw new Error("invalid JSON request body");
  return parsed;
}

function emitLlmAdaptersUpdated(ctx) {
  try {
    ctx.emit("llm/adapters-updated");
  } catch (error) {
    setLastError(error);
  }
}

function registerWebApi(ctx, store, modelSettings) {
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "prefix",
          path: "/antigravity/api",
          handler: async (request, response) => {
            const url = new URL(request.url || "/", "http://dsh.local");
            const path = url.pathname.replace(/^\/antigravity\/api\/?/, "");
            try {
              if (path === "status" || path === "") {
                if (request.method !== "GET") return sendMethodNotAllowed(response);
                return sendJson(response, 200, { ok: true, value: await webStatus(store, modelSettings) });
              }
              if (path === "login") {
                if (request.method !== "POST") return sendMethodNotAllowed(response);
                const value = await beginWebLogin(store);
                return sendJson(response, 200, { ok: true, value });
              }
              if (path === "quota") {
                if (request.method !== "GET" && request.method !== "POST") {
                  return sendMethodNotAllowed(response);
                }
                const quota = await fetchAccountQuota(store, modelSettings);
                emitLlmAdaptersUpdated(ctx);
                return sendJson(response, 200, {
                  ok: true,
                  value: {
                    projectId: quota.projectId,
                    planLabel: quota.planLabel,
                    fetchedAt: quota.fetchedAt,
                    ...quotaCardRows(quota),
                    models: modelOptionsPayload(await modelSettings.read(), quota),
                  },
                });
              }
              if (path === "proxy") {
                if (request.method === "GET") {
                  return sendJson(response, 200, { ok: true, value: await getProxyConfig() });
                }
                if (request.method === "POST") {
                  const body = await readRequestJson(request);
                  return sendJson(response, 200, { ok: true, value: await setProxyConfig(body) });
                }
                return sendMethodNotAllowed(response);
              }
              if (path === "proxy/test") {
                if (request.method !== "POST") return sendMethodNotAllowed(response);
                const body = await readRequestJson(request);
                return sendJson(response, 200, {
                  ok: true,
                  value: await testProxyConnection(body.port),
                });
              }
              if (path === "models") {
                if (request.method === "GET") {
                  return sendJson(response, 200, {
                    ok: true,
                    value: modelOptionsPayload(await modelSettings.read(), getCachedQuota()),
                  });
                }
                if (request.method === "POST") {
                  const body = await readRequestJson(request);
                  if (!Array.isArray(body.enabledModelIds)) {
                    return sendJson(response, 400, { ok: false, error: "enabledModelIds must be an array" });
                  }
                  const settings = await modelSettings.setEnabledModelIds(body.enabledModelIds);
                  emitLlmAdaptersUpdated(ctx);
                  return sendJson(response, 200, {
                    ok: true,
                    value: modelOptionsPayload(settings, getCachedQuota()),
                  });
                }
                return sendMethodNotAllowed(response);
              }
              if (path === "logout") {
                if (request.method !== "POST") return sendMethodNotAllowed(response);
                await store.delete();
                cachedQuota = undefined;
                return sendJson(response, 200, { ok: true, value: await webStatus(store, modelSettings) });
              }
              return sendJson(response, 404, { ok: false, error: "not-found" });
            } catch (error) {
              return sendJson(response, 500, { ok: false, error: safeError(error) });
            }
          },
        }),
      "dsh-antigravity: web api",
    );
  });
}

export function apply(ctx) {
  const store = new FileCredentialStore(credentialPath());
  const modelSettings = new FileModelSettingsStore(modelSettingsPath());
  const resolveAttachments = () => ctx.get("attachments");
  const adapter = new AntigravityAdapter(store, modelSettings, resolveAttachments);
  ctx.llm.registerAdapter([PROVIDER], adapter);
  registerWebApi(ctx, store, modelSettings);
}

apply.inject = ["llm"];

export default apply;
