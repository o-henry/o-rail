import {
  DASHBOARD_TOPIC_IDS,
  type DashboardAgentConfigMap,
  type DashboardTopicAgentConfig,
  type DashboardTopicId,
} from "./types";

export const DASHBOARD_AGENT_CONFIG_STORAGE_KEY = "RAIL_DASHBOARD_AGENT_CONFIG_V1";
const DEFAULT_MODEL = "gpt-5.2-codex";

const DEFAULT_CADENCE_BY_TOPIC: Record<DashboardTopicId, number> = {
  marketSummary: 6,
  globalHeadlines: 6,
  industryTrendRadar: 6,
  communityHotTopics: 6,
  devCommunityHotTopics: 6,
  paperResearch: 24,
  eventCalendar: 12,
  riskAlertBoard: 3,
  devEcosystem: 24,
};

const DEFAULT_ALLOWLIST_BY_TOPIC: Record<DashboardTopicId, string[]> = {
  marketSummary: ["finance.yahoo.com", "stooq.com", "investing.com"],
  globalHeadlines: ["reuters.com", "apnews.com", "ft.com", "wsj.com"],
  industryTrendRadar: ["mckinsey.com", "gartner.com", "cbinsights.com", "statista.com"],
  communityHotTopics: [
    "reddit.com",
    "dcinside.com",
    "x.com",
    "tieba.baidu.com",
    "zhihu.com",
    "weibo.com",
    "5ch.net",
  ],
  devCommunityHotTopics: [
    "news.ycombinator.com",
    "github.com",
    "stackoverflow.com",
    "dev.to",
    "hashnode.com",
    "lobste.rs",
    "csdn.net",
    "juejin.cn",
    "qiita.com",
    "zenn.dev",
    "reddit.com",
    "x.com",
    "threads.net",
  ],
  paperResearch: [
    "arxiv.org",
    "openreview.net",
    "pubmed.ncbi.nlm.nih.gov",
    "ieeexplore.ieee.org",
    "dl.acm.org",
    "nature.com",
    "science.org",
    "springer.com",
    "sciencedirect.com",
    "ssrn.com",
  ],
  eventCalendar: ["federalreserve.gov", "imf.org", "sec.gov", "coinmarketcal.com"],
  riskAlertBoard: [
    "sec.gov",
    "cisa.gov",
    "owasp.org",
    "krebsonsecurity.com",
    "fema.gov",
    "earthquake.usgs.gov",
    "noaa.gov",
    "weather.gov",
    "gdacs.org",
    "reliefweb.int",
    "emsc-csem.org",
    "jma.go.jp",
  ],
  devEcosystem: [
    "github.blog",
    "nodejs.org",
    "python.org",
    "react.dev",
    "openai.com",
    "deepmind.google",
    "huggingface.co",
    "unity.com",
    "unrealengine.com",
    "gamedeveloper.com",
    "gdcvault.com",
    "godotengine.org",
  ],
};

const DEFAULT_PROMPT_BY_TOPIC: Record<DashboardTopicId, string> = {
  marketSummary:
    "You are the market summary analyst. Produce concise market snapshot, key movers, and near-term risk posture.",
  globalHeadlines:
    "You are the global headlines analyst. Prioritize high-impact verified headlines and explain why they matter.",
  industryTrendRadar:
    "You are the trend analyst. Extract validated trend signals, momentum changes, and uncertainty notes.",
  communityHotTopics:
    "You are the general community intelligence analyst. Surface fast-rising topics, cluster duplicates, and highlight representative links.",
  devCommunityHotTopics:
    "You are the developer community intelligence analyst. Track fast-rising developer topics, major discussion threads, and actionable engineering signals.",
  paperResearch:
    "You are the research paper analyst. Track globally relevant papers, summarize core contributions, and explain practical implications.",
  eventCalendar:
    "You are the event calendar analyst. Summarize upcoming events with dates, impact level, and watch notes.",
  riskAlertBoard:
    "You are the risk analyst. Detect policy/compliance/security/market risk signals and rank by urgency.",
  devEcosystem:
    "You are the developer ecosystem analyst. Summarize major releases, breaking changes, and migration implications.",
};

const MAX_ALLOWLIST_ITEMS = 40;

function normalizeCadenceHours(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(168, Math.round(parsed)));
}

function normalizePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeAllowlist(value: unknown, fallback: string[]): string[] {
  const fallbackNormalized = fallback
    .map((row) => String(row ?? "").trim().toLowerCase())
    .filter((row) => row.length > 0);
  if (!Array.isArray(value)) {
    return [...fallbackNormalized];
  }
  const normalized = value
    .map((row) => String(row ?? "").trim().toLowerCase())
    .filter((row) => row.length > 0)
    .slice(0, MAX_ALLOWLIST_ITEMS);
  if (normalized.length === 0) {
    return [...fallbackNormalized];
  }
  return [...new Set([...normalized, ...fallbackNormalized])].slice(0, MAX_ALLOWLIST_ITEMS);
}

export function createDefaultDashboardTopicConfig(topic: DashboardTopicId): DashboardTopicAgentConfig {
  return {
    enabled: true,
    model: DEFAULT_MODEL,
    systemPrompt: DEFAULT_PROMPT_BY_TOPIC[topic],
    cadenceHours: DEFAULT_CADENCE_BY_TOPIC[topic],
    maxSources: 8,
    maxSnippets: 6,
    maxSnippetChars: 1600,
    allowlist: [...DEFAULT_ALLOWLIST_BY_TOPIC[topic]],
  };
}

export function createDefaultDashboardAgentConfigMap(): DashboardAgentConfigMap {
  const out = {} as DashboardAgentConfigMap;
  for (const topic of DASHBOARD_TOPIC_IDS) {
    out[topic] = createDefaultDashboardTopicConfig(topic);
  }
  return out;
}

export function normalizeDashboardTopicConfig(topic: DashboardTopicId, raw: unknown): DashboardTopicAgentConfig {
  const fallback = createDefaultDashboardTopicConfig(topic);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const row = raw as Partial<DashboardTopicAgentConfig>;
  return {
    enabled: row.enabled !== false,
    model: String(row.model ?? fallback.model).trim() || fallback.model,
    systemPrompt: String(row.systemPrompt ?? fallback.systemPrompt).trim() || fallback.systemPrompt,
    cadenceHours: normalizeCadenceHours(row.cadenceHours, fallback.cadenceHours),
    maxSources: normalizePositiveInt(row.maxSources, fallback.maxSources, 1, 20),
    maxSnippets: normalizePositiveInt(row.maxSnippets, fallback.maxSnippets, 1, 20),
    maxSnippetChars: normalizePositiveInt(row.maxSnippetChars, fallback.maxSnippetChars, 300, 6_000),
    allowlist: normalizeAllowlist(row.allowlist, fallback.allowlist),
  };
}

export function normalizeDashboardAgentConfigMap(raw: unknown): DashboardAgentConfigMap {
  const out = createDefaultDashboardAgentConfigMap();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  const obj = raw as Record<string, unknown>;
  for (const topic of DASHBOARD_TOPIC_IDS) {
    out[topic] = normalizeDashboardTopicConfig(topic, obj[topic]);
  }
  return out;
}
