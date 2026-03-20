import { useI18n } from "../../i18n";
import type { LiveAgentCard } from "./liveAgentState";
import type { ApprovalRecord, ThreadMessage, ThreadRoleId } from "./threadTypes";

type LiveProcessEvent = {
  id: string;
  runId: string;
  roleId: ThreadRoleId;
  agentLabel: string;
  type: string;
  stage: string;
  message: string;
  at: string;
};

type TasksThreadConversationProps = {
  messages: ThreadMessage[];
  visibleAgentLabels: string[];
  liveAgents: LiveAgentCard[];
  liveProcessEvents: LiveProcessEvent[];
  approvals: ApprovalRecord[];
  conversationRef: React.RefObject<HTMLDivElement | null>;
  onResolveApproval: (approval: ApprovalRecord, decision: "approved" | "rejected") => void;
};

function parseTimelineMessage(content: string, agentLabels: string[]) {
  const text = String(content ?? "").trim();
  for (const label of agentLabels) {
    if (text.startsWith(`${label}:`)) {
      return {
        label,
        body: text.slice(label.length + 1).trim(),
      };
    }
    if (text.startsWith(`Created ${label} `) || text.includes(` ${label} is `)) {
      return {
        label,
        body: text,
      };
    }
  }
  return {
    label: "",
    body: text,
  };
}

function resolveTimelineMessage(message: ThreadMessage, agentLabels: string[]) {
  const parsed = parseTimelineMessage(message.content, agentLabels);
  return {
    label: String(message.agentLabel ?? "").trim() || parsed.label,
    body: parsed.body,
    artifactPath: String(message.artifactPath ?? "").trim(),
    createdAt: String(message.createdAt ?? "").trim(),
  };
}

function formatArtifactStamp(input: string) {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return normalized;
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayProcessStage(stage: string, t: (key: string) => string) {
  const normalized = String(stage ?? "").trim().toLowerCase();
  if (normalized === "crawler") return t("tasks.processStage.crawler");
  if (normalized === "rag") return t("tasks.processStage.rag");
  if (normalized === "codex") return t("tasks.processStage.codex");
  if (normalized === "critic") return t("tasks.processStage.critic");
  if (normalized === "save") return t("tasks.processStage.save");
  if (normalized === "approval") return t("tasks.processStage.approval");
  return stage || t("tasks.processStage.progress");
}

function displayProcessEventLabel(type: string, t: (key: string) => string) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized === "run_queued") return t("tasks.processEvent.queued");
  if (normalized === "run_started") return t("tasks.processEvent.started");
  if (normalized === "stage_started") return t("tasks.processEvent.running");
  if (normalized === "stage_done") return t("tasks.processEvent.done");
  if (normalized === "stage_error") return t("tasks.processEvent.error");
  if (normalized === "run_done") return t("tasks.processEvent.finished");
  if (normalized === "run_error") return t("tasks.processEvent.failed");
  if (normalized === "artifact_added") return t("tasks.processEvent.artifact");
  return t("tasks.processEvent.progress");
}

export function TasksThreadConversation(props: TasksThreadConversationProps) {
  const { t } = useI18n();

  return (
    <div className="tasks-thread-conversation-scroll" ref={props.conversationRef}>
      <section className="tasks-thread-timeline">
        {props.messages.map((message) => {
          const parsed = resolveTimelineMessage(message, props.visibleAgentLabels);
          return (
            <article className={`tasks-thread-message-row is-${message.role}`} key={message.id}>
              {parsed.label ? <span className="tasks-thread-message-label">{parsed.label}</span> : null}
              <div className="tasks-thread-log-line">{parsed.body}</div>
              {parsed.artifactPath ? (
                <div className="tasks-thread-message-meta">
                  <small className="tasks-thread-message-artifact">{parsed.artifactPath}</small>
                  {parsed.createdAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(parsed.createdAt)}</small> : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {props.liveProcessEvents.map((event) => (
          <article className="tasks-thread-message-row is-system is-process" key={event.id}>
            <span className="tasks-thread-message-label">
              {event.agentLabel} · {displayProcessEventLabel(event.type, t)}
            </span>
            <div className="tasks-thread-log-line">
              {event.stage ? `[${displayProcessStage(event.stage, t)}] ` : ""}
              {event.message}
            </div>
          </article>
        ))}
        {props.liveAgents.map((agent) => (
          <article className="tasks-thread-message-row is-assistant is-live-placeholder" key={`live:${agent.agentId}`}>
            <span className="tasks-thread-message-label">{agent.label}</span>
            <div className="tasks-thread-log-line">{t("tasks.live.working")}</div>
            {agent.latestArtifactPath ? (
              <div className="tasks-thread-message-meta">
                <small className="tasks-thread-message-artifact">{agent.latestArtifactPath}</small>
                {agent.updatedAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(agent.updatedAt)}</small> : null}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      {props.approvals.length > 0 ? (
        <section className="tasks-thread-approvals-stack">
          {props.approvals.map((approval) => (
            <article className="tasks-thread-approval-card" key={approval.id}>
              <div className="tasks-thread-section-head">
                <strong>{t("tasks.approval.required")}</strong>
                <span>{approval.kind.toUpperCase()}</span>
              </div>
              <p>{approval.summary}</p>
              <div className="tasks-thread-approval-actions">
                <button onClick={() => props.onResolveApproval(approval, "rejected")} type="button">
                  {t("tasks.approval.reject")}
                </button>
                <button className="tasks-thread-primary" onClick={() => props.onResolveApproval(approval, "approved")} type="button">
                  {t("tasks.approval.approve")}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
