export const DASHBOARD_TOPIC_IDS = [
  "marketSummary",
  "globalHeadlines",
  "industryTrendRadar",
  "communityHotTopics",
  "devCommunityHotTopics",
  "paperResearch",
  "eventCalendar",
  "riskAlertBoard",
  "devEcosystem",
] as const;

export type DashboardTopicId = (typeof DASHBOARD_TOPIC_IDS)[number];

export type DashboardTopicAgentConfig = {
  enabled: boolean;
  model: string;
  systemPrompt: string;
  cadenceHours: number;
  maxSources: number;
  maxSnippets: number;
  maxSnippetChars: number;
  allowlist: string[];
};

export type DashboardAgentConfigMap = Record<DashboardTopicId, DashboardTopicAgentConfig>;

export type DashboardTopicReference = {
  url: string;
  title: string;
  source: string;
  publishedAt?: string;
};

export type DashboardTopicEvent = {
  title: string;
  date?: string;
  note?: string;
};

export type DashboardTopicSnapshot = {
  topic: DashboardTopicId;
  runId?: string;
  model: string;
  generatedAt: string;
  summary: string;
  highlights: string[];
  risks: string[];
  events: DashboardTopicEvent[];
  references: DashboardTopicReference[];
  status?: "ok" | "degraded";
  statusMessage?: string;
  referenceEmpty?: boolean;
};

export type DashboardTopicRunState = {
  running: boolean;
  lastRunAt?: string;
  lastError?: string;
  progressStage?: string;
  progressText?: string;
};

export type DashboardIntelligenceState = {
  config: DashboardAgentConfigMap;
  snapshots: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>;
  runStateByTopic: Record<DashboardTopicId, DashboardTopicRunState>;
};
