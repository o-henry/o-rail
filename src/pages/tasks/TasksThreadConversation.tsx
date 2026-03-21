import { useEffect, useMemo, useState } from "react";
import type { AgenticCoordinationState, SessionIndexEntry } from "../../features/orchestration/agentic/coordinationTypes";
import { useI18n } from "../../i18n";
import { TasksThreadOrchestrationCard } from "./TasksThreadOrchestrationCard";
import {
  formatRelativeUpdateAge,
  inferNextLiveAction,
  resolveLatestFailureReason,
  resolveLiveActivityState,
  resolveRecentSourceCount,
  type LiveAgentCard,
} from "./liveAgentState";
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
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  recentRuntimeSessions: SessionIndexEntry[];
  visibleAgentLabels: string[];
  liveAgents: LiveAgentCard[];
  liveProcessEvents: LiveProcessEvent[];
  approvals: ApprovalRecord[];
  conversationRef: React.RefObject<HTMLDivElement | null>;
  onApprovePlan: () => void;
  onCancelOrchestration: () => void;
  onOpenRuntimeSession: (threadId: string) => void;
  onRequestFollowup: () => void;
  onResumeOrchestration: () => void;
  onResolveApproval: (approval: ApprovalRecord, decision: "approved" | "rejected") => void;
  onVerifyReview: () => void;
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

export function isFinishedThreadMessage(message: ThreadMessage): boolean {
  return message.role === "assistant" && String(message.eventKind ?? "").trim() === "agent_result";
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

function buildLatestProcessEventByRole(events: LiveProcessEvent[]) {
  const latest = new Map<ThreadRoleId, LiveProcessEvent>();
  for (const event of events) {
    const previous = latest.get(event.roleId);
    if (!previous || Date.parse(event.at || "") >= Date.parse(previous.at || "")) {
      latest.set(event.roleId, event);
    }
  }
  return latest;
}

function buildRoleEventsByRole(events: LiveProcessEvent[]) {
  const grouped = new Map<ThreadRoleId, LiveProcessEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.roleId);
    if (bucket) {
      bucket.push(event);
      continue;
    }
    grouped.set(event.roleId, [event]);
  }
  return grouped;
}

function animatedDots(frame: number) {
  return [".", "..", "..."][frame % 3] ?? "...";
}

export function TasksThreadConversation(props: TasksThreadConversationProps) {
  const { t } = useI18n();
  const [pulseFrame, setPulseFrame] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const latestProcessEventByRole = useMemo(
    () => buildLatestProcessEventByRole(props.liveProcessEvents),
    [props.liveProcessEvents],
  );
  const roleEventsByRole = useMemo(
    () => buildRoleEventsByRole(props.liveProcessEvents),
    [props.liveProcessEvents],
  );

  useEffect(() => {
    if (props.liveAgents.length === 0 && props.liveProcessEvents.length === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setPulseFrame((current) => (current + 1) % 3);
      setLiveNowMs(Date.now());
    }, 450);
    return () => window.clearInterval(intervalId);
  }, [props.liveAgents.length, props.liveProcessEvents.length]);

  return (
    <div className="tasks-thread-conversation-scroll" ref={props.conversationRef}>
      <TasksThreadOrchestrationCard
        orchestration={props.orchestration}
        recentSessions={props.recentRuntimeSessions}
        onApprovePlan={props.onApprovePlan}
        onCancel={props.onCancelOrchestration}
        onOpenSession={props.onOpenRuntimeSession}
        onRequestFollowup={props.onRequestFollowup}
        onResume={props.onResumeOrchestration}
        onVerifyReview={props.onVerifyReview}
      />
      <section className="tasks-thread-timeline">
        {props.messages.map((message) => {
          const parsed = resolveTimelineMessage(message, props.visibleAgentLabels);
          return (
            <article className={`tasks-thread-message-row is-${message.role}`} key={message.id}>
              {parsed.label ? <span className="tasks-thread-message-label">{parsed.label}</span> : null}
              <div className="tasks-thread-log-line">
                {parsed.body}
                {isFinishedThreadMessage(message) ? <span className="tasks-thread-finish-badge">FINISH</span> : null}
              </div>
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
          (() => {
            const roleEvents = roleEventsByRole.get(agent.roleId) ?? [];
            const latestEvent = latestProcessEventByRole.get(agent.roleId);
            const freshestAt = String(latestEvent?.at ?? agent.updatedAt ?? "").trim();
            const liveState = resolveLiveActivityState(freshestAt, liveNowMs);
            const recentSourceCount = resolveRecentSourceCount(roleEvents);
            const failureReason = resolveLatestFailureReason(roleEvents);
            const lastSeenLabel = formatRelativeUpdateAge(freshestAt, {
              justNow: t("time.justNow"),
              minutesAgo: (value) => t("time.minutesAgo", { value }),
              hoursAgo: (value) => t("time.hoursAgo", { value }),
              daysAgo: (value) => t("time.daysAgo", { value }),
            });
            const stateLabel =
              failureReason.includes("ROLE_KB_BOOTSTRAP 실패") && recentSourceCount === 0
                ? t("tasks.live.state.degraded")
                : liveState === "stalled"
                ? t("tasks.live.state.stalled")
                : liveState === "delayed"
                  ? t("tasks.live.state.delayed")
                  : t("tasks.live.state.active");
            const currentWorkLabel =
              failureReason.includes("ROLE_KB_BOOTSTRAP 실패") && recentSourceCount === 0 && String(latestEvent?.stage ?? "").trim().toLowerCase() === "codex"
                ? t("tasks.live.currentWork.degraded")
                : latestEvent?.message || agent.summary || t("tasks.live.working");
            const nextAction = inferNextLiveAction({
              stage: latestEvent?.stage,
              activityState: liveState,
              failureReason,
              interrupted: (agent.summary || "").includes("중단"),
              recentSourceCount,
            });
            return (
              <article className="tasks-thread-message-row is-assistant is-live-placeholder" key={`live:${agent.agentId}`}>
                <div className="tasks-thread-live-header">
                  <span className="tasks-thread-message-label">{agent.label}</span>
                  {latestEvent?.stage ? (
                    <span className="tasks-thread-live-stage">
                      {displayProcessStage(String(latestEvent.stage ?? ""), t)}
                    </span>
                  ) : null}
                  <span className={`tasks-thread-live-state is-${liveState}`}>
                    {stateLabel}
                  </span>
                  <span aria-hidden="true" className="tasks-thread-live-pulse">
                    {animatedDots(pulseFrame)}
                  </span>
                </div>
                <div className="tasks-thread-log-line">
                  {currentWorkLabel}
                </div>
                <div className="tasks-thread-live-detail">
                  {t("tasks.live.lastUpdate", { value: lastSeenLabel })}
                </div>
                {agent.summary && latestEvent?.message && latestEvent.message !== agent.summary ? (
                  <div className="tasks-thread-live-detail">{agent.summary}</div>
                ) : null}
                <dl className="tasks-thread-live-metrics">
                  <div>
                    <dt>{t("tasks.live.metric.stage")}</dt>
                    <dd>{latestEvent?.stage ? displayProcessStage(String(latestEvent.stage ?? ""), t) : t("tasks.live.metric.pending")}</dd>
                  </div>
                  <div>
                    <dt>{t("tasks.live.metric.currentWork")}</dt>
                    <dd>{currentWorkLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("tasks.live.metric.sourcesSeen")}</dt>
                    <dd>{recentSourceCount != null ? t("tasks.live.metric.sourcesSeenValue", { value: recentSourceCount }) : t("tasks.live.metric.pending")}</dd>
                  </div>
                  <div>
                    <dt>{t("tasks.live.metric.failureReason")}</dt>
                    <dd>{failureReason || t("tasks.live.metric.none")}</dd>
                  </div>
                  <div>
                    <dt>{t("tasks.live.metric.nextAction")}</dt>
                    <dd>{nextAction}</dd>
                  </div>
                </dl>
                {agent.latestArtifactPath ? (
                  <div className="tasks-thread-message-meta">
                    <small className="tasks-thread-message-artifact">{agent.latestArtifactPath}</small>
                    {agent.updatedAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(agent.updatedAt)}</small> : null}
                  </div>
                ) : null}
              </article>
            );
          })()
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
