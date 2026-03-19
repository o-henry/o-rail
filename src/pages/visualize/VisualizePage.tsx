import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FeedChart from "../../components/feed/FeedChart";
import FeedDocument from "../../components/feed/FeedDocument";
import type { FeedChartSpec } from "../../features/feed/chartSpec";
import { useVisualizePageState } from "./useVisualizePageState";

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
    type: "bar",
    title: "Source Mix",
    labels: spec.bySourceType.map((row) => shorten(row.sourceType.replace("source.", ""))),
    series: [{ name: "Items", data: spec.bySourceType.map((row) => row.itemCount), color: "#f87171" }],
  };
}

function buildVerificationChart(spec: ReturnType<typeof useVisualizePageState>["collectionMetrics"]): FeedChartSpec | null {
  if (!spec || spec.byVerificationStatus.length === 0) {
    return null;
  }
  return {
    type: "pie",
    title: "Verification",
    labels: spec.byVerificationStatus.map((row) => row.verificationStatus),
    series: [{ name: "Items", data: spec.byVerificationStatus.map((row) => row.itemCount), color: "#a78bfa" }],
  };
}

function buildTimelineChart(spec: ReturnType<typeof useVisualizePageState>["collectionMetrics"]): FeedChartSpec | null {
  if (!spec || spec.timeline.length === 0) {
    return null;
  }
  return {
    type: "line",
    title: "Collection Timeline",
    labels: spec.timeline.map((row) => row.bucketDate.slice(5)),
    series: [{ name: "Items", data: spec.timeline.map((row) => row.itemCount), color: "#8b5cf6" }],
  };
}

export default function VisualizePage({ cwd, hasTauriRuntime, onOpenKnowledgeEntry }: VisualizePageProps) {
  const state = useVisualizePageState({ cwd, hasTauriRuntime });
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const mainRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement | null>(null);

  const sourceChart = buildSourceChart(state.collectionMetrics);
  const verificationChart = buildVerificationChart(state.collectionMetrics);
  const timelineChart = buildTimelineChart(state.collectionMetrics);
  const qualityScore = Math.max(0, Math.min(100, Math.round(state.collectionMetrics?.totals.avgScore ?? 0)));

  const reportEntryId = state.selectedReportRun?.collectionEntryId || state.selectedReportRun?.reportEntryId || "";
  const reportJob = state.collectionPayload?.planned?.job;
  const leadCopy = firstNarrativeLine(state.reportMarkdown) || firstNarrativeLine(state.collectionMarkdown);
  const evidenceItems = state.collectionItems?.items ?? [];
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

  useEffect(() => {
    if (!evidenceItems.length) {
      setSelectedEvidenceId("");
      return;
    }
    setSelectedEvidenceId((current) => (evidenceItems.some((item) => item.itemFactId === current) ? current : evidenceItems[0]?.itemFactId ?? ""));
  }, [evidenceItems]);

  const selectedEvidence = useMemo(
    () => evidenceItems.find((item) => item.itemFactId === selectedEvidenceId) ?? evidenceItems[0] ?? null,
    [evidenceItems, selectedEvidenceId],
  );

  const focusWidget = useCallback((ref: { current: HTMLElement | null }) => {
    const container = mainRef.current;
    const element = ref.current;
    if (!container || !element) {
      return;
    }
    const top = Math.max(0, element.offsetTop - 16);
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

  return (
    <section className="panel-card visualize-view workspace-tab-panel">
      <section className="visualize-monitor-shell">
        <header className="visualize-monitor-topbar">
          <div className="visualize-monitor-brand">
            <small>{state.error || state.statusText || (hasTauriRuntime ? "RAIL RESEARCH" : "Desktop Runtime Required")}</small>
            <strong>{state.selectedReportRun?.title || "Research monitor"}</strong>
          </div>

          <nav className="visualize-monitor-nav" aria-label="Visualize sections">
            <button className="is-active" onClick={() => focusWidget(sessionRef)} type="button">요약</button>
            <button onClick={() => focusWidget(reportRef)} type="button">리포트</button>
            <button onClick={() => focusWidget(evidenceRef)} type="button">근거</button>
            <button
              disabled={!reportEntryId || !onOpenKnowledgeEntry}
              onClick={() => reportEntryId && onOpenKnowledgeEntry?.(reportEntryId)}
              type="button"
            >
              원본
            </button>
          </nav>

          <div className="visualize-monitor-actions">
            <button disabled={state.refreshing} onClick={() => void state.refreshAll()} type="button">
              {state.refreshing ? "SYNC" : "새로고침"}
            </button>
            <button disabled={state.steamIngesting} onClick={() => void state.ingestSteam()} type="button">
              {state.steamIngesting ? "STEAM" : "Steam 적재"}
            </button>
            <label className="visualize-monitor-session-select">
              <span>세션</span>
              <select onChange={(event) => state.setSelectedRunId(event.currentTarget.value)} value={state.selectedRunId}>
                {state.reportRuns.map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {run.title || run.taskId}
                  </option>
                ))}
              </select>
            </label>
            {reportEntryId && onOpenKnowledgeEntry ? (
              <button onClick={() => onOpenKnowledgeEntry(reportEntryId)} type="button">
                데이터베이스
              </button>
            ) : null}
          </div>
        </header>

        <section className="visualize-monitor-body">
          <section className="visualize-monitor-main" ref={mainRef}>
            <div className="visualize-monitor-grid">
              <article className="visualize-monitor-widget is-session" ref={sessionRef}>
                <div className="visualize-monitor-widget-head">
                  <span>[ 조사 세션 ]</span>
                  <small>{state.selectedReportRun?.taskId || "awaiting @researcher"}</small>
                </div>
                <h1>{state.selectedReportRun?.title || "Run @researcher to generate a new monitored session"}</h1>
                <p>
                  {state.selectedReportRun
                    ? `${formatStamp(state.selectedReportRun.updatedAt)} · ${reportJob?.label || reportJob?.resolvedSourceType || "AUTO COLLECTION"}`
                    : "Tasks or graph에서 @researcher로 요청하면 이 캔버스가 해당 조사 세션으로 전환됩니다."}
                </p>
                <p className="visualize-monitor-summary-copy">
                  {leadCopy || "이 세션의 가장 중요한 결론이 아직 없습니다. researcher가 리포트를 작성하면 여기에 한 줄 요약이 나타납니다."}
                </p>
                <div className="visualize-monitor-chip-row">
                  <span>{reportJob?.collectorStrategy || "planner"}</span>
                  <span>{reportJob?.resolvedSourceType || "auto"}</span>
                  <span>{state.activeJobId || "no-job"}</span>
                </div>
              </article>

              <article className="visualize-monitor-widget is-kpis">
                <div className="visualize-monitor-widget-head">
                  <span>[ 핵심 지표 ]</span>
                  <small>{state.activeJobId ? "FILTERED" : "GLOBAL"}</small>
                </div>
                <div className="visualize-monitor-kpi-grid">
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
              </article>

              <article className="visualize-monitor-widget is-chart-main">
                <div className="visualize-monitor-widget-head">
                  <span>[ 수집 추세 ]</span>
                  <small>{state.collectionMetrics?.timeline.length ?? 0} buckets</small>
                </div>
                {timelineChart ? <FeedChart spec={timelineChart} /> : <div className="visualize-monitor-placeholder">Timeline chart pending</div>}
              </article>

              <article className="visualize-monitor-widget is-chart-source">
                <div className="visualize-monitor-widget-head">
                  <span>[ 소스 분포 ]</span>
                  <small>{state.collectionMetrics?.bySourceType.length ?? 0} groups</small>
                </div>
                {sourceChart ? <FeedChart spec={sourceChart} /> : <div className="visualize-monitor-placeholder">Source mix pending</div>}
              </article>

              <article className="visualize-monitor-widget is-chart-quality">
                <div className="visualize-monitor-widget-head">
                  <span>[ 검증 비율 ]</span>
                  <small>{qualityScore}</small>
                </div>
                <div className="visualize-monitor-quality-panel">
                  <div className="visualize-monitor-quality-score">
                    <strong>{formatPercent(qualityScore)}</strong>
                    <span>평균 품질 점수</span>
                  </div>
                  <div className="visualize-monitor-quality-meter" role="presentation">
                    <span style={{ width: `${qualityScore}%` }} />
                  </div>
                  <div className="visualize-monitor-quality-legend">
                    {(state.collectionMetrics?.byVerificationStatus ?? []).map((row) => (
                      <div className="visualize-monitor-quality-legend-row" key={row.verificationStatus}>
                        <span>{row.verificationStatus}</span>
                        <strong>{row.itemCount}</strong>
                      </div>
                    ))}
                    {verificationChart ? null : (
                      <>
                        <div className="visualize-monitor-quality-legend-row">
                          <span>signal</span>
                          <strong>{qualityScore}</strong>
                        </div>
                        <div className="visualize-monitor-quality-legend-row">
                          <span>remaining</span>
                          <strong>{Math.max(0, 100 - qualityScore)}</strong>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </article>

              <article className="visualize-monitor-widget is-sources">
                <div className="visualize-monitor-widget-head">
                  <span>[ 상위 소스 ]</span>
                  <small>{topSources.length}</small>
                </div>
                <div className="visualize-monitor-ranked-list">
                  {topSources.map((source) => (
                    <div className="visualize-monitor-ranked-item" key={source.sourceName}>
                      <strong>{source.sourceName}</strong>
                      <span>{source.itemCount} items</span>
                    </div>
                  ))}
                  {topSources.length ? null : <p className="visualize-monitor-empty">표시할 상위 소스가 없습니다.</p>}
                </div>
              </article>

              <article className="visualize-monitor-widget is-steam">
                <div className="visualize-monitor-widget-head">
                  <span>[ 스팀 상위 게임 ]</span>
                  <small>{topSteamGames.length}</small>
                </div>
                <div className="visualize-monitor-ranked-list">
                  {topSteamGames.map((game) => (
                    <div className="visualize-monitor-ranked-item" key={game.gameKey}>
                      <strong>{game.gameName}</strong>
                      <span>{game.totalReviews} reviews · {formatPercent(game.positiveRatio)}</span>
                    </div>
                  ))}
                  {topSteamGames.length ? null : <p className="visualize-monitor-empty">Steam 데이터가 아직 없습니다.</p>}
                </div>
              </article>

              <article className="visualize-monitor-widget is-report" ref={reportRef}>
                <div className="visualize-monitor-widget-head">
                  <span>[ 리서치 리포트 ]</span>
                  <small>{state.detailLoading ? "loading" : state.reportMarkdown ? "ready" : "empty"}</small>
                </div>
                {state.reportMarkdown ? (
                  <FeedDocument className="visualize-monitor-document" text={state.reportMarkdown} />
                ) : (
                  <p className="visualize-monitor-empty">No final researcher report for this run yet.</p>
                )}
              </article>

              <article className="visualize-monitor-widget is-evidence" ref={evidenceRef}>
                <div className="visualize-monitor-widget-head">
                  <span>[ 근거 스트림 ]</span>
                  <small>{evidenceItems.length} rows</small>
                </div>
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
                    <button
                      className={item.itemFactId === selectedEvidence?.itemFactId ? "is-active" : ""}
                      key={item.itemFactId}
                      onClick={() => setSelectedEvidenceId(item.itemFactId)}
                      type="button"
                    >
                      <strong>{item.title || shorten(item.sourceName || item.sourceType, 24)}</strong>
                      <span>{item.verificationStatus} · {item.score}</span>
                    </button>
                  ))}
                  {evidenceItems.length ? null : <p className="visualize-monitor-empty">No normalized collection items yet.</p>}
                </div>
                {selectedEvidence ? (
                  <div className="visualize-monitor-evidence-detail">
                    <strong>{selectedEvidence.title || selectedEvidence.url}</strong>
                    <div className="visualize-monitor-chip-row">
                      <span>{selectedEvidence.sourceName || selectedEvidence.sourceType}</span>
                      <span>SCORE {selectedEvidence.score}</span>
                      <span>HOT {selectedEvidence.hotScore}</span>
                    </div>
                    <p>{selectedEvidence.summary || selectedEvidence.contentExcerpt || "본문 추출 요약 없음"}</p>
                    <a href={selectedEvidence.url} rel="noreferrer" target="_blank">
                      {selectedEvidence.url}
                    </a>
                  </div>
                ) : null}
              </article>
            </div>
          </section>
        </section>
      </section>
    </section>
  );
}
