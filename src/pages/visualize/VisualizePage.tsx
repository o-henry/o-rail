import { useCallback, useRef, useState } from "react";
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

function buildSourceChart(spec: ReturnType<typeof useVisualizePageState>["collectionMetrics"]): FeedChartSpec | null {
  if (!spec || spec.bySourceType.length === 0) {
    return null;
  }
  return {
    type: "pie",
    labels: spec.bySourceType.map((row) => shorten(row.sourceType.replace("source.", ""))),
    series: [{ name: "Items", data: spec.bySourceType.map((row) => row.itemCount) }],
  };
}

function buildTimelineChart(spec: ReturnType<typeof useVisualizePageState>["collectionMetrics"]): FeedChartSpec | null {
  if (!spec || spec.timeline.length === 0) {
    return null;
  }
  return {
    type: "line",
    labels: spec.timeline.map((row) => row.bucketDate.slice(5)),
    series: [{ name: "Items", data: spec.timeline.map((row) => row.itemCount), color: "#8b5cf6" }],
  };
}

export default function VisualizePage({ cwd, hasTauriRuntime, onOpenKnowledgeEntry }: VisualizePageProps) {
  const { t } = useI18n();
  const state = useVisualizePageState({ cwd, hasTauriRuntime });
  const [maximizedWidgetId, setMaximizedWidgetId] = useState<VisualizeWidgetId | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement | null>(null);

  const sourceChart = buildSourceChart(state.collectionMetrics);
  const timelineChart = buildTimelineChart(state.collectionMetrics);
  const qualityScore = Math.max(0, Math.min(100, Math.round(state.collectionMetrics?.totals.avgScore ?? 0)));
  const reportBody = state.reportMarkdown || state.collectionMarkdown;

  const reportEntryId = state.selectedReportRun?.collectionEntryId || state.selectedReportRun?.reportEntryId || "";
  const reportJob = state.collectionPayload?.planned?.job;
  const autoSpec = state.collectionPayload?.reportSpec;
  const questionType = autoSpec?.questionType || "topic_research";
  const leadCopy = firstNarrativeLine(state.reportMarkdown) || firstNarrativeLine(state.collectionMarkdown);
  const evidenceItems = state.collectionItems?.items ?? [];
  const popularGenres = state.collectionGenreRankings?.popular.slice(0, 5) ?? [];
  const qualityGenres = state.collectionGenreRankings?.quality.slice(0, 5) ?? [];
  const topSources = state.collectionMetrics?.topSources.slice(0, 5) ?? [];
  const topSteamGames = [...(state.steamMetrics?.items ?? [])]
    .sort((left, right) => right.totalReviews - left.totalReviews)
    .slice(0, 5);
  const mainChartSpec = autoSpec?.widgets?.mainChart?.chart || timelineChart;
  const secondaryChartSpec = autoSpec?.widgets?.secondaryChart?.chart || sourceChart;
  const mainChartTitle =
    questionType === "genre_ranking"
      ? t("visualize.chart.popularGenres")
      : questionType === "game_comparison"
        ? t("visualize.chart.comparisonSignals")
        : questionType === "community_sentiment"
          ? t("visualize.chart.reactionTimeline")
          : t("visualize.chart.collectionTimeline");
  const secondaryChartTitle =
    questionType === "genre_ranking"
      ? t("visualize.chart.bestRatedGenres")
      : t("visualize.chart.sourceMix");
  const mainChartDescription =
    questionType === "genre_ranking"
      ? t("visualize.chart.popularGenres.desc")
      : questionType === "game_comparison"
        ? t("visualize.chart.comparisonSignals.desc")
        : questionType === "community_sentiment"
          ? t("visualize.chart.reactionTimeline.desc")
          : t("visualize.chart.collectionTimeline.desc");
  const secondaryChartDescription =
    questionType === "genre_ranking"
      ? t("visualize.chart.bestRatedGenres.desc")
      : t("visualize.chart.sourceMix.desc");
  const primaryListTitle =
    questionType === "genre_ranking"
      ? t("visualize.list.genreSnapshots")
      : questionType === "game_comparison"
        ? t("visualize.list.comparedTitles")
        : questionType === "community_sentiment"
          ? t("visualize.list.reactionHighlights")
          : t("visualize.list.topSources");
  const secondaryListTitle =
    questionType === "genre_ranking"
      ? t("visualize.list.representativeGames")
      : questionType === "game_comparison" || questionType === "community_sentiment"
        ? t("visualize.list.topSources")
        : t("visualize.list.representativeTitles");
  const reportTitle = t("visualize.report.title");
  const evidenceTitle = t("visualize.evidence.title");
  const primaryListItems: ResearchReportListItem[] =
    popularGenres.length
      ? popularGenres.map((genre) => ({
          title: `${genre.rank}. ${genre.genreLabel}`,
          detail: genre.representativeTitles.slice(0, 2).join(" · ") || t("visualize.common.representativesPending"),
          badge: `P ${Math.round(genre.popularityScore)} · E ${genre.evidenceCount}`,
        }))
      : topSources.map((source) => ({
          title: source.sourceName,
          detail: t("visualize.common.primarySource"),
          badge: t("visualize.common.itemCount", { count: source.itemCount }),
        }));
  const secondaryListItems: ResearchReportListItem[] =
    qualityGenres.length
      ? qualityGenres.map((genre) => ({
          title: `${genre.rank}. ${genre.genreLabel}`,
          detail: genre.representativeTitles.slice(0, 3).join(" · ") || t("visualize.common.representativesPending"),
          badge: `Q ${Math.round(genre.qualityScore)} · ${Math.round(genre.avgScore)}`,
        }))
      : topSteamGames.map((game) => ({
          title: game.gameName,
          detail: t("visualize.common.representativeGame"),
          badge: `${game.totalReviews} reviews · ${formatPercent(game.positiveRatio)}`,
        }));
  const summaryMetrics = [
    { label: t("visualize.metric.evidence"), value: state.collectionMetrics?.totals.items ?? 0, meta: t("visualize.metric.evidence.meta") },
    { label: t("visualize.metric.verified"), value: state.collectionMetrics?.totals.verified ?? 0, meta: t("visualize.metric.verified.meta") },
    { label: t("visualize.metric.sources"), value: state.collectionMetrics?.totals.sources ?? 0, meta: t("visualize.metric.sources.meta") },
    { label: t("visualize.metric.avgScore"), value: state.collectionMetrics?.totals.avgScore ?? 0, meta: t("visualize.metric.avgScore.meta") },
    { label: t("visualize.metric.warnings"), value: state.collectionMetrics?.totals.warnings ?? 0, meta: t("visualize.metric.warnings.meta") },
  ];

  const focusWidget = useCallback((ref: { current: HTMLElement | null }) => {
    const container = mainRef.current;
    const element = ref.current;
    if (!container || !element) {
      return;
    }
    const top = Math.max(0, element.offsetTop - 16);
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

  const toggleMaximize = useCallback((widgetId: VisualizeWidgetId) => {
    setMaximizedWidgetId((current) => (current === widgetId ? null : widgetId));
  }, []);

  return (
    <section className="panel-card visualize-view workspace-tab-panel">
      <section className="visualize-monitor-shell">
        <header className="visualize-monitor-topbar">
          <div className="visualize-monitor-toolbar-copy">
            <strong>RESEARCH</strong>
            <span>{state.selectedReportRun?.title || t("visualize.toolbar.empty")}</span>
          </div>
          <div className="visualize-monitor-toolbar-actions">
            <button
              aria-label={historyOpen ? t("visualize.history.close") : t("visualize.history.open")}
              aria-pressed={historyOpen}
              className="visualize-monitor-toolbar-icon"
              onClick={() => setHistoryOpen((current) => !current)}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/open.svg" />
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
                title="RESEARCH SESSION"
                widgetId="session"
              >
                <h1>{state.selectedReportRun?.title || t("visualize.session.emptyTitle")}</h1>
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
                    <p className="visualize-monitor-chart-copy">{mainChartDescription}</p>
                    <FeedChart spec={mainChartSpec} />
                  </>
                ) : <div className="visualize-monitor-placeholder">{t("visualize.placeholder.timeline")}</div>}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-source"
                maximized={maximizedWidgetId === "sourceMix"}
                onToggleMaximize={toggleMaximize}
                title={secondaryChartTitle}
                widgetId="sourceMix"
              >
                {secondaryChartSpec ? (
                  <>
                    <p className="visualize-monitor-chart-copy">{secondaryChartDescription}</p>
                    <FeedChart spec={secondaryChartSpec} />
                  </>
                ) : <div className="visualize-monitor-placeholder">{t("visualize.placeholder.sourceMix")}</div>}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-quality"
                maximized={maximizedWidgetId === "quality"}
                onToggleMaximize={toggleMaximize}
                title="QUALITY SCORE"
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
                    {(state.collectionMetrics?.byVerificationStatus ?? []).map((row) => (
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
                className="is-steam"
                maximized={maximizedWidgetId === "steam"}
                onToggleMaximize={toggleMaximize}
                title={secondaryListTitle}
                widgetId="steam"
              >
                <div className="visualize-monitor-ranked-list">
                  {secondaryListItems.map((item, index) => (
                    <div className="visualize-monitor-ranked-item" key={`${item.title || "item"}-${index}`}>
                      <div className="visualize-monitor-ranked-item-copy">
                        <strong>{item.title || "-"}</strong>
                        <p>{item.detail || "-"}</p>
                      </div>
                      <span>{item.badge || "-"}</span>
                    </div>
                  ))}
                  {secondaryListItems.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.snapshots")}</p>}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                articleRef={reportRef}
                className="is-report"
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
                maximized={maximizedWidgetId === "evidence"}
                onToggleMaximize={toggleMaximize}
                title={evidenceTitle}
                widgetId="evidence"
              >
                <div className="visualize-monitor-search-row">
                  <input
                    onChange={(event) => state.setItemSearch(event.currentTarget.value)}
                    placeholder={t("visualize.evidence.searchPlaceholder")}
                    type="search"
                    value={state.itemSearch}
                  />
                </div>
                <div className="visualize-monitor-evidence-picker">
                  {evidenceItems.map((item) => (
                    <article className="visualize-monitor-evidence-card" key={item.itemFactId}>
                      <strong>{item.title || shorten(item.sourceName || item.sourceType, 24)}</strong>
                      <div className="visualize-monitor-chip-row">
                        <span>{item.sourceName || item.sourceType}</span>
                        <span>{item.verificationStatus}</span>
                        <span>SCORE {item.score}</span>
                      </div>
                      <p>{item.summary || item.contentExcerpt || t("visualize.evidence.noSummary")}</p>
                      <a href={item.url} rel="noreferrer" target="_blank">
                        {item.url}
                      </a>
                    </article>
                  ))}
                  {evidenceItems.length ? null : <p className="visualize-monitor-empty">{t("visualize.empty.evidence")}</p>}
                </div>
              </VisualizeWidgetFrame>
            </div>
          </section>
          {historyOpen ? (
            <aside className="visualize-monitor-rail" aria-label={t("visualize.history.aria")}>
              <header className="visualize-monitor-rail-head">
                <strong>{t("visualize.history.title")}</strong>
                <span>{t("visualize.session.count", { count: state.reportRuns.length })}</span>
              </header>
              <div className="visualize-monitor-rail-list">
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
                {reportEntryId && onOpenKnowledgeEntry ? (
                  <button className="visualize-monitor-rail-action" onClick={() => onOpenKnowledgeEntry(reportEntryId)} type="button">
                    {t("visualize.action.database")}
                  </button>
                ) : null}
                <button className="visualize-monitor-rail-action subtle" onClick={() => focusWidget(reportRef)} type="button">
                  {t("visualize.action.jumpReport")}
                </button>
                <button className="visualize-monitor-rail-action subtle" onClick={() => focusWidget(evidenceRef)} type="button">
                  {t("visualize.action.jumpEvidence")}
                </button>
                <button className="visualize-monitor-rail-action subtle" onClick={() => focusWidget(sessionRef)} type="button">
                  {t("visualize.action.jumpSummary")}
                </button>
              </div>
            </aside>
          ) : null}
        </section>
      </section>
    </section>
  );
}
