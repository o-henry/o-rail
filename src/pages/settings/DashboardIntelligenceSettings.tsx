import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from "react";
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
  onRequestRunInAgents: (topic: DashboardTopicId, followupInstruction?: string) => void;
};

function formatTopicId(topic: DashboardTopicId): string {
  return topic.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
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
  const activeTopicRunState = props.runStateByTopic[activeTopic];
  const activeSnapshot = props.snapshotsByTopic[activeTopic];

  const activeTopicStatus = useMemo(() => {
    if (activeTopicRunState?.running) {
      return "RUNNING";
    }
    if (activeTopicRunState?.lastError) {
      return "ERROR";
    }
    if (activeTopicRunState?.lastRunAt) {
      return "DONE";
    }
    return "IDLE";
  }, [activeTopicRunState]);

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

  const onSubmitFollowup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = followupDraft.trim();
    if (!prompt || props.disabled) {
      return;
    }
    props.onRequestRunInAgents(activeTopic, prompt);
    setFollowupDraft("");
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
        </div>
        <div className="settings-dashboard-intelligence-list" role="tablist" aria-label="데이터 토픽">
          {DASHBOARD_TOPIC_IDS.map((topic) => {
            const runState = props.runStateByTopic[topic];
            const rowSnapshot = props.snapshotsByTopic[topic];
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

                <div className={`settings-dashboard-topic-state${runState?.running ? " is-running" : ""}`}>
                  {runState?.running ? "RUNNING" : runState?.lastError ? "ERROR" : runState?.lastRunAt ? "DONE" : "IDLE"}
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
          <button
            className="settings-dashboard-request-button"
            disabled={props.disabled}
            onClick={() => props.onRequestRunInAgents(activeTopic)}
            type="button"
          >
            에이전트에서 실행 요청
          </button>
        </header>

        <div className="settings-dashboard-topic-detail-scroll">
          <section className="settings-dashboard-topic-detail-section">
            <h5>실행 상태</h5>
            <p>{activeTopicStatus}</p>
            {activeTopicRunState?.progressText ? <small>{activeTopicRunState.progressText}</small> : null}
            <small>{activeTopicUpdatedAtText}</small>
            {activeTopicRunState?.lastError ? <small>{activeTopicRunState.lastError}</small> : null}
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>실행 메타</h5>
            <small>{`model ${activeSnapshot?.model || "미실행"}`}</small>
            <small>{`references ${activeSnapshot?.references?.length ?? 0}`}</small>
          </section>

          <section className="settings-dashboard-topic-detail-section">
            <h5>구현 내용</h5>
            <p>{activeTopicConfig.systemPrompt}</p>
            <small>{`allowlist ${activeTopicConfig.allowlist.length}개`}</small>
            {activeTopicConfig.allowlist.length > 0 ? (
              <ul className="settings-dashboard-topic-detail-links">
                {activeTopicConfig.allowlist.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            ) : null}
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

          {activeSnapshot?.risks?.length ? (
            <section className="settings-dashboard-topic-detail-section">
              <h5>리스크</h5>
              <ul>
                {activeSnapshot.risks.map((item, index) => (
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

        <form className="data-topic-followup-composer question-input agents-composer workflow-question-input" onSubmit={onSubmitFollowup}>
          <textarea
            disabled={props.disabled}
            onChange={(event) => setFollowupDraft(event.currentTarget.value)}
            placeholder="추가 요청을 입력하면 에이전트 탭으로 실행 요청이 전달됩니다."
            rows={2}
            value={followupDraft}
          />
          <div className="question-input-footer">
            <button
              className="primary-action question-create-button agents-send-button data-topic-followup-send"
              disabled={!followupDraft.trim() || props.disabled}
              type="submit"
            >
              <img alt="" aria-hidden="true" className="question-create-icon" src="/up.svg" />
            </button>
          </div>
        </form>
      </aside>
    </section>
  );
}
