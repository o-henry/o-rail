#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFile, chmod, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { pickProviderResponseText, resolveProviderRunMode } from './providerExecution.mjs';

const PROFILE_ROOT =
  process.env.RAIL_WEB_PROFILE_ROOT ||
  path.join(os.homedir(), '.rail', 'providers');
const LOG_PATH =
  process.env.RAIL_WEB_LOG_PATH ||
  path.join(os.homedir(), '.rail', 'web-worker.log');
const SYSTEM_CHROME_PROFILE_OVERRIDE = process.env.RAIL_WEB_SYSTEM_CHROME_PROFILE || '';
const SYSTEM_CHROME_PROFILE_DEFAULT = resolveSystemChromeUserDataDir();
const SYSTEM_CHROME_PROFILE_DIR =
  SYSTEM_CHROME_PROFILE_OVERRIDE.trim() || SYSTEM_CHROME_PROFILE_DEFAULT || '';
const USE_SYSTEM_CHROME_PROFILE =
  (process.env.RAIL_WEB_USE_SYSTEM_CHROME_PROFILE ?? '0') === '1' &&
  Boolean(SYSTEM_CHROME_PROFILE_DIR);
const DEFAULT_TIMEOUT_MS = 180_000;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = Number(process.env.RAIL_WEB_BRIDGE_PORT ?? 38961) || 38961;
const WORKER_LOCK_PATH = path.join(PROFILE_ROOT, 'worker.lock.json');
const PARENT_PID = Number(process.env.RAIL_PARENT_PID ?? 0) || 0;
const PARENT_WATCH_INTERVAL_MS = 3000;
const BRIDGE_ALLOWED_WEB_ORIGINS = new Set([
  'https://gemini.google.com',
  'https://chatgpt.com',
  'https://grok.com',
  'https://claude.ai',
  'https://www.perplexity.ai',
  'https://perplexity.ai',
]);
const BRIDGE_ALLOWED_EXTENSION_IDS_RAW = [
  process.env.RAIL_WEB_BRIDGE_ALLOWED_EXTENSION_IDS ?? '',
  process.env.RAIL_WEB_BRIDGE_ALLOWED_EXTENSION_ID ?? '',
]
  .map((row) => String(row).trim())
  .filter(Boolean)
  .join(',');
const BRIDGE_ALLOWED_EXTENSION_ORIGINS = parseAllowedExtensionOrigins(
  BRIDGE_ALLOWED_EXTENSION_IDS_RAW,
);
const BRIDGE_EXTENSION_ALLOWLIST_CONFIGURED = BRIDGE_ALLOWED_EXTENSION_ORIGINS.size > 0;
const SESSION_PROVIDER_CONFIG = {
  gemini: {
    homeUrls: ['https://gemini.google.com/app', 'https://gemini.google.com/'],
    activeSignals: ['gemini.google.com/app'],
    loginSignals: ['accounts.google.com'],
  },
  gpt: {
    homeUrls: ['https://chatgpt.com/'],
    activeSignals: ['chatgpt.com'],
    loginSignals: ['auth.openai.com', 'chatgpt.com/auth'],
  },
  grok: {
    homeUrls: ['https://grok.com/'],
    activeSignals: ['grok.com'],
    loginSignals: ['accounts.x.com', 'x.com/i/flow/login', 'grok.com/login'],
  },
  perplexity: {
    homeUrls: ['https://www.perplexity.ai/'],
    activeSignals: ['perplexity.ai'],
    loginSignals: ['perplexity.ai/sign-in', 'perplexity.ai/login'],
  },
  claude: {
    homeUrls: ['https://claude.ai/'],
    activeSignals: ['claude.ai'],
    loginSignals: ['claude.ai/login'],
  },
};

const PROVIDER_AUTOMATION_CONFIG = {
  gemini: {
    inputSelectors: [
      'textarea[aria-label*="prompt" i]',
      'textarea[aria-label*="질문" i]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'rich-textarea div[contenteditable="true"]',
      'textarea',
    ],
    submitSelectors: [
      'button[aria-label*="Send" i]',
      'button[aria-label*="전송" i]',
      'button:has-text("Send")',
    ],
    responseSelectors: [
      '[data-message-author-role="model"]',
      'model-response',
      'main article',
      'main .markdown',
    ],
  },
  gpt: {
    inputSelectors: [
      '#prompt-textarea',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="메시지" i]',
      'div[contenteditable="true"][id*="prompt" i]',
      'textarea',
    ],
    submitSelectors: [
      'button[data-testid*="send" i]',
      'button[aria-label*="Send" i]',
      'button:has-text("Send")',
    ],
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      'article[data-testid*="conversation-turn"]',
      'main article',
      'main .markdown',
    ],
  },
  grok: {
    inputSelectors: [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="질문" i]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    submitSelectors: [
      'button[aria-label*="Send" i]',
      'button[data-testid*="send" i]',
      'button:has-text("Send")',
    ],
    responseSelectors: [
      'main article',
      '[data-testid*="message"]',
      '.markdown',
      '.prose',
    ],
  },
  perplexity: {
    inputSelectors: [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="질문" i]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    submitSelectors: [
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Send" i]',
      'button[data-testid*="submit" i]',
      'button:has-text("Submit")',
    ],
    responseSelectors: [
      'main article',
      '[data-testid*="answer" i]',
      '.markdown',
      '.prose',
    ],
  },
  claude: {
    inputSelectors: [
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="메시지" i]',
      'textarea',
    ],
    submitSelectors: [
      'button[aria-label*="Send" i]',
      'button[data-testid*="send" i]',
      'button:has-text("Send")',
    ],
    responseSelectors: [
      'main article',
      '[data-testid*="message" i]',
      '.markdown',
      '.prose',
    ],
  },
};

const state = {
  providers: new Map(),
  activeRuns: new Map(),
  providerOperationQueue: new Map(),
  lastError: null,
  bridge: {
    server: null,
    token: '',
    lastSeenAt: null,
    connectedProviders: new Map(),
    tasks: new Map(),
    providerQueue: new Map(),
    nextTaskSeq: 1,
  },
};

let lockHeld = false;
let shutdownRequested = false;
let parentWatchTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerActiveRun(runToken) {
  if (!runToken?.provider) {
    return;
  }
  const provider = String(runToken.provider).trim().toLowerCase();
  if (!provider) {
    return;
  }
  const current = state.activeRuns.get(provider) ?? new Set();
  current.add(runToken);
  state.activeRuns.set(provider, current);
}

function unregisterActiveRun(runToken) {
  if (!runToken?.provider) {
    return;
  }
  const provider = String(runToken.provider).trim().toLowerCase();
  const current = state.activeRuns.get(provider);
  if (!current) {
    return;
  }
  current.delete(runToken);
  if (current.size === 0) {
    state.activeRuns.delete(provider);
    return;
  }
  state.activeRuns.set(provider, current);
}

function runProviderOperationExclusive(provider, operation) {
  const normalizedProvider = String(provider ?? '').trim().toLowerCase();
  if (!normalizedProvider) {
    return operation();
  }
  const previousTail = state.providerOperationQueue.get(normalizedProvider) ?? Promise.resolve();
  const runPromise = previousTail
    .catch(() => {})
    .then(async () => operation());
  const nextTail = runPromise.catch(() => {});
  state.providerOperationQueue.set(normalizedProvider, nextTail);
  return runPromise.finally(() => {
    if (state.providerOperationQueue.get(normalizedProvider) === nextTail) {
      state.providerOperationQueue.delete(normalizedProvider);
    }
  });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminatePid(pid) {
  if (!isPidAlive(pid) || pid === process.pid) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + 1_200;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return;
    }
    await sleep(120);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore
  }
}

async function acquireWorkerLock() {
  await hardenDir(PROFILE_ROOT);
  try {
    const raw = await readFile(WORKER_LOCK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const existingPid = Number(parsed?.pid ?? 0);
    if (existingPid > 0 && existingPid !== process.pid && isPidAlive(existingPid)) {
      await logLine(`stale worker lock found; terminating pid=${existingPid}`);
      await terminatePid(existingPid);
    }
  } catch {
    // lock file missing/corrupt -> overwrite
  }

  const payload = JSON.stringify(
    {
      pid: process.pid,
      startedAt: nowIso(),
      profileRoot: PROFILE_ROOT,
    },
    null,
    2,
  );
  await writeFile(WORKER_LOCK_PATH, payload, { encoding: 'utf8', mode: 0o600 });
  await hardenFile(WORKER_LOCK_PATH);
  lockHeld = true;
}

async function releaseWorkerLock() {
  if (!lockHeld) {
    return;
  }
  try {
    const raw = await readFile(WORKER_LOCK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Number(parsed?.pid ?? 0) === process.pid) {
      await unlink(WORKER_LOCK_PATH);
    }
  } catch {
    // ignore
  } finally {
    lockHeld = false;
  }
}

function isParentAlive() {
  if (!Number.isInteger(PARENT_PID) || PARENT_PID <= 1) {
    return true;
  }
  try {
    process.kill(PARENT_PID, 0);
    return true;
  } catch {
    return false;
  }
}

function startParentWatchdog() {
  if (!Number.isInteger(PARENT_PID) || PARENT_PID <= 1) {
    return;
  }
  if (parentWatchTimer) {
    clearInterval(parentWatchTimer);
  }
  parentWatchTimer = setInterval(() => {
    if (shutdownRequested) {
      return;
    }
    if (!isParentAlive()) {
      void gracefulShutdown(`parent process exited (pid=${PARENT_PID})`, 0);
    }
  }, PARENT_WATCH_INTERVAL_MS);
}

function stopParentWatchdog() {
  if (parentWatchTimer) {
    clearInterval(parentWatchTimer);
    parentWatchTimer = null;
  }
}

async function hardenDir(dirPath) {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
  try {
    await chmod(dirPath, 0o700);
  } catch {
    // ignore on platforms/filesystems that do not support chmod
  }
}

async function hardenFile(filePath) {
  try {
    await chmod(filePath, 0o600);
  } catch {
    // ignore on platforms/filesystems that do not support chmod
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function logLine(message) {
  const line = `[${nowIso()}] ${message}\n`;
  try {
    await hardenDir(path.dirname(LOG_PATH));
    await appendFile(LOG_PATH, line, { encoding: 'utf8', mode: 0o600 });
    await hardenFile(LOG_PATH);
  } catch {
    // ignore logging errors
  }
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function notify(method, params = {}) {
  writeJson({ jsonrpc: '2.0', method, params });
}

function respond(id, result) {
  writeJson({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message, data = null) {
  writeJson({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  });
}

function workerError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function maskToken(token) {
  const raw = String(token ?? '');
  if (!raw) {
    return '';
  }
  if (raw.length <= 10) {
    return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
  }
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function parseAllowedExtensionOrigins(raw) {
  const text = String(raw ?? '').trim();
  const set = new Set();
  if (!text) {
    return set;
  }
  const rows = text.split(',').map((row) => row.trim()).filter(Boolean);
  for (const row of rows) {
    if (row.startsWith('chrome-extension://')) {
      set.add(row.replace(/\/+$/, ''));
      continue;
    }
    if (/^[a-p]{32}$/.test(row)) {
      set.add(`chrome-extension://${row}`);
    }
  }
  return set;
}

function requestOrigin(req) {
  const value = String(req?.headers?.origin ?? '').trim();
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function isAllowedBridgeOrigin(origin) {
  if (!origin) {
    return true;
  }
  if (origin.startsWith('chrome-extension://')) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      return false;
    }
    // Soft policy: extension allowlist mismatch should not block runtime when token is valid.
    // This prevents silent no-claim failures caused by stale extension IDs.
    return true;
  }
  return BRIDGE_ALLOWED_WEB_ORIGINS.has(origin);
}

function isLoopbackRequest(req) {
  const remote = String(req?.socket?.remoteAddress ?? '');
  if (!remote) {
    return false;
  }
  return (
    remote === '127.0.0.1' ||
    remote === '::1' ||
    remote === '::ffff:127.0.0.1'
  );
}

function corsHeadersForRequest(req) {
  const origin = requestOrigin(req);
  if (!isAllowedBridgeOrigin(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
}

function safeTokenEquals(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function bridgeStatusPayload({ exposeToken = false } = {}) {
  const connectedProviders = Array.from(state.bridge.connectedProviders.entries())
    .map(([provider, row]) => ({
      provider,
      pageUrl: row.pageUrl ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  const taskRows = Array.from(state.bridge.tasks.values());
  const activeTasks = taskRows.filter((row) =>
    row.status === 'claimed' ||
    row.status === 'prompt_filled' ||
    row.status === 'waiting_user_send' ||
    row.status === 'responding',
  ).length;
  const queuedTasks = taskRows.filter((row) => row.status === 'queued').length;
  return {
    running: Boolean(state.bridge.server?.listening),
    port: BRIDGE_PORT,
    tokenMasked: maskToken(state.bridge.token),
    token: exposeToken ? state.bridge.token : undefined,
    tokenStorage: 'memory',
    extensionOriginAllowlistConfigured: BRIDGE_EXTENSION_ALLOWLIST_CONFIGURED,
    allowedExtensionOriginCount: BRIDGE_ALLOWED_EXTENSION_ORIGINS.size,
    extensionOriginPolicy: BRIDGE_EXTENSION_ALLOWLIST_CONFIGURED
      ? 'allowlist_soft'
      : 'token_only',
    lastSeenAt: state.bridge.lastSeenAt,
    connectedProviders,
    queuedTasks,
    activeTasks,
  };
}

function bridgeProgress(provider, stage, message) {
  notify('web/progress', {
    provider,
    stage,
    message,
  });
}

function recordBridgeSeen(provider, pageUrl) {
  if (!SESSION_PROVIDER_CONFIG[provider]) {
    return;
  }
  const now = nowIso();
  state.bridge.lastSeenAt = now;
  const prev = state.bridge.connectedProviders.get(provider) ?? {};
  state.bridge.connectedProviders.set(provider, {
    ...prev,
    pageUrl: pageUrl || prev.pageUrl || null,
    lastSeenAt: now,
  });
}

function normalizeBridgeTaskStage(value) {
  const stage = String(value ?? '').trim();
  if (
    stage === 'queued' ||
    stage === 'claimed' ||
    stage === 'prompt_filled' ||
    stage === 'waiting_user_send' ||
    stage === 'responding' ||
    stage === 'done' ||
    stage === 'failed' ||
    stage === 'timeout'
  ) {
    return stage;
  }
  return '';
}

function removeBridgeTaskFromQueue(task) {
  const queue = state.bridge.providerQueue.get(task.provider);
  if (!queue) {
    return;
  }
  const next = queue.filter((taskId) => taskId !== task.id);
  if (next.length === 0) {
    state.bridge.providerQueue.delete(task.provider);
    return;
  }
  state.bridge.providerQueue.set(task.provider, next);
}

function settleBridgeTask(task, payload) {
  if (!task || task.settled) {
    return;
  }
  task.settled = true;
  clearTimeout(task.timeoutHandle);
  removeBridgeTaskFromQueue(task);
  state.bridge.tasks.delete(task.id);
  task.resolve(payload);
}

function failBridgeTask(task, code, message) {
  if (!task || task.settled) {
    return;
  }
  task.settled = true;
  clearTimeout(task.timeoutHandle);
  removeBridgeTaskFromQueue(task);
  state.bridge.tasks.delete(task.id);
  task.reject(workerError(code, message));
}

function enqueueBridgeTask(provider, prompt, timeoutMs) {
  const taskId = `bridge-${Date.now()}-${state.bridge.nextTaskSeq++}`;
  const task = {
    id: taskId,
    provider,
    prompt,
    status: 'queued',
    createdAt: nowIso(),
    timeoutMs,
    settled: false,
    timeoutHandle: null,
    resolve: () => {},
    reject: () => {},
  };
  const completion = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });
  task.timeoutHandle = setTimeout(() => {
    task.status = 'timeout';
    bridgeProgress(provider, 'bridge_timeout', '웹 연결 응답 대기 시간이 초과되었습니다.');
    failBridgeTask(task, 'BRIDGE_TIMEOUT', `웹 연결 응답 대기 시간 초과 (${timeoutMs}ms)`);
  }, timeoutMs);
  state.bridge.tasks.set(task.id, task);
  const queue = state.bridge.providerQueue.get(provider) ?? [];
  queue.push(task.id);
  state.bridge.providerQueue.set(provider, queue);
  bridgeProgress(provider, 'bridge_queued', '웹 연결 대기열에 프롬프트를 등록했습니다.');
  return { task, completion };
}

function claimBridgeTask(provider, pageUrl) {
  const queue = state.bridge.providerQueue.get(provider) ?? [];
  for (const taskId of queue) {
    const task = state.bridge.tasks.get(taskId);
    if (!task || task.settled || task.status !== 'queued') {
      continue;
    }
    task.status = 'claimed';
    task.claimedAt = nowIso();
    task.pageUrl = pageUrl || null;
    recordBridgeSeen(provider, pageUrl);
    bridgeProgress(provider, 'bridge_claimed', '확장이 작업을 수신했습니다.');
    return task;
  }
  return null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 2_000_000) {
      throw workerError('PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw workerError('INVALID_JSON', `JSON 파싱 실패: ${String(error)}`);
  }
}

function parseAuthToken(req) {
  const raw = String(req.headers.authorization ?? '');
  if (!raw.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return raw.slice(7).trim();
}

function extractTaskIdFromPath(pathname) {
  const match = pathname.match(/^\/v1\/task\/([^/]+)\/(stage|result|error)$/);
  if (!match) {
    return null;
  }
  return {
    taskId: decodeURIComponent(match[1]),
    action: match[2],
  };
}

async function ensureBridgeToken() {
  if (state.bridge.token) {
    return state.bridge.token;
  }
  const next = randomBytes(32).toString('base64url');
  state.bridge.token = next;
  return next;
}

async function rotateBridgeToken() {
  const next = randomBytes(32).toString('base64url');
  state.bridge.token = next;
  return bridgeStatusPayload({ exposeToken: true });
}

function sanitizePublicErrorCode(rawCode, fallback = 'INTERNAL_ERROR') {
  const normalized = String(rawCode ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function sanitizePublicErrorMessage(rawMessage, fallback = '요청 처리 실패') {
  const firstLine = String(rawMessage ?? '')
    .split(/\r?\n/)[0]
    ?.trim();
  const cleaned = String(firstLine ?? '')
    .replace(/[<>`]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 320) || fallback;
}

function publicErrorPayload(error, fallbackCode = 'INTERNAL_ERROR', fallbackMessage = '요청 처리 실패') {
  if (error && typeof error === 'object') {
    return {
      ok: false,
      errorCode: sanitizePublicErrorCode(error.code, fallbackCode),
      error: sanitizePublicErrorMessage(error.message, fallbackMessage),
    };
  }
  if (typeof error === 'string') {
    return {
      ok: false,
      errorCode: sanitizePublicErrorCode(fallbackCode, 'INTERNAL_ERROR'),
      error: sanitizePublicErrorMessage(error, fallbackMessage),
    };
  }
  return {
    ok: false,
    errorCode: sanitizePublicErrorCode(fallbackCode, 'INTERNAL_ERROR'),
    error: sanitizePublicErrorMessage('', fallbackMessage),
  };
}

function writeHttpJson(req, res, statusCode, payload) {
  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  res.writeHead(statusCode, {
    ...baseHeaders,
    ...corsHeadersForRequest(req),
  });
  res.end(JSON.stringify(payload));
}

async function handleBridgeHttpRequest(req, res) {
  if (!isLoopbackRequest(req)) {
    writeHttpJson(req, res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  const origin = requestOrigin(req);
  if (!isAllowedBridgeOrigin(origin)) {
    writeHttpJson(req, res, 403, { ok: false, error: 'forbidden_origin' });
    return;
  }

  if (req.method === 'OPTIONS') {
    writeHttpJson(req, res, 200, { ok: true });
    return;
  }

  await ensureBridgeToken();

  const url = new URL(req.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  const pathname = url.pathname;

  if (pathname === '/v1/health' && req.method === 'GET') {
    const token = parseAuthToken(req);
    if (!safeTokenEquals(token, state.bridge.token)) {
      writeHttpJson(req, res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    writeHttpJson(req, res, 200, { ok: true, bridge: bridgeStatusPayload({ exposeToken: false }) });
    return;
  }

  const token = parseAuthToken(req);
  if (!safeTokenEquals(token, state.bridge.token)) {
    writeHttpJson(req, res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  if (pathname === '/v1/task/claim' && req.method === 'POST') {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (error) {
      writeHttpJson(req, res, 400, publicErrorPayload(error, 'INVALID_JSON', '요청 본문을 읽지 못했습니다.'));
      return;
    }
    const provider = String(body.provider ?? '').trim().toLowerCase();
    const pageUrl = sanitizeUrlForUi(String(body.pageUrl ?? '').trim()) ?? null;
    if (!SESSION_PROVIDER_CONFIG[provider]) {
      writeHttpJson(req, res, 400, { ok: false, errorCode: 'UNSUPPORTED_PROVIDER', error: 'unsupported provider' });
      return;
    }
    recordBridgeSeen(provider, pageUrl);
    const task = claimBridgeTask(provider, pageUrl);
    if (!task) {
      writeHttpJson(req, res, 200, { ok: true, task: null });
      return;
    }
    writeHttpJson(req, res, 200, {
      ok: true,
      task: {
        id: task.id,
        provider: task.provider,
        prompt: task.prompt,
        createdAt: task.createdAt,
        timeoutMs: task.timeoutMs,
      },
    });
    return;
  }

  if (pathname === '/v1/bridge/event' && req.method === 'POST') {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (error) {
      writeHttpJson(req, res, 400, publicErrorPayload(error, 'INVALID_JSON', '요청 본문을 읽지 못했습니다.'));
      return;
    }
    const provider = String(body.provider ?? '').trim().toLowerCase();
    if (!SESSION_PROVIDER_CONFIG[provider]) {
      writeHttpJson(req, res, 400, { ok: false, errorCode: 'UNSUPPORTED_PROVIDER', error: 'unsupported provider' });
      return;
    }
    const pageUrl = sanitizeUrlForUi(String(body.pageUrl ?? '').trim()) ?? null;
    recordBridgeSeen(provider, pageUrl);
    const level = String(body.level ?? 'info').trim().toLowerCase();
    const code = String(body.code ?? '').trim();
    const message = String(body.message ?? '').trim() || '웹 연결 확장 이벤트';
    const prefix = code ? `${code}: ` : '';
    bridgeProgress(
      provider,
      level === 'error' ? 'bridge_extension_error' : 'bridge_extension_event',
      `${prefix}${message}`,
    );
    writeHttpJson(req, res, 200, { ok: true });
    return;
  }

  const taskRoute = extractTaskIdFromPath(pathname);
  if (taskRoute && req.method === 'POST') {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (error) {
      writeHttpJson(req, res, 400, publicErrorPayload(error, 'INVALID_JSON', '요청 본문을 읽지 못했습니다.'));
      return;
    }
    const task = state.bridge.tasks.get(taskRoute.taskId);
    if (!task || task.settled) {
      writeHttpJson(req, res, 404, { ok: false, error: 'task not found' });
      return;
    }

    const provider = task.provider;
    const pageUrl = sanitizeUrlForUi(String(body.pageUrl ?? '').trim()) ?? task.pageUrl ?? null;
    recordBridgeSeen(provider, pageUrl);

    if (taskRoute.action === 'stage') {
      const stage = normalizeBridgeTaskStage(body.stage);
      if (!stage) {
        writeHttpJson(req, res, 400, { ok: false, error: 'invalid stage' });
        return;
      }
      task.status = stage;
      const detail = String(body.detail ?? '').trim();
      bridgeProgress(provider, `bridge_${stage}`, detail || `웹 연결 단계: ${stage}`);
      writeHttpJson(req, res, 200, { ok: true });
      return;
    }

    if (taskRoute.action === 'error') {
      const code = String(body.code ?? 'BRIDGE_ERROR').trim() || 'BRIDGE_ERROR';
      const message = String(body.message ?? '웹 연결 오류').trim() || '웹 연결 오류';
      task.status = 'failed';
      bridgeProgress(provider, 'bridge_failed', `${code}: ${message}`);
      failBridgeTask(task, code, message);
      writeHttpJson(req, res, 200, { ok: true });
      return;
    }

    if (taskRoute.action === 'result') {
      const text = String(body.text ?? '').trim();
      if (!text) {
        writeHttpJson(req, res, 400, { ok: false, error: 'text is required' });
        return;
      }
      task.status = 'done';
      bridgeProgress(provider, 'bridge_done', '웹 연결 응답 수집 완료');
      settleBridgeTask(task, {
        text,
        raw: body.raw ?? null,
        meta: body.meta ?? null,
      });
      writeHttpJson(req, res, 200, { ok: true });
      return;
    }
  }

  writeHttpJson(req, res, 404, { ok: false, error: 'not found' });
}

async function startBridgeServer() {
  if (state.bridge.server?.listening) {
    return;
  }
  await ensureBridgeToken();
  const server = createServer((req, res) => {
    void handleBridgeHttpRequest(req, res).catch((error) => {
      writeHttpJson(req, res, 500, publicErrorPayload(error, 'BRIDGE_INTERNAL', '브리지 처리 중 오류가 발생했습니다.'));
    });
  });
  state.bridge.server = server;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      server.off('error', reject);
      resolve(true);
    });
  });
  await logLine(`bridge server started: http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  notify('web/progress', {
    stage: 'bridge_started',
    message: `웹 연결 서버 시작 (${BRIDGE_HOST}:${BRIDGE_PORT})`,
  });
}

async function stopBridgeServer() {
  const server = state.bridge.server;
  state.bridge.server = null;
  if (!server) {
    return;
  }
  await new Promise((resolve) => {
    server.close(() => resolve(true));
  });
  await logLine('bridge server stopped');
}

let playwrightPromise = null;
async function loadPlaywright() {
  if (playwrightPromise) {
    return playwrightPromise;
  }

  playwrightPromise = (async () => {
    try {
      return await import('playwright');
    } catch {
      try {
        return await import('playwright-core');
      } catch {
        throw workerError(
          'BROWSER_MISSING',
          'playwright 또는 playwright-core 모듈을 찾을 수 없습니다. `npm i playwright-core` 후 재시도하세요.',
        );
      }
    }
  })();

  return playwrightPromise;
}

function chromeExecutableCandidates() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
}

function resolveChromeExecutable() {
  return chromeExecutableCandidates().find((candidate) => existsSync(candidate)) || null;
}

function resolveSystemChromeUserDataDir() {
  if (process.platform === 'darwin') {
    const candidate = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    return existsSync(candidate) ? candidate : '';
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (!localAppData) {
      return '';
    }
    const candidate = path.join(localAppData, 'Google', 'Chrome', 'User Data');
    return existsSync(candidate) ? candidate : '';
  }
  const linuxCandidates = [
    path.join(os.homedir(), '.config', 'google-chrome'),
    path.join(os.homedir(), '.config', 'chromium'),
  ];
  return linuxCandidates.find((candidate) => existsSync(candidate)) || '';
}

function isSystemProfileEnabled() {
  return USE_SYSTEM_CHROME_PROFILE && Boolean(SYSTEM_CHROME_PROFILE_DIR);
}

function providerLocalProfileDir(provider) {
  return path.join(PROFILE_ROOT, `${provider}-profile`);
}

function providerProfileDir(provider) {
  if (isSystemProfileEnabled()) {
    return SYSTEM_CHROME_PROFILE_DIR;
  }
  return providerLocalProfileDir(provider);
}

function isLikelyProfileLockError(error) {
  const raw = String(error ?? '');
  const lower = raw.toLowerCase();
  return (
    lower.includes('기존 브라우저 세션에서 여는 중입니다') ||
    lower.includes('opening in existing browser session') ||
    lower.includes('profile appears to be in use') ||
    lower.includes('profile in use') ||
    lower.includes('target page, context or browser has been closed')
  );
}

function sanitizeUrlForUi(rawUrl) {
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function inferSessionState(provider, sanitizedUrl, contextOpen = true) {
  if (!contextOpen) {
    return 'unknown';
  }
  if (!sanitizedUrl) {
    return 'unknown';
  }
  const config = SESSION_PROVIDER_CONFIG[provider];
  if (!config) {
    return 'unknown';
  }
  const lower = sanitizedUrl.toLowerCase();
  if (config.loginSignals.some((signal) => lower.includes(signal))) {
    return 'login_required';
  }
  if (provider !== 'gemini') {
    return 'unknown';
  }
  if (config.activeSignals.some((signal) => lower.includes(signal))) {
    return 'active';
  }
  return 'unknown';
}

const GEMINI_PROMPT_INPUT_SELECTORS = PROVIDER_AUTOMATION_CONFIG.gemini.inputSelectors;

async function hasVisibleSelector(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      const count = await locator.count();
      if (count > 0 && (await locator.isVisible())) {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

async function isGeminiPromptReady(page) {
  return hasVisibleSelector(page, GEMINI_PROMPT_INPUT_SELECTORS);
}

async function inferSessionStateWithPage(provider, page, contextOpen = true) {
  const safeUrl = contextOpen ? sanitizeUrlForUi(page?.url?.() ?? null) : null;
  const urlBased = inferSessionState(provider, safeUrl, contextOpen);
  if (!contextOpen || !page || page.isClosed()) {
    return { safeUrl, sessionState: urlBased };
  }

  try {
    const loginRequired = await isLikelyNotLoggedIn(provider, page);
    if (loginRequired) {
      return { safeUrl, sessionState: 'login_required' };
    }
    const promptReady = await hasVisibleSelector(page, providerAutomationConfig(provider).inputSelectors);
    if (promptReady) {
      return { safeUrl, sessionState: 'active' };
    }
    return { safeUrl, sessionState: urlBased };
  } catch {
    return { safeUrl, sessionState: urlBased };
  }
}

async function ensureProviderContext(provider) {
  if (!SESSION_PROVIDER_CONFIG[provider]) {
    throw workerError('UNSUPPORTED_PROVIDER', `지원하지 않는 provider입니다: ${provider}`);
  }

  const current = state.providers.get(provider);
  if (current && !current.contextClosed) {
    if (!current.page || current.page.isClosed()) {
      current.page = current.context.pages()[0] ?? (await current.context.newPage());
    }
    return current;
  }

  const playwrightModule = await loadPlaywright();
  const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
  if (!chromium) {
    throw workerError('BROWSER_MISSING', 'chromium 런처를 찾지 못했습니다.');
  }

  const launchTargets = [];
  const systemProfileBusyWithOtherProvider = Array.from(state.providers.values()).some(
    (wrapped) =>
      wrapped.provider !== provider &&
      !wrapped.contextClosed &&
      wrapped.profileDir === SYSTEM_CHROME_PROFILE_DIR,
  );
  if (isSystemProfileEnabled() && !systemProfileBusyWithOtherProvider) {
    launchTargets.push({
      kind: 'system',
      profileDir: SYSTEM_CHROME_PROFILE_DIR,
      profileName: 'Default',
    });
  }
  const localProfile = providerLocalProfileDir(provider);
  if (!launchTargets.some((row) => row.profileDir === localProfile)) {
    launchTargets.push({
      kind: 'local',
      profileDir: localProfile,
      profileName: null,
    });
  }

  const executablePath = resolveChromeExecutable();
  let context = null;
  let profileDir = '';
  let launchError = null;

  for (const target of launchTargets) {
    profileDir = target.profileDir;
    if (target.kind === 'local') {
      await hardenDir(profileDir);
    }

    const launchOptions = {
      headless: false,
      viewport: { width: 1380, height: 900 },
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--disable-setuid-sandbox'],
      args: ['--disable-dev-shm-usage', '--no-first-run'],
    };
    if (target.profileName) {
      launchOptions.args.push(`--profile-directory=${target.profileName}`);
    }
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    notify('web/progress', {
      provider,
      stage: 'launch_context',
      message:
        target.kind === 'system'
          ? '시스템 Chrome 프로필로 세션 연결을 시도합니다.'
          : '앱 전용 프로필로 세션 연결을 시도합니다.',
    });

    try {
      context = await chromium.launchPersistentContext(profileDir, launchOptions);
      launchError = null;
      break;
    } catch (error) {
      launchError = error;
      if (target.kind === 'system' && isLikelyProfileLockError(error)) {
        notify('web/progress', {
          provider,
          stage: 'launch_context_fallback',
          message: '시스템 Chrome 프로필이 사용 중이라 앱 전용 프로필로 전환합니다.',
        });
        continue;
      }
      break;
    }
  }

  if (!context) {
    throw workerError(
      'BROWSER_MISSING',
      `브라우저 컨텍스트 시작 실패: ${String(launchError ?? 'unknown error')}`,
      { executablePath, profileDir },
    );
  }

  const page = context.pages()[0] ?? (await context.newPage());

  const wrapped = {
    provider,
    context,
    page,
    profileDir,
    contextClosed: false,
  };

  context.on('close', () => {
    wrapped.contextClosed = true;
  });

  state.providers.set(provider, wrapped);
  return wrapped;
}

function throwIfRunCancelled(runToken) {
  if (runToken?.cancelled) {
    throw workerError('CANCELLED', '요청이 취소되었습니다.');
  }
}

async function ensureProviderLandingPage(provider, page, runToken = null) {
  const config = SESSION_PROVIDER_CONFIG[provider];
  if (!config) {
    throw workerError('UNSUPPORTED_PROVIDER', `지원하지 않는 provider입니다: ${provider}`);
  }
  for (const url of config.homeUrls) {
    throwIfRunCancelled(runToken);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      throwIfRunCancelled(runToken);
      return;
    } catch (error) {
      if (error?.code === 'CANCELLED') {
        throw error;
      }
      // try next
    }
  }
  throw workerError('NAVIGATION_FAILED', `${provider} 페이지로 이동하지 못했습니다.`);
}

async function waitForFirstVisible(page, selectors, timeoutMs, runToken = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfRunCancelled(runToken);
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      try {
        const count = await locator.count();
        if (count > 0 && (await locator.isVisible())) {
          return locator;
        }
      } catch {
        // continue
      }
    }
    await page.waitForTimeout(200);
  }
  return null;
}

function providerAutomationConfig(provider) {
  return PROVIDER_AUTOMATION_CONFIG[provider] ?? PROVIDER_AUTOMATION_CONFIG.gemini;
}

async function isLikelyNotLoggedIn(provider, page) {
  const config = SESSION_PROVIDER_CONFIG[provider];
  const automation = providerAutomationConfig(provider);

  const urlLower = String(page.url() || '').toLowerCase();
  if (provider === 'gemini' && /accounts\.google\.com/.test(urlLower)) {
    return true;
  }
  if (config?.loginSignals?.some((signal) => urlLower.includes(String(signal).toLowerCase()))) {
    return true;
  }

  if (
    provider === 'gemini' &&
    (await hasVisibleSelector(page, [
      'text=/지원되지 않는 명령줄 플래그|브라우저 또는 앱이 안전하지 않을 수 있습니다/i',
    ]))
  ) {
    return true;
  }

  const promptReady = await hasVisibleSelector(page, automation.inputSelectors);
  if (promptReady) {
    return false;
  }

  if (
    await hasVisibleSelector(page, [
      'input[type="email"]',
      'input[type="password"]',
      'form[action*="login" i]',
      'form[action*="signin" i]',
    ])
  ) {
    return true;
  }

  const explicitLoginByProvider = {
    gemini: ['button:has-text("Sign in")', 'a:has-text("Sign in")', 'text=/계정 선택/i'],
    gpt: ['button:has-text("Log in")', 'a:has-text("Log in")'],
    grok: ['button:has-text("Log in")', 'a:has-text("Log in")'],
    perplexity: ['button:has-text("Log in")', 'a:has-text("Log in")', 'button:has-text("Sign in")'],
    claude: ['button:has-text("Log in")', 'a:has-text("Log in")', 'button:has-text("Sign in")'],
  };
  return hasVisibleSelector(page, explicitLoginByProvider[provider] ?? []);
}

async function fillPromptAndSubmit(provider, page, prompt, runToken = null) {
  const automation = providerAutomationConfig(provider);
  const input = await waitForFirstVisible(page, automation.inputSelectors, 15_000, runToken);
  if (!input) {
    const notLoggedIn = await isLikelyNotLoggedIn(provider, page);
    if (notLoggedIn) {
      throw workerError('NOT_LOGGED_IN', `${provider.toUpperCase()} 로그인 상태를 확인할 수 없습니다. 먼저 로그인하세요.`);
    }
    throw workerError('INPUT_NOT_FOUND', `${provider.toUpperCase()} 입력창을 찾지 못했습니다.`);
  }

  notify('web/progress', {
    provider,
    stage: 'input_found',
    message: '입력창을 찾았습니다.',
  });

  throwIfRunCancelled(runToken);
  await input.click({ timeout: 5_000 });
  await input.focus();
  const isTextarea = await input.evaluate((el) => el.tagName.toLowerCase() === 'textarea');
  const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';

  if (isTextarea) {
    throwIfRunCancelled(runToken);
    await input.fill(prompt);
  } else {
    throwIfRunCancelled(runToken);
    await page.keyboard.press(`${commandKey}+A`);
    await page.keyboard.press('Backspace');
    throwIfRunCancelled(runToken);
    await page.keyboard.insertText(prompt);
  }

  notify('web/progress', {
    provider,
    stage: 'prompt_filled',
    message: '프롬프트를 입력했습니다.',
  });

  for (const selector of automation.submitSelectors) {
    throwIfRunCancelled(runToken);
    const button = page.locator(selector).first();
    try {
      if ((await button.count()) > 0 && (await button.isVisible())) {
        await button.click({ timeout: 5_000 });
        return;
      }
    } catch {
      // continue
    }
  }

  try {
    throwIfRunCancelled(runToken);
    await page.keyboard.press('Enter');
  } catch (error) {
    throw workerError('SUBMIT_FAILED', `전송 동작 실패: ${String(error)}`);
  }
}

async function extractProviderResponseText(provider, page, prompt) {
  const automation = providerAutomationConfig(provider);
  const candidates = await page.evaluate((selectors) => {
    const rows = [];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const text = (node.innerText || '').trim();
        if (!text) {
          continue;
        }
        const rect = node.getBoundingClientRect();
        rows.push({
          text,
          top: rect.top,
          bottom: rect.bottom,
          len: text.length,
        });
      }
    }
    rows.sort((a, b) => a.bottom - b.bottom);
    return rows.slice(-16);
  }, [
    ...automation.responseSelectors,
    '[data-message-author-role="assistant"]',
    '[data-message-author-role="model"]',
    'main article',
    'main .markdown',
    'main .prose',
  ]);

  return pickProviderResponseText(candidates, prompt);
}

async function waitForProviderResponse(provider, page, prompt, timeoutMs, runToken) {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    if (runToken.cancelled) {
      throw workerError('CANCELLED', '요청이 취소되었습니다.');
    }

    const text = await extractProviderResponseText(provider, page, prompt);
    if (text) {
      if (text !== lastText) {
        lastText = text;
        lastChangeAt = Date.now();
        notify('web/progress', {
          provider,
          stage: 'response_streaming',
          message: `응답 수집 중 (${text.length} chars)`,
        });
      } else if (Date.now() - lastChangeAt >= 1600) {
        return text;
      }
    }

    await page.waitForTimeout(450);
  }

  throw workerError('TIMEOUT', `응답 대기 시간이 초과되었습니다 (${timeoutMs}ms).`);
}

async function runProviderAutomation(provider, { prompt, timeoutMs, runToken: providedRunToken = null }) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const runToken = providedRunToken ?? { cancelled: false, provider };
  const ownsRunToken = !providedRunToken;

  try {
    if (ownsRunToken) {
      registerActiveRun(runToken);
    }
    const wrapped = await ensureProviderContext(provider);
    const { page } = wrapped;

    notify('web/progress', {
      provider,
      stage: 'navigation',
      message: `${provider.toUpperCase()} 페이지를 준비합니다.`,
    });
    await ensureProviderLandingPage(provider, page, runToken);

    notify('web/progress', {
      provider,
      stage: 'input',
      message: '프롬프트 입력을 시작합니다.',
    });
    await fillPromptAndSubmit(provider, page, prompt, runToken);

    notify('web/progress', {
      provider,
      stage: 'await_response',
      message: '응답을 기다리는 중입니다.',
    });
    const text = await waitForProviderResponse(provider, page, prompt, timeoutMs, runToken);

    const finishedAt = nowIso();
    return {
      ok: true,
      text,
      raw: {
        provider,
      },
      meta: {
        provider,
        url: page.url(),
        startedAt,
        finishedAt,
        elapsedMs: Date.now() - startedMs,
        extractionStrategy: 'dom-bottom-most-stable-text',
      },
    };
  } finally {
    if (ownsRunToken) {
      unregisterActiveRun(runToken);
    }
  }
}

async function runProviderBridgeAssisted(provider, { prompt, timeoutMs, runToken }) {
  const resolvedMode = resolveProviderRunMode({
    requestedMode: 'bridgeAssisted',
    provider,
    bridgeListening: Boolean(state.bridge.server?.listening),
    connectedProviders: state.bridge.connectedProviders,
  });

  if (resolvedMode.mode === 'auto') {
    const fallbackMessage =
      resolvedMode.fallbackReason === 'bridge_not_running'
        ? '웹 연결 서버가 없어 자동 브라우저 제어로 전환합니다.'
        : resolvedMode.fallbackReason === 'bridge_stale'
          ? '웹 연결이 오래되어 자동 브라우저 제어로 전환합니다.'
          : '웹 연결이 아직 붙지 않아 자동 브라우저 제어로 전환합니다.';
    bridgeProgress(provider, 'bridge_fallback_auto', fallbackMessage);
    return runProviderAutomation(provider, {
      prompt,
      timeoutMs,
      runToken,
    });
  }
  const startedAt = nowIso();
  const startedMs = Date.now();
  const { task, completion } = enqueueBridgeTask(provider, prompt, timeoutMs);

  while (true) {
    if (runToken.cancelled) {
      task.status = 'failed';
      bridgeProgress(provider, 'bridge_cancelled', '요청이 취소되었습니다.');
      failBridgeTask(task, 'CANCELLED', '요청이 취소되었습니다.');
      throw workerError('CANCELLED', '요청이 취소되었습니다.');
    }

    try {
      const result = await Promise.race([
        completion,
        sleep(220).then(() => null),
      ]);
      if (!result) {
        continue;
      }
      const finishedAt = nowIso();
      return {
        ok: true,
        text: String(result.text ?? '').trim(),
        raw: {
          provider,
          bridge: true,
          payload: result.raw ?? null,
        },
        meta: {
          provider,
          url: task.pageUrl ?? null,
          startedAt,
          finishedAt,
          elapsedMs: Date.now() - startedMs,
          extractionStrategy: 'browser-extension-bridge',
        },
      };
    } catch (error) {
      throw error;
    }
  }
}

async function openProviderSession(provider) {
  const wrapped = await ensureProviderContext(provider);
  await ensureProviderLandingPage(provider, wrapped.page);
  try {
    await wrapped.page.bringToFront();
  } catch {
    // ignore
  }

  const { safeUrl, sessionState } = await inferSessionStateWithPage(
    provider,
    wrapped.page,
    !wrapped.contextClosed,
  );
  notify('web/progress', {
    provider,
    stage: 'session_open',
    message: '로그인 세션 창을 열었습니다.',
  });
  return {
    ok: true,
    provider,
    url: safeUrl,
    sessionState,
  };
}

async function getHealthResult() {
  const providerStatuses = {};
  for (const [provider, wrapped] of state.providers.entries()) {
    const contextOpen = !wrapped.contextClosed;
    const { safeUrl, sessionState } = await inferSessionStateWithPage(
      provider,
      wrapped.page,
      contextOpen,
    );
    providerStatuses[provider] = {
      contextOpen,
      profileDir: wrapped.profileDir,
      url: safeUrl,
      sessionState,
    };
  }

  return {
    running: true,
    lastError: state.lastError,
    providers: providerStatuses,
    logPath: LOG_PATH,
    profileRoot: PROFILE_ROOT,
    activeProvider: Array.from(state.activeRuns.keys())[0] ?? null,
    activeProviders: Array.from(state.activeRuns.keys()),
    bridge: bridgeStatusPayload({ exposeToken: false }),
  };
}

async function resetProviderSession(provider) {
  const wrapped = state.providers.get(provider);
  const wrappedProfileDir = wrapped?.profileDir || null;
  if (wrapped) {
    try {
      await wrapped.context.close();
    } catch {
      // ignore
    }
    wrapped.contextClosed = true;
    state.providers.delete(provider);
  }

  const profileDir = wrappedProfileDir || providerProfileDir(provider);
  if (!isSystemProfileEnabled() || profileDir !== SYSTEM_CHROME_PROFILE_DIR) {
    await rm(profileDir, { recursive: true, force: true });
    await hardenDir(profileDir);
  }

  return { ok: true, provider, profileDir };
}

async function cancelProviderRun(provider) {
  const normalizedProvider = String(provider ?? '').trim().toLowerCase();
  const activeRuns = state.activeRuns.get(normalizedProvider);
  let cancelledCount = 0;
  if (activeRuns?.size) {
    for (const runToken of activeRuns) {
      if (!runToken.cancelled) {
        runToken.cancelled = true;
        cancelledCount += 1;
      }
    }
  }
  for (const task of state.bridge.tasks.values()) {
    if (task.provider !== normalizedProvider || task.settled) {
      continue;
    }
    task.status = 'failed';
    failBridgeTask(task, 'CANCELLED', '요청이 취소되었습니다.');
    cancelledCount += 1;
  }
  const wrapped = state.providers.get(normalizedProvider);
  if (cancelledCount > 0 && wrapped) {
    try {
      await wrapped.context.close();
    } catch {
      // ignore
    }
    wrapped.contextClosed = true;
    state.providers.delete(normalizedProvider);
  }
  return { ok: true, cancelled: cancelledCount > 0, cancelledCount };
}

async function closeAllProviderContexts() {
  const providers = Array.from(state.providers.values());
  state.providers.clear();
  for (const wrapped of providers) {
    try {
      await wrapped.context.close();
    } catch {
      // ignore
    }
  }
}

function closeAllBridgeTasks(reason = '웹 연결 작업이 중단되었습니다.') {
  const tasks = Array.from(state.bridge.tasks.values());
  state.bridge.tasks.clear();
  state.bridge.providerQueue.clear();
  for (const task of tasks) {
    if (task.settled) {
      continue;
    }
    task.status = 'failed';
    clearTimeout(task.timeoutHandle);
    task.settled = true;
    task.reject(workerError('BRIDGE_STOPPED', reason));
  }
}

async function gracefulShutdown(reason, exitCode = 0) {
  if (shutdownRequested) {
    return;
  }
  shutdownRequested = true;
  stopParentWatchdog();
  notify('web/worker/stopped', { reason, stoppedAt: nowIso() });
  await logLine(`web worker shutdown: ${reason}`);
  closeAllBridgeTasks('웹 연결 서버가 종료되었습니다.');
  await stopBridgeServer();
  await closeAllProviderContexts();
  await releaseWorkerLock();
  process.exit(exitCode);
}

async function handleRpcRequest(message) {
  const { id, method, params = {} } = message;

  if (method === 'health') {
    const result = await getHealthResult();
    respond(id, result);
    return;
  }

  if (method === 'bridge/status') {
    await ensureBridgeToken();
    respond(id, bridgeStatusPayload({ exposeToken: true }));
    return;
  }

  if (method === 'bridge/tokenRotate') {
    const result = await rotateBridgeToken();
    notify('web/progress', {
      stage: 'bridge_token_rotated',
      message: '웹 연결 토큰을 재발급했습니다.',
    });
    respond(id, result);
    return;
  }

  if (method === 'provider/run') {
    const provider = String(params.provider ?? '').trim().toLowerCase();
    const prompt = String(params.prompt ?? '');
    const timeoutMs = Number(params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const modeRaw = String(params.mode ?? 'auto').trim();
    const requestedMode = modeRaw === 'bridgeAssisted' ? 'bridgeAssisted' : 'auto';

    if (!provider) {
      respond(id, {
        ok: false,
        errorCode: 'UNSUPPORTED_PROVIDER',
        error: 'provider가 비어 있습니다.',
      });
      return;
    }

    if (!SESSION_PROVIDER_CONFIG[provider]) {
      respond(id, {
        ok: false,
        errorCode: 'UNSUPPORTED_PROVIDER',
        error: `지원하지 않는 provider입니다. provider=${provider}`,
      });
      return;
    }

    if (!prompt.trim()) {
      respond(id, {
        ok: false,
        errorCode: 'INVALID_PROMPT',
        error: 'prompt가 비어 있습니다.',
      });
      return;
    }

    try {
      const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
      const runToken = { cancelled: false, provider };
      registerActiveRun(runToken);
      let result;
      try {
        result = await runProviderOperationExclusive(provider, async () => {
          throwIfRunCancelled(runToken);
          if (requestedMode === 'bridgeAssisted') {
            return runProviderBridgeAssisted(provider, {
              prompt,
              timeoutMs: safeTimeoutMs,
              runToken,
            });
          }
          return runProviderAutomation(provider, {
            prompt,
            timeoutMs: safeTimeoutMs,
            runToken,
          });
        });
      } finally {
        unregisterActiveRun(runToken);
      }
      respond(id, result);
    } catch (error) {
      const code =
        error?.code || (requestedMode === 'bridgeAssisted' ? 'BRIDGE_FAILED' : 'EXTRACTION_FAILED');
      const messageText = error?.message || String(error);
      state.lastError = `${code}: ${messageText}`;
      notify('web/progress', {
        provider,
        stage: requestedMode === 'bridgeAssisted' ? 'bridge_error' : 'error',
        message: state.lastError,
      });
      respond(id, {
        ok: false,
        errorCode: code,
        error: messageText,
        meta: {
          provider,
          failedAt: nowIso(),
        },
      });
    }
    return;
  }

  if (method === 'provider/openSession') {
    const provider = String(params.provider ?? '').trim().toLowerCase();
    if (!provider) {
      respond(id, { ok: false, error: 'provider가 비어 있습니다.' });
      return;
    }
    try {
      const result = await runProviderOperationExclusive(provider, async () => openProviderSession(provider));
      respond(id, result);
    } catch (error) {
      const code = error?.code || 'INTERNAL';
      const messageText = error?.message || String(error);
      respond(id, { ok: false, errorCode: code, error: messageText });
    }
    return;
  }

  if (method === 'provider/resetSession') {
    const provider = String(params.provider ?? '').trim().toLowerCase();
    if (!provider) {
      respond(id, { ok: false, error: 'provider가 비어 있습니다.' });
      return;
    }

    try {
      const result = await runProviderOperationExclusive(provider, async () => resetProviderSession(provider));
      respond(id, result);
    } catch (error) {
      respond(id, {
        ok: false,
        error: `세션 리셋 실패: ${String(error)}`,
      });
    }
    return;
  }

  if (method === 'provider/cancel') {
    const provider = String(params.provider ?? '').trim().toLowerCase();
    const result = await cancelProviderRun(provider);
    respond(id, result);
    return;
  }

  respondError(id, -32601, `Method not found: ${method}`);
}

async function handleLine(rawLine) {
  const line = rawLine.trim();
  if (!line) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    await logLine(`invalid json: ${line}`);
    return;
  }

  const id = parsed.id;
  const method = parsed.method;
  if (typeof id === 'undefined' || typeof method !== 'string') {
    respondError(id ?? null, -32600, 'Invalid request');
    return;
  }

  try {
    await handleRpcRequest(parsed);
  } catch (error) {
    const message = error?.message || String(error);
    const code = error?.code || 'INTERNAL';
    state.lastError = `${code}: ${message}`;
    respond(id, {
      ok: false,
      errorCode: code,
      error: message,
    });
  }
}

async function bootstrap() {
  await hardenDir(PROFILE_ROOT);
  await acquireWorkerLock();
  await ensureBridgeToken();
  try {
    await startBridgeServer();
  } catch (error) {
    state.lastError = `BRIDGE_START_FAILED: ${String(error)}`;
    await logLine(`bridge server unavailable: ${String(error)}`);
    notify('web/progress', {
      stage: 'bridge_unavailable',
      message: '웹 연결 서버를 시작하지 못했습니다. 수동 폴백을 사용하세요.',
    });
  }
  await logLine('web worker boot');
  notify('web/worker/started', {
    profileRoot: PROFILE_ROOT,
    logPath: LOG_PATH,
    startedAt: nowIso(),
  });
  if (!BRIDGE_EXTENSION_ALLOWLIST_CONFIGURED) {
    const message =
      '확장 ID allowlist 미설정: 토큰 기반 기본 모드로 동작합니다. 필요 시 allowlist를 추가하세요.';
    await logLine(`bridge security: ${message}`);
    notify('web/progress', {
      stage: 'bridge_extension_allowlist_missing',
      message,
    });
  }

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    void handleLine(line);
  });

  rl.on('close', async () => {
    await gracefulShutdown('stdin closed', 0);
  });

  startParentWatchdog();
}

process.on('uncaughtException', (error) => {
  state.lastError = `uncaughtException: ${String(error)}`;
  notify('web/worker/error', { message: state.lastError });
  void gracefulShutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (error) => {
  state.lastError = `unhandledRejection: ${String(error)}`;
  notify('web/worker/error', { message: state.lastError });
  void gracefulShutdown('unhandledRejection', 1);
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT', 0);
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM', 0);
});

bootstrap().catch((error) => {
  const message = `bootstrap failed: ${String(error)}`;
  notify('web/worker/error', { message });
  void gracefulShutdown('bootstrap failed', 1);
});
