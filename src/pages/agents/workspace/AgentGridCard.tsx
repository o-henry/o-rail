import type { DashboardTopicId, DashboardTopicRunState } from "../../../features/dashboard/intelligence";
import type { AgentThread } from "../agentTypes";
import { type ProcessStep, buildProcessSteps, resolveAgentPipelineStatus } from "./pipelineStage";
import { detectTextLang, toKoreanThreadName, uppercaseEnglishTokens } from "./textUtils";

type AgentGridCardProps = {
  t: (key: string) => string;
  thread: AgentThread;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
  dataTopicId: DashboardTopicId | null;
  dataTopicRunState: DashboardTopicRunState | null;
};

export function AgentGridCard({
  t,
  thread,
  isSelected,
  onSelect,
  onClose,
  dataTopicId,
  dataTopicRunState,
}: AgentGridCardProps) {
  const resolvedStatus = resolveAgentPipelineStatus(thread, dataTopicId, dataTopicRunState);
  const pipelineStatus = dataTopicId ? resolvedStatus : "pending";
  const displayThreadName = toKoreanThreadName(thread.name);
  const processSteps: ProcessStep[] = buildProcessSteps(
    thread,
    isSelected,
    dataTopicId,
    dataTopicRunState,
  );
  const isRunning = pipelineStatus === "running";
  const chipText =
    pipelineStatus === "running"
      ? "실행 중"
      : pipelineStatus === "done"
        ? "완료"
        : pipelineStatus === "error"
          ? "실패"
          : "대기";
  const roleLang = detectTextLang(thread.role);
  const starterPromptLang = detectTextLang(thread.starterPrompt ?? "");
  const nameLang = detectTextLang(displayThreadName);

  return (
    <article
      className={`panel-card agents-grid-card${isSelected ? " is-selected" : ""}${isRunning ? " is-running" : ""}`.trim()}
      onClick={onSelect}
    >
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
        <span className="agents-grid-card-kind">
          {thread.status === "preset" ? "기본 에이전트" : "사용자 에이전트"}
        </span>
      </div>
      <div className="agents-grid-card-log" aria-label={`${displayThreadName} 로그`}>
        <section className="agents-grid-card-log-block">
          <h5>역할</h5>
          <p className="agents-grid-card-role" lang={roleLang}>{uppercaseEnglishTokens(thread.role)}</p>
        </section>
        <section className="agents-grid-card-log-block">
          <h5>처리 단계</h5>
          <ol className="agents-grid-card-process-list">
            {processSteps.map((step) => (
              <li key={step.id}>
                <span className={`agents-grid-card-process-dot is-${step.state}`} />
                <span lang={detectTextLang(step.label)}>{step.label}</span>
              </li>
            ))}
          </ol>
        </section>
        {thread.starterPrompt ? (
          <section className="agents-grid-card-log-block">
            <h5>최근 요청 템플릿</h5>
            <p className="agents-grid-card-starter" lang={starterPromptLang}>{thread.starterPrompt}</p>
          </section>
        ) : null}
      </div>
      <div className="agents-grid-card-foot">
        <span className={`agents-grid-card-chip agents-grid-card-foot-chip is-${pipelineStatus}`}>{chipText}</span>
        <span
          aria-label={pipelineStatus === "running" ? "실행 중" : pipelineStatus === "done" ? "완료" : pipelineStatus === "error" ? "실패" : "대기"}
          className={`agents-grid-card-status-dot is-${pipelineStatus}`}
          title={chipText}
        />
      </div>
    </article>
  );
}
