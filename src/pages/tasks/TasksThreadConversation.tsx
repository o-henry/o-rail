import { Fragment, memo, useEffect, useMemo, useState } from "react";
import type { AgenticCoordinationState, SessionIndexEntry } from "../../features/orchestration/agentic/coordinationTypes";
import { useI18n } from "../../i18n";
import { TasksThreadOrchestrationCard } from "./TasksThreadOrchestrationCard";
import { TasksThreadMessageContent } from "./TasksThreadMessageContent";
import { getTaskAgentLabel, orderedTaskAgentPresetIds } from "./taskAgentPresets";
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

export function isFailedThreadMessage(message: ThreadMessage): boolean {
  return message.role === "assistant" && String(message.eventKind ?? "").trim() === "agent_failed";
}

function latestUserMessageId(messages: ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return String(message.id ?? "").trim();
    }
  }
  return "";
}

function latestAssistantOutcomeMessage(messages: ThreadMessage[]): ThreadMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (isFinishedThreadMessage(message) || isFailedThreadMessage(message))) {
      return message;
    }
  }
  return null;
}

export function resolveThreadParticipationBadgeRoleIds(orchestration: AgenticCoordinationState | null): ThreadRoleId[] {
  const orchestrationRoleIds = orderedTaskAgentPresetIds(
    orchestration?.assignedRoleIds?.length
      ? orchestration.assignedRoleIds
      : (orchestration?.requestedRoleIds ?? []),
  );
  if (orchestrationRoleIds.length > 0) {
    return orchestrationRoleIds;
  }
  return [];
}

export function resolveProgressiveRevealStep(contentLength: number): number {
  if (contentLength <= 0) {
    return 0;
  }
  return Math.max(48, Math.min(220, Math.ceil(contentLength / 36)));
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

function TasksThreadConversationImpl(props: TasksThreadConversationProps) {
  const { t } = useI18n();
  const [pulseFrame, setPulseFrame] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingVisibleChars, setStreamingVisibleChars] = useState(0);
  const latestProcessEventByRole = useMemo(
    () => buildLatestProcessEventByRole(props.liveProcessEvents),
    [props.liveProcessEvents],
  );
  const roleEventsByRole = useMemo(
    () => buildRoleEventsByRole(props.liveProcessEvents),
    [props.liveProcessEvents],
  );
  const currentRunBadgeRoleIds = useMemo(
    () => resolveThreadParticipationBadgeRoleIds(props.orchestration),
    [props.orchestration],
  );
  const latestUserPromptMessageId = useMemo(
    () => latestUserMessageId(props.messages),
    [props.messages],
  );
  const latestOutcomeMessage = useMemo(
    () => latestAssistantOutcomeMessage(props.messages),
    [props.messages],
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

  useEffect(() => {
    const latestMessageId = String(latestOutcomeMessage?.id ?? "").trim();
    const latestBody = latestOutcomeMessage
      ? resolveTimelineMessage(latestOutcomeMessage, props.visibleAgentLabels).body
      : "";
    if (!latestMessageId || !latestBody) {
      setStreamingMessageId("");
      setStreamingVisibleChars(0);
      return;
    }
    const step = resolveProgressiveRevealStep(latestBody.length);
    setStreamingMessageId(latestMessageId);
    setStreamingVisibleChars((current) => (
      latestMessageId === streamingMessageId
        ? Math.min(Math.max(current, step), latestBody.length)
        : Math.min(step, latestBody.length)
    ));
    if (latestBody.length <= step) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setStreamingVisibleChars((current) => {
        if (current >= latestBody.length) {
          window.clearInterval(intervalId);
          return latestBody.length;
        }
        return Math.min(latestBody.length, current + step);
      });
    }, 20);
    return () => window.clearInterval(intervalId);
  }, [latestOutcomeMessage, props.visibleAgentLabels, streamingMessageId]);

  useEffect(() => {
    if (!streamingMessageId || !props.conversationRef.current) {
      return;
    }
    props.conversationRef.current.scrollTop = props.conversationRef.current.scrollHeight;
  }, [props.conversationRef, streamingMessageId, streamingVisibleChars]);

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
          const displayedBody =
            String(message.id ?? "").trim() === streamingMessageId && streamingVisibleChars > 0
              ? parsed.body.slice(0, Math.min(parsed.body.length, streamingVisibleChars))
              : parsed.body;
          return (
            <Fragment key={message.id}>
              <article className={`tasks-thread-message-row is-${message.role}`} key={message.id}>
                {parsed.label ? <span className="tasks-thread-message-label">{parsed.label}</span> : null}
                <div className="tasks-thread-log-line">
                  {message.role === "assistant" ? <TasksThreadMessageContent content={displayedBody} /> : displayedBody}
                </div>
                {isFinishedThreadMessage(message) || isFailedThreadMessage(message) ? (
                  <div className="tasks-thread-message-badges">
                    {isFinishedThreadMessage(message) ? <span className="tasks-thread-finish-badge">FINISH</span> : null}
                    {isFinishedThreadMessage(message) ? <span className="tasks-thread-status-badge is-success">SUCCESS</span> : null}
                    {isFailedThreadMessage(message) ? <span className="tasks-thread-status-badge is-fail">FAIL</span> : null}
                  </div>
                ) : null}
                {parsed.artifactPath ? (
                  <div className="tasks-thread-message-meta">
                    <small className="tasks-thread-message-artifact">{parsed.artifactPath}</small>
                    {parsed.createdAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(parsed.createdAt)}</small> : null}
                  </div>
                ) : null}
              </article>
              {String(message.id ?? "").trim() === latestUserPromptMessageId && currentRunBadgeRoleIds.length > 0 ? (
                <article className="tasks-thread-message-row is-assistant is-participant-summary" key={`${message.id}:participants`}>
                  <div className="tasks-thread-message-agent-list">
                    {currentRunBadgeRoleIds.map((roleId) => (
                      <span className="tasks-thread-message-agent-chip" key={`${message.id}:${roleId}`}>
                        {getTaskAgentLabel(roleId)}
                      </span>
                    ))}
                  </div>
                </article>
              ) : null}
            </Fragment>
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

export const TasksThreadConversation = memo(TasksThreadConversationImpl);
TasksThreadConversation.displayName = "TasksThreadConversation";
