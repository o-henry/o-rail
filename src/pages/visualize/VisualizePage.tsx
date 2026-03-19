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

function buildQualityChart(score: number): FeedChartSpec {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    type: "pie",
    title: "Quality Score",
    labels: ["Signal", "Remaining"],
    series: [{ name: "Score", data: [bounded, Math.max(0, 100 - bounded)], color: "#22c55e" }],
  };
}

export default function VisualizePage({ cwd, hasTauriRuntime, onOpenKnowledgeEntry }: VisualizePageProps) {
  const state = useVisualizePageState({ cwd, hasTauriRuntime });
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const [railHidden, setRailHidden] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  const evidenceRef = useRef<HTMLElement | null>(null);

  const sourceChart = buildSourceChart(state.collectionMetrics);
  const verificationChart = buildVerificationChart(state.collectionMetrics);
  const timelineChart = buildTimelineChart(state.collectionMetrics);
  const qualityChart = buildQualityChart(state.collectionMetrics?.totals.avgScore ?? 0);

  const reportEntryId = state.selectedReportRun?.collectionEntryId || state.selectedReportRun?.reportEntryId || "";
  const reportJob = state.collectionPayload?.planned?.job;
  const leadCopy = firstNarrativeLine(state.reportMarkdown) || firstNarrativeLine(state.collectionMarkdown);
  const evidenceItems = state.collectionItems?.items ?? [];

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
            <button className="is-active" onClick={() => focusWidget(sessionRef)} type="button">MONITOR</button>
            <button onClick={() => focusWidget(reportRef)} type="button">REPORTS</button>
            <button onClick={() => focusWidget(evidenceRef)} type="button">EVIDENCE</button>
            <button
              disabled={!reportEntryId || !onOpenKnowledgeEntry}
              onClick={() => reportEntryId && onOpenKnowledgeEntry?.(reportEntryId)}
              type="button"
            >
              DATABASE
            </button>
          </nav>

          <div className="visualize-monitor-actions">
            <button disabled={state.refreshing} onClick={() => void state.refreshAll()} type="button">
              {state.refreshing ? "SYNC" : "REFRESH"}
            </button>
            <button disabled={state.steamIngesting} onClick={() => void state.ingestSteam()} type="button">
              {state.steamIngesting ? "STEAM" : "INGEST"}
            </button>
            <button onClick={() => setRailHidden((current) => !current)} type="button">
              {railHidden ? "SHOW PANEL" : "HIDE PANEL"}
            </button>
            {reportEntryId && onOpenKnowledgeEntry ? (
              <button onClick={() => onOpenKnowledgeEntry(reportEntryId)} type="button">
                DATABASE
              </button>
            ) : null}
          </div>
        </header>

        <section className="visualize-monitor-body">
          <section className="visualize-monitor-main" ref={mainRef}>
            <div className="visualize-monitor-grid">
              <article className="visualize-monitor-widget is-session" ref={sessionRef}>
                <div className="visualize-monitor-widget-head">
                  <span>[ RESEARCH SESSION ]</span>
                  <small>{state.selectedReportRun?.taskId || "awaiting @researcher"}</small>
                </div>
                <h1>{state.selectedReportRun?.title || "Run @researcher to generate a new monitored session"}</h1>
                <p>
                  {state.selectedReportRun
                    ? `${formatStamp(state.selectedReportRun.updatedAt)} · ${reportJob?.label || reportJob?.resolvedSourceType || "AUTO COLLECTION"}`
                    : "Tasks or graph에서 @researcher로 요청하면 이 캔버스가 해당 조사 세션으로 전환됩니다."}
                </p>
                <div className="visualize-monitor-chip-row">
                  <span>{reportJob?.collectorStrategy || "planner"}</span>
                  <span>{reportJob?.resolvedSourceType || "auto"}</span>
                  <span>{state.activeJobId || "no-job"}</span>
                </div>
              </article>

              <article className="visualize-monitor-widget is-kpis">
                <div className="visualize-monitor-widget-head">
                  <span>[ SIGNAL PULSE ]</span>
                  <small>{state.activeJobId ? "FILTERED" : "GLOBAL"}</small>
                </div>
                <div className="visualize-monitor-kpi-grid">
                  <div>
                    <strong>{state.collectionMetrics?.totals.items ?? 0}</strong>
                    <span>ITEMS</span>
                  </div>
                  <div>
                    <strong>{state.collectionMetrics?.totals.verified ?? 0}</strong>
                    <span>VERIFIED</span>
                  </div>
                  <div>
                    <strong>{state.collectionMetrics?.totals.sources ?? 0}</strong>
                    <span>SOURCES</span>
                  </div>
                  <div>
                    <strong>{state.collectionMetrics?.totals.avgScore ?? 0}</strong>
                    <span>AVG SCORE</span>
                  </div>
                </div>
              </article>

              <article className="visualize-monitor-widget is-chart-main">
                <div className="visualize-monitor-widget-head">
                  <span>[ COLLECTION TIMELINE ]</span>
                  <small>{state.collectionMetrics?.timeline.length ?? 0} buckets</small>
                </div>
                {timelineChart ? <FeedChart spec={timelineChart} /> : <div className="visualize-monitor-placeholder">Timeline chart pending</div>}
              </article>

              <article className="visualize-monitor-widget is-chart-source">
                <div className="visualize-monitor-widget-head">
                  <span>[ SOURCE MIX ]</span>
                  <small>{state.collectionMetrics?.bySourceType.length ?? 0} groups</small>
                </div>
                {sourceChart ? <FeedChart spec={sourceChart} /> : <div className="visualize-monitor-placeholder">Source mix pending</div>}
              </article>

              <article className="visualize-monitor-widget is-chart-quality">
                <div className="visualize-monitor-widget-head">
                  <span>[ QUALITY SCORE ]</span>
                  <small>{state.collectionMetrics?.totals.avgScore ?? 0}</small>
                </div>
                <FeedChart spec={qualityChart} />
              </article>

              <article className="visualize-monitor-widget is-report" ref={reportRef}>
                <div className="visualize-monitor-widget-head">
                  <span>[ RESEARCH REPORT ]</span>
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
                  <span>[ EVIDENCE STREAM ]</span>
                  <small>{evidenceItems.length} rows</small>
                </div>
                <div className="visualize-monitor-evidence-picker">
                  {evidenceItems.slice(0, 6).map((item) => (
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
              </article>
            </div>
          </section>

          <aside className={`visualize-monitor-rail${railHidden ? " is-hidden" : ""}`}>
            <section className="visualize-monitor-rail-panel">
              <div className="visualize-monitor-widget-head">
                <span>[ RESEARCH CONSOLE ]</span>
                <small>{state.reportRuns.length} runs</small>
              </div>
              <p className="visualize-monitor-console-copy">
                {leadCopy || "researcher의 핵심 결론과 조사 설명이 여기에 나타납니다."}
              </p>
              <div className="visualize-monitor-console-meta">
                <div><span>RUN</span><strong>{state.selectedReportRun?.runId || "-"}</strong></div>
                <div><span>UPDATED</span><strong>{formatStamp(state.selectedReportRun?.updatedAt || "")}</strong></div>
                <div><span>STATUS</span><strong>{state.detailLoading ? "LOADING" : "READY"}</strong></div>
              </div>
            </section>

            <section className="visualize-monitor-rail-panel">
              <div className="visualize-monitor-widget-head">
                <span>[ SELECTED EVIDENCE ]</span>
                <small>{selectedEvidence?.verificationStatus || "none"}</small>
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
              ) : (
                <p className="visualize-monitor-empty">증거 행을 선택하면 상세가 여기 표시됩니다.</p>
              )}
            </section>

            <section className="visualize-monitor-rail-panel">
              <div className="visualize-monitor-widget-head">
                <span>[ RECENT SESSIONS ]</span>
                <small>{state.reportRuns.length}</small>
              </div>
              <div className="visualize-monitor-session-list">
                {state.reportRuns.map((run) => (
                  <button
                    className={`visualize-monitor-session-item${run.runId === state.selectedRunId ? " is-active" : ""}`}
                    key={run.runId}
                    onClick={() => state.setSelectedRunId(run.runId)}
                    type="button"
                  >
                    <strong>{run.title || run.taskId}</strong>
                    <span>{run.taskId}</span>
                    <span>{formatStamp(run.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="visualize-monitor-rail-panel">
              <div className="visualize-monitor-widget-head">
                <span>[ DATA BRIEF ]</span>
                <small>{state.activeJobId || "no-job"}</small>
              </div>
              {verificationChart ? <FeedChart spec={verificationChart} /> : null}
              {state.collectionMarkdown ? (
                <FeedDocument className="visualize-monitor-document is-compact" text={state.collectionMarkdown} />
              ) : (
                <p className="visualize-monitor-empty">No research_collection.md for this run yet.</p>
              )}
            </section>

            <details className="visualize-monitor-drawer">
              <summary>[ ADVANCED MANUAL COLLECTION ]</summary>
              <div className="visualize-monitor-manual">
                <label>
                  <span>URL 목록</span>
                  <textarea
                    onChange={(event) => state.setUrlsText(event.currentTarget.value)}
                    placeholder="https://store.steampowered.com/app/..."
                    rows={4}
                    value={state.urlsText}
                  />
                </label>
                <label>
                  <span>키워드</span>
                  <input
                    onChange={(event) => state.setKeywordsText(event.currentTarget.value)}
                    placeholder="roguelike, indie, replayability"
                    type="text"
                    value={state.keywordsText}
                  />
                </label>
                <label>
                  <span>라벨</span>
                  <input onChange={(event) => state.setLabel(event.currentTarget.value)} placeholder="Idea sweep" type="text" value={state.label} />
                </label>
                <label>
                  <span>소스 타입</span>
                  <select onChange={(event) => state.setRequestedSourceType(event.currentTarget.value)} value={state.requestedSourceType}>
                    <option value="auto">auto</option>
                    <option value="community">community</option>
                    <option value="critic">critic</option>
                    <option value="news">news</option>
                    <option value="dev">dev</option>
                    <option value="market">market</option>
                    <option value="sns">sns</option>
                  </select>
                </label>
                <label>
                  <span>최대 item</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      state.setMaxItems(Math.max(1, Math.min(120, Number(event.currentTarget.value.replace(/[^\d]/g, "")) || 40)))
                    }
                    pattern="[0-9]*"
                    type="text"
                    value={String(state.maxItems)}
                  />
                </label>
                <button disabled={state.busy || !hasTauriRuntime} onClick={() => void state.runCollection()} type="button">
                  {state.busy ? "수집 실행 중..." : "수집 실행"}
                </button>
              </div>
            </details>
          </aside>
        </section>
      </section>
    </section>
  );
}
