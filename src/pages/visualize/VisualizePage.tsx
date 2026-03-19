import { useCallback, useRef, useState } from "react";
import FeedChart from "../../components/feed/FeedChart";
import FeedDocument from "../../components/feed/FeedDocument";
import type { FeedChartSpec } from "../../features/feed/chartSpec";
import { useVisualizePageState } from "./useVisualizePageState";
import { VisualizeWidgetFrame } from "./VisualizeWidgetFrame";
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
  const leadCopy = firstNarrativeLine(state.reportMarkdown) || firstNarrativeLine(state.collectionMarkdown);
  const evidenceItems = state.collectionItems?.items ?? [];
  const popularGenres = state.collectionGenreRankings?.popular.slice(0, 5) ?? [];
  const qualityGenres = state.collectionGenreRankings?.quality.slice(0, 5) ?? [];
  const topSources = state.collectionMetrics?.topSources.slice(0, 5) ?? [];
  const topSteamGames = [...(state.steamMetrics?.items ?? [])]
    .sort((left, right) => right.totalReviews - left.totalReviews)
    .slice(0, 5);
  const summaryMetrics = [
    { label: "근거 수", value: state.collectionMetrics?.totals.items ?? 0, meta: "수집된 정규화 항목" },
    { label: "검증됨", value: state.collectionMetrics?.totals.verified ?? 0, meta: "확인된 근거" },
    { label: "소스 수", value: state.collectionMetrics?.totals.sources ?? 0, meta: "서로 다른 출처" },
    { label: "평균 점수", value: state.collectionMetrics?.totals.avgScore ?? 0, meta: "신호 강도" },
    { label: "경고", value: state.collectionMetrics?.totals.warnings ?? 0, meta: "주의 필요" },
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
            <span>{state.selectedReportRun?.title || "Run @researcher to create a monitored session"}</span>
          </div>
          <div className="visualize-monitor-toolbar-actions">
            <button
              aria-label={historyOpen ? "리서치 패널 닫기" : "리서치 패널 열기"}
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
                <h1>{state.selectedReportRun?.title || "Run @researcher to generate a new monitored session"}</h1>
                {state.reportRuns.length ? (
                  <div className="visualize-monitor-session-row">
                    <span>{state.reportRuns.length} research sessions</span>
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
                    : "Tasks or graph에서 @researcher로 요청하면 이 캔버스가 해당 조사 세션으로 전환됩니다."}
                </p>
                <p className="visualize-monitor-summary-copy">
                  {leadCopy || "이 세션의 가장 중요한 결론이 아직 없습니다. researcher가 리포트를 작성하면 여기에 한 줄 요약이 나타납니다."}
                </p>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-main"
                maximized={maximizedWidgetId === "timeline"}
                onToggleMaximize={toggleMaximize}
                title="COLLECTION TIMELINE"
                widgetId="timeline"
              >
                {timelineChart ? (
                  <>
                    <p className="visualize-monitor-chart-copy">수집된 근거가 날짜별로 몇 건 들어왔는지 보여줍니다.</p>
                    <FeedChart spec={timelineChart} />
                  </>
                ) : <div className="visualize-monitor-placeholder">수집 타임라인 데이터가 아직 없습니다.</div>}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-chart-source"
                maximized={maximizedWidgetId === "sourceMix"}
                onToggleMaximize={toggleMaximize}
                title="SOURCE MIX"
                widgetId="sourceMix"
              >
                {sourceChart ? (
                  <>
                    <p className="visualize-monitor-chart-copy">현재 세션에 포함된 출처 유형 비중입니다.</p>
                    <FeedChart spec={sourceChart} />
                  </>
                ) : <div className="visualize-monitor-placeholder">출처 분포 데이터가 아직 없습니다.</div>}
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
                    <span>평균 품질 점수</span>
                  </div>
                  <div className="visualize-monitor-quality-meter" role="presentation">
                    <span style={{ width: `${qualityScore}%` }} />
                  </div>
                  <p className="visualize-monitor-quality-copy">
                    평균 점수와 검증 비율을 함께 반영한 품질 신호입니다.
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
                title={popularGenres.length ? "POPULAR GENRES" : "TOP SOURCES"}
                widgetId="sources"
              >
                <div className="visualize-monitor-ranked-list">
                  {popularGenres.length
                    ? popularGenres.map((genre) => (
                        <div className="visualize-monitor-ranked-item" key={genre.genreKey}>
                          <div className="visualize-monitor-ranked-item-copy">
                            <strong>{genre.rank}. {genre.genreLabel}</strong>
                            <p>{genre.representativeTitles.slice(0, 2).join(" · ") || "대표 게임 추출 중"}</p>
                          </div>
                          <span>P {Math.round(genre.popularityScore)} · E {genre.evidenceCount}</span>
                        </div>
                      ))
                    : topSources.map((source) => (
                        <div className="visualize-monitor-ranked-item" key={source.sourceName}>
                          <strong>{source.sourceName}</strong>
                          <span>{source.itemCount}건</span>
                        </div>
                      ))}
                  {popularGenres.length || topSources.length ? null : <p className="visualize-monitor-empty">표시할 상위 소스가 없습니다.</p>}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                className="is-steam"
                maximized={maximizedWidgetId === "steam"}
                onToggleMaximize={toggleMaximize}
                title={qualityGenres.length ? "BEST RATED GENRES" : "REPRESENTATIVE TITLES"}
                widgetId="steam"
              >
                <div className="visualize-monitor-ranked-list">
                  {qualityGenres.length
                    ? qualityGenres.map((genre) => (
                        <div className="visualize-monitor-ranked-item" key={genre.genreKey}>
                          <div className="visualize-monitor-ranked-item-copy">
                            <strong>{genre.rank}. {genre.genreLabel}</strong>
                            <p>{genre.representativeTitles.slice(0, 3).join(" · ") || "대표 게임 추출 중"}</p>
                          </div>
                          <span>Q {Math.round(genre.qualityScore)} · {Math.round(genre.avgScore)}</span>
                        </div>
                      ))
                    : topSteamGames.map((game) => (
                        <div className="visualize-monitor-ranked-item" key={game.gameKey}>
                          <strong>{game.gameName}</strong>
                          <span>{game.totalReviews} reviews · {formatPercent(game.positiveRatio)}</span>
                        </div>
                      ))}
                  {qualityGenres.length || topSteamGames.length ? null : <p className="visualize-monitor-empty">표시할 스냅샷이 아직 없습니다.</p>}
                </div>
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                articleRef={reportRef}
                className="is-report"
                maximized={maximizedWidgetId === "report"}
                onToggleMaximize={toggleMaximize}
                title="RESEARCH REPORT"
                widgetId="report"
              >
                {reportBody ? (
                  <FeedDocument className="visualize-monitor-document" text={reportBody} />
                ) : (
                  <p className="visualize-monitor-empty">아직 표시할 researcher 문서가 없습니다.</p>
                )}
              </VisualizeWidgetFrame>

              <VisualizeWidgetFrame
                articleRef={evidenceRef}
                className="is-evidence"
                maximized={maximizedWidgetId === "evidence"}
                onToggleMaximize={toggleMaximize}
                title="EVIDENCE STREAM"
                widgetId="evidence"
              >
                <div className="visualize-monitor-search-row">
                  <input
                    onChange={(event) => state.setItemSearch(event.currentTarget.value)}
                    placeholder="제목, 요약, 본문 검색"
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
                      <p>{item.summary || item.contentExcerpt || "본문 추출 요약 없음"}</p>
                      <a href={item.url} rel="noreferrer" target="_blank">
                        {item.url}
                      </a>
                    </article>
                  ))}
                  {evidenceItems.length ? null : <p className="visualize-monitor-empty">아직 정규화된 근거 항목이 없습니다.</p>}
                </div>
              </VisualizeWidgetFrame>
            </div>
          </section>
          {historyOpen ? (
            <aside className="visualize-monitor-rail" aria-label="Research history">
              <header className="visualize-monitor-rail-head">
                <strong>RESEARCH DATA</strong>
                <span>{state.reportRuns.length} sessions</span>
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
                        <p>{run.summary || "요약이 아직 없습니다."}</p>
                      </button>
                    );
                  })
                ) : (
                  <div className="visualize-monitor-rail-empty">아직 생성된 리서치 세션이 없습니다.</div>
                )}
              </div>
              <div className="visualize-monitor-rail-footer">
                <button className="visualize-monitor-rail-action" disabled={state.refreshing} onClick={() => void state.refreshAll()} type="button">
                  {state.refreshing ? "SYNC" : "새로고침"}
                </button>
                <button className="visualize-monitor-rail-action" disabled={state.steamIngesting} onClick={() => void state.ingestSteam()} type="button">
                  {state.steamIngesting ? "STEAM" : "Steam 적재"}
                </button>
                {reportEntryId && onOpenKnowledgeEntry ? (
                  <button className="visualize-monitor-rail-action" onClick={() => onOpenKnowledgeEntry(reportEntryId)} type="button">
                    데이터베이스
                  </button>
                ) : null}
                <button className="visualize-monitor-rail-action subtle" onClick={() => focusWidget(reportRef)} type="button">
                  리포트로 이동
                </button>
                <button className="visualize-monitor-rail-action subtle" onClick={() => focusWidget(evidenceRef)} type="button">
                  근거로 이동
                </button>
                <button className="visualize-monitor-rail-action subtle" onClick={() => focusWidget(sessionRef)} type="button">
                  요약으로 이동
                </button>
              </div>
            </aside>
          ) : null}
        </section>
      </section>
    </section>
  );
}
