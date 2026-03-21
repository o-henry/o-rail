import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FancySelect from "../../components/FancySelect";
import FeedChart from "../../components/feed/FeedChart";
import type { FeedChartSpec } from "../../features/feed/chartSpec";
import type {
  ResearchCollectionGenreRankingRow,
  ResearchCollectionItem,
  ResearchCollectionMetricsResult,
} from "../../features/research-storage/domain/types";
import { useI18n } from "../../i18n";
import { useVisualizePageState } from "./useVisualizePageState";
import { VisualizeChartAssistantPane, type VisualizeChartAssistantLogEntry } from "./VisualizeChartAssistantPane";
import {
  chartRowsFromMarkdownFallback,
  mergeVisualizeMarkdownFallback,
  parseVisualizeMarkdownFallback,
} from "./visualizeMarkdownFallback";
import { buildVisualizeChartAssistantResult } from "./visualizeChartAssistant";
import { resolveVisualizeRailMode } from "./visualizeRailMode";
import { VisualizeWidgetFrame } from "./VisualizeWidgetFrame";
import type { VisualizeWidgetId } from "./visualizeWidgetLayout";
import type { ResearchCollectionPayload } from "./visualizeReportUtils";

type VisualizePageProps = {
  cwd: string;
  hasTauriRuntime: boolean;
  isActive: boolean;
  onOpenKnowledgeEntry?: (entryId: string) => void;
};

function shorten(label: string, limit = 14) {
  return label.length > limit ? `${label.slice(0, limit - 1)}...` : label;
}

function firstNarrativeLine(input: string) {
  return (
    input
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("```")) ?? ""
  );
}

function formatStamp(input: string) {
  return String(input ?? "").slice(0, 16).replace("T", " ") || "-";
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value)}%`;
}

export function resolveQualityScore(
  metrics: VisualizeMetrics | null | undefined,
  items: EvidenceItem[],
  markdownAvgScore: number,
) {
  const metricAvg = Number(metrics?.totals.avgScore ?? 0);
  const scoredItems = items.filter((item) => Number.isFinite(item.score) && item.score > 0);
  const evidenceAvg = scoredItems.length
    ? scoredItems.reduce((total, item) => total + item.score, 0) / scoredItems.length
    : 0;
  const totalItems = Math.max(
    0,
    Number(metrics?.totals.items ?? 0) || items.length,
  );
  const verified = Math.max(0, Number(metrics?.totals.verified ?? 0));
  const warnings = Math.max(0, Number(metrics?.totals.warnings ?? 0));
  const conflicted = Math.max(0, Number(metrics?.totals.conflicted ?? 0));
  const unresolved = Math.max(0, totalItems - verified - warnings - conflicted);
  const verificationScore = totalItems > 0
    ? ((verified * 1 + warnings * 0.55 + unresolved * 0.35) / totalItems) * 100
    : 0;
  const baseScore = metricAvg > 0 ? metricAvg : evidenceAvg;
  const blendedScore = baseScore > 0 && verificationScore > 0
    ? baseScore * 0.7 + verificationScore * 0.3
    : baseScore || verificationScore || Number(markdownAvgScore ?? 0) || 0;
  return Math.max(0, Math.min(100, Math.round(blendedScore)));
}

type VisualizeMetrics = ReturnType<typeof useVisualizePageState>["collectionMetrics"];
type EvidenceItem = NonNullable<ReturnType<typeof useVisualizePageState>["collectionItems"]>["items"][number];
type PayloadMetricsSourceRow = NonNullable<NonNullable<ResearchCollectionPayload["metrics"]>["bySourceType"]>[number];
type PayloadMetricsVerificationRow = NonNullable<NonNullable<ResearchCollectionPayload["metrics"]>["byVerificationStatus"]>[number];
type PayloadMetricsTimelineRow = NonNullable<NonNullable<ResearchCollectionPayload["metrics"]>["timeline"]>[number];
type PayloadMetricsTopSourceRow = NonNullable<NonNullable<ResearchCollectionPayload["metrics"]>["topSources"]>[number];
type PayloadGenreRankingRow = NonNullable<NonNullable<ResearchCollectionPayload["genreRankings"]>["popular"]>[number];
type PayloadItemRow = NonNullable<NonNullable<ResearchCollectionPayload["items"]>["items"]>[number];

function parseUrlHost(input: string) {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesAllowedDomain(host: string, allowedDomains: string[]) {
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function filterEvidenceItems(items: EvidenceItem[], allowedDomains: string[], shouldFilter: boolean) {
  if (!shouldFilter || allowedDomains.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const host = parseUrlHost(item.url);
    return host ? matchesAllowedDomain(host, allowedDomains) : false;
  });
}

function buildMetricsFromItems(jobId: string, items: EvidenceItem[]): NonNullable<VisualizeMetrics> {
  const bySourceType = new Map<string, { itemCount: number; avgScore: number; avgHotScore: number }>();
  const byVerificationStatus = new Map<string, number>();
  const timeline = new Map<string, number>();
  const topSources = new Map<string, number>();
  let scoreTotal = 0;
  let verified = 0;
  let warnings = 0;
  let conflicted = 0;

  for (const item of items) {
    const sourceRow = bySourceType.get(item.sourceType) ?? { itemCount: 0, avgScore: 0, avgHotScore: 0 };
    sourceRow.itemCount += 1;
    sourceRow.avgScore += item.score;
    sourceRow.avgHotScore += item.hotScore;
    bySourceType.set(item.sourceType, sourceRow);

    byVerificationStatus.set(item.verificationStatus, (byVerificationStatus.get(item.verificationStatus) ?? 0) + 1);
    topSources.set(item.sourceName, (topSources.get(item.sourceName) ?? 0) + 1);
    const bucket = String(item.publishedAt || item.fetchedAt || "").slice(0, 10);
    if (bucket) {
      timeline.set(bucket, (timeline.get(bucket) ?? 0) + 1);
    }
    if (item.verificationStatus === "verified") {
      verified += 1;
    } else if (item.verificationStatus === "warning") {
      warnings += 1;
    } else if (item.verificationStatus === "conflicted") {
      conflicted += 1;
    }
    scoreTotal += item.score;
  }

  return {
    dbPath: "",
    jobId,
    totals: {
      items: items.length,
      sources: topSources.size,
      verified,
      warnings,
      conflicted,
      avgScore: items.length ? scoreTotal / items.length : 0,
      avgHotScore: 0,
    },
    bySourceType: [...bySourceType.entries()].map(([sourceType, row]) => ({
      sourceType,
      itemCount: row.itemCount,
      avgScore: row.itemCount ? row.avgScore / row.itemCount : 0,
      avgHotScore: row.itemCount ? row.avgHotScore / row.itemCount : 0,
    })),
    byVerificationStatus: [...byVerificationStatus.entries()].map(([verificationStatus, itemCount]) => ({
      verificationStatus,
      itemCount,
    })),
    timeline: [...timeline.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bucketDate, itemCount]) => ({ bucketDate, itemCount })),
    topSources: [...topSources.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([sourceName, itemCount]) => ({ sourceName, itemCount })),
  };
}

function hasMetricsData(metrics: VisualizeMetrics | null | undefined) {
  if (!metrics) {
    return false;
  }
  return (
    (metrics.totals.items ?? 0) > 0
    || (metrics.topSources?.length ?? 0) > 0
    || (metrics.timeline?.length ?? 0) > 0
    || (metrics.byVerificationStatus?.length ?? 0) > 0
    || (metrics.bySourceType?.length ?? 0) > 0
  );
}

function hasGenreRankingData(rankings: ReturnType<typeof useVisualizePageState>["collectionGenreRankings"] | null | undefined) {
  if (!rankings) {
    return false;
  }
  return (rankings.popular?.length ?? 0) > 0 || (rankings.quality?.length ?? 0) > 0;
}

function toPayloadMetrics(payload: ResearchCollectionPayload | null): ResearchCollectionMetricsResult | null {
  if (!payload?.metrics) {
    return null;
  }
  return {
    dbPath: "",
    jobId: String(payload.planned?.job?.jobId ?? payload.metrics.jobId ?? "").trim(),
    totals: {
      items: Number(payload.metrics.totals?.items ?? 0),
      sources: Number(payload.metrics.totals?.sources ?? 0),
      verified: Number(payload.metrics.totals?.verified ?? 0),
      warnings: Number(payload.metrics.totals?.warnings ?? 0),
      conflicted: Number(payload.metrics.totals?.conflicted ?? 0),
      avgScore: Number(payload.metrics.totals?.avgScore ?? 0),
      avgHotScore: Number(payload.metrics.totals?.avgHotScore ?? 0),
    },
    bySourceType: (payload.metrics.bySourceType ?? []).map((row: PayloadMetricsSourceRow) => ({
      sourceType: String(row.sourceType ?? ""),
      itemCount: Number(row.itemCount ?? 0),
      avgScore: Number(row.avgScore ?? 0),
      avgHotScore: Number(row.avgHotScore ?? 0),
    })),
    byVerificationStatus: (payload.metrics.byVerificationStatus ?? []).map((row: PayloadMetricsVerificationRow) => ({
      verificationStatus: String(row.verificationStatus ?? ""),
      itemCount: Number(row.itemCount ?? 0),
    })),
    timeline: (payload.metrics.timeline ?? []).map((row: PayloadMetricsTimelineRow) => ({
      bucketDate: String(row.bucketDate ?? ""),
      itemCount: Number(row.itemCount ?? 0),
    })),
    topSources: (payload.metrics.topSources ?? []).map((row: PayloadMetricsTopSourceRow) => ({
      sourceName: String(row.sourceName ?? ""),
      itemCount: Number(row.itemCount ?? 0),
    })),
  };
}

function toPayloadGenreRankings(payload: ResearchCollectionPayload | null) {
  if (!payload?.genreRankings) {
    return null;
  }
  return {
    dbPath: "",
    jobId: String(payload.planned?.job?.jobId ?? payload.genreRankings.jobId ?? "").trim(),
    popular: (payload.genreRankings.popular ?? []).map((row: PayloadGenreRankingRow): ResearchCollectionGenreRankingRow => ({
      genreKey: String(row.genreKey ?? ""),
      genreLabel: String(row.genreLabel ?? ""),
      rank: Number(row.rank ?? 0),
      evidenceCount: 0,
      verifiedCount: 0,
      sourceDiversity: 0,
      avgScore: 0,
      avgHotScore: 0,
      popularityScore: Number(row.popularityScore ?? 0),
      qualityScore: Number(row.qualityScore ?? 0),
      sourceNames: [],
      representativeTitles: row.representativeTitles ?? [],
      generatedAt: "",
    })),
    quality: (payload.genreRankings.quality ?? []).map((row: PayloadGenreRankingRow): ResearchCollectionGenreRankingRow => ({
      genreKey: String(row.genreKey ?? ""),
      genreLabel: String(row.genreLabel ?? ""),
      rank: Number(row.rank ?? 0),
      evidenceCount: 0,
      verifiedCount: 0,
      sourceDiversity: 0,
      avgScore: 0,
      avgHotScore: 0,
      popularityScore: Number(row.popularityScore ?? 0),
      qualityScore: Number(row.qualityScore ?? 0),
      sourceNames: [],
      representativeTitles: row.representativeTitles ?? [],
      generatedAt: "",
    })),
  };
}

function toPayloadItems(payload: ResearchCollectionPayload | null): EvidenceItem[] {
  return (payload?.items?.items ?? []).map((row: PayloadItemRow, index: number): ResearchCollectionItem => ({
    itemFactId: String(row.itemFactId ?? `payload-item-${index}`),
    jobId: String(payload?.planned?.job?.jobId ?? ""),
    jobRunId: "",
    viaRunId: "",
    sourceType: String(row.sourceType ?? "source.community"),
    sourceName: String(row.sourceName ?? ""),
    country: "",
    adapter: "",
    itemKey: String(row.url ?? row.title ?? `payload-item-${index}`),
    sourceItemId: "",
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    verificationStatus: String(row.verificationStatus ?? ""),
    score: Number(row.score ?? 0),
    hotScore: 0,
    contentExcerpt: String(row.summary ?? ""),
    fetchedAt: String(row.fetchedAt ?? ""),
    publishedAt: String(row.publishedAt ?? ""),
    summary: String(row.summary ?? ""),
    sourceCount: 1,
    rawExportPath: "",
  }));
}

function withoutChartTitle(spec: FeedChartSpec | null | undefined): FeedChartSpec | null {
  if (!spec) {
    return null;
  }
  return { ...spec, title: "" };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function VisualizePage({ cwd, hasTauriRuntime, isActive, onOpenKnowledgeEntry }: VisualizePageProps) {
  const { t } = useI18n();
  const state = useVisualizePageState({ cwd, hasTauriRuntime, isActive });
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<VisualizeWidgetId | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedReportDocumentKind, setSelectedReportDocumentKind] = useState<"report" | "collection">("report");
  const [chartAssistantOpen, setChartAssistantOpen] = useState(false);
  const [chartAssistantBusy, setChartAssistantBusy] = useState(false);
  const [chartAssistantDraft, setChartAssistantDraft] = useState("");
  const [chartAssistantLogs, setChartAssistantLogs] = useState<VisualizeChartAssistantLogEntry[]>([]);
  const [manualChartSpec, setManualChartSpec] = useState<FeedChartSpec | null>(null);
  const [manualChartTitle, setManualChartTitle] = useState("");
  const railMode = resolveVisualizeRailMode({ historyOpen, chartAssistantOpen });
  const isRailOpen = railMode !== "closed";
  const mainRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement | null>(null);

  const reportBody = state.reportMarkdown || state.collectionMarkdown;
  const reportJobId = String(state.collectionPayload?.planned?.job?.jobId ?? "").trim();
  const reportJob = state.collectionPayload?.planned?.job;
  const collectionMarkdownFallback = useMemo(
    () => parseVisualizeMarkdownFallback(state.collectionMarkdown),
    [state.collectionMarkdown],
  );
  const reportMarkdownFallback = useMemo(
    () => parseVisualizeMarkdownFallback(state.reportMarkdown),
    [state.reportMarkdown],
  );
  const markdownFallback = useMemo(
    () => mergeVisualizeMarkdownFallback(collectionMarkdownFallback, reportMarkdownFallback),
    [collectionMarkdownFallback, reportMarkdownFallback],
  );
  const payloadMetrics = useMemo(() => toPayloadMetrics(state.collectionPayload), [state.collectionPayload]);
  const payloadGenreRankings = useMemo(() => toPayloadGenreRankings(state.collectionPayload), [state.collectionPayload]);
  const payloadItems = useMemo(() => toPayloadItems(state.collectionPayload), [state.collectionPayload]);
  const autoSpec = state.collectionPayload?.reportSpec;
  const questionType = autoSpec?.questionType || "topic_research";
  const allowedDomains = reportJob?.sourceOptions?.allowed_domains ?? reportJob?.domains ?? [];
  const shouldFilterEvidence = Boolean(reportJob?.sourceOptions?.strict_domain_isolation || questionType === "genre_ranking");
  const resolvedCollectionMetrics = hasMetricsData(state.collectionMetrics) ? state.collectionMetrics : payloadMetrics;
  const resolvedCollectionGenreRankings = hasGenreRankingData(state.collectionGenreRankings)
    ? state.collectionGenreRankings
    : payloadGenreRankings;
  const rawEvidenceItems = (state.collectionItems?.items?.length ? state.collectionItems.items : payloadItems) ?? [];
  const evidenceItems = useMemo(
    () => filterEvidenceItems(rawEvidenceItems, allowedDomains, shouldFilterEvidence),
    [allowedDomains, rawEvidenceItems, shouldFilterEvidence],
  );
  const evidenceWasFiltered = evidenceItems.length !== rawEvidenceItems.length;
  const effectiveMetrics = useMemo(
    () => (evidenceWasFiltered ? buildMetricsFromItems(reportJobId, evidenceItems) : resolvedCollectionMetrics),
    [evidenceItems, evidenceWasFiltered, reportJobId, resolvedCollectionMetrics],
  );
  const popularGenres = evidenceWasFiltered ? [] : (resolvedCollectionGenreRankings?.popular.slice(0, 5) ?? []);
  const markdownMainChart = markdownFallback.charts[0]?.chart ?? null;
  const topSources = (effectiveMetrics?.topSources.slice(0, 5) ?? []).length
    ? (effectiveMetrics?.topSources.slice(0, 5) ?? [])
    : markdownFallback.topSources.slice(0, 5);
  const qualityScore = useMemo(
    () => resolveQualityScore(effectiveMetrics, evidenceItems, markdownFallback.metrics.avgScore),
    [effectiveMetrics, evidenceItems, markdownFallback.metrics.avgScore],
  );
  const leadCopy = firstNarrativeLine(state.reportMarkdown) || firstNarrativeLine(state.collectionMarkdown) || markdownFallback.conclusions[0]?.title || "";
  const mainChartSpec = withoutChartTitle(
    manualChartSpec,
  );
  const mainChartTitle =
    manualChartTitle
    || t("visualize.chart.generic");
  const primaryListTitle =
    autoSpec?.widgets?.primaryList?.title
    || (questionType === "genre_ranking"
      ? t("visualize.list.genreSnapshots")
      : questionType === "game_comparison"
        ? t("visualize.list.comparedTitles")
        : questionType === "community_sentiment"
          ? t("visualize.list.reactionHighlights")
          : t("visualize.list.topSources"));
  const reportTitle = t("visualize.report.title");
  const evidenceTitle = t("visualize.evidence.title");
  const toolbarTitle = t("visualize.toolbar.title");
  const sessionTitle = t("visualize.widget.session");
  const qualityTitle = t("visualize.widget.quality");
  const timelineRows = useMemo(
    () => {
      const directRows = (effectiveMetrics?.timeline ?? []).map((row) => ({
        label: row.bucketDate.split("-").join("."),
        count: row.itemCount,
      }));
      if (directRows.length > 0) {
        return directRows;
      }
      return chartRowsFromMarkdownFallback(markdownMainChart);
    },
    [effectiveMetrics, markdownMainChart],
  );
  const displayEvidenceItems = evidenceItems.length > 0
    ? evidenceItems.map((item) => ({
      key: item.itemFactId,
      title: item.title || shorten(item.sourceName || item.sourceType, 32),
      verificationStatus: item.verificationStatus,
      score: item.score,
      url: item.url,
    }))
    : markdownFallback.evidence.map((item, index) => ({
      key: `fallback-evidence-${index}`,
      title: item.title || shorten(item.url || item.summary, 32),
      verificationStatus: item.verificationStatus,
      score: item.score,
      url: item.url,
    }));
  const summaryMetrics = [
    { label: t("visualize.metric.evidence"), value: effectiveMetrics?.totals.items ?? markdownFallback.metrics.items, meta: t("visualize.metric.evidence.meta") },
    { label: t("visualize.metric.verified"), value: effectiveMetrics?.totals.verified ?? markdownFallback.metrics.verified, meta: t("visualize.metric.verified.meta") },
    { label: t("visualize.metric.sources"), value: effectiveMetrics?.totals.sources ?? markdownFallback.metrics.sources, meta: t("visualize.metric.sources.meta") },
    { label: t("visualize.metric.avgScore"), value: effectiveMetrics?.totals.avgScore ?? markdownFallback.metrics.avgScore, meta: t("visualize.metric.avgScore.meta") },
    { label: t("visualize.metric.warnings"), value: effectiveMetrics?.totals.warnings ?? markdownFallback.metrics.warnings, meta: t("visualize.metric.warnings.meta") },
  ];
  const hasCollectedEvidence = (effectiveMetrics?.totals.items ?? 0) > 0 || evidenceItems.length > 0 || markdownFallback.metrics.items > 0;
  const verificationRows = (effectiveMetrics?.byVerificationStatus?.length ?? 0) > 0
    ? (effectiveMetrics?.byVerificationStatus ?? [])
    : [
      { verificationStatus: "verified", itemCount: markdownFallback.metrics.verified },
      { verificationStatus: "warning", itemCount: markdownFallback.metrics.warnings },
      { verificationStatus: "conflicted", itemCount: markdownFallback.metrics.conflicted },
    ].filter((row) => row.itemCount > 0);
  const sourceShareTotal = Math.max(effectiveMetrics?.totals.items ?? markdownFallback.metrics.items ?? 0, 1);

  const toggleMaximize = useCallback((widgetId: VisualizeWidgetId) => {
    setMaximizedWidgetId((current) => (current === widgetId ? null : widgetId));
  }, []);

  const reportDocumentOptions = useMemo(() => {
    const options: Array<{ value: "report" | "collection"; label: string }> = [];
    if (state.selectedReportRun?.reportMarkdownPath) {
      options.push({ value: "report", label: t("visualize.report.findingsDocument") });
    }
    if (state.selectedReportRun?.collectionMarkdownPath) {
      options.push({ value: "collection", label: t("visualize.report.collectionDocument") });
    }
    return options;
  }, [state.selectedReportRun?.collectionMarkdownPath, state.selectedReportRun?.reportMarkdownPath, t]);

  const selectedReportEntryId = useMemo(() => {
    if (selectedReportDocumentKind === "collection") {
      return String(state.selectedReportRun?.collectionEntryId ?? "").trim();
    }
    return String(state.selectedReportRun?.reportEntryId ?? "").trim();
  }, [selectedReportDocumentKind, state.selectedReportRun?.collectionEntryId, state.selectedReportRun?.reportEntryId]);

  useEffect(() => {
    if (reportDocumentOptions.some((option) => option.value === selectedReportDocumentKind)) {
      return;
    }
    setSelectedReportDocumentKind(reportDocumentOptions[0]?.value ?? "report");
  }, [reportDocumentOptions, selectedReportDocumentKind]);

  useEffect(() => {
    setChartAssistantBusy(false);
    setChartAssistantDraft("");
    setChartAssistantLogs([]);
    setManualChartSpec(null);
    setManualChartTitle("");
    setChartAssistantOpen(false);
  }, [state.selectedRunId]);

  const runChartAssistant = useCallback(async () => {
    const prompt = chartAssistantDraft.trim();
    if (!prompt || chartAssistantBusy) {
      return;
    }
    const result = buildVisualizeChartAssistantResult({
      prompt,
      leadCopy,
      topSources,
      timelineRows,
      popularGenres,
      verificationRows,
      markdownChart: markdownMainChart,
    });
    const requestId = `${Date.now()}`;
    setChartAssistantBusy(true);
    setChartAssistantLogs((current) => [
      ...current,
      { id: `user-${requestId}`, role: "user", text: prompt },
    ]);
    setChartAssistantDraft("");
    for (const [index, step] of result.steps.entries()) {
      await wait(120);
      setChartAssistantLogs((current) => [
        ...current,
        { id: `assistant-${requestId}-${index}`, role: "assistant", text: step },
      ]);
    }
    await wait(120);
    setManualChartSpec(result.chart ? withoutChartTitle(result.chart) : null);
    setManualChartTitle(result.title);
    setChartAssistantLogs((current) => [
      ...current,
      { id: `assistant-summary-${requestId}`, role: "assistant", text: result.summary },
    ]);
    setChartAssistantBusy(false);
  }, [
    chartAssistantBusy,
    chartAssistantDraft,
    leadCopy,
    markdownMainChart,
    popularGenres,
    timelineRows,
    topSources,
    verificationRows,
  ]);

  return (
    <section className="panel-card visualize-view workspace-tab-panel">
      <section className="visualize-monitor-shell">
        <header className="visualize-monitor-topbar">
          <div className="visualize-monitor-toolbar-copy">
            <strong>{toolbarTitle}</strong>
            <small>{t("visualize.session.emptySubcopy")}</small>
          </div>
          <div className="visualize-monitor-toolbar-actions">
            <button
              aria-label={isRailOpen ? t("visualize.history.close") : t("visualize.history.open")}
              aria-pressed={isRailOpen}
              className="visualize-monitor-toolbar-icon"
              onClick={() => {
                setChartAssistantOpen(false);
                setHistoryOpen((current) => !current);
              }}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/open-panel.svg" />
            </button>
          </div>
        </header>

        <section className="visualize-monitor-body">
          <section
            aria-busy={state.refreshing || state.detailLoading}
            className={`visualize-monitor-main${state.refreshing || state.detailLoading ? " is-updating" : ""}`}
            ref={mainRef}
          >
            {state.refreshing || state.detailLoading ? (
              <div className="visualize-monitor-loading-overlay" aria-hidden="true">
                <div className="visualize-monitor-loading-skeleton">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : null}
            <div className={`visualize-monitor-grid${maximizedWidgetId ? " has-maximized-widget" : ""}`}>
              <VisualizeWidgetFrame
                articleRef={sessionRef}
                className="is-session"
                maximized={maximizedWidgetId === "session"}
                onToggleMaximize={toggleMaximize}
                title={sessionTitle}
                widgetId="session"
              >
                {state.selectedReportRun?.title ? <h1>{state.selectedReportRun.title}</h1> : null}
                {state.reportRuns.length > 1 ? (
                  <p className="visualize-monitor-session-switch-hint">
                    {t("visualize.session.switchHint", { count: state.reportRuns.length })}
                  </p>
                ) : null}
                {state.selectedReportRun ? (
                  <p>
                    {`${formatStamp(state.selectedReportRun.updatedAt)} · ${reportJob?.label || reportJob?.resolvedSourceType || "AUTO COLLECTION"}`}
                  </p>
                ) : null}
                {state.selectedReportRun && !hasCollectedEvidence ? (
                  <p className="visualize-monitor-session-switch-hint">
                    {t("visualize.session.noData")}
                  </p>
                ) : null}
                <p className="visualize-monitor-summary-copy visualize-monitor-session-summary-copy">
                  {leadCopy || t("visualize.session.emptySummary")}
                </p>
                {markdownFallback.conclusions.length > 1 ? (
                  <div className="visualize-monitor-session-findings">
                    {markdownFallback.conclusions.slice(0, 3).map((row) => (
                      <p className="visualize-monitor-session-switch-hint" key={`${row.rank}-${row.title}`}>
                        {`${row.rank}. ${row.title}`}
                      </p>
                    ))}
                  </div>
                ) : null}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-main"
                headerActions={(
                  <button
                    aria-label={chartAssistantOpen ? "차트 생성 패널 닫기" : "차트 생성 패널 열기"}
                    className={`visualize-monitor-widget-action-button${chartAssistantOpen ? " is-active" : ""}`}
                    onClick={() => {
                      setChartAssistantOpen((current) => {
                        const next = !current;
                        if (next) {
                          setHistoryOpen(false);
                        }
                        return next;
                      });
                    }}
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src="/open-panel.svg" />
                  </button>
                )}
                maximized={maximizedWidgetId === "timeline"}
                onToggleMaximize={toggleMaximize}
                surfaceClassName="is-chart-builder-surface"
                title={mainChartTitle}
                widgetId="timeline"
              >
                <div className="visualize-chart-builder-main">
                  {mainChartSpec ? (
                    <FeedChart spec={mainChartSpec} />
                  ) : (
                    <div className="visualize-monitor-placeholder visualize-chart-builder-placeholder">
                      <div>
                        <strong>차트가 아직 없습니다.</strong>
                        <p>우측 버튼을 눌러서 차트를 생성하세요.</p>
                      </div>
                    </div>
                  )}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-quality"
                maximized={maximizedWidgetId === "quality"}
                onToggleMaximize={toggleMaximize}
                title={qualityTitle}
                widgetId="quality"
              >
                <div className="visualize-monitor-quality-panel">
                  <div className="visualize-monitor-quality-score">
                    <strong>{formatPercent(qualityScore)}</strong>
                    <span>{t("visualize.quality.avg")}</span>
                  </div>
                  <div className="visualize-monitor-quality-meter" role="presentation">
                    <span style={{ width: `${qualityScore}%` }} />
                  </div>
                  <p className="visualize-monitor-quality-copy">
                    {t("visualize.quality.copy")}
                  </p>
                  <div className="visualize-monitor-quality-legend">
                    {verificationRows.map((row) => (
                      <div
                        className={`visualize-monitor-quality-legend-row${row.verificationStatus === "verified" ? " is-verified" : ""}`}
                        key={row.verificationStatus}
                      >
                        <span>{row.verificationStatus}</span>
                        <strong>{row.itemCount}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="visualize-monitor-kpi-grid is-inline">
                    {summaryMetrics.map((metric) => (
                      <div className="visualize-monitor-kpi-item" key={metric.label}>
                        <strong>{metric.value}</strong>
                        <div className="visualize-monitor-kpi-copy">
                          <span>{metric.label}</span>
                          <small>{metric.meta}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-sources"
                maximized={maximizedWidgetId === "sources"}
                onToggleMaximize={toggleMaximize}
                surfaceClassName="is-ranked-table-surface"
                title={primaryListTitle}
                widgetId="sources"
              >
                <div className="visualize-monitor-ranked-table-head">
                  <span>{t("visualize.common.source")}</span>
                  <span>{t("visualize.common.count")}</span>
                  <span>{t("visualize.common.share")}</span>
                </div>
                <div className={`visualize-monitor-ranked-list is-table${topSources.length ? "" : " is-empty"}`}>
                  {topSources.map((source) => (
                    <div className="visualize-monitor-ranked-item is-table" key={source.sourceName}>
                      <strong>{source.sourceName || "-"}</strong>
                      <span>{source.itemCount}</span>
                      <span>{formatPercent((source.itemCount / sourceShareTotal) * 100)}</span>
                    </div>
                  ))}
                  {topSources.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.items")}</p>}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-timeline"
                maximized={maximizedWidgetId === "steam"}
                onToggleMaximize={toggleMaximize}
                surfaceClassName="is-ranked-table-surface"
                title={t("visualize.chart.collectionTimeline")}
                widgetId="steam"
              >
                <div className="visualize-monitor-ranked-table-head">
                  <span>{t("visualize.common.date")}</span>
                  <span>{t("visualize.common.count")}</span>
                </div>
                <div className={`visualize-monitor-ranked-list is-table${timelineRows.length ? "" : " is-empty"}`}>
                  {timelineRows.map((row) => (
                    <div className="visualize-monitor-ranked-item is-table" key={row.label}>
                      <strong>{row.label}</strong>
                      <span>{row.count}</span>
                    </div>
                  ))}
                  {timelineRows.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.snapshots")}</p>}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-report"
                articleRef={reportRef}
                maximized={maximizedWidgetId === "report"}
                onToggleMaximize={toggleMaximize}
                surfaceClassName="is-report-surface"
                title={reportTitle}
                widgetId="report"
              >
                {reportBody ? (
                  <div className="visualize-monitor-report-link-panel">
                    <p className="visualize-monitor-report-link-copy">
                      {t("visualize.report.databaseOnly")}
                    </p>
                    <div className="visualize-monitor-report-link-row">
                      <FancySelect
                        ariaLabel={t("visualize.report.documentPicker")}
                        className="visualize-monitor-select visualize-monitor-report-link-select"
                        dataE2e="visualize-report-document-picker"
                        onChange={(nextValue) => setSelectedReportDocumentKind(nextValue === "collection" ? "collection" : "report")}
                        options={reportDocumentOptions}
                        value={selectedReportDocumentKind}
                      />
                      <button
                        aria-label={t("visualize.report.openDatabase")}
                        className="visualize-monitor-report-link-button"
                        data-e2e="visualize-open-database"
                        disabled={!selectedReportEntryId}
                        onClick={() => {
                          if (selectedReportEntryId) {
                            onOpenKnowledgeEntry?.(selectedReportEntryId);
                          }
                        }}
                        title={t("visualize.report.openDatabase")}
                        type="button"
                      >
                        {t("visualize.report.openDatabase")}
                      </button>
                    </div>
                    <small className="visualize-monitor-report-link-meta">
                      {selectedReportDocumentKind === "collection"
                        ? (state.selectedReportRun?.collectionMarkdownPath ?? "")
                        : (state.selectedReportRun?.reportMarkdownPath ?? "")}
                    </small>
                  </div>
                ) : (
                  <p className="visualize-monitor-empty">{t("visualize.empty.report")}</p>
                )}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                articleRef={evidenceRef}
                className="is-evidence"
                maximized={maximizedWidgetId === "evidence"}
                onToggleMaximize={toggleMaximize}
                surfaceClassName="is-evidence-surface"
                title={evidenceTitle}
                widgetId="evidence"
              >
                <div className="visualize-monitor-evidence-table-head">
                  <span>{t("visualize.evidence.column.title")}</span>
                  <span>{t("visualize.evidence.column.approval")}</span>
                  <span>{t("visualize.evidence.column.score")}</span>
                  <span>{t("visualize.evidence.column.link")}</span>
                </div>
                <div className="visualize-monitor-evidence-picker">
                  {displayEvidenceItems.map((item) => (
                    <article className="visualize-monitor-evidence-row" key={item.key}>
                      <strong>{item.title}</strong>
                      <span>{item.verificationStatus}</span>
                      <span>{item.score}</span>
                      <div className="visualize-monitor-evidence-summary-cell">
                        <a href={item.url} rel="noreferrer" target="_blank">
                          {item.url}
                        </a>
                      </div>
                    </article>
                  ))}
                  {displayEvidenceItems.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.evidence")}</p>}
                </div>
              </VisualizeWidgetFrame>
            </div>
          </section>
          {isRailOpen ? (
            <aside
              className={`visualize-monitor-rail${railMode === "assistant" ? " is-assistant-open" : ""}`}
              aria-label={railMode === "assistant" ? "Chart assistant" : t("visualize.history.aria")}
            >
              {railMode === "assistant" ? (
                <VisualizeChartAssistantPane
                  busy={chartAssistantBusy}
                  draft={chartAssistantDraft}
                  logs={chartAssistantLogs}
                  onDraftChange={setChartAssistantDraft}
                  onSubmit={() => void runChartAssistant()}
                  open={chartAssistantOpen}
                  reportBody={reportBody}
                />
              ) : (
                <>
                  <header className="visualize-monitor-rail-head">
                    <strong>{t("visualize.history.title")}</strong>
                    <span>{t("visualize.session.count", { count: state.reportRuns.length })}</span>
                  </header>
                  <div className={`visualize-monitor-rail-list${state.reportRuns.length ? "" : " is-empty"}`}>
                    {state.reportRuns.length ? (
                      state.reportRuns.map((run) => {
                        const isSelected = run.runId === state.selectedRunId;
                        return (
                          <button
                            aria-label={`${run.title || run.taskId} 시각화 세션 선택`}
                            className={`visualize-monitor-rail-item${isSelected ? " is-active" : ""}`}
                            data-e2e={`visualize-history-run-${run.runId}`}
                            key={run.runId}
                            onClick={() => state.setSelectedRunId(run.runId)}
                            title={`${run.title || run.taskId} · ${formatStamp(run.updatedAt)}`}
                            type="button"
                          >
                            <strong>{run.title || run.taskId}</strong>
                            <span>{formatStamp(run.updatedAt)}</span>
                            {run.summary && run.summary.trim() !== run.title.trim() ? <p>{run.summary}</p> : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="visualize-monitor-rail-empty">{t("visualize.history.empty")}</div>
                    )}
                  </div>
                  <div className="visualize-monitor-rail-footer">
                    <button
                      aria-label={state.refreshing ? t("visualize.action.sync") : t("visualize.action.refresh")}
                      className="visualize-monitor-rail-action"
                      data-e2e="visualize-refresh"
                      disabled={state.refreshing}
                      onClick={() => void state.refreshAll()}
                      title={state.refreshing ? t("visualize.action.sync") : t("visualize.action.refresh")}
                      type="button"
                    >
                      {state.refreshing ? t("visualize.action.sync") : t("visualize.action.refresh")}
                    </button>
                  </div>
                </>
              )}
            </aside>
          ) : null}
        </section>
      </section>
    </section>
  );
}
