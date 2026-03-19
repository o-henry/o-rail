import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ResearchCollectionItemSearchResult,
  ResearchCollectionJobListItem,
  ResearchCollectionGenreRankingsResult,
  ResearchCollectionMetricsResult,
  ResearchGameMetricsResult,
  ResearchOverview,
} from "../../features/research-storage/domain/types";
import {
  executeDynamicResearchCollectionJob,
  ingestSteamResearchCache,
  listDynamicResearchCollectionJobs,
  listResearchCollectionItems,
  loadResearchCollectionMetrics,
  loadResearchCollectionGenreRankings,
  loadResearchGameMetrics,
  loadResearchOverview,
  planDynamicResearchCollectionJob,
} from "../../features/research-storage/runtime/researchStorage";
import { readKnowledgeEntries } from "../../features/studio/knowledgeIndex";
import { invoke } from "../../shared/tauri";
import {
  buildVisualizeResearchRuns,
  parseResearchCollectionPayload,
  type VisualizeResearchRun,
} from "./visualizeReportUtils";
import { useI18n } from "../../i18n";

type UseVisualizePageStateParams = {
  cwd: string;
  hasTauriRuntime: boolean;
};

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function parseLines(input: string) {
  return input.split(/\r?\n|,/g).map((value) => value.trim()).filter(Boolean);
}

function isEntryInWorkspace(entry: { sourceFile?: string; markdownPath?: string; jsonPath?: string }, cwd: string) {
  const root = String(cwd ?? "").trim();
  if (!root) {
    return true;
  }
  const candidates = [entry.sourceFile, entry.markdownPath, entry.jsonPath].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (candidates.length === 0) {
    return true;
  }
  return candidates.some((value) => value.startsWith(root));
}

export function useVisualizePageState({ cwd, hasTauriRuntime }: UseVisualizePageStateParams) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<ResearchOverview | null>(null);
  const [jobs, setJobs] = useState<ResearchCollectionJobListItem[]>([]);
  const [collectionMetrics, setCollectionMetrics] = useState<ResearchCollectionMetricsResult | null>(null);
  const [collectionGenreRankings, setCollectionGenreRankings] = useState<ResearchCollectionGenreRankingsResult | null>(null);
  const [collectionItems, setCollectionItems] = useState<ResearchCollectionItemSearchResult | null>(null);
  const [steamMetrics, setSteamMetrics] = useState<ResearchGameMetricsResult | null>(null);
  const [reportRuns, setReportRuns] = useState<VisualizeResearchRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState(""), [selectedJobId, setSelectedJobId] = useState("");
  const [reportMarkdown, setReportMarkdown] = useState(""), [collectionMarkdown, setCollectionMarkdown] = useState("");
  const [collectionPayload, setCollectionPayload] = useState<ReturnType<typeof parseResearchCollectionPayload>>(null);
  const [itemSearch, setItemSearch] = useState(""), [urlsText, setUrlsText] = useState("");
  const [keywordsText, setKeywordsText] = useState(""), [label, setLabel] = useState("");
  const [requestedSourceType, setRequestedSourceType] = useState("auto"), [maxItems, setMaxItems] = useState(40);
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false), [steamIngesting, setSteamIngesting] = useState(false);
  const [error, setError] = useState(""), [statusText, setStatusText] = useState("");

  const selectedReportRun = useMemo(() => reportRuns.find((item) => item.runId === selectedRunId) ?? null, [reportRuns, selectedRunId]);
  const reportJobId = String(collectionPayload?.planned?.job?.jobId ?? "").trim();
  const activeJobId = selectedReportRun ? reportJobId : selectedJobId;

  const syncReportRuns = useCallback(() => {
    const nextRuns = buildVisualizeResearchRuns(readKnowledgeEntries().filter((entry) => isEntryInWorkspace(entry, cwd)));
    setReportRuns(nextRuns);
    setSelectedRunId((current) => (current && nextRuns.some((row) => row.runId === current) ? current : (nextRuns[0]?.runId ?? "")));
  }, [cwd]);

  useEffect(() => {
    if (!hasTauriRuntime || !cwd.trim()) {
      setStatusText(t("visualize.status.desktopOnly"));
      return;
    }
    let cancelled = false;
    setRefreshing(true);
    setError("");
    syncReportRuns();
    void Promise.all([loadResearchOverview(cwd), listDynamicResearchCollectionJobs(cwd), loadResearchGameMetrics(cwd)])
      .then(([nextOverview, nextJobs, nextSteamMetrics]) => {
        if (cancelled) {
          return;
        }
        setOverview(nextOverview);
        setJobs(nextJobs.items);
        setSteamMetrics(nextSteamMetrics);
        setSelectedJobId((current) => (current && nextJobs.items.some((item) => item.jobId === current) ? current : (nextJobs.items[0]?.jobId ?? "")));
        setStatusText(
          t("visualize.status.storageLoaded", {
            runs: nextOverview.totals.runs,
            reviews: nextOverview.totals.reviews,
            facts: nextOverview.totals.collectionItems,
          }),
        );
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(toMessage(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, hasTauriRuntime, syncReportRuns, t]);

  useEffect(() => {
    syncReportRuns();
    const handler = () => syncReportRuns();
    window.addEventListener("rail:thread-updated", handler as EventListener);
    window.addEventListener("rail:task-updated", handler as EventListener);
    return () => {
      window.removeEventListener("rail:thread-updated", handler as EventListener);
      window.removeEventListener("rail:task-updated", handler as EventListener);
    };
  }, [syncReportRuns]);

  useEffect(() => {
    if (!hasTauriRuntime || !selectedReportRun) {
      setReportMarkdown("");
      setCollectionMarkdown("");
      setCollectionPayload(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setError("");
    void (async () => {
      try {
        const [nextReportMarkdown, nextCollectionMarkdown, nextCollectionJson] = await Promise.all([
          selectedReportRun.reportMarkdownPath ? invoke<string>("workspace_read_text", { cwd, path: selectedReportRun.reportMarkdownPath }) : Promise.resolve(""),
          selectedReportRun.collectionMarkdownPath ? invoke<string>("workspace_read_text", { cwd, path: selectedReportRun.collectionMarkdownPath }) : Promise.resolve(""),
          selectedReportRun.collectionJsonPath ? invoke<string>("workspace_read_text", { cwd, path: selectedReportRun.collectionJsonPath }) : Promise.resolve(""),
        ]);
        if (cancelled) {
          return;
        }
        setReportMarkdown(String(nextReportMarkdown ?? ""));
        setCollectionMarkdown(String(nextCollectionMarkdown ?? ""));
        setCollectionPayload(parseResearchCollectionPayload(String(nextCollectionJson ?? "")));
      } catch (nextError) {
        if (!cancelled) {
          setError(toMessage(nextError));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, hasTauriRuntime, selectedReportRun]);

  useEffect(() => {
    if (!hasTauriRuntime || !cwd.trim()) {
      return;
    }
    if (selectedReportRun && !reportJobId) {
      setCollectionMetrics(null);
      setCollectionGenreRankings(null);
      setCollectionItems(null);
      setStatusText(t("visualize.status.noCollectionJob"));
      return;
    }
    let cancelled = false;
    void Promise.all([
      loadResearchCollectionMetrics(cwd, activeJobId),
      activeJobId ? loadResearchCollectionGenreRankings(cwd, activeJobId) : Promise.resolve({ dbPath: "", jobId: "", popular: [], quality: [] }),
      listResearchCollectionItems(cwd, {
        jobId: activeJobId,
        search: itemSearch,
        limit: 24,
        offset: 0,
      }),
    ])
      .then(([nextMetrics, nextGenreRankings, nextItems]) => {
        if (cancelled) {
          return;
        }
        setCollectionMetrics(nextMetrics);
        setCollectionGenreRankings(nextGenreRankings);
        setCollectionItems(nextItems);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(toMessage(nextError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeJobId, cwd, hasTauriRuntime, itemSearch, reportJobId, selectedReportRun, t]);

  async function refreshAll(nextSelectedJobId = selectedJobId) {
    if (!hasTauriRuntime || !cwd.trim()) {
      return;
    }
    setRefreshing(true);
    setError("");
    try {
      const [nextOverview, nextJobs, nextSteamMetrics] = await Promise.all([
        loadResearchOverview(cwd),
        listDynamicResearchCollectionJobs(cwd),
        loadResearchGameMetrics(cwd),
      ]);
      setOverview(nextOverview);
      setJobs(nextJobs.items);
      setSteamMetrics(nextSteamMetrics);
      syncReportRuns();
      setSelectedJobId(nextSelectedJobId && nextJobs.items.some((item) => item.jobId === nextSelectedJobId) ? nextSelectedJobId : (nextJobs.items[0]?.jobId ?? ""));
      setStatusText(
        t("visualize.status.storageRefreshed", {
          reports: buildVisualizeResearchRuns(readKnowledgeEntries()).length,
          facts: nextOverview.totals.collectionItems,
        }),
      );
    } catch (nextError) {
      setError(toMessage(nextError));
    } finally {
      setRefreshing(false);
    }
  }

  async function runCollection() {
    if (!hasTauriRuntime || !cwd.trim()) {
      setError(t("visualize.error.collectDesktopOnly"));
      return;
    }
    const urls = parseLines(urlsText);
    const keywords = parseLines(keywordsText);
    if (urls.length === 0 && keywords.length === 0) {
      setError(t("visualize.error.requireUrlOrKeyword"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      setStatusText(t("visualize.status.planningCollection"));
      const planned = await planDynamicResearchCollectionJob(cwd, {
        urls,
        keywords,
        label,
        requestedSourceType,
        maxItems,
      });
      setStatusText(t("visualize.status.collectionRunning", { jobId: planned.job.jobId }));
      await executeDynamicResearchCollectionJob(cwd, planned.job.jobId);
      await refreshAll(planned.job.jobId);
      setStatusText(t("visualize.status.collectionDone", { label: planned.job.label }));
    } catch (nextError) {
      setError(toMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function ingestSteam() {
    if (!hasTauriRuntime || !cwd.trim()) {
      setError(t("visualize.error.steamDesktopOnly"));
      return;
    }
    setSteamIngesting(true);
    setError("");
    try {
      const result = await ingestSteamResearchCache(cwd);
      await refreshAll();
      setStatusText(t("visualize.status.steamIngestDone", { reviews: result.reviews }));
    } catch (nextError) {
      setError(toMessage(nextError));
    } finally {
      setSteamIngesting(false);
    }
  }

  return {
    activeJobId,
    busy,
    collectionItems,
    collectionGenreRankings,
    collectionMarkdown,
    collectionMetrics,
    collectionPayload,
    detailLoading,
    error,
    hasTauriRuntime,
    ingestSteam,
    itemSearch,
    jobs,
    keywordsText,
    label,
    maxItems,
    overview,
    refreshing,
    reportMarkdown,
    reportRuns,
    requestedSourceType,
    runCollection,
    selectedJobId,
    selectedReportRun,
    selectedRunId,
    setItemSearch,
    setKeywordsText,
    setLabel,
    setMaxItems,
    setRequestedSourceType,
    setSelectedJobId,
    setSelectedRunId,
    setUrlsText,
    statusText,
    steamIngesting,
    steamMetrics,
    refreshAll,
    urlsText,
  };
}
