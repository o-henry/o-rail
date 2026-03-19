import { invoke } from "../../../shared/tauri";
import type {
  ResearchCollectionExecuteResult,
  ResearchCollectionGenreRankingsResult,
  ResearchCollectionHandoffResult,
  ResearchCollectionItemSearchFilters,
  ResearchCollectionItemSearchResult,
  ResearchCollectionJobListResult,
  ResearchCollectionJobPlanResult,
  ResearchCollectionMetricsResult,
  ResearchGameListResult,
  ResearchGameMetricsResult,
  ResearchIngestResult,
  ResearchOverview,
  ResearchReviewSearchFilters,
  ResearchReviewSearchResult,
  ResearchSentimentSeriesResult,
} from "../domain/types";

export function normalizeResearchReviewFilters(filters: ResearchReviewSearchFilters = {}) {
  return {
    source: String(filters.source ?? "steam").trim() || "steam",
    gameKey: String(filters.gameKey ?? "").trim(),
    sentiment: String(filters.sentiment ?? "").trim().toLowerCase(),
    language: String(filters.language ?? "").trim(),
    search: String(filters.search ?? "").trim(),
    limit: Math.max(1, Math.min(200, Number(filters.limit ?? 50) || 50)),
    offset: Math.max(0, Number(filters.offset ?? 0) || 0),
  };
}

export function ingestSteamResearchCache(cwd: string) {
  return invoke<ResearchIngestResult>("research_storage_ingest_steam_cache", { cwd });
}

export function loadResearchOverview(cwd: string) {
  return invoke<ResearchOverview>("research_storage_overview", { cwd });
}

export function searchResearchReviews(cwd: string, filters: ResearchReviewSearchFilters = {}) {
  const normalized = normalizeResearchReviewFilters(filters);
  return invoke<ResearchReviewSearchResult>("research_storage_query_reviews", {
    cwd,
    source: normalized.source,
    gameKey: normalized.gameKey,
    sentiment: normalized.sentiment,
    language: normalized.language,
    search: normalized.search,
    limit: normalized.limit,
    offset: normalized.offset,
  });
}

export function listResearchGames(cwd: string, source = "steam") {
  return invoke<ResearchGameListResult>("research_storage_list_games", { cwd, source });
}

export function loadResearchGameMetrics(cwd: string, source = "steam") {
  return invoke<ResearchGameMetricsResult>("research_storage_game_metrics", { cwd, source });
}

export function loadResearchSentimentSeries(cwd: string, gameKey: string, source = "steam", limit = 90) {
  return invoke<ResearchSentimentSeriesResult>("research_storage_sentiment_series", {
    cwd,
    gameKey,
    source,
    limit,
  });
}

export function normalizeDynamicCollectionUrls(urls: string[]) {
  return [...new Set(urls.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 24);
}

export function normalizeDynamicCollectionKeywords(keywords: string[] = []) {
  return [...new Set(keywords.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 12);
}

export function normalizeResearchCollectionItemFilters(filters: ResearchCollectionItemSearchFilters = {}) {
  return {
    jobId: String(filters.jobId ?? "").trim(),
    sourceType: String(filters.sourceType ?? "").trim(),
    verificationStatus: String(filters.verificationStatus ?? "").trim(),
    search: String(filters.search ?? "").trim(),
    limit: Math.max(1, Math.min(200, Number(filters.limit ?? 50) || 50)),
    offset: Math.max(0, Number(filters.offset ?? 0) || 0),
  };
}

export function planDynamicResearchCollectionJob(
  cwd: string,
  params: {
    urls: string[];
    keywords?: string[];
    label?: string;
    requestedSourceType?: string;
    maxItems?: number;
  },
) {
  return invoke<ResearchCollectionJobPlanResult>("research_storage_plan_dynamic_job", {
    cwd,
    urls: normalizeDynamicCollectionUrls(params.urls),
    keywords: normalizeDynamicCollectionKeywords(params.keywords ?? []),
    label: String(params.label ?? "").trim(),
    requestedSourceType: String(params.requestedSourceType ?? "auto").trim() || "auto",
    maxItems: Math.max(1, Math.min(120, Number(params.maxItems ?? 40) || 40)),
  });
}

export function listDynamicResearchCollectionJobs(cwd: string) {
  return invoke<ResearchCollectionJobListResult>("research_storage_list_jobs", { cwd });
}

export function loadDynamicResearchCollectionJob(cwd: string, jobId: string) {
  return invoke<ResearchCollectionJobPlanResult>("research_storage_load_job", { cwd, jobId });
}

export function buildDynamicResearchCollectionHandoff(cwd: string, jobId: string, agentRole = "researcher") {
  return invoke<ResearchCollectionHandoffResult>("research_storage_build_job_handoff", {
    cwd,
    jobId,
    agentRole,
  });
}

export function listResearchCollectionItems(cwd: string, filters: ResearchCollectionItemSearchFilters = {}) {
  const normalized = normalizeResearchCollectionItemFilters(filters);
  return invoke<ResearchCollectionItemSearchResult>("research_storage_list_collection_items", {
    cwd,
    jobId: normalized.jobId,
    sourceType: normalized.sourceType,
    verificationStatus: normalized.verificationStatus,
    search: normalized.search,
    limit: normalized.limit,
    offset: normalized.offset,
  });
}

export function loadResearchCollectionMetrics(cwd: string, jobId = "") {
  return invoke<ResearchCollectionMetricsResult>("research_storage_collection_metrics", {
    cwd,
    jobId: String(jobId ?? "").trim(),
  });
}

export function loadResearchCollectionGenreRankings(cwd: string, jobId: string) {
  return invoke<ResearchCollectionGenreRankingsResult>("research_storage_collection_genre_rankings", {
    cwd,
    jobId: String(jobId ?? "").trim(),
  });
}

export function executeDynamicResearchCollectionJob(cwd: string, jobId: string, flowId = 1) {
  return invoke<ResearchCollectionExecuteResult>("research_storage_execute_job", {
    cwd,
    jobId,
    flowId,
  });
}
