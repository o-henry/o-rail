import type {
  AgenticCoordinationState,
  BackgroundDelegationResult,
  RuntimeLedgerEvent,
  SessionIndexEntry,
  SessionResumePointer,
} from "./coordinationTypes";
import { nextCoordinationId } from "./coordinationScaffold";

export function readyCoordinationForExecution(
  state: AgenticCoordinationState,
  at = new Date().toISOString(),
): AgenticCoordinationState {
  if (state.mode !== "team" || !state.plan?.requiresApproval || state.plan.approvedAt) {
    return state;
  }
  return approveCoordinationPlan(state, at);
}

export function approveCoordinationPlan(state: AgenticCoordinationState, at = new Date().toISOString()): AgenticCoordinationState {
  if (!state.plan) {
    return state;
  }
  return {
    ...state,
    status: "planning",
    nextAction: state.mode === "team" ? "Start the team run." : state.nextAction,
    blockedReason: null,
    plan: {
      ...state.plan,
      approvedAt: at,
      steps: state.plan.steps.map((step) =>
        step.id === "plan" || step.id === "approve"
          ? { ...step, status: "done" }
          : step.id === "execute"
            ? { ...step, status: "active" }
            : step,
      ),
    },
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "planning",
          nextAction: "Start the team run.",
          blockedReason: null,
          lanes: state.teamSession.lanes.map((lane) =>
            lane.id === "planner"
              ? { ...lane, status: "done", summary: "Plan approved.", updatedAt: at }
              : lane.id === "implementer"
                ? { ...lane, status: "queued", summary: "Ready to execute.", updatedAt: at }
                : lane,
          ),
          updatedAt: at,
        }
      : null,
    updatedAt: at,
  };
}

export function startCoordinationRun(state: AgenticCoordinationState, at = new Date().toISOString()): AgenticCoordinationState {
  return {
    ...state,
    status: "running",
    nextAction: state.mode === "quick" ? "Wait for the primary role result." : "Wait for delegate results, then synthesize.",
    delegateTasks: state.delegateTasks.map((task) => ({
      ...task,
      status: task.status === "queued" ? "running" : task.status,
      summary: task.status === "queued" ? "Running" : task.summary,
      updatedAt: at,
    })),
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "running",
          nextAction: "Wait for implementer and reviewer updates.",
          lanes: state.teamSession.lanes.map((lane) =>
            lane.id === "implementer"
              ? { ...lane, status: "active", summary: "Implementation is running.", updatedAt: at }
              : lane.id === "reviewer"
                ? { ...lane, status: "review", summary: "Will verify after execution.", updatedAt: at }
                : lane,
          ),
          updatedAt: at,
        }
      : null,
    updatedAt: at,
  };
}

export function completeDelegateTask(
  state: AgenticCoordinationState,
  params: { taskId: string; summary: string; at?: string },
): AgenticCoordinationState {
  const updatedAt = params.at ?? new Date().toISOString();
  const task = state.delegateTasks.find((item) => item.id === params.taskId);
  if (!task) {
    return state;
  }
  const result: BackgroundDelegationResult = {
    id: nextCoordinationId("result"),
    taskId: task.id,
    title: task.title,
    summary: params.summary,
    updatedAt,
  };
  return {
    ...state,
    delegateTasks: state.delegateTasks.map((item) =>
      item.id === params.taskId
        ? { ...item, status: "completed", summary: params.summary, updatedAt }
        : item,
    ),
    delegateResults: [result, ...state.delegateResults].slice(0, 6),
    updatedAt,
  };
}

export function markCoordinationWaitingReview(state: AgenticCoordinationState, at = new Date().toISOString()): AgenticCoordinationState {
  return {
    ...state,
    status: "waiting_review",
    nextAction: "Review the result, then verify it or request follow-up changes.",
    blockedReason: null,
    plan: state.plan
      ? {
          ...state.plan,
          steps: state.plan.steps.map((step) =>
            step.id === "execute"
              ? { ...step, status: "done" }
              : step.id === "verify"
                ? { ...step, status: "active" }
                : step,
          ),
        }
      : null,
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "waiting_review",
          nextAction: "Review the result, then verify it or request follow-up changes.",
          blockedReason: null,
          lanes: state.teamSession.lanes.map((lane) =>
            lane.id === "implementer"
              ? { ...lane, status: "done", summary: "Implementation finished. Waiting for review.", updatedAt: at }
              : lane.id === "reviewer"
                ? { ...lane, status: "review", summary: "Reviewing the result before final verification.", updatedAt: at }
                : lane,
          ),
          updatedAt: at,
        }
      : null,
    updatedAt: at,
  };
}

export function blockCoordinationRun(
  state: AgenticCoordinationState,
  params: { reason: string; nextAction: string; at?: string },
): AgenticCoordinationState {
  const updatedAt = params.at ?? new Date().toISOString();
  const resumePointer: SessionResumePointer = {
    threadId: state.threadId,
    label: "Resume team run",
    reason: params.reason,
    nextAction: params.nextAction,
  };
  return {
    ...state,
    status: "needs_resume",
    nextAction: params.nextAction,
    blockedReason: params.reason,
    resumePointer,
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "needs_resume",
          blockedReason: params.reason,
          resumeHint: params.nextAction,
          updatedAt,
        }
      : null,
    updatedAt,
  };
}

export function reopenCoordinationRun(
  state: AgenticCoordinationState,
  params: { reason: string; nextAction: string; at?: string },
): AgenticCoordinationState {
  const updatedAt = params.at ?? new Date().toISOString();
  const resumePointer: SessionResumePointer = {
    threadId: state.threadId,
    label: "Resume follow-up changes",
    reason: params.reason,
    nextAction: params.nextAction,
  };
  return {
    ...state,
    status: "needs_resume",
    nextAction: params.nextAction,
    blockedReason: params.reason,
    resumePointer,
    plan: state.plan
      ? {
          ...state.plan,
          steps: state.plan.steps.map((step) =>
            step.id === "execute"
              ? { ...step, status: "active" }
              : step.id === "verify"
                ? { ...step, status: "pending" }
                : step,
          ),
        }
      : null,
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "needs_resume",
          nextAction: params.nextAction,
          blockedReason: params.reason,
          resumeHint: params.nextAction,
          lanes: state.teamSession.lanes.map((lane) =>
            lane.id === "implementer"
              ? { ...lane, status: "blocked", summary: "Waiting to resume follow-up changes.", updatedAt }
              : lane.id === "reviewer"
                ? { ...lane, status: "blocked", summary: "Requested follow-up changes before verification.", updatedAt }
                : lane,
          ),
          updatedAt,
        }
      : null,
    updatedAt,
  };
}

export function completeCoordinationRun(state: AgenticCoordinationState, at = new Date().toISOString()): AgenticCoordinationState {
  return {
    ...state,
    status: "completed",
    nextAction: "Execution finished. Review artifacts or open the thread again later.",
    blockedReason: null,
    plan: state.plan
      ? {
          ...state.plan,
          steps: state.plan.steps.map((step) => ({ ...step, status: "done" })),
        }
      : null,
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "completed",
          nextAction: "Completed.",
          blockedReason: null,
          lanes: state.teamSession.lanes.map((lane) => ({ ...lane, status: "done", updatedAt: at })),
          updatedAt: at,
        }
      : null,
    updatedAt: at,
  };
}

export function cancelCoordinationRun(state: AgenticCoordinationState, at = new Date().toISOString()): AgenticCoordinationState {
  return {
    ...state,
    status: "cancelled",
    nextAction: "Cancelled. Resume only if the request still matters.",
    blockedReason: "Cancelled by operator.",
    teamSession: state.teamSession
      ? {
          ...state.teamSession,
          status: "cancelled",
          nextAction: "Cancelled.",
          blockedReason: "Cancelled by operator.",
          lanes: state.teamSession.lanes.map((lane) => ({ ...lane, status: "cancelled", updatedAt: at })),
          updatedAt: at,
        }
      : null,
    delegateTasks: state.delegateTasks.map((task) => ({
      ...task,
      status: task.status === "completed" ? task.status : "cancelled",
      updatedAt: at,
    })),
    updatedAt: at,
  };
}
export function deriveSessionIndexEntry(state: AgenticCoordinationState, title: string): SessionIndexEntry {
  return {
    threadId: state.threadId,
    title: String(title ?? "").trim() || "Untitled runtime session",
    mode: state.mode,
    intent: state.intent,
    status: state.status,
    nextAction: state.nextAction,
    updatedAt: state.updatedAt,
  };
}
export function createRuntimeLedgerEvent(params: {
  threadId: string;
  kind: RuntimeLedgerEvent["kind"];
  summary: string;
  at?: string;
}): RuntimeLedgerEvent {
  return {
    id: nextCoordinationId("ledger"),
    threadId: params.threadId,
    kind: params.kind,
    summary: params.summary,
    at: params.at ?? new Date().toISOString(),
  };
}
