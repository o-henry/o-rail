import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import type { RoleKnowledgeSource } from "../../../features/studio/roleKnowledgeStore";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type RoleKnowledgeProviderId =
  | "scrapling"
  | "crawl4ai"
  | "steel"
  | "playwright_local"
  | "browser_use"
  | "scrapy_playwright"
  | "lightpanda_experimental";

export type RoleKnowledgeProviderCapability =
  | "extract_document"
  | "interactive_browser"
  | "stateful_session"
  | "batch_crawl";

type RoleKnowledgeProviderHealth = {
  provider?: string;
  available?: boolean;
  ready?: boolean;
  configured?: boolean;
  installed?: boolean;
  installable?: boolean;
  message?: string;
  capabilities?: string[];
};

type RoleKnowledgeProviderFetchResult = {
  provider?: string;
  status?: string;
  url?: string;
  fetched_at?: string;
  summary?: string;
  content?: string;
  markdown_path?: string;
  json_path?: string;
  source_meta?: Record<string, unknown>;
  error?: string;
};

type RoleKnowledgeProviderDefinition = {
  id: RoleKnowledgeProviderId;
  capabilities: RoleKnowledgeProviderCapability[];
  installable: boolean;
};

type FetchRoleKnowledgeSourceInput = {
  cwd: string;
  invokeFn: InvokeFn;
  url: string;
  roleId: StudioRoleId;
  userPrompt?: string;
  topic?: string;
};

type FetchBootstrapSourcesWithRetryInput = {
  cwd: string;
  invokeFn: InvokeFn;
  roleId: StudioRoleId;
  userPrompt?: string;
  urls: string[];
  minSuccessRatio: number;
  maxAttempts: number;
};

const PROVIDER_READY_PROMISE_BY_KEY = new Map<string, Promise<void>>();

const PROVIDER_DEFINITIONS: RoleKnowledgeProviderDefinition[] = [
  {
    id: "scrapling",
    capabilities: ["extract_document"],
    installable: true,
  },
  {
    id: "crawl4ai",
    capabilities: ["extract_document"],
    installable: true,
  },
  {
    id: "steel",
    capabilities: ["extract_document", "interactive_browser", "stateful_session"],
    installable: false,
  },
  {
    id: "playwright_local",
    capabilities: ["interactive_browser"],
    installable: false,
  },
  {
    id: "browser_use",
    capabilities: ["interactive_browser"],
    installable: false,
  },
  {
    id: "scrapy_playwright",
    capabilities: ["batch_crawl"],
    installable: false,
  },
  {
    id: "lightpanda_experimental",
    capabilities: ["interactive_browser", "stateful_session"],
    installable: false,
  },
];

const DOCUMENT_HOST_HINTS = [
  "docs.",
  "developer.",
  "developers.",
  "support.",
  "help.",
  "learn.",
  "manual.",
  "reference.",
  "readthedocs.io",
  "docs.rs",
];

const DOCUMENT_PATH_HINTS = [
  "/docs",
  "/doc",
  "/manual",
  "/guide",
  "/reference",
  "/api",
  "/readme",
  "/wiki",
  "/blob/",
  "/releases",
];

const INTERACTIVE_HOST_HINTS = [
  "reddit.com",
  "x.com",
  "threads.net",
  "steamcommunity.com",
  "discord.com",
  "facebook.com",
  "instagram.com",
];

const DOCUMENT_PROMPT_HINTS = /(공식|문서|docs|documentation|manual|guide|reference|readme|release note|api)\b/i;
const ROLE_KB_FETCH_TIMEOUT_MS = 28_000;
const DEFAULT_ROLE_KB_TOPIC = "devEcosystem";

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value: unknown, max = 320): string {
  const text = cleanLine(value);
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      globalThis.clearTimeout(timer);
    }
  }
}

function getProviderDefinition(provider: RoleKnowledgeProviderId): RoleKnowledgeProviderDefinition {
  return PROVIDER_DEFINITIONS.find((row) => row.id === provider) ?? PROVIDER_DEFINITIONS[0]!;
}

function isDocumentLikeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (
      DOCUMENT_HOST_HINTS.some((hint) => host.includes(hint)) ||
      DOCUMENT_PATH_HINTS.some((hint) => path.includes(hint))
    );
  } catch {
    return false;
  }
}

function isInteractiveCommunityUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return INTERACTIVE_HOST_HINTS.some((hint) => host.includes(hint));
  } catch {
    return false;
  }
}

function prefersDocumentationExtraction(params: {
  url: string;
  userPrompt?: string;
  roleId: StudioRoleId;
}): boolean {
  if (params.roleId === "technical_writer" || params.roleId === "tooling_engineer") {
    return true;
  }
  if (isDocumentLikeUrl(params.url)) {
    return true;
  }
  return DOCUMENT_PROMPT_HINTS.test(cleanLine(params.userPrompt));
}

export function resolveRoleKnowledgeProviderOrder(params: {
  url: string;
  roleId: StudioRoleId;
  userPrompt?: string;
}): RoleKnowledgeProviderId[] {
  if (prefersDocumentationExtraction(params)) {
    return ["crawl4ai", "scrapling", "steel", "lightpanda_experimental", "browser_use"];
  }
  if (isInteractiveCommunityUrl(params.url)) {
    return ["scrapling", "steel", "lightpanda_experimental", "browser_use", "crawl4ai"];
  }
  return ["scrapling", "crawl4ai", "steel", "lightpanda_experimental", "browser_use"];
}

async function readProviderHealth(params: {
  cwd: string;
  invokeFn: InvokeFn;
  provider: RoleKnowledgeProviderId;
}): Promise<RoleKnowledgeProviderHealth> {
  return withTimeout(
    params.invokeFn<RoleKnowledgeProviderHealth>("dashboard_crawl_provider_health", {
      cwd: params.cwd,
      provider: params.provider,
    }),
    ROLE_KB_FETCH_TIMEOUT_MS,
    "dashboard_crawl_provider_health",
  );
}

async function ensureProviderReady(params: {
  cwd: string;
  invokeFn: InvokeFn;
  provider: RoleKnowledgeProviderId;
}): Promise<void> {
  const cacheKey = `${cleanLine(params.cwd)}::${params.provider}`;
  const existing = PROVIDER_READY_PROMISE_BY_KEY.get(cacheKey);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    let health = await readProviderHealth(params);
    if (health.ready) {
      return;
    }

    const providerDefinition = getProviderDefinition(params.provider);
    if (!providerDefinition.installable || health.installable === false) {
      throw new Error(truncateText(health.message || `${params.provider} is not ready`, 220));
    }

    await withTimeout(
      params.invokeFn("dashboard_crawl_provider_install", {
        cwd: params.cwd,
        provider: params.provider,
      }),
      ROLE_KB_FETCH_TIMEOUT_MS,
      "dashboard_crawl_provider_install",
    );
    health = await readProviderHealth(params);
    if (!health.ready) {
      throw new Error(truncateText(health.message || `${params.provider} is not ready`, 220));
    }
  })();

  PROVIDER_READY_PROMISE_BY_KEY.set(cacheKey, task);
  try {
    await task;
  } catch (error) {
    PROVIDER_READY_PROMISE_BY_KEY.delete(cacheKey);
    throw error;
  }
}

function normalizeFetchResult(
  params: {
    provider: RoleKnowledgeProviderId;
    url: string;
  },
  result: RoleKnowledgeProviderFetchResult,
): RoleKnowledgeSource {
  return {
    url: cleanLine(result.url) || params.url,
    provider: params.provider,
    status: "ok",
    fetchedAt: cleanLine(result.fetched_at) || new Date().toISOString(),
    summary: truncateText(result.summary, 320),
    content: truncateText(result.content, 480),
    markdownPath: cleanLine(result.markdown_path) || undefined,
    jsonPath: cleanLine(result.json_path) || undefined,
  };
}

async function fetchRoleKnowledgeSourceWithProvider(
  params: FetchRoleKnowledgeSourceInput & {
    provider: RoleKnowledgeProviderId;
  },
): Promise<RoleKnowledgeSource> {
  try {
    await ensureProviderReady({
      cwd: params.cwd,
      invokeFn: params.invokeFn,
      provider: params.provider,
    });
  } catch (error) {
    return {
      url: params.url,
      provider: params.provider,
      status: "error",
      error: truncateText(error, 180),
    };
  }

  try {
    const result = await withTimeout(
      params.invokeFn<RoleKnowledgeProviderFetchResult>("dashboard_crawl_provider_fetch_url", {
        cwd: params.cwd,
        provider: params.provider,
        url: params.url,
        topic: params.topic ?? DEFAULT_ROLE_KB_TOPIC,
      }),
      ROLE_KB_FETCH_TIMEOUT_MS,
      "dashboard_crawl_provider_fetch_url",
    );
    if (cleanLine(result.status).toLowerCase() === "ok") {
      return normalizeFetchResult({ provider: params.provider, url: params.url }, result);
    }
    return {
      url: params.url,
      provider: params.provider,
      status: "error",
      error: truncateText(result.error || result.status || "provider fetch failed", 180),
    };
  } catch (error) {
    return {
      url: params.url,
      provider: params.provider,
      status: "error",
      error: truncateText(error, 180),
    };
  }
}

export async function fetchRoleKnowledgeSourceWithProviders(
  params: FetchRoleKnowledgeSourceInput,
): Promise<RoleKnowledgeSource> {
  const providerOrder = resolveRoleKnowledgeProviderOrder({
    url: params.url,
    roleId: params.roleId,
    userPrompt: params.userPrompt,
  });
  const providerResults = await Promise.all(
    providerOrder.map((provider) =>
      fetchRoleKnowledgeSourceWithProvider({
        ...params,
        provider,
      }),
    ),
  );

  for (const provider of providerOrder) {
    const matched = providerResults.find(
      (row) => row.status === "ok" && cleanLine(row.provider) === provider,
    );
    if (matched) {
      return matched;
    }
  }
  const failures = providerResults
    .filter((row) => row.status !== "ok")
    .map((row) => `${cleanLine(row.provider) || "unknown"}: ${truncateText(row.error, 180)}`)
    .filter(Boolean);

  return {
    url: params.url,
    provider: providerOrder[0],
    status: "error",
    error: failures.join(" | ") || "no provider succeeded",
  };
}

function resolveBootstrapMinSuccessCount(sourceCount: number, minSuccessRatio: number): number {
  if (sourceCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(sourceCount * minSuccessRatio));
}

function mergeBootstrapSourceResults(
  previous: RoleKnowledgeSource[] | null,
  current: RoleKnowledgeSource[],
): RoleKnowledgeSource[] {
  if (!previous || previous.length === 0) {
    return current;
  }
  return current.map((row, index) => {
    const prior = previous[index];
    if (!prior) {
      return row;
    }
    if (prior.status === "ok" && row.status !== "ok") {
      return prior;
    }
    return row;
  });
}

export async function fetchBootstrapSourcesWithRetry(
  params: FetchBootstrapSourcesWithRetryInput,
): Promise<{
  sourceResults: RoleKnowledgeSource[];
  successfulSources: RoleKnowledgeSource[];
  attemptsUsed: number;
  minSuccessCount: number;
}> {
  const minSuccessCount = resolveBootstrapMinSuccessCount(params.urls.length, params.minSuccessRatio);
  let bestResults: RoleKnowledgeSource[] = [];
  let successfulSources: RoleKnowledgeSource[] = [];
  let attemptsUsed = 0;

  while (attemptsUsed < params.maxAttempts) {
    attemptsUsed += 1;
    const currentResults = await Promise.all(
      params.urls.map((url) =>
        fetchRoleKnowledgeSourceWithProviders({
          cwd: params.cwd,
          invokeFn: params.invokeFn,
          url,
          roleId: params.roleId,
          userPrompt: params.userPrompt,
        }),
      ),
    );
    bestResults = mergeBootstrapSourceResults(bestResults, currentResults);
    successfulSources = bestResults.filter((row) => row.status === "ok");
    if (successfulSources.length >= minSuccessCount) {
      break;
    }
    if (params.roleId !== "research_analyst") {
      break;
    }
  }

  return {
    sourceResults: bestResults,
    successfulSources,
    attemptsUsed,
    minSuccessCount,
  };
}

export function resetRoleKnowledgeProviderRuntimeForTests(): void {
  PROVIDER_READY_PROMISE_BY_KEY.clear();
}
