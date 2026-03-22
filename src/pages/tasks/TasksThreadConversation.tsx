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

type LiveConversationEntry = {
  roleId: ThreadRoleId;
  label: string;
  agent: LiveAgentCard | null;
  latestEvent: LiveProcessEvent | null;
};

type TimelineRenderEntry =
  | { kind: "single"; message: ThreadMessage }
  | { kind: "group"; id: string; messages: ThreadMessage[] };

type TasksThreadConversationProps = {
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  recentRuntimeSessions: SessionIndexEntry[];
  visibleAgentLabels: string[];
  liveAgents: LiveAgentCard[];
  liveProcessEvents: LiveProcessEvent[];
  latestRunInternalBadges: Array<{ key: string; label: string; kind: "internal" | "provider" }>;
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

export function normalizeTasksTimelineCopy(content: string): string {
  return String(content ?? "")
    .replace(/\bCreated\b/g, "CREATED")
    .replace(/\[(?:Codex|코덱스) 실행\]/g, "[코덱스 실행]")
    .replace(/\bCodex\b/g, "코덱스")
    .replace(/\bruntime attached\b/gi, "RUNTIME ATTACHED");
}

export function isFinishedThreadMessage(message: ThreadMessage): boolean {
  return message.role === "assistant" && String(message.eventKind ?? "").trim() === "agent_result";
}

export function isFailedThreadMessage(message: ThreadMessage): boolean {
  return message.role === "assistant" && String(message.eventKind ?? "").trim() === "agent_failed";
}

function shouldRenderMessageMarkdown(message: ThreadMessage): boolean {
  return isFinishedThreadMessage(message) || isFailedThreadMessage(message);
}

function shouldHideTimelineMessage(message: ThreadMessage, assignedRoleIds: ThreadRoleId[]): boolean {
  const eventKind = String(message.eventKind ?? "").trim();
  if (eventKind === "agent_created") {
    return true;
  }
  if (
    assignedRoleIds.length > 0 &&
    (eventKind === "agent_status" || eventKind === "agent_result" || eventKind === "agent_failed") &&
    message.sourceRoleId &&
    !assignedRoleIds.includes(message.sourceRoleId)
  ) {
    return true;
  }
  return false;
}

function shouldGroupTimelineMessage(message: ThreadMessage): boolean {
  const eventKind = String(message.eventKind ?? "").trim();
  if (eventKind === "run_interrupted") {
    return false;
  }
  return !shouldRenderMessageMarkdown(message) && (message.role === "assistant" || message.role === "system");
}

export function buildTimelineRenderEntries(messages: ThreadMessage[], assignedRoleIds: ThreadRoleId[] = []): TimelineRenderEntry[] {
  const entries: TimelineRenderEntry[] = [];
  let currentGroup: ThreadMessage[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      return;
    }
    entries.push({
      kind: "group",
      id: currentGroup.map((message) => String(message.id ?? "").trim()).filter(Boolean).join(":"),
      messages: currentGroup,
    });
    currentGroup = [];
  };

  for (const message of messages) {
    if (shouldHideTimelineMessage(message, assignedRoleIds)) {
      continue;
    }
    if (shouldGroupTimelineMessage(message)) {
      currentGroup.push(message);
      continue;
    }
    flushGroup();
    entries.push({ kind: "single", message });
  }
  flushGroup();
  return entries;
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

export function resolveLatestRunParticipationBadgeRoleIds(params: {
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  liveAgents: LiveAgentCard[];
}): ThreadRoleId[] {
  const latestUserId = latestUserMessageId(params.messages);
  const latestUserIndex = latestUserId
    ? params.messages.findIndex((message) => String(message.id ?? "").trim() === latestUserId)
    : -1;
  const latestRunMessages = latestUserIndex >= 0 ? params.messages.slice(latestUserIndex + 1) : [];
  const emittedRoleIds = orderedTaskAgentPresetIds(
    latestRunMessages
      .filter((message) => String(message.eventKind ?? "").trim() !== "agent_created")
      .map((message) => message.sourceRoleId)
      .filter((roleId): roleId is ThreadRoleId => Boolean(roleId)),
  );
  if (emittedRoleIds.length > 0) {
    return emittedRoleIds;
  }
  const liveRoleIds = orderedTaskAgentPresetIds(params.liveAgents.map((agent) => agent.roleId));
  if (liveRoleIds.length > 0) {
    return liveRoleIds;
  }
  const orchestrationRoleIds = resolveThreadParticipationBadgeRoleIds(params.orchestration);
  if (orchestrationRoleIds.length > 0) {
    return orchestrationRoleIds;
  }
  return orderedTaskAgentPresetIds(
    latestRunMessages
      .map((message) => message.sourceRoleId)
      .filter((roleId): roleId is ThreadRoleId => Boolean(roleId)),
  );
}

type ConversationParticipationBadge = {
  key: string;
  label: string;
  kind: "agent" | "provider" | "internal";
};

export function resolveLatestRunParticipationBadges(params: {
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  liveAgents: LiveAgentCard[];
  internalBadges: Array<{ key: string; label: string; kind: "internal" | "provider" }>;
}): ConversationParticipationBadge[] {
  const roleBadges = resolveLatestRunParticipationBadgeRoleIds({
    orchestration: params.orchestration,
    messages: params.messages,
    liveAgents: params.liveAgents,
  }).map((roleId) => ({
    key: `agent:${roleId}`,
    label: getTaskAgentLabel(roleId),
    kind: "agent" as const,
  }));
  const internalBadges = params.internalBadges.map((badge) => ({
    key: badge.key,
    label: badge.label,
    kind: badge.kind,
  }));
  return [...roleBadges, ...internalBadges];
}

export function resolveProgressiveRevealStep(contentLength: number): number {
  if (contentLength <= 0) {
    return 0;
  }
  return Math.max(48, Math.min(220, Math.ceil(contentLength / 36)));
}

export function shouldProgressivelyRevealMessage(message: ThreadMessage, body: string): boolean {
  const contentLength = body.trim().length;
  if (contentLength < 180) {
    return false;
  }
  const eventKind = String(message.eventKind ?? "").trim();
  if (message.role === "assistant") {
    return true;
  }
  return message.role === "system" && eventKind !== "run_interrupted";
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

function displayProcessEventBadgeLabel(type: string, t: (key: string) => string) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized === "run_queued") return t("tasks.processEvent.queued");
  if (normalized === "run_started") return t("tasks.processEvent.started");
  if (normalized === "stage_started") return "";
  if (normalized === "stage_done") return t("tasks.processEvent.done");
  if (normalized === "run_done") return t("tasks.processEvent.finished");
  if (normalized === "run_error" || normalized === "stage_error") return t("tasks.processEvent.failed");
  return "";
}

function shouldHideBareLiveStatusMessage(message: string) {
  const normalized = String(message ?? "").trim().toLowerCase();
  return ["queued", "started", "done", "failed", "error"].includes(normalized);
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

export function resolveLiveConversationEntries(params: {
  liveAgents: LiveAgentCard[];
  liveProcessEvents: LiveProcessEvent[];
}): LiveConversationEntry[] {
  const latestProcessEventByRole = buildLatestProcessEventByRole(params.liveProcessEvents);
  const seen = new Set<ThreadRoleId>();
  const entries: LiveConversationEntry[] = [];

  for (const agent of params.liveAgents) {
    seen.add(agent.roleId);
    entries.push({
      roleId: agent.roleId,
      label: agent.label,
      agent,
      latestEvent: latestProcessEventByRole.get(agent.roleId) ?? null,
    });
  }

  const remainingEvents = Array.from(latestProcessEventByRole.values()).sort((left, right) => (
    Date.parse(right.at || "") - Date.parse(left.at || "")
  ));

  for (const event of remainingEvents) {
    if (seen.has(event.roleId)) {
      continue;
    }
    seen.add(event.roleId);
    entries.push({
      roleId: event.roleId,
      label: event.agentLabel || getTaskAgentLabel(event.roleId),
      agent: null,
      latestEvent: event,
    });
  }

  return entries;
}

function shouldShowLiveDots(eventType: string, liveState: "active" | "delayed" | "stalled") {
  if (liveState === "stalled") {
    return false;
  }
  const normalized = String(eventType ?? "").trim().toLowerCase();
  return !["run_done", "run_error", "stage_done", "stage_error"].includes(normalized);
}

const StaticTimelineMessageRow = memo(function StaticTimelineMessageRow(props: {
  messageRole: ThreadMessage["role"];
  label: string;
  body: string;
  renderMarkdown: boolean;
  artifactPath: string;
  createdAt: string;
  showFinish: boolean;
  showSuccess: boolean;
  showFail: boolean;
  progressivelyReveal: boolean;
  progressiveStep: number;
  conversationRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [visibleChars, setVisibleChars] = useState(() => (
    props.progressivelyReveal ? Math.min(props.progressiveStep, props.body.length) : props.body.length
  ));

  useEffect(() => {
    setVisibleChars(props.progressivelyReveal ? Math.min(props.progressiveStep, props.body.length) : props.body.length);
  }, [props.body, props.progressiveStep, props.progressivelyReveal]);

  useEffect(() => {
    if (!props.progressivelyReveal || visibleChars >= props.body.length) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setVisibleChars((current) => Math.min(props.body.length, current + props.progressiveStep));
    }, 45);
    return () => window.clearInterval(intervalId);
  }, [props.body.length, props.progressiveStep, props.progressivelyReveal, visibleChars]);

  useEffect(() => {
    const element = props.conversationRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [props.conversationRef, visibleChars]);

  const displayedBody = props.progressivelyReveal
    ? props.body.slice(0, Math.min(props.body.length, visibleChars))
    : props.body;
  const isTerminalResult = props.showFinish || props.showSuccess || props.showFail;
  return (
    <article className={`tasks-thread-message-row is-${props.messageRole}${isTerminalResult ? " is-terminal-result" : ""}`}>
      {props.label ? <span className="tasks-thread-message-label">{props.label}</span> : null}
      <div className="tasks-thread-log-line">
        {props.renderMarkdown ? <TasksThreadMessageContent content={displayedBody} /> : displayedBody}
      </div>
      {props.showFinish || props.showSuccess || props.showFail ? (
        <div className="tasks-thread-message-badges">
          {props.showFinish ? <span className="tasks-thread-finish-badge">FINISH</span> : null}
          {props.showSuccess ? <span className="tasks-thread-status-badge is-success">SUCCESS</span> : null}
          {props.showFail ? <span className="tasks-thread-status-badge is-fail">FAIL</span> : null}
        </div>
      ) : null}
      {props.artifactPath ? (
        <div className="tasks-thread-message-meta">
          <small className="tasks-thread-message-artifact">{props.artifactPath}</small>
          {props.createdAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(props.createdAt)}</small> : null}
        </div>
      ) : null}
    </article>
  );
});

const GroupedTimelineLogRow = memo(function GroupedTimelineLogRow(props: {
  text: string;
}) {
  return (
    <article className="tasks-thread-message-row is-assistant is-log-group">
      <pre className="tasks-thread-log-pre">{props.text}</pre>
    </article>
  );
});

function TasksThreadConversationImpl(props: TasksThreadConversationProps) {
  const { t } = useI18n();
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const latestProcessEventByRole = useMemo(
    () => buildLatestProcessEventByRole(props.liveProcessEvents),
    [props.liveProcessEvents],
  );
  const roleEventsByRole = useMemo(
    () => buildRoleEventsByRole(props.liveProcessEvents),
    [props.liveProcessEvents],
  );
  const liveConversationEntries = useMemo(
    () => resolveLiveConversationEntries({
      liveAgents: props.liveAgents,
      liveProcessEvents: props.liveProcessEvents,
    }),
    [props.liveAgents, props.liveProcessEvents],
  );
  const currentRunBadges = useMemo(
    () => resolveLatestRunParticipationBadges({
      orchestration: props.orchestration,
      messages: props.messages,
      liveAgents: props.liveAgents,
      internalBadges: props.latestRunInternalBadges,
    }),
    [props.latestRunInternalBadges, props.liveAgents, props.messages, props.orchestration],
  );
  const latestUserPromptMessageId = useMemo(
    () => latestUserMessageId(props.messages),
    [props.messages],
  );
  const timelineEntries = useMemo(
    () => buildTimelineRenderEntries(
      props.messages,
      resolveThreadParticipationBadgeRoleIds(props.orchestration),
    ),
    [props.messages, props.orchestration],
  );
  const interruptedTimelineEntries = useMemo(
    () => timelineEntries.filter((entry) => entry.kind === "single" && String(entry.message.eventKind ?? "").trim() === "run_interrupted"),
    [timelineEntries],
  );
  const primaryTimelineEntries = useMemo(
    () => timelineEntries.filter((entry) => !(entry.kind === "single" && String(entry.message.eventKind ?? "").trim() === "run_interrupted")),
    [timelineEntries],
  );
  const latestProgressiveMessageId = useMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      const body = resolveTimelineMessage(message, props.visibleAgentLabels).body;
      if (!String(message.id ?? "").trim() || !shouldProgressivelyRevealMessage(message, body)) {
        continue;
      }
      return String(message.id ?? "").trim();
    }
    return "";
  }, [props.messages, props.visibleAgentLabels]);

  useEffect(() => {
    if (props.liveAgents.length === 0 && props.liveProcessEvents.length === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 10_000);
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
        {primaryTimelineEntries.map((entry) => {
          if (entry.kind === "group") {
            const groupText = entry.messages
              .map((message) => {
                const parsed = resolveTimelineMessage(message, props.visibleAgentLabels);
                const body = normalizeTasksTimelineCopy(parsed.body);
                return parsed.label ? `${parsed.label}\n${body}` : body;
              })
              .filter(Boolean)
              .join("\n\n");
            return (
              <GroupedTimelineLogRow key={entry.id} text={groupText} />
            );
          }
          const { message } = entry;
          const parsed = resolveTimelineMessage(message, props.visibleAgentLabels);
          const messageId = String(message.id ?? "").trim();
          const renderedBody = normalizeTasksTimelineCopy(parsed.body);
          const progressivelyReveal = !shouldRenderMessageMarkdown(message)
            && messageId === latestProgressiveMessageId
            && shouldProgressivelyRevealMessage(message, parsed.body);
          const progressiveStep = resolveProgressiveRevealStep(renderedBody.length);
          return (
            <Fragment key={message.id}>
              <StaticTimelineMessageRow
                artifactPath={parsed.artifactPath}
                body={renderedBody}
                conversationRef={props.conversationRef}
                createdAt={parsed.createdAt}
                label={parsed.label}
                messageRole={message.role}
                progressiveStep={progressiveStep}
                progressivelyReveal={progressivelyReveal}
                renderMarkdown={shouldRenderMessageMarkdown(message)}
                showFail={isFailedThreadMessage(message)}
                showFinish={isFinishedThreadMessage(message)}
                showSuccess={isFinishedThreadMessage(message)}
              />
              {String(message.id ?? "").trim() === latestUserPromptMessageId && currentRunBadges.length > 0 ? (
                <article className="tasks-thread-message-row is-assistant is-participant-summary" key={`${message.id}:participants`}>
                  <div className="tasks-thread-message-agent-list">
                    {currentRunBadges.map((badge) => (
                      <span
                        className={`tasks-thread-message-agent-chip${badge.kind === "provider" ? " is-provider" : ""}${badge.kind === "internal" ? " is-internal" : ""}`}
                        key={`${message.id}:${badge.key}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </article>
              ) : null}
            </Fragment>
          );
        })}
        {liveConversationEntries.map((entry) => (
          (() => {
            const roleEvents = roleEventsByRole.get(entry.roleId) ?? [];
            const latestEvent = entry.latestEvent ?? latestProcessEventByRole.get(entry.roleId) ?? null;
            const freshestAt = String(latestEvent?.at ?? entry.agent?.updatedAt ?? "").trim();
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
                : latestEvent?.message || entry.agent?.summary || t("tasks.live.working");
            const nextAction = inferNextLiveAction({
              stage: latestEvent?.stage,
              activityState: liveState,
              failureReason,
              interrupted: (entry.agent?.summary || "").includes("중단"),
              recentSourceCount,
            });
            const eventBadgeLabel = latestEvent?.type
              ? displayProcessEventBadgeLabel(latestEvent.type, t)
              : "";
            const displayLogLine =
              !(eventBadgeLabel && shouldHideBareLiveStatusMessage(currentWorkLabel))
              || Boolean(latestEvent?.stage);
            return (
              <article className="tasks-thread-message-row is-assistant is-live-placeholder" key={`live:${entry.roleId}`}>
                <div className="tasks-thread-live-header">
                  <span className="tasks-thread-message-label">{entry.label}</span>
                  {latestEvent?.stage ? (
                    <span className="tasks-thread-live-stage">
                      {displayProcessStage(String(latestEvent.stage ?? ""), t)}
                    </span>
                  ) : null}
                  <span className={`tasks-thread-live-state is-${liveState}`}>
                    {stateLabel}
                  </span>
                  {shouldShowLiveDots(latestEvent?.type ?? "", liveState) ? (
                    <span aria-hidden="true" className="tasks-thread-live-dots">
                      <span className="tasks-thread-live-dot" />
                      <span className="tasks-thread-live-dot" />
                      <span className="tasks-thread-live-dot" />
                    </span>
                  ) : null}
                  {eventBadgeLabel ? (
                    <span className="tasks-thread-live-event">
                      {eventBadgeLabel}
                    </span>
                  ) : null}
                </div>
                {displayLogLine ? (
                  <div className="tasks-thread-log-line">
                    {latestEvent?.stage ? `[${displayProcessStage(String(latestEvent.stage ?? ""), t)}] ` : ""}
                    {normalizeTasksTimelineCopy(currentWorkLabel)}
                  </div>
                ) : null}
                <div className="tasks-thread-live-detail">
                  {t("tasks.live.lastUpdate", { value: lastSeenLabel })}
                </div>
                {entry.agent?.summary && latestEvent?.message && latestEvent.message !== entry.agent.summary ? (
                  <div className="tasks-thread-live-detail">{entry.agent.summary}</div>
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
                {entry.agent?.latestArtifactPath ? (
                  <div className="tasks-thread-message-meta">
                    <small className="tasks-thread-message-artifact">{entry.agent.latestArtifactPath}</small>
                    {entry.agent.updatedAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(entry.agent.updatedAt)}</small> : null}
                  </div>
                ) : null}
              </article>
            );
          })()
        ))}
        {interruptedTimelineEntries.map((entry) => {
          if (entry.kind !== "single") {
            return null;
          }
          const parsed = resolveTimelineMessage(entry.message, props.visibleAgentLabels);
          const renderedBody = normalizeTasksTimelineCopy(parsed.body);
          return (
            <StaticTimelineMessageRow
              artifactPath={parsed.artifactPath}
              body={renderedBody}
              conversationRef={props.conversationRef}
              createdAt={parsed.createdAt}
              key={entry.message.id}
              label={parsed.label}
              messageRole={entry.message.role}
              progressiveStep={resolveProgressiveRevealStep(renderedBody.length)}
              progressivelyReveal={false}
              renderMarkdown={false}
              showFail={false}
              showFinish={false}
              showSuccess={false}
            />
          );
        })}
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
