import { describe, expect, it } from "vitest";
import { applyCoordinationSettlement, settleRunningCoordinationRun } from "./taskCoordinationLifecycle";
import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";
import type { ThreadDetail } from "./threadTypes";

function buildCoordinationState(): AgenticCoordinationState {
  return {
    threadId: "thread-1",
    prompt: "test",
    requestedRoleIds: ["researcher"],
    recommendedMode: "fanout",
    mode: "fanout",
    intent: "research",
    status: "running",
    nextAction: "Wait",
    blockedReason: null,
    plan: null,
    delegateTasks: [],
    delegateResults: [],
    teamSession: null,
    resumePointer: null,
    guidance: [],
    updatedAt: "2026-03-21T00:00:00.000Z",
  };
}

function buildThread(overrides?: Partial<ThreadDetail>): ThreadDetail {
  return {
    thread: {
      threadId: "thread-1",
      taskId: "task-1",
      title: "Example",
      userPrompt: "Prompt",
      status: "running",
      cwd: "/tmp/project",
      accessMode: "Local",
      model: "5.4",
      reasoning: "중간",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    },
    task: {
      taskId: "task-1",
      projectPath: "/tmp/project",
      workspacePath: "/tmp/project",
      worktreePath: null,
      title: "Example",
      userPrompt: "Prompt",
      status: "running",
      accessMode: "Local",
      branchLabel: null,
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    },
    messages: [],
    agents: [],
    approvals: [],
    artifacts: {},
    changedFiles: [],
    validationState: "pending",
    riskLevel: "low",
    files: [],
    workflow: {
      currentStageId: "plan",
      stages: [],
      nextAction: "Wait",
      readinessSummary: "Ready",
    },
    ...overrides,
  } as ThreadDetail;
}

describe("settleRunningCoordinationRun", () => {
  it("stays pending while live agents or approvals remain", () => {
    const settlement = settleRunningCoordinationRun(
      buildThread({
        agents: [{ id: "a1", threadId: "thread-1", label: "RESEARCHER", roleId: "researcher", status: "thinking", lastUpdatedAt: "2026-03-21T00:00:01.000Z" }],
      }),
      buildCoordinationState(),
      Date.parse("2026-03-21T00:03:00.000Z"),
    );
    expect(settlement).toEqual({ kind: "pending" });
  });

  it("blocks when live agents stop reporting progress for too long", () => {
    const settlement = settleRunningCoordinationRun(
      buildThread({
        agents: [{ id: "a1", threadId: "thread-1", label: "RESEARCHER", roleId: "researcher", status: "thinking", lastUpdatedAt: "2026-03-21T00:00:01.000Z" }],
      }),
      buildCoordinationState(),
      Date.parse("2026-03-21T00:05:30.000Z"),
    );
    expect(settlement).toEqual({
      kind: "blocked",
      reason: "Runtime session stopped reporting progress.",
      nextAction: "Resume the task to restart the stalled agent run.",
      summary: "Runtime session appears to be stuck and needs operator resume",
    });
  });

  it("blocks when any agent failed", () => {
    const settlement = settleRunningCoordinationRun(
      buildThread({
        agents: [{ id: "a1", threadId: "thread-1", label: "RESEARCHER", roleId: "researcher", status: "failed", lastUpdatedAt: "2026-03-21T00:00:01.000Z" }],
      }),
      buildCoordinationState(),
    );
    expect(settlement.kind).toBe("blocked");
    expect(settlement).toMatchObject({
      reason: "RESEARCHER failed.",
    });
  });

  it("stays pending when runtime has started but no terminal evidence exists yet", () => {
    const settlement = settleRunningCoordinationRun(buildThread(), buildCoordinationState());
    expect(settlement).toEqual({ kind: "pending" });
  });

  it("completes only after terminal evidence exists", () => {
    const settlement = settleRunningCoordinationRun(
      buildThread({
        thread: {
          ...buildThread().thread,
          status: "completed",
        },
      }),
      buildCoordinationState(),
    );
    expect(settlement).toEqual({
      kind: "completed",
      summary: "Runtime session completed",
    });
  });
});

describe("applyCoordinationSettlement", () => {
  it("blocks the coordination state when settlement is blocked", () => {
    const next = applyCoordinationSettlement(buildCoordinationState(), {
      kind: "blocked",
      reason: "RESEARCHER failed.",
      nextAction: "Retry it.",
      summary: "blocked",
    });
    expect(next.status).toBe("needs_resume");
    expect(next.blockedReason).toBe("RESEARCHER failed.");
  });
});
