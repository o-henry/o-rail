import type { MutableRefObject } from "react";

import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import {
  approveCoordinationPlan,
  cancelCoordinationRun,
  completeCoordinationRun,
  reopenCoordinationRun,
  startCoordinationRun,
} from "../../features/orchestration/agentic/coordination";
import type { AgenticCoordinationState, RuntimeLedgerEvent } from "../../features/orchestration/agentic/coordinationTypes";
import { buildExecutionPlanFromCoordination, runBrowserExecutionPlan, runRuntimeExecutionPlan } from "./taskExecutionRuntime";
import { loadThreadAgentDetail } from "./taskThreadAgentDetail";
import { createBrowserMessage, truncateTitle } from "./taskThreadBrowserState";
import { withTaskCoordination } from "./taskOrchestrationState";
import { cloneStore, type BrowserStore } from "./taskThreadStorageState";
import type { ThreadDetail } from "./threadTypes";
import { isLiveBackgroundAgentStatus } from "./liveAgentState";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type UpdateThreadCoordination = (
  threadId: string,
  updater: (current: AgenticCoordinationState | null) => AgenticCoordinationState | null,
  event?: { kind: RuntimeLedgerEvent["kind"]; summary: string },
) => AgenticCoordinationState | null;

type CommonCoordinationActionDeps = {
  activeThread: ThreadDetail;
  activeThreadCoordination: AgenticCoordinationState | null;
  applyBrowserStore: (store: BrowserStore, preferredThreadId?: string) => ThreadDetail | null;
  browserStoreRef: MutableRefObject<BrowserStore>;
  createId: (prefix: string) => string;
  cwd: string;
  hasTauriRuntime: boolean;
  hydrateThreadDetail: (detail: ThreadDetail | null) => ThreadDetail | null;
  invokeFn: InvokeFn;
  publishAction: (action: AgenticAction) => void;
  setActiveThread: React.Dispatch<React.SetStateAction<ThreadDetail | null>>;
  setStatus: (message: string) => void;
  syncSpawnedThreadSelection: (detail: ThreadDetail) => Promise<void>;
  timestampFactory: () => string;
  updateThreadCoordination: UpdateThreadCoordination;
};

function rollbackCoordinationStart(
  deps: CommonCoordinationActionDeps,
  previousThread: ThreadDetail,
  previousCoordination: AgenticCoordinationState,
) {
  deps.updateThreadCoordination(
    previousThread.thread.threadId,
    () => previousCoordination,
    { kind: "run_blocked", summary: "Restored previous orchestration state after a failed launch attempt" },
  );
  deps.setActiveThread((current) => (
    current
      ? withTaskCoordination({
        ...current,
        thread: {
          ...current.thread,
          status: previousThread.thread.status,
          updatedAt: previousThread.thread.updatedAt,
        },
      }, previousCoordination)
      : withTaskCoordination(previousThread, previousCoordination)
  ));
}

export async function approveCoordinationPlanAction(deps: CommonCoordinationActionDeps) {
  const { activeThread, activeThreadCoordination } = deps;
  if (!activeThreadCoordination) {
    return;
  }
  const approved = deps.updateThreadCoordination(
    activeThread.thread.threadId,
    (current) => (current ? approveCoordinationPlan(current) : current),
    { kind: "plan_approved", summary: "Approved team plan" },
  );
  if (!approved) {
    return;
  }
  const executionPlan = buildExecutionPlanFromCoordination(activeThread, approved);
  try {
    if (!deps.hasTauriRuntime || !deps.cwd) {
      const store = cloneStore(deps.browserStoreRef.current);
      const detail = store.details[activeThread.thread.threadId];
      if (!detail) {
        return;
      }
      const timestamp = deps.timestampFactory();
      const running = deps.updateThreadCoordination(
        detail.thread.threadId,
        () => startCoordinationRun(approved, timestamp),
        { kind: "run_started", summary: "Started approved team run" },
      ) ?? approved;
      runBrowserExecutionPlan({
        detail,
        prompt: approved.prompt,
        plan: executionPlan,
        timestamp,
        createId: deps.createId,
      });
      detail.orchestration = running;
      store.details[detail.thread.threadId] = withTaskCoordination(detail, running);
      deps.applyBrowserStore(store, detail.thread.threadId);
      deps.setStatus(`Team run started: ${truncateTitle(detail.thread.title)}`);
      return;
    }
    const running = deps.updateThreadCoordination(
      activeThread.thread.threadId,
      () => startCoordinationRun(approved),
      { kind: "run_started", summary: "Started approved team run" },
    ) ?? approved;
    const spawned = await runRuntimeExecutionPlan({
      detail: activeThread,
      prompt: approved.prompt,
      plan: executionPlan,
      cwd: deps.cwd,
      invokeFn: deps.invokeFn,
      hydrateThreadDetail: deps.hydrateThreadDetail,
      publishAction: deps.publishAction,
    });
    await deps.syncSpawnedThreadSelection(spawned);
    deps.setActiveThread(withTaskCoordination(spawned, running));
    deps.setStatus(`Team run started: ${truncateTitle(spawned.thread.title)}`);
  } catch (error) {
    rollbackCoordinationStart(deps, activeThread, activeThreadCoordination);
    deps.setStatus(`Failed to start team run: ${error instanceof Error ? error.message : String(error ?? "Unknown error")}`);
  }
}

export async function cancelCoordinationAction(deps: CommonCoordinationActionDeps) {
  if (!deps.activeThreadCoordination) {
    return;
  }
  try {
    const timestamp = deps.timestampFactory();
    if (deps.hasTauriRuntime && deps.cwd) {
      const runningAgents = deps.activeThread.agents.filter((agent) => isLiveBackgroundAgentStatus(agent.status));
      const agentDetails = await Promise.all(
        runningAgents.map((agent) => loadThreadAgentDetail({
          threadId: deps.activeThread.thread.threadId,
          agentId: agent.id,
          hasTauriRuntime: deps.hasTauriRuntime,
          cwd: deps.cwd,
          invokeFn: deps.invokeFn,
        }).catch(() => null)),
      );
      const codexThreadIds = [...new Set(
        agentDetails
          .map((detail) => String(detail?.codexThreadId ?? "").trim())
          .filter(Boolean),
      )];
      await Promise.all(codexThreadIds.map((threadId) => deps.invokeFn("turn_interrupt", { threadId })));
    }
    const cancelled = deps.updateThreadCoordination(
      deps.activeThread.thread.threadId,
      (current) => (current ? cancelCoordinationRun(current, timestamp) : current),
      { kind: "run_cancelled", summary: "Cancelled orchestration run" },
    );
    if (cancelled) {
      deps.setActiveThread((current) => (
        current
          ? withTaskCoordination({
            ...current,
            thread: {
              ...current.thread,
              status: "cancelled",
              updatedAt: timestamp,
            },
          }, cancelled)
          : current
      ));
    }
    deps.setStatus(`Cancelled runtime session: ${truncateTitle(deps.activeThread.thread.title)}`);
  } catch (error) {
    deps.setStatus(`Failed to cancel runtime session: ${error instanceof Error ? error.message : String(error ?? "Unknown error")}`);
  }
}

export async function resumeCoordinationAction(deps: CommonCoordinationActionDeps) {
  const { activeThread, activeThreadCoordination } = deps;
  if (!activeThreadCoordination?.resumePointer) {
    return;
  }
  const resumed = deps.updateThreadCoordination(
    activeThread.thread.threadId,
    (current) => (
      current
        ? startCoordinationRun({
            ...current,
            status: "planning",
            blockedReason: null,
            resumePointer: null,
          })
        : current
    ),
    { kind: "resume_requested", summary: "Resume requested for runtime session" },
  );
  if (!resumed) {
    return;
  }
  const executionPlan = buildExecutionPlanFromCoordination(activeThread, resumed);
  try {
    if (!deps.hasTauriRuntime || !deps.cwd) {
      const store = cloneStore(deps.browserStoreRef.current);
      const detail = store.details[activeThread.thread.threadId];
      if (!detail) {
        return;
      }
      const timestamp = deps.timestampFactory();
      runBrowserExecutionPlan({
        detail,
        prompt: resumed.prompt,
        plan: executionPlan,
        timestamp,
        createId: deps.createId,
      });
      detail.orchestration = resumed;
      store.details[detail.thread.threadId] = withTaskCoordination(detail, resumed);
      deps.applyBrowserStore(store, detail.thread.threadId);
      deps.setStatus(`Resumed runtime session: ${truncateTitle(detail.thread.title)}`);
      return;
    }
    const spawned = await runRuntimeExecutionPlan({
      detail: activeThread,
      prompt: resumed.prompt,
      plan: executionPlan,
      cwd: deps.cwd,
      invokeFn: deps.invokeFn,
      hydrateThreadDetail: deps.hydrateThreadDetail,
      publishAction: deps.publishAction,
    });
    await deps.syncSpawnedThreadSelection(spawned);
    deps.setActiveThread(withTaskCoordination(spawned, resumed));
    deps.setStatus(`Resumed runtime session: ${truncateTitle(spawned.thread.title)}`);
  } catch (error) {
    rollbackCoordinationStart(deps, activeThread, activeThreadCoordination);
    deps.setStatus(`Failed to resume team run: ${error instanceof Error ? error.message : String(error ?? "Unknown error")}`);
  }
}

export function verifyCoordinationReviewAction(deps: CommonCoordinationActionDeps) {
  const { activeThread, activeThreadCoordination } = deps;
  if (!activeThreadCoordination || activeThreadCoordination.status !== "waiting_review") {
    return;
  }
  const timestamp = deps.timestampFactory();
  const verified = deps.updateThreadCoordination(
    activeThread.thread.threadId,
    (current) => (current ? completeCoordinationRun(current, timestamp) : current),
    { kind: "run_completed", summary: "Runtime session verified and completed" },
  );
  if (!verified) {
    return;
  }
  if (!deps.hasTauriRuntime || !deps.cwd) {
    const store = cloneStore(deps.browserStoreRef.current);
    const detail = store.details[activeThread.thread.threadId];
    if (detail) {
      detail.thread.status = "completed";
      detail.thread.updatedAt = timestamp;
      detail.messages.push(
        createBrowserMessage(
          detail.thread.threadId,
          "system",
          "Review verified. The runtime session is complete.",
          timestamp,
          { eventKind: "coordination_review_verified" },
        ),
      );
      detail.orchestration = verified;
      store.details[detail.thread.threadId] = withTaskCoordination(detail, verified);
      deps.applyBrowserStore(store, detail.thread.threadId);
    }
  } else {
    deps.setActiveThread((current) => (
      current
        ? withTaskCoordination({
          ...current,
          thread: {
            ...current.thread,
            status: "completed",
            updatedAt: timestamp,
          },
        }, verified)
        : current
    ));
  }
  deps.setStatus(`Runtime session verified: ${truncateTitle(activeThread.thread.title)}`);
}

export function requestCoordinationFollowupAction(deps: CommonCoordinationActionDeps) {
  const { activeThread, activeThreadCoordination } = deps;
  if (!activeThreadCoordination || activeThreadCoordination.status !== "waiting_review") {
    return;
  }
  const timestamp = deps.timestampFactory();
  const reopened = deps.updateThreadCoordination(
    activeThread.thread.threadId,
    (current) => (
      current
        ? reopenCoordinationRun(current, {
            reason: "Reviewer requested follow-up changes.",
            nextAction: "Resume the team run to address the review feedback.",
            at: timestamp,
          })
        : current
    ),
    { kind: "review_reopened", summary: "Runtime session reopened for follow-up changes" },
  );
  if (!reopened) {
    return;
  }
  if (!deps.hasTauriRuntime || !deps.cwd) {
    const store = cloneStore(deps.browserStoreRef.current);
    const detail = store.details[activeThread.thread.threadId];
    if (detail) {
      detail.thread.status = "active";
      detail.thread.updatedAt = timestamp;
      detail.messages.push(
        createBrowserMessage(
          detail.thread.threadId,
          "system",
          "Review requested follow-up changes. Resume the team run to continue.",
          timestamp,
          { eventKind: "coordination_review_reopened" },
        ),
      );
      detail.orchestration = reopened;
      store.details[detail.thread.threadId] = withTaskCoordination(detail, reopened);
      deps.applyBrowserStore(store, detail.thread.threadId);
    }
  } else {
    deps.setActiveThread((current) => (
      current
        ? withTaskCoordination({
          ...current,
          thread: {
            ...current.thread,
            status: "active",
            updatedAt: timestamp,
          },
        }, reopened)
        : current
    ));
  }
  deps.setStatus(`Follow-up requested: ${truncateTitle(activeThread.thread.title)}`);
}
