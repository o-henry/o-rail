export type ResearchCollectionRun = {
  runId: string;
  source: string;
  collector: string;
  collectedAt: string;
  rawRoot: string;
  manifestPath: string;
  gameCount: number;
  rawDocumentCount: number;
  reviewCount: number;
};

export type ResearchOverview = {
  dbPath: string;
  totals: {
    runs: number;
    games: number;
    rawDocuments: number;
    reviews: number;
    collectionItems: number;
  };
  runs: ResearchCollectionRun[];
};

export type ResearchGameListItem = {
  gameKey: string;
  source: string;
  sourceGameId: string;
  slug: string;
  name: string;
  reviewCount: number;
  latestReviewAt: string;
};

export type ResearchGameListResult = {
  dbPath: string;
  items: ResearchGameListItem[];
};

export type ResearchIngestResult = {
  runId: string;
  source: string;
  dbPath: string;
  rawRoot: string;
  manifestPath: string;
  games: number;
  rawDocuments: number;
  reviews: number;
};

export type ResearchReviewRow = {
  reviewKey: string;
  runId: string;
  source: string;
  sourceItemId: string;
  gameKey: string;
  gameName: string;
  body: string;
  language: string;
  ratingDirection: string;
  ratingNumeric: number;
  helpfulVotes: number;
  funnyVotes: number;
  playtimeHours: number;
  createdAt: string;
  collectedAt: string;
  rawId: string;
  rawPath: string;
};

export type ResearchReviewSearchFilters = {
  source?: string;
  gameKey?: string;
  sentiment?: string;
  language?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ResearchReviewSearchResult = {
  dbPath: string;
  total: number;
  limit: number;
  offset: number;
  items: ResearchReviewRow[];
};

export type ResearchGameMetric = {
  gameKey: string;
  gameName: string;
  totalReviews: number;
  positiveReviews: number;
  negativeReviews: number;
  positiveRatio: number;
  languageCount: number;
  avgHelpfulVotes: number;
  avgPlaytimeHours: number;
  latestReviewAt: string;
};

export type ResearchGameMetricsResult = {
  dbPath: string;
  items: ResearchGameMetric[];
};

export type ResearchSentimentSeriesPoint = {
  bucketDate: string;
  totalReviews: number;
  positiveReviews: number;
  negativeReviews: number;
};

export type ResearchSentimentSeriesResult = {
  dbPath: string;
  source: string;
  gameKey: string;
  items: ResearchSentimentSeriesPoint[];
};

export type ResearchCollectionTarget = {
  targetId: string;
  position: number;
  url: string;
  host: string;
  resolvedSourceType: string;
  collectorStrategy: string;
  interactionMode: string;
  requiresBrowser: boolean;
  reasons: string[];
  interactionSteps: string[];
};

export type ResearchCollectionJob = {
  specVersion: number;
  jobId: string;
  jobKind: string;
  status: string;
  label: string;
  requestedSourceType: string;
  resolvedSourceType: string;
  viaSourceType: string;
  collectorStrategy: string;
  maxItems: number;
  urls: string[];
  keywords: string[];
  domains: string[];
  planner?: {
    mode?: string;
    prompt?: string;
    derivedUrls?: string[];
    derivedKeywords?: string[];
    derivedDomains?: string[];
    analysisMode?: string;
    metricFocus?: string[];
    dataScope?: string;
    aggregationUnit?: string;
    suggestedSourceType?: string;
    additionalKeywords?: string[];
    additionalDomains?: string[];
    instructions?: string[];
  };
  targets: ResearchCollectionTarget[];
  sourceOptions: {
    urls: string[];
    keywords: string[];
    domains: string[];
    allowed_domains?: string[];
    strict_domain_isolation?: boolean;
    max_items: number;
    planner?: Record<string, unknown>;
    targets: Array<{
      url: string;
      host: string;
      collectorStrategy: string;
      interactionMode: string;
      requiresBrowser: boolean;
      interactionSteps: string[];
    }>;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type ResearchCollectionJobPlanResult = {
  dbPath: string;
  job: ResearchCollectionJob;
};

export type ResearchCollectionJobListItem = {
  jobId: string;
  jobKind: string;
  status: string;
  label: string;
  requestedSourceType: string;
  resolvedSourceType: string;
  viaSourceType: string;
  collectorStrategy: string;
  maxItems: number;
  createdAt: string;
  updatedAt: string;
};

export type ResearchCollectionJobListResult = {
  dbPath: string;
  items: ResearchCollectionJobListItem[];
};

export type ResearchCollectionHandoff = {
  handoffId: string;
  jobId: string;
  agentRole: string;
  title: string;
  prompt: string;
  job: ResearchCollectionJob;
  sourceOptions: {
    urls: string[];
    keywords: string[];
    domains: string[];
    allowed_domains?: string[];
    strict_domain_isolation?: boolean;
    max_items: number;
  };
  preferredExecutionOrder: string[];
};

export type ResearchCollectionHandoffResult = {
  dbPath: string;
  handoff: ResearchCollectionHandoff;
};

export type ResearchCollectionExecution = {
  jobRunId: string;
  jobId: string;
  viaRunId: string;
  flowId: number;
  status: string;
  executedAt: string;
  result: unknown;
};

export type ResearchCollectionExecuteResult = {
  job: ResearchCollectionJob;
  execution: ResearchCollectionExecution;
  via: unknown;
};

export type ResearchCollectionItem = {
  itemFactId: string;
  jobId: string;
  jobRunId: string;
  viaRunId: string;
  sourceType: string;
  sourceName: string;
  country: string;
  adapter: string;
  itemKey: string;
  sourceItemId: string;
  title: string;
  url: string;
  summary: string;
  contentExcerpt: string;
  publishedAt: string;
  fetchedAt: string;
  verificationStatus: string;
  score: number;
  hotScore: number;
  sourceCount: number;
  rawExportPath: string;
};

export type ResearchCollectionItemSearchFilters = {
  jobId?: string;
  sourceType?: string;
  verificationStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ResearchCollectionItemSearchResult = {
  dbPath: string;
  total: number;
  limit: number;
  offset: number;
  items: ResearchCollectionItem[];
};

export type ResearchCollectionMetricsSourceRow = {
  sourceType: string;
  itemCount: number;
  avgScore: number;
  avgHotScore: number;
};

export type ResearchCollectionMetricsVerificationRow = {
  verificationStatus: string;
  itemCount: number;
};

export type ResearchCollectionMetricsTimelinePoint = {
  bucketDate: string;
  itemCount: number;
};

export type ResearchCollectionMetricsTopSource = {
  sourceName: string;
  itemCount: number;
};

export type ResearchCollectionMetricsResult = {
  dbPath: string;
  jobId: string;
  totals: {
    items: number;
    sources: number;
    verified: number;
    warnings: number;
    conflicted: number;
    avgScore: number;
    avgHotScore: number;
  };
  bySourceType: ResearchCollectionMetricsSourceRow[];
  byVerificationStatus: ResearchCollectionMetricsVerificationRow[];
  timeline: ResearchCollectionMetricsTimelinePoint[];
  topSources: ResearchCollectionMetricsTopSource[];
};

export type ResearchCollectionGenreRankingRow = {
  genreKey: string;
  genreLabel: string;
  rank: number;
  evidenceCount: number;
  verifiedCount: number;
  sourceDiversity: number;
  avgScore: number;
  avgHotScore: number;
  popularityScore: number;
  qualityScore: number;
  representativeTitles: string[];
  sourceNames: string[];
  generatedAt: string;
};

export type ResearchCollectionGenreRankingsResult = {
  dbPath: string;
  jobId: string;
  popular: ResearchCollectionGenreRankingRow[];
  quality: ResearchCollectionGenreRankingRow[];
};
