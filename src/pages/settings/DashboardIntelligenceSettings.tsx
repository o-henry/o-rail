import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import {
  DASHBOARD_TOPIC_IDS,
  type DashboardAgentConfigMap,
  type DashboardTopicId,
  type DashboardTopicRunState,
  type DashboardTopicSnapshot,
} from "../../features/dashboard/intelligence";

type DashboardIntelligenceSettingsProps = {
  config: DashboardAgentConfigMap;
  runStateByTopic: Record<DashboardTopicId, DashboardTopicRunState>;
  snapshotsByTopic: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>;
  disabled?: boolean;
  onRunTopic: (topic: DashboardTopicId, followupInstruction?: string) => void;
  briefingDocuments: Array<{
    id: string;
    runId: string;
    summary: string;
    sourceFile: string;
    agentName: string;
    createdAt: string;
    isFinalDocument?: boolean;
    status?: string;
  }>;
  onOpenBriefingDocument: (runId: string, postId?: string) => void;
};

type DashboardTopicStatusTone = "running" | "error" | "done" | "done-risk" | "idle";

type DashboardTopicStatusInfo = {
  label: string;
  tone: DashboardTopicStatusTone;
};

function hasHangulText(value: string): boolean {
  return /[가-힣]/.test(value);
}

function toKoreanRiskText(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "-";
  }
  if (hasHangulText(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("empty codex response")) {
    return "Codex 응답이 비어 있어 스니펫 기반 대체 요약으로 처리되었습니다.";
  }
  if (lower.includes("raw files not found")) {
    return "수집된 원문 파일을 찾지 못했습니다.";
  }
  if (lower.includes("knowledge probe returned no valid files")) {
    return "RAG에 사용할 유효한 원문 파일이 없습니다.";
  }
  if (lower.includes("rag snippet was empty")) {
    return "RAG 스니펫이 비어 있어 근거가 부족합니다.";
  }
  if (lower.includes("codex error")) {
    return "Codex 처리 중 오류가 발생했습니다.";
  }
  if (lower.includes("auth") || lower.includes("401") || lower.includes("unauthorized")) {
    return "Codex 인증이 필요합니다.";
  }
  return `리스크 항목: ${trimmed}`;
}

function formatTopicId(topic: DashboardTopicId): string {
  return topic.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function resolveKoreanImplementationText(topic: DashboardTopicId, t: (key: string) => string): string {
  const subtitle = t(`dashboard.detail.${topic}.subtitle`);
  const section1 = t(`dashboard.detail.${topic}.section1`);
  const section2 = t(`dashboard.detail.${topic}.section2`);
  const section3 = t(`dashboard.detail.${topic}.section3`);
  return [subtitle, section1, section2, section3]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function formatDateTimeText(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value ?? "").trim() || "-";
  }
  return parsed.toLocaleString();
}

function resolveTopicStatusInfo(
  runState: DashboardTopicRunState | undefined,
  snapshot: DashboardTopicSnapshot | undefined,
): DashboardTopicStatusInfo {
  if (runState?.running) {
    return { label: "실행 중", tone: "running" };
  }
  if (runState?.lastError) {
    return { label: "오류", tone: "error" };
  }
  if (runState?.lastRunAt) {
    const hasRisk = (snapshot?.risks?.length ?? 0) > 0;
    return { label: "완료", tone: hasRisk ? "done-risk" : "done" };
  }
  return { label: "대기", tone: "idle" };
}

export default function DashboardIntelligenceSettings(props: DashboardIntelligenceSettingsProps) {
  const { t } = useI18n();
  const [activeTopic, setActiveTopic] = useState<DashboardTopicId>(DASHBOARD_TOPIC_IDS[0]);

  useEffect(() => {
    if (DASHBOARD_TOPIC_IDS.includes(activeTopic)) {
      return;
    }
    setActiveTopic(DASHBOARD_TOPIC_IDS[0]);
  }, [activeTopic]);

  const activeTopicConfig = props.config[activeTopic];
  const activeTopicRunState = props.runStateByTopic[activeTopic];
  const activeSnapshot = props.snapshotsByTopic[activeTopic];
  const activeRunId = String(activeSnapshot?.runId ?? "").trim();

  const activeTopicStatus = useMemo(
    () => resolveTopicStatusInfo(activeTopicRunState, activeSnapshot),
    [activeSnapshot, activeTopicRunState],
  );

  const activeTopicUpdatedAtText = useMemo(() => {
    const source = activeSnapshot?.generatedAt || activeTopicRunState?.lastRunAt;
    if (!source) {
      return "아직 실행 기록이 없습니다.";
    }
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) {
      return source;
    }
    return parsed.toLocaleString();
  }, [activeSnapshot?.generatedAt, activeTopicRunState?.lastRunAt]);

  const activeBriefingDocuments = useMemo(() => {
    if (!activeRunId) {
      return [];
    }
    return props.briefingDocuments
      .filter((doc) => String(doc.runId ?? "").trim() === activeRunId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [activeRunId, props.briefingDocuments]);
  const latestBriefingDocumentId = String(activeBriefingDocuments[0]?.id ?? "").trim();
  const activeTopicImplementationText = useMemo(
    () => resolveKoreanImplementationText(activeTopic, t),
    [activeTopic, t],
  );

  const onSelectTopic = (topic: DashboardTopicId) => {
    setActiveTopic(topic);
  };

  const onSelectTopicByKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
    topic: DashboardTopicId,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    setActiveTopic(topic);
  };

  return (
    <section className="settings-dashboard-intelligence settings-dashboard-intelligence-split">
      <section className="settings-dashboard-intelligence-main">
        <header className="settings-dashboard-intelligence-head">
          <div className="settings-dashboard-intelligence-copy">
            <h3 className="settings-dashboard-intelligence-title">데이터 파이프라인</h3>
            <p>{t("settings.dashboardIntelligence.description")}</p>
          </div>
        </header>
        <div className="settings-dashboard-topic-columns" role="presentation">
          <span>TOPIC</span>
          <span>MODEL</span>
          <span>STATE</span>
          <span>RUN</span>
        </div>
        <div className="settings-dashboard-intelligence-list" role="tablist" aria-label="데이터 토픽">
          {DASHBOARD_TOPIC_IDS.map((topic) => {
            const runState = props.runStateByTopic[topic];
            const rowSnapshot = props.snapshotsByTopic[topic];
            const rowStatus = resolveTopicStatusInfo(runState, rowSnapshot);
            return (
              <article
                aria-selected={activeTopic === topic}
                className={`settings-dashboard-topic-row${activeTopic === topic ? " is-active" : ""}`}
                key={topic}
                onClick={() => onSelectTopic(topic)}
                onKeyDown={(event) => onSelectTopicByKeyboard(event, topic)}
                role="tab"
                tabIndex={0}
              >
                <div className="settings-dashboard-topic-title">
                  <code>{formatTopicId(topic)}</code>
                  <strong>{t(`dashboard.widget.${topic}.title`)}</strong>
                  {runState?.lastError ? <p>{runState.lastError}</p> : null}
                </div>

                <div className="settings-dashboard-topic-model">
                  <code className="settings-dashboard-topic-model-code">{rowSnapshot?.model || "미실행"}</code>
                </div>

                <div className="settings-dashboard-topic-state">
                  <span className={`settings-dashboard-status-badge is-${rowStatus.tone}`}>{rowStatus.label}</span>
                </div>
                <div className="settings-dashboard-topic-run">
                  <button
                    className="settings-dashboard-topic-run-button"
                    disabled={Boolean(props.disabled) || Boolean(runState?.running)}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRunTopic(topic);
                    }}
                    type="button"
                  >
                    실행하기
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="settings-dashboard-topic-detail" aria-live="polite">
        <header className="settings-dashboard-topic-detail-head">
          <div className="settings-dashboard-topic-detail-title">
            <small>선택 토픽</small>
            <strong>{t(`dashboard.widget.${activeTopic}.title`)}</strong>
            <code>{formatTopicId(activeTopic)}</code>
          </div>
        </header>

        <div className="settings-dashboard-topic-detail-scroll">
          <section className="settings-dashboard-topic-detail-section settings-dashboard-topic-status-section">
            <h5>실행 상태</h5>
            <div className="settings-dashboard-topic-status-group">
              <div className="settings-dashboard-topic-status-line">
                <span className={`settings-dashboard-status-badge is-${activeTopicStatus.tone}`}>{activeTopicStatus.label}</span>
                <small className="settings-dashboard-date-pill">{activeTopicUpdatedAtText}</small>
              </div>
              {activeTopicRunState?.progressText ? <small>{activeTopicRunState.progressText}</small> : null}
            </div>
            {activeTopicRunState?.lastError ? <small>{activeTopicRunState.lastError}</small> : null}
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>실행 메타</h5>
            <div className="settings-dashboard-topic-doc-actions">
              <button
                className="settings-dashboard-topic-doc-open-all"
                disabled={!activeRunId}
                onClick={() => props.onOpenBriefingDocument(activeRunId)}
                type="button"
              >
                피드에서 문서 보기
              </button>
              <button
                className="settings-dashboard-topic-doc-open"
                disabled={!activeRunId || !latestBriefingDocumentId}
                onClick={() => props.onOpenBriefingDocument(activeRunId, latestBriefingDocumentId)}
                type="button"
              >
                최신 문서 열기
              </button>
            </div>
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>리스크</h5>
            {activeSnapshot?.risks?.length ? (
              <ul>
                {activeSnapshot.risks.map((item, index) => (
                  <li key={`${index}-${item}`}>{toKoreanRiskText(item)}</li>
                ))}
              </ul>
            ) : (
              <p>리스크 없음</p>
            )}
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>브리핑 문서</h5>
            {!activeRunId ? <small>실행 후 브리핑 문서가 생성됩니다.</small> : null}
            {activeBriefingDocuments.length > 0 ? (
              <ul className="settings-dashboard-topic-doc-list">
                {activeBriefingDocuments.slice(0, 6).map((doc) => (
                  <li className="settings-dashboard-topic-doc-item" key={doc.id}>
                    <div className="settings-dashboard-topic-doc-copy">
                      <strong>{doc.isFinalDocument ? "최종 문서" : "생성 문서"}</strong>
                      <small>{`${doc.agentName} · ${formatDateTimeText(doc.createdAt)}`}</small>
                      <p>{doc.summary || "요약이 없는 문서입니다."}</p>
                      <code>{doc.sourceFile}</code>
                    </div>
                    <button
                      className="settings-dashboard-topic-doc-open"
                      onClick={() => props.onOpenBriefingDocument(doc.runId, doc.id)}
                      type="button"
                    >
                      문서 열기
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>해당 실행의 브리핑 문서가 아직 없습니다.</p>
            )}
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>구현 내용</h5>
            <p className="settings-dashboard-topic-implementation-copy">{activeTopicImplementationText}</p>
            <div className="settings-dashboard-topic-allowlist-block">
              <small>{`ALLOWLIST ${activeTopicConfig.allowlist.length}개`}</small>
              {activeTopicConfig.allowlist.length > 0 ? (
                <ul className="settings-dashboard-topic-detail-links">
                  {activeTopicConfig.allowlist.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>요약</h5>
            <p>{activeSnapshot?.summary || "스냅샷이 없습니다. 토픽 실행 후 결과가 표시됩니다."}</p>
          </section>

          {activeSnapshot?.highlights?.length ? (
            <section className="settings-dashboard-topic-detail-section">
              <h5>핵심 포인트</h5>
              <ul>
                {activeSnapshot.highlights.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {activeSnapshot?.events?.length ? (
            <section className="settings-dashboard-topic-detail-section">
              <h5>이벤트</h5>
              <ul>
                {activeSnapshot.events.map((item, index) => (
                  <li key={`${index}-${item.title}`}>
                    <span>{item.title}</span>
                    {item.date ? <small>{item.date}</small> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activeSnapshot?.references?.length ? (
            <section className="settings-dashboard-topic-detail-section">
              <h5>근거 링크</h5>
              <ul className="settings-dashboard-topic-detail-links">
                {activeSnapshot.references.map((ref, index) => (
                  <li key={`${index}-${ref.url}`}>
                    <a href={ref.url} target="_blank" rel="noreferrer">
                      {ref.title || ref.source || ref.url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

      </aside>
    </section>
  );
}
