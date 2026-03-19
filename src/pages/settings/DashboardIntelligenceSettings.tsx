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
  t: (key: string) => string,
): DashboardTopicStatusInfo {
  if (runState?.running) {
    return { label: t("label.status.running"), tone: "running" };
  }
  if (runState?.lastError) {
    return { label: t("label.status.failed"), tone: "error" };
  }
  if (runState?.lastRunAt) {
    const hasRisk = (snapshot?.risks?.length ?? 0) > 0;
    return { label: t("label.status.done"), tone: hasRisk ? "done-risk" : "done" };
  }
  return { label: t("label.status.idle"), tone: "idle" };
}

export default function DashboardIntelligenceSettings(props: DashboardIntelligenceSettingsProps) {
  const { t } = useI18n();
  const [activeTopic, setActiveTopic] = useState<DashboardTopicId>(DASHBOARD_TOPIC_IDS[0]);
  const [followupDraft, setFollowupDraft] = useState("");

  useEffect(() => {
    if (DASHBOARD_TOPIC_IDS.includes(activeTopic)) {
      return;
    }
    setActiveTopic(DASHBOARD_TOPIC_IDS[0]);
  }, [activeTopic]);

  const activeTopicConfig = props.config[activeTopic];
  const activeSnapshot = props.snapshotsByTopic[activeTopic];
  const activeRunId = String(activeSnapshot?.runId ?? "").trim();

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
    setFollowupDraft("");
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
    setFollowupDraft("");
  };

  const onSubmitFollowup = () => {
    const next = followupDraft.trim();
    if (!next) {
      return;
    }
    props.onRunTopic(activeTopic, next);
    setFollowupDraft("");
  };

  const onFollowupKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    onSubmitFollowup();
  };

  return (
    <section className="settings-dashboard-intelligence settings-dashboard-intelligence-split">
      <section className="settings-dashboard-intelligence-main">
        <header className="settings-dashboard-intelligence-head">
          <div className="settings-dashboard-intelligence-copy">
            <h3 className="settings-dashboard-intelligence-title">{t("settings.dashboardIntelligence.pipeline")}</h3>
            <p>{t("settings.dashboardIntelligence.description")}</p>
          </div>
        </header>
        <div className="settings-dashboard-topic-columns" role="presentation">
          <span>{t("settings.dashboardIntelligence.columns.topic")}</span>
          <span>{t("settings.dashboardIntelligence.columns.model")}</span>
          <span>{t("settings.dashboardIntelligence.columns.state")}</span>
          <span>{t("settings.dashboardIntelligence.columns.run")}</span>
        </div>
        <div className="settings-dashboard-intelligence-list" role="tablist" aria-label={t("settings.dashboardIntelligence.topicAria")}>
          {DASHBOARD_TOPIC_IDS.map((topic) => {
            const runState = props.runStateByTopic[topic];
            const rowSnapshot = props.snapshotsByTopic[topic];
            const rowStatus = resolveTopicStatusInfo(runState, rowSnapshot, t);
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
                  <code className="settings-dashboard-topic-model-code">{rowSnapshot?.model || t("settings.dashboardIntelligence.notRun")}</code>
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
                    {t("settings.dashboardIntelligence.runTopic")}
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
            <small>{t("settings.dashboardIntelligence.selectedTopic")}</small>
            <strong>{t(`dashboard.widget.${activeTopic}.title`)}</strong>
            <code>{formatTopicId(activeTopic)}</code>
          </div>
        </header>

        <div className="settings-dashboard-topic-detail-scroll">
          <section className="settings-dashboard-topic-detail-section">
            <h5>{t("settings.dashboardIntelligence.runMeta")}</h5>
            <div className="settings-dashboard-topic-doc-actions">
              <button
                className="settings-dashboard-topic-doc-open-all"
                disabled={!activeRunId}
                onClick={() => props.onOpenBriefingDocument(activeRunId)}
                type="button"
              >
                {t("settings.dashboardIntelligence.viewDocsInFeed")}
              </button>
              <button
                className="settings-dashboard-topic-doc-open"
                disabled={!activeRunId || !latestBriefingDocumentId}
                onClick={() => props.onOpenBriefingDocument(activeRunId, latestBriefingDocumentId)}
                type="button"
              >
                {t("settings.dashboardIntelligence.openLatestDoc")}
              </button>
            </div>
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>{t("settings.dashboardIntelligence.briefingDocs")}</h5>
            {!activeRunId ? <small>{t("settings.dashboardIntelligence.briefingPending")}</small> : null}
            {activeBriefingDocuments.length > 0 ? (
              <div className="settings-dashboard-topic-doc-flat">
                {activeBriefingDocuments.slice(0, 6).map((doc) => (
                  <article className="settings-dashboard-topic-doc-row" key={doc.id}>
                    <small>{`${doc.agentName} · ${formatDateTimeText(doc.createdAt)}`}</small>
                    <p>{doc.summary || t("settings.dashboardIntelligence.noSummaryDoc")}</p>
                    <button
                      className="settings-dashboard-topic-doc-open"
                      onClick={() => props.onOpenBriefingDocument(doc.runId, doc.id)}
                      type="button"
                    >
                      {t("settings.dashboardIntelligence.openDoc")}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p>{t("settings.dashboardIntelligence.noBriefingDocs")}</p>
            )}
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>{t("settings.dashboardIntelligence.implementation")}</h5>
            <p className="settings-dashboard-topic-implementation-copy">{activeTopicImplementationText}</p>
            <div className="settings-dashboard-topic-allowlist-block">
              <div className="settings-dashboard-topic-allowlist-head">
                <small>{t("settings.dashboardIntelligence.allowlistCount", { count: activeTopicConfig.allowlist.length })}</small>
                <button
                  aria-label={t("settings.dashboardIntelligence.allowlistAria")}
                  className="settings-dashboard-allowlist-help help-tooltip"
                  type="button"
                >
                  ?
                </button>
              </div>
              <div className="settings-dashboard-allowlist-tooltip" role="tooltip">
                {activeTopicConfig.allowlist.length > 0 ? (
                  <ul>
                    {activeTopicConfig.allowlist.map((source) => (
                      <li key={source}>{source}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("settings.dashboardIntelligence.noLinks")}</p>
                )}
              </div>
            </div>
          </section>

          {activeSnapshot?.events?.length ? (
            <section className="settings-dashboard-topic-detail-section">
              <h5>{t("settings.dashboardIntelligence.events")}</h5>
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
              <h5>{t("settings.dashboardIntelligence.references")}</h5>
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
        <section className="settings-dashboard-topic-request question-input workflow-question-input">
          <textarea
            onChange={(event) => setFollowupDraft(event.currentTarget.value)}
            onKeyDown={onFollowupKeyDown}
            placeholder={t("settings.dashboardIntelligence.followupPlaceholder")}
            rows={1}
            value={followupDraft}
          />
          <div className="question-input-footer">
            <button
              aria-label={t("settings.dashboardIntelligence.followupAria")}
              className={`question-create-button settings-dashboard-topic-request-send${
                followupDraft.trim().length > 0 ? " primary-action" : ""
              }`}
              disabled={!followupDraft.trim() || Boolean(props.disabled)}
              onClick={onSubmitFollowup}
              type="button"
            >
              <img alt="" aria-hidden="true" className="question-create-icon" src="/up.svg" />
            </button>
          </div>
        </section>
      </aside>
    </section>
  );
}
