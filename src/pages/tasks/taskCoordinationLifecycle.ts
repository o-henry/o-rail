import { blockCoordinationRun, completeCoordinationRun } from "../../features/orchestration/agentic/coordination";
import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";
import { isLiveBackgroundAgentStatus } from "./liveAgentState";
import type { ThreadDetail } from "./threadTypes";

const STALE_RUNTIME_WINDOW_MS = 4 * 60 * 1000;

export type CoordinationRunSettlement =
  | { kind: "pending" }
  | { kind: "completed"; summary: string }
  | { kind: "blocked"; reason: string; nextAction: string; summary: string };

function failedAgentSummary(thread: ThreadDetail): CoordinationRunSettlement | null {
  const failedAgents = thread.agents.filter((agent) => String(agent.status ?? "").trim().toLowerCase() === "failed");
  if (failedAgents.length === 0) {
    return null;
  }
  const labels = failedAgents
    .map((agent) => String(agent.label || agent.roleId || "agent").trim())
    .filter(Boolean);
  const preview = labels.slice(0, 2).join(", ");
  return {
    kind: "blocked",
    reason:
      failedAgents.length === 1
        ? `${preview || "A background agent"} failed.`
        : `${failedAgents.length} background agents failed${preview ? `: ${preview}` : ""}.`,
    nextAction: "Review the failed agent output, then retry or adjust the request.",
    summary: "Runtime session blocked because one or more agent runs failed",
  };
}

function failedThreadSummary(thread: ThreadDetail): CoordinationRunSettlement | null {
  const normalizedStatus = String(thread.thread.status ?? "").trim().toLowerCase();
  if (!normalizedStatus || (normalizedStatus !== "failed" && normalizedStatus !== "error" && normalizedStatus !== "cancelled")) {
    return null;
  }
  return {
    kind: "blocked",
    reason: `Thread finished with ${normalizedStatus}.`,
    nextAction: "Inspect the failed run details and retry with a narrower request if needed.",
    summary: "Runtime session blocked because the thread finished in a failed state",
  };
}

function toTimestamp(value: string | null | undefined): number | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function staleRuntimeSummary(
  thread: ThreadDetail,
  coordination: AgenticCoordinationState,
  nowMs: number,
): CoordinationRunSettlement | null {
  const liveAgents = thread.agents.filter((agent) => isLiveBackgroundAgentStatus(agent.status));
  if (liveAgents.length === 0) {
    return null;
  }
  const freshestAgentUpdateMs = liveAgents
    .map((agent) => toTimestamp(agent.lastUpdatedAt))
    .filter((value): value is number => typeof value === "number")
    .reduce<number | null>((latest, current) => (latest === null || current > latest ? current : latest), null);
  const coordinationUpdatedMs = toTimestamp(coordination.updatedAt);
  const referenceMs = freshestAgentUpdateMs ?? coordinationUpdatedMs;
  if (referenceMs === null || nowMs - referenceMs < STALE_RUNTIME_WINDOW_MS) {
    return null;
  }
  return {
    kind: "blocked",
    reason: "Runtime session stopped reporting progress.",
    nextAction: "Resume the task to restart the stalled agent run.",
    summary: "Runtime session appears to be stuck and needs operator resume",
  };
}

export function settleRunningCoordinationRun(
  thread: ThreadDetail | null | undefined,
  coordination: AgenticCoordinationState | null | undefined,
  nowMs = Date.now(),
): CoordinationRunSettlement {
  if (!thread || !coordination || coordination.status !== "running") {
    return { kind: "pending" };
  }
  const staleRuntime = staleRuntimeSummary(thread, coordination, nowMs);
  if (staleRuntime) {
    return staleRuntime;
  }
  if (thread.agents.some((agent) => isLiveBackgroundAgentStatus(agent.status))) {
    return { kind: "pending" };
  }
  if (thread.approvals.some((approval) => approval.status === "pending")) {
    return { kind: "pending" };
  }
  return failedAgentSummary(thread) ?? failedThreadSummary(thread) ?? {
    kind: "completed",
    summary: "Runtime session completed",
  };
}

export function applyCoordinationSettlement(
  state: AgenticCoordinationState,
  settlement: CoordinationRunSettlement,
): AgenticCoordinationState {
  if (settlement.kind === "completed") {
    return completeCoordinationRun(state);
  }
  if (settlement.kind === "blocked") {
    return blockCoordinationRun(state, {
      reason: settlement.reason,
      nextAction: settlement.nextAction,
    });
  }
  return state;
}
