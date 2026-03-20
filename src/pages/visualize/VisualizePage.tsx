import { useCallback, useMemo, useRef, useState } from "react";
import FeedChart from "../../components/feed/FeedChart";
import FeedDocument from "../../components/feed/FeedDocument";
import type { FeedChartSpec } from "../../features/feed/chartSpec";
import { useI18n } from "../../i18n";
import { useVisualizePageState } from "./useVisualizePageState";
import { VisualizeWidgetFrame } from "./VisualizeWidgetFrame";
import type { ResearchReportListItem } from "./visualizeReportUtils";
import type { VisualizeWidgetId } from "./visualizeWidgetLayout";

type VisualizePageProps = {
  cwd: string;
  hasTauriRuntime: boolean;
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

type VisualizeMetrics = ReturnType<typeof useVisualizePageState>["collectionMetrics"];
type EvidenceItem = NonNullable<ReturnType<typeof useVisualizePageState>["collectionItems"]>["items"][number];

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

function buildTimelineChart(spec: VisualizeMetrics): FeedChartSpec | null {
  if (!spec || spec.timeline.length === 0) {
    return null;
  }
  return {
    type: "line",
    labels: spec.timeline.map((row) => row.bucketDate.slice(5)),
    series: [{ name: "Items", data: spec.timeline.map((row) => row.itemCount), color: "#8b5cf6" }],
  };
}

function buildGenreRankingChart(
  rows: Array<{ genreLabel: string; popularityScore?: number; avgScore?: number; qualityScore?: number }>,
  metric: "popularityScore" | "avgScore" | "qualityScore",
  seriesName: string,
  color: string,
): FeedChartSpec | null {
  if (!rows.length) {
    return null;
  }
  const labels = rows.map((row) => row.genreLabel);
  const data = rows.map((row) => Math.round(Number(row[metric] ?? 0)));
  if (!data.some((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return {
    type: "bar",
    labels,
    series: [{ name: seriesName, data, color }],
  };
}

function withoutChartTitle(spec: FeedChartSpec | null | undefined): FeedChartSpec | null {
  if (!spec) {
    return null;
  }
  return { ...spec, title: "" };
}

export default function VisualizePage({ cwd, hasTauriRuntime }: VisualizePageProps) {
  const { t } = useI18n();
  const state = useVisualizePageState({ cwd, hasTauriRuntime });
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<VisualizeWidgetId | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isEvidenceCollapsed, setIsEvidenceCollapsed] = useState(true);
  const mainRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement | null>(null);

  const reportBody = state.reportMarkdown || state.collectionMarkdown;
  const reportJobId = String(state.collectionPayload?.planned?.job?.jobId ?? "").trim();
  const reportJob = state.collectionPayload?.planned?.job;
  const autoSpec = state.collectionPayload?.reportSpec;
  const questionType = autoSpec?.questionType || "topic_research";
  const allowedDomains = reportJob?.sourceOptions?.allowed_domains ?? reportJob?.domains ?? [];
  const shouldFilterEvidence = Boolean(reportJob?.sourceOptions?.strict_domain_isolation || questionType === "genre_ranking");
  const rawEvidenceItems = state.collectionItems?.items ?? [];
  const evidenceItems = useMemo(
    () => filterEvidenceItems(rawEvidenceItems, allowedDomains, shouldFilterEvidence),
    [allowedDomains, rawEvidenceItems, shouldFilterEvidence],
  );
  const evidenceWasFiltered = evidenceItems.length !== rawEvidenceItems.length;
  const effectiveMetrics = useMemo(
    () => (evidenceWasFiltered ? buildMetricsFromItems(reportJobId, evidenceItems) : state.collectionMetrics),
    [evidenceItems, evidenceWasFiltered, reportJobId, state.collectionMetrics],
  );
  const popularGenres = evidenceWasFiltered ? [] : (state.collectionGenreRankings?.popular.slice(0, 5) ?? []);
  const topSources = effectiveMetrics?.topSources.slice(0, 5) ?? [];
  const timelineChart = buildTimelineChart(effectiveMetrics);
  const popularGenreChart = buildGenreRankingChart(popularGenres, "popularityScore", "Popularity", "#0f172a");
  const qualityScore = Math.max(0, Math.min(100, Math.round(effectiveMetrics?.totals.avgScore ?? 0)));
  const leadCopy = firstNarrativeLine(state.reportMarkdown) || firstNarrativeLine(state.collectionMarkdown);
  const mainChartSpec = withoutChartTitle(
    autoSpec?.widgets
      ? (autoSpec.widgets.mainChart?.chart ?? null)
      : questionType === "genre_ranking"
        ? popularGenreChart
        : timelineChart,
  );
  const mainChartTitle =
    autoSpec?.widgets?.mainChart?.title
    || (questionType === "genre_ranking"
      ? t("visualize.chart.popularGenres")
      : questionType === "game_comparison"
        ? t("visualize.chart.comparisonSignals")
        : questionType === "community_sentiment"
          ? t("visualize.chart.reactionTimeline")
          : t("visualize.chart.generic"));
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
  const allowGenericFallbackLists = !autoSpec?.widgets || questionType === "topic_research";
  const timelineRows = useMemo(
    () =>
      (effectiveMetrics?.timeline ?? []).map((row) => ({
        label: row.bucketDate.split("-").join("."),
        count: row.itemCount,
      })),
    [effectiveMetrics],
  );
  const primaryListItems: ResearchReportListItem[] =
    (autoSpec?.widgets?.primaryList?.items?.length
      ? autoSpec.widgets.primaryList.items
      : null)
    ?? (popularGenres.length
      ? popularGenres.map((genre) => ({
          title: `${genre.rank}. ${genre.genreLabel}`,
          detail: `${t("visualize.common.avgScore")} ${Math.round(genre.avgScore)} · ${genre.representativeTitles.slice(0, 2).join(" · ") || t("visualize.common.representativesPending")}`,
          badge: `P ${Math.round(genre.popularityScore)} · E ${genre.evidenceCount}`,
        }))
      : allowGenericFallbackLists
        ? topSources.map((source) => ({
            title: source.sourceName,
            detail: t("visualize.common.primarySource"),
            badge: t("visualize.common.itemCount", { count: source.itemCount }),
          }))
        : []);
  const summaryMetrics = [
    { label: t("visualize.metric.evidence"), value: effectiveMetrics?.totals.items ?? 0, meta: t("visualize.metric.evidence.meta") },
    { label: t("visualize.metric.verified"), value: effectiveMetrics?.totals.verified ?? 0, meta: t("visualize.metric.verified.meta") },
    { label: t("visualize.metric.sources"), value: effectiveMetrics?.totals.sources ?? 0, meta: t("visualize.metric.sources.meta") },
    { label: t("visualize.metric.avgScore"), value: effectiveMetrics?.totals.avgScore ?? 0, meta: t("visualize.metric.avgScore.meta") },
    { label: t("visualize.metric.warnings"), value: effectiveMetrics?.totals.warnings ?? 0, meta: t("visualize.metric.warnings.meta") },
  ];

  const toggleMaximize = useCallback((widgetId: VisualizeWidgetId) => {
    setMaximizedWidgetId((current) => (current === widgetId ? null : widgetId));
  }, []);

  return (
    <section className="panel-card visualize-view workspace-tab-panel">
      <section className="visualize-monitor-shell">
        <header className="visualize-monitor-topbar">
          <div className="visualize-monitor-toolbar-copy">
            <strong>{toolbarTitle}</strong>
          </div>
          <div className="visualize-monitor-toolbar-actions">
            <button
              aria-label={historyOpen ? t("visualize.history.close") : t("visualize.history.open")}
              aria-pressed={historyOpen}
              className="visualize-monitor-toolbar-icon"
              onClick={() => setHistoryOpen((current) => !current)}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/open-panel.svg" />
            </button>
          </div>
        </header>

        <section className="visualize-monitor-body">
          <section className="visualize-monitor-main" ref={mainRef}>
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
                {state.reportRuns.length ? (
                  <div className="visualize-monitor-session-row">
                    <span>{t("visualize.session.count", { count: state.reportRuns.length })}</span>
                    <select onChange={(event) => state.setSelectedRunId(event.currentTarget.value)} value={state.selectedRunId}>
                      {state.reportRuns.map((run) => (
                        <option key={run.runId} value={run.runId}>
                          {run.title || run.taskId}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <p>
                  {state.selectedReportRun
                    ? `${formatStamp(state.selectedReportRun.updatedAt)} · ${reportJob?.label || reportJob?.resolvedSourceType || "AUTO COLLECTION"}`
                    : t("visualize.session.emptySubcopy")}
                </p>
                <p className="visualize-monitor-summary-copy">
                  {leadCopy || t("visualize.session.emptySummary")}
                </p>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-main"
                maximized={maximizedWidgetId === "timeline"}
                onToggleMaximize={toggleMaximize}
                title={mainChartTitle}
                widgetId="timeline"
              >
                {mainChartSpec ? (
                  <>
                    <FeedChart spec={mainChartSpec} />
                  </>
                ) : <div className="visualize-monitor-placeholder">{t("visualize.placeholder.timeline")}</div>}
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
                    {(effectiveMetrics?.byVerificationStatus ?? []).map((row) => (
                      <div className="visualize-monitor-quality-legend-row" key={row.verificationStatus}>
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
                title={primaryListTitle}
                widgetId="sources"
              >
                <div className="visualize-monitor-ranked-list">
                  {primaryListItems.map((item, index) => (
                    <div className="visualize-monitor-ranked-item" key={`${item.title || "item"}-${index}`}>
                      <div className="visualize-monitor-ranked-item-copy">
                        <strong>{item.title || "-"}</strong>
                        <p>{item.detail || "-"}</p>
                      </div>
                      <span>{item.badge || "-"}</span>
                    </div>
                  ))}
                  {primaryListItems.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.items")}</p>}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-timeline"
                maximized={maximizedWidgetId === "steam"}
                onToggleMaximize={toggleMaximize}
                title={t("visualize.chart.collectionTimeline")}
                widgetId="steam"
              >
                <div className="visualize-monitor-ranked-table">
                  <div className="visualize-monitor-ranked-table-head">
                    <span>{t("visualize.common.date")}</span>
                    <span>{t("visualize.common.count")}</span>
                    <span>{t("visualize.common.share")}</span>
                  </div>
                  <div className="visualize-monitor-ranked-list is-table">
                    {timelineRows.map((row) => (
                      <div className="visualize-monitor-ranked-item is-table" key={row.label}>
                        <strong>{row.label}</strong>
                        <span>{row.count}</span>
                        <span>{formatPercent((row.count / Math.max(effectiveMetrics?.totals.items ?? 0, 1)) * 100)}</span>
                      </div>
                    ))}
                    {timelineRows.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.snapshots")}</p>}
                  </div>
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-report"
                articleRef={reportRef}
                maximized={maximizedWidgetId === "report"}
                onToggleMaximize={toggleMaximize}
                title={reportTitle}
                widgetId="report"
              >
                {reportBody ? (
                  <FeedDocument className="visualize-monitor-document" text={reportBody} />
                ) : (
                  <p className="visualize-monitor-empty">{t("visualize.empty.report")}</p>
                )}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                articleRef={evidenceRef}
                className="is-evidence"
                headerActions={(
                  <button
                    aria-label={isEvidenceCollapsed ? t("visualize.evidence.expand") : t("visualize.evidence.collapse")}
                    className="visualize-monitor-widget-toggle"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsEvidenceCollapsed((current) => !current);
                    }}
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src={isEvidenceCollapsed ? "/down-arrow.svg" : "/up-arrow.svg"} />
                  </button>
                )}
                maximized={maximizedWidgetId === "evidence"}
                onToggleMaximize={toggleMaximize}
                title={evidenceTitle}
                widgetId="evidence"
              >
                {isEvidenceCollapsed ? null : (
                  <div className="visualize-monitor-evidence-table">
                    <div className="visualize-monitor-evidence-table-head">
                      <span>{t("visualize.evidence.column.title")}</span>
                      <span>{t("visualize.evidence.column.approval")}</span>
                      <span>{t("visualize.evidence.column.score")}</span>
                      <span>{t("visualize.evidence.column.link")}</span>
                    </div>
                    <div className="visualize-monitor-evidence-picker">
                      {evidenceItems.map((item) => (
                        <article className="visualize-monitor-evidence-row" key={item.itemFactId}>
                          <strong>{item.title || shorten(item.sourceName || item.sourceType, 32)}</strong>
                          <span>{item.verificationStatus}</span>
                          <span>{item.score}</span>
                          <div className="visualize-monitor-evidence-summary-cell">
                            <a href={item.url} rel="noreferrer" target="_blank">
                              {item.url}
                            </a>
                          </div>
                        </article>
                      ))}
                      {evidenceItems.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.evidence")}</p>}
                    </div>
                  </div>
                )}
              </VisualizeWidgetFrame>
            </div>
          </section>
          {historyOpen ? (
            <aside className="visualize-monitor-rail" aria-label={t("visualize.history.aria")}>
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
                        className={`visualize-monitor-rail-item${isSelected ? " is-active" : ""}`}
                        key={run.runId}
                        onClick={() => state.setSelectedRunId(run.runId)}
                        type="button"
                      >
                        <strong>{run.title || run.taskId}</strong>
                        <span>{formatStamp(run.updatedAt)}</span>
                        <p>{run.summary || t("visualize.history.noSummary")}</p>
                      </button>
                    );
                  })
                ) : (
                  <div className="visualize-monitor-rail-empty">{t("visualize.history.empty")}</div>
                )}
              </div>
              <div className="visualize-monitor-rail-footer">
                <button className="visualize-monitor-rail-action" disabled={state.refreshing} onClick={() => void state.refreshAll()} type="button">
                  {state.refreshing ? t("visualize.action.sync") : t("visualize.action.refresh")}
                </button>
              </div>
            </aside>
          ) : null}
        </section>
      </section>
    </section>
  );
}
