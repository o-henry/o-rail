import type { DashboardTopicId, DashboardTopicRunState } from "../../../features/dashboard/intelligence";
import type { AgentThread } from "../agentTypes";
import { type ProcessStep, buildProcessSteps } from "./pipelineStage";
import { detectTextLang, toKoreanThreadName } from "./textUtils";

type AgentGridCardProps = {
  t: (key: string) => string;
  thread: AgentThread;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  dataTopicId: DashboardTopicId | null;
  dataTopicRunState: DashboardTopicRunState | null;
};

export function AgentGridCard({
  t,
  thread,
  isActive,
  onSelect,
  onClose,
  dataTopicId,
  dataTopicRunState,
}: AgentGridCardProps) {
  const displayThreadName = toKoreanThreadName(thread.name);
  const processSteps: ProcessStep[] = buildProcessSteps(
    thread,
    isActive,
    dataTopicId,
    dataTopicRunState,
  );
  const roleLang = detectTextLang(thread.role);
  const starterPromptLang = detectTextLang(thread.starterPrompt ?? "");
  const nameLang = detectTextLang(displayThreadName);

  return (
    <article className={`panel-card agents-grid-card${isActive ? " is-active" : ""}`} onClick={onSelect}>
      <div className="agents-grid-card-head">
        <strong lang={nameLang}>{displayThreadName}</strong>
        <button
          aria-label={`${displayThreadName} ${t("agents.off")}`}
          className="agents-off-button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          title={t("agents.off")}
          type="button"
        >
          <img alt="" aria-hidden="true" src="/xmark.svg" />
        </button>
      </div>
      <div className="agents-grid-card-meta">
        <span className={`agents-grid-card-chip${isActive ? " is-running" : " is-pending"}`}>
          {isActive ? "실행 대상" : "대기"}
        </span>
        <span className="agents-grid-card-chip is-neutral">
          {thread.status === "preset" ? "기본 에이전트" : "사용자 에이전트"}
        </span>
      </div>
      <div className="agents-grid-card-log" aria-label={`${displayThreadName} 로그`}>
        <section className="agents-grid-card-log-block">
          <h5>역할</h5>
          <p className="agents-grid-card-role" lang={roleLang}>{thread.role}</p>
        </section>
        <section className="agents-grid-card-log-block">
          <h5>처리 단계</h5>
          <ol className="agents-grid-card-process-list">
            {processSteps.map((step, index) => (
              <li key={step.id}>
                <span className="agents-grid-card-process-index">{index + 1}</span>
                <span className={`agents-grid-card-process-dot is-${step.state}`} />
                <span lang={detectTextLang(step.label)}>{step.label}</span>
              </li>
            ))}
          </ol>
          {isActive && dataTopicRunState?.progressText ? (
            <small className="agents-grid-card-progress-text">{dataTopicRunState.progressText}</small>
          ) : null}
        </section>
        {thread.starterPrompt ? (
          <section className="agents-grid-card-log-block">
            <h5>최근 요청 템플릿</h5>
            <p className="agents-grid-card-starter" lang={starterPromptLang}>{thread.starterPrompt}</p>
          </section>
        ) : null}
      </div>
      <div className="agents-grid-card-foot">
        <span
          aria-label={isActive ? "활성" : "대기"}
          className={`agents-grid-card-status-dot${isActive ? " is-active" : " is-standby"}`}
          title={isActive ? "활성" : "대기"}
        />
      </div>
    </article>
  );
}
