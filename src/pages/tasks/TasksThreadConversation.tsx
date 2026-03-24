import { Fragment, memo, useEffect, useMemo, useState } from "react";
import type { AgenticCoordinationState, SessionIndexEntry } from "../../features/orchestration/agentic/coordinationTypes";
import { useI18n } from "../../i18n";
import { TasksThreadOrchestrationCard } from "./TasksThreadOrchestrationCard";
import { TasksThreadMessageContent } from "./TasksThreadMessageContent";
import { getTaskAgentLabel } from "./taskAgentPresets";
import {
  describeLiveCurrentWork,
  formatRelativeUpdateAge,
  inferNextLiveAction,
  resolveLatestFailureReason,
  resolveLiveActivityState,
  resolveRecentSourceCount,
  shouldShowRelativeLiveSignalAge,
  type LiveServiceStatus,
  type LiveAgentCard,
} from "./liveAgentState";
import {
  buildTimelineRenderEntries,
  compactTasksTimelineCopy,
  isFailedThreadMessage,
  isFinishedThreadMessage,
  normalizeTasksTimelineCopy,
  resolveLatestRunParticipationBadges,
  resolveThreadParticipationBadgeRoleIds,
  resolveTimelineMessage,
  shouldKeepPrimaryTimelineMessage,
  shouldRenderMessageMarkdown,
  type TimelineRenderEntry,
} from "./taskThreadConversationHelpers";
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

type PreparedLiveConversationEntry = {
  roleId: ThreadRoleId;
  label: string;
  agent: LiveAgentCard | null;
  latestEvent: LiveProcessEvent | null;
  freshestAt: string;
  recentSourceCount: number | null;
  failureReason: string;
  currentWorkDetail: string;
  displayCurrentWorkLabel: string;
  displayFailureReason: string;
  eventBadgeLabel: string;
  stageLabel: string;
};

type PreparedTimelineSingleEntry = {
  kind: "single";
  id: string;
  messageRole: ThreadMessage["role"];
  label: string;
  body: string;
  artifactPath: string;
  createdAt: string;
  renderMarkdown: boolean;
  showFinish: boolean;
  showSuccess: boolean;
  showFail: boolean;
  showParticipantBadges: boolean;
};

type PreparedTimelineGroupEntry = {
  kind: "group";
  id: string;
  text: string;
};

type PreparedTimelineEntry = PreparedTimelineSingleEntry | PreparedTimelineGroupEntry;

type ConversationParticipationBadge = {
  key: string;
  label: string;
  kind: "agent" | "provider" | "internal";
};

type TasksThreadConversationProps = {
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  recentRuntimeSessions: SessionIndexEntry[];
  visibleAgentLabels: string[];
  liveAgents: LiveAgentCard[];
  liveProcessEvents: LiveProcessEvent[];
  latestRunInternalBadges: Array<{ key: string; label: string; kind: "internal" | "provider" }>;
  approvals: ApprovalRecord[];
  runtimeHeartbeatAt: string;
  runtimeHeartbeatState: "idle" | "alive" | "error";
  runtimeServiceStatus: LiveServiceStatus | null;
  conversationRef: React.RefObject<HTMLDivElement | null>;
  onApprovePlan: () => void;
  onCancelOrchestration: () => void;
  onOpenRuntimeSession: (threadId: string) => void;
  onRequestFollowup: () => void;
  onResumeOrchestration: () => void;
  onResolveApproval: (approval: ApprovalRecord, decision: "approved" | "rejected") => void;
  onVerifyReview: () => void;
};

function hasFreshRuntimeHeartbeat(input: string, nowMs: number, windowMs = 20_000): boolean {
  const parsed = Date.parse(String(input ?? "").trim());
  return Number.isFinite(parsed) && nowMs - parsed <= windowMs;
}

function splitMessagesForTimeline(messages: ThreadMessage[]) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) {
    return {
      latestUserPromptMessageId: "",
      historicalMessages: messages,
      activeRunMessages: [] as ThreadMessage[],
    };
  }
  return {
    latestUserPromptMessageId: String(messages[latestUserIndex]?.id ?? "").trim(),
    historicalMessages: messages.slice(0, latestUserIndex),
    activeRunMessages: messages.slice(latestUserIndex),
  };
}

function prepareTimelineEntries(params: {
  entries: TimelineRenderEntry[];
  visibleAgentLabels: string[];
  latestUserPromptMessageId: string;
}): PreparedTimelineEntry[] {
  return params.entries.map((entry) => {
    if (entry.kind === "group") {
      return {
        kind: "group",
        id: entry.id,
        text: entry.messages
          .map((message) => {
            const parsed = resolveTimelineMessage(message, params.visibleAgentLabels);
            const body = normalizeTasksTimelineCopy(parsed.body);
            return parsed.label ? `${parsed.label}\n${body}` : body;
          })
          .filter(Boolean)
          .join("\n\n"),
      };
    }
    const parsed = resolveTimelineMessage(entry.message, params.visibleAgentLabels);
    return {
      kind: "single",
      id: String(entry.message.id ?? "").trim(),
      messageRole: entry.message.role,
      label: parsed.label,
      body: normalizeTasksTimelineCopy(parsed.body),
      artifactPath: parsed.artifactPath,
      createdAt: parsed.createdAt,
      renderMarkdown: shouldRenderMessageMarkdown(entry.message),
      showFinish: isFinishedThreadMessage(entry.message),
      showSuccess: isFinishedThreadMessage(entry.message),
      showFail: isFailedThreadMessage(entry.message),
      showParticipantBadges: String(entry.message.id ?? "").trim() === params.latestUserPromptMessageId,
    };
  });
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
  if (normalized === "item/completed" || normalized === "turn/completed") return "";
  if (normalized === "stage_done") return t("tasks.processEvent.done");
  if (normalized === "run_done") return t("tasks.processEvent.finished");
  if (normalized === "run_error" || normalized === "stage_error") return t("tasks.processEvent.failed");
  return "";
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

function prepareLiveConversationEntries(params: {
  entries: LiveConversationEntry[];
  latestProcessEventByRole: Map<ThreadRoleId, LiveProcessEvent>;
  roleEventsByRole: Map<ThreadRoleId, LiveProcessEvent[]>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): PreparedLiveConversationEntry[] {
  return params.entries.map((entry) => {
    const roleEvents = params.roleEventsByRole.get(entry.roleId) ?? [];
    const latestEvent = entry.latestEvent ?? params.latestProcessEventByRole.get(entry.roleId) ?? null;
    const freshestAt = String(latestEvent?.at ?? entry.agent?.updatedAt ?? "").trim();
    const recentSourceCount = resolveRecentSourceCount(roleEvents);
    const failureReason = resolveLatestFailureReason(roleEvents);
    const currentWorkLabel =
      failureReason.includes("ROLE_KB_BOOTSTRAP 실패") && recentSourceCount === 0 && String(latestEvent?.stage ?? "").trim().toLowerCase() === "codex"
        ? params.t("tasks.live.currentWork.degraded")
        : latestEvent?.message || entry.agent?.summary || params.t("tasks.live.working");
    const currentWorkDetail = describeLiveCurrentWork({
      stage: latestEvent?.stage,
      eventType: latestEvent?.type,
      failureReason,
      recentSourceCount,
    });
    return {
      roleId: entry.roleId,
      label: entry.label,
      agent: entry.agent,
      latestEvent,
      freshestAt,
      recentSourceCount,
      failureReason,
      currentWorkDetail,
      displayCurrentWorkLabel: compactTasksTimelineCopy(currentWorkLabel),
      displayFailureReason: failureReason ? compactTasksTimelineCopy(failureReason) : "",
      eventBadgeLabel: latestEvent?.type
        ? displayProcessEventBadgeLabel(latestEvent.type, params.t)
        : "",
      stageLabel: latestEvent?.stage
        ? displayProcessStage(String(latestEvent.stage ?? ""), params.t)
        : params.t("tasks.live.metric.pending"),
    };
  });
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
  interruptionBadge?: boolean;
  renderMarkdown: boolean;
  artifactPath: string;
  createdAt: string;
  showFinish: boolean;
  showSuccess: boolean;
  showFail: boolean;
}) {
  const displayedBody = props.body;
  const isTerminalResult = props.showFinish || props.showSuccess || props.showFail;
  const handleOpenKnowledgeArtifact = () => {
    const artifactPath = String(props.artifactPath ?? "").trim();
    if (!artifactPath || typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent("rail:request-open-knowledge-artifact", { detail: { artifactPath } }));
  };
  return (
    <article
      aria-label={`${props.messageRole} 메시지${props.label ? ` ${props.label}` : ""}`}
      className={`tasks-thread-message-row is-${props.messageRole}${isTerminalResult ? " is-terminal-result" : ""}`}
    >
      {props.label ? <span className="tasks-thread-message-label">{props.label}</span> : null}
      <div className={`tasks-thread-log-line${props.interruptionBadge ? " is-interruption-badge" : ""}`}>
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
          <button
            aria-label={`데이터베이스에서 산출물 열기 ${props.artifactPath}`}
            className="tasks-thread-message-artifact tasks-thread-message-artifact-link"
            onClick={handleOpenKnowledgeArtifact}
            type="button"
          >
            {props.artifactPath}
          </button>
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
    <article aria-label="시스템 로그 묶음" className="tasks-thread-message-row is-assistant is-log-group">
      <pre className="tasks-thread-log-pre">{props.text}</pre>
    </article>
  );
});

const TimelineEntryRows = memo(function TimelineEntryRows(props: {
  entries: PreparedTimelineEntry[];
  currentRunBadges: ConversationParticipationBadge[];
}) {
  return (
    <>
      {props.entries.map((entry) => {
        if (entry.kind === "group") {
          return (
            <GroupedTimelineLogRow key={entry.id} text={entry.text} />
          );
        }
        return (
          <Fragment key={entry.id}>
            <StaticTimelineMessageRow
              artifactPath={entry.artifactPath}
              body={entry.body}
              createdAt={entry.createdAt}
              label={entry.label}
              messageRole={entry.messageRole}
              renderMarkdown={entry.renderMarkdown}
              showFail={entry.showFail}
              showFinish={entry.showFinish}
              showSuccess={entry.showSuccess}
            />
            {entry.showParticipantBadges ? (
              <>
                {props.currentRunBadges.length > 0 ? (
                  <article
                    aria-label="이번 실행 참여 에이전트와 provider"
                    className="tasks-thread-message-row is-assistant is-participant-summary"
                    key={`${entry.id}:participants`}
                  >
                    <div className="tasks-thread-message-agent-list">
                      {props.currentRunBadges.map((badge) => (
                        <span
                          className={`tasks-thread-message-agent-chip${badge.kind === "provider" ? " is-provider" : ""}${badge.kind === "internal" ? " is-internal" : ""}`}
                          key={`${entry.id}:${badge.key}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </article>
                ) : null}
              </>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
});

const LiveConversationRows = memo(function LiveConversationRows(props: {
  entries: PreparedLiveConversationEntry[];
  runtimeHeartbeatAt: string;
  runtimeHeartbeatState: "idle" | "alive" | "error";
  runtimeServiceStatus: LiveServiceStatus | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (props.entries.length === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 10_000);
    return () => window.clearInterval(intervalId);
  }, [props.entries.length]);

  return (
    <>
      {props.entries.map((entry) => {
        const liveState = resolveLiveActivityState(entry.freshestAt, liveNowMs);
        const serviceResponsiveWhileStalled =
          liveState === "stalled"
          && props.runtimeHeartbeatState === "alive"
          && hasFreshRuntimeHeartbeat(props.runtimeHeartbeatAt, liveNowMs);
        const signalDisconnected =
          liveState === "stalled"
          && props.runtimeHeartbeatState === "error";
        const serviceStateLabel =
          props.runtimeServiceStatus?.state === "failed"
            ? "실패"
            : props.runtimeServiceStatus?.state === "completed"
              ? "완료"
              : props.runtimeServiceStatus?.state === "approval_required"
                ? "승인 대기"
                : props.runtimeServiceStatus?.state === "cancelled"
                  ? "중단됨"
                  : props.runtimeServiceStatus?.state === "running"
                    ? "실행 중"
                    : "상태 확인 중";
        const stateLabel =
          entry.failureReason.includes("ROLE_KB_BOOTSTRAP 실패") && entry.recentSourceCount === 0
            ? props.t("tasks.live.state.degraded")
            : serviceResponsiveWhileStalled
              ? serviceStateLabel
              : signalDisconnected
                ? props.t("tasks.live.state.disconnected")
                : liveState === "stalled"
                  ? serviceStateLabel
                  : liveState === "delayed"
                    ? props.t("tasks.live.state.delayed")
                    : props.t("tasks.live.state.active");
        const stateClassName = serviceResponsiveWhileStalled
          ? "waiting"
          : signalDisconnected
            ? "disconnected"
            : liveState;
        const nextAction = inferNextLiveAction({
          stage: entry.latestEvent?.stage,
          activityState: liveState,
          failureReason: entry.failureReason,
          interrupted: (entry.agent?.summary || "").includes("중단"),
          recentSourceCount: entry.recentSourceCount,
        });
        const liveSignalLabel =
          !shouldShowRelativeLiveSignalAge({
            activityState: liveState,
            signalDisconnected,
          })
            ? props.t("tasks.live.noRecentSignal")
            : props.t("tasks.live.lastUpdate", {
                value: formatRelativeUpdateAge(entry.freshestAt, {
                  justNow: props.t("time.justNow"),
                  minutesAgo: (value) => props.t("time.minutesAgo", { value }),
                  hoursAgo: (value) => props.t("time.hoursAgo", { value }),
                  daysAgo: (value) => props.t("time.daysAgo", { value }),
                }),
              });

        return (
          <article
            aria-label={`${entry.label} 실시간 상태`}
            className="tasks-thread-message-row is-assistant is-live-placeholder"
            key={`live:${entry.roleId}`}
          >
            <div className="tasks-thread-live-header">
              <span className="tasks-thread-message-label">{entry.label}</span>
              {entry.latestEvent?.stage ? (
                <span className="tasks-thread-live-stage-label">
                  {`${props.t("tasks.live.metric.stage")}: ${entry.stageLabel}`}
                </span>
              ) : null}
              <span className={`tasks-thread-live-state is-${stateClassName}`}>{stateLabel}</span>
              {shouldShowLiveDots(entry.latestEvent?.type ?? "", liveState) ? (
                <span aria-hidden="true" className="tasks-thread-live-dots">
                  <span className="tasks-thread-live-dot" />
                  <span className="tasks-thread-live-dot" />
                  <span className="tasks-thread-live-dot" />
                </span>
              ) : null}
              {entry.eventBadgeLabel ? (
                <span className="tasks-thread-live-event">
                  {entry.eventBadgeLabel}
                </span>
              ) : null}
            </div>
            {entry.currentWorkDetail ? (
              <div className="tasks-thread-live-detail is-explanation">
                {entry.currentWorkDetail}
              </div>
            ) : null}
            {serviceResponsiveWhileStalled ? (
              <div className="tasks-thread-live-detail is-warning">
                {props.runtimeServiceStatus?.detail || props.t("tasks.live.statusDetail.waitingLong")}
              </div>
            ) : signalDisconnected ? (
              <div className="tasks-thread-live-detail is-warning">
                {props.t("tasks.live.statusDetail.disconnected")}
              </div>
            ) : liveState === "stalled" ? (
              <div className="tasks-thread-live-detail is-warning">
                {props.runtimeServiceStatus?.detail || props.t("tasks.live.statusDetail.waitingLong")}
              </div>
            ) : null}
            <div className="tasks-thread-live-detail">{liveSignalLabel}</div>
            {entry.agent?.summary && entry.latestEvent?.message && entry.latestEvent.message !== entry.agent.summary ? (
              <div className="tasks-thread-live-detail">{entry.agent.summary}</div>
            ) : null}
            <dl className="tasks-thread-live-metrics">
              <div>
                <dt>{props.t("tasks.live.metric.stage")}</dt>
                <dd>{entry.stageLabel}</dd>
              </div>
              <div>
                <dt>{props.t("tasks.live.metric.currentWork")}</dt>
                <dd>
                  {entry.displayCurrentWorkLabel}
                  {entry.currentWorkDetail ? <span className="tasks-thread-live-metric-subcopy">{entry.currentWorkDetail}</span> : null}
                </dd>
              </div>
              <div>
                <dt>{props.t("tasks.live.metric.sourcesSeen")}</dt>
                <dd>{entry.recentSourceCount != null ? props.t("tasks.live.metric.sourcesSeenValue", { value: entry.recentSourceCount }) : props.t("tasks.live.metric.pending")}</dd>
              </div>
              <div>
                <dt>{props.t("tasks.live.metric.failureReason")}</dt>
                <dd>{entry.displayFailureReason || props.t("tasks.live.metric.none")}</dd>
              </div>
              <div>
                <dt>{props.t("tasks.live.metric.nextAction")}</dt>
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
      })}
    </>
  );
});

function TasksThreadConversationImpl(props: TasksThreadConversationProps) {
  const { t } = useI18n();
  const assignedRoleIds = useMemo(
    () => resolveThreadParticipationBadgeRoleIds(props.orchestration),
    [props.orchestration],
  );
  const {
    latestUserPromptMessageId,
    historicalMessages,
    activeRunMessages,
  } = useMemo(
    () => splitMessagesForTimeline(props.messages),
    [props.messages],
  );
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
      messages: activeRunMessages,
      liveAgents: props.liveAgents,
      internalBadges: props.latestRunInternalBadges,
    }),
    [activeRunMessages, props.latestRunInternalBadges, props.liveAgents, props.orchestration],
  );
  const historicalTimelineEntries = useMemo(
    () => buildTimelineRenderEntries(
      historicalMessages,
      assignedRoleIds,
    ),
    [assignedRoleIds, historicalMessages],
  );
  const activeRunTimelineEntries = useMemo(
    () => buildTimelineRenderEntries(
      activeRunMessages,
      assignedRoleIds,
    ),
    [activeRunMessages, assignedRoleIds],
  );
  const historicalPrimaryTimelineEntries = useMemo(
    () => historicalTimelineEntries.filter((entry) => entry.kind === "single" && shouldKeepPrimaryTimelineMessage(entry.message)),
    [historicalTimelineEntries],
  );
  const activeRunPrimaryTimelineEntries = useMemo(
    () => activeRunTimelineEntries.filter((entry) => entry.kind === "single" && shouldKeepPrimaryTimelineMessage(entry.message)),
    [activeRunTimelineEntries],
  );
  const interruptedTimelineEntries = useMemo(
    () => [...historicalTimelineEntries, ...activeRunTimelineEntries].filter((entry) => entry.kind === "single" && String(entry.message.eventKind ?? "").trim() === "run_interrupted"),
    [activeRunTimelineEntries, historicalTimelineEntries],
  );
  const preparedHistoricalTimelineEntries = useMemo(
    () => prepareTimelineEntries({
      entries: historicalPrimaryTimelineEntries,
      visibleAgentLabels: props.visibleAgentLabels,
      latestUserPromptMessageId: "",
    }),
    [historicalPrimaryTimelineEntries, props.visibleAgentLabels],
  );
  const preparedActiveRunTimelineEntries = useMemo(
    () => prepareTimelineEntries({
      entries: activeRunPrimaryTimelineEntries,
      visibleAgentLabels: props.visibleAgentLabels,
      latestUserPromptMessageId,
    }),
    [activeRunPrimaryTimelineEntries, latestUserPromptMessageId, props.visibleAgentLabels],
  );
  const preparedInterruptedTimelineEntries = useMemo(
    () => prepareTimelineEntries({
      entries: interruptedTimelineEntries,
      visibleAgentLabels: props.visibleAgentLabels,
      latestUserPromptMessageId,
    }),
    [interruptedTimelineEntries, latestUserPromptMessageId, props.visibleAgentLabels],
  );
  const preparedCombinedTimelineEntries = useMemo(
    () => [...preparedHistoricalTimelineEntries, ...preparedActiveRunTimelineEntries],
    [preparedActiveRunTimelineEntries, preparedHistoricalTimelineEntries],
  );
  const preparedLiveConversationEntries = useMemo(
    () => prepareLiveConversationEntries({
      entries: liveConversationEntries,
      latestProcessEventByRole,
      roleEventsByRole,
      t,
    }),
    [latestProcessEventByRole, liveConversationEntries, roleEventsByRole, t],
  );

  return (
    <div aria-label="Tasks 대화 스크롤 영역" className="tasks-thread-conversation-scroll" ref={props.conversationRef}>
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
      <section aria-label="대화 타임라인" className="tasks-thread-timeline" role="log">
        <TimelineEntryRows
          currentRunBadges={currentRunBadges}
          entries={preparedCombinedTimelineEntries}
        />
        <LiveConversationRows
          entries={preparedLiveConversationEntries}
          runtimeHeartbeatAt={props.runtimeHeartbeatAt}
          runtimeHeartbeatState={props.runtimeHeartbeatState}
          runtimeServiceStatus={props.runtimeServiceStatus}
          t={t}
        />
        {preparedInterruptedTimelineEntries.map((entry) => {
          if (entry.kind !== "single") {
            return null;
          }
          return (
            <StaticTimelineMessageRow
              artifactPath={entry.artifactPath}
              body={entry.body}
              createdAt={entry.createdAt}
              interruptionBadge
              key={entry.id}
              label={entry.label}
              messageRole={entry.messageRole}
              renderMarkdown={false}
              showFail={false}
              showFinish={false}
              showSuccess={false}
            />
          );
        })}
      </section>

      {props.approvals.length > 0 ? (
        <section aria-label="승인 대기 목록" className="tasks-thread-approvals-stack" role="region">
          {props.approvals.map((approval) => (
            <article aria-label={`${approval.kind} 승인 요청`} className="tasks-thread-approval-card" key={approval.id}>
              <div className="tasks-thread-section-head">
                <strong>{t("tasks.approval.required")}</strong>
                <span>{approval.kind.toUpperCase()}</span>
              </div>
              <p>{approval.summary}</p>
              <div className="tasks-thread-approval-actions">
                <button aria-label={`${approval.kind} 승인 요청 거절`} onClick={() => props.onResolveApproval(approval, "rejected")} type="button">
                  {t("tasks.approval.reject")}
                </button>
                <button
                  aria-label={`${approval.kind} 승인 요청 승인`}
                  className="tasks-thread-primary"
                  onClick={() => props.onResolveApproval(approval, "approved")}
                  type="button"
                >
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
