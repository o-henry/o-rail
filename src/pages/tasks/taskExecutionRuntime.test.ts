import { describe, expect, it, vi } from "vitest";
import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";
import { buildExecutionPlanFromCoordination, deriveExecutionPlan, dispatchTaskExecutionPlan, runBrowserExecutionPlan } from "./taskExecutionRuntime";
import type { ThreadDetail } from "./threadTypes";

function buildThreadDetail(): ThreadDetail {
  return {
    thread: {
      threadId: "thread_1",
      taskId: "task_1",
      title: "Test thread",
      userPrompt: "Compare the implementation",
      status: "idle",
      cwd: "/workspace/demo",
      branchLabel: "main",
      accessMode: "Local",
      model: "GPT-5.4",
      reasoning: "중간",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    },
    task: {
      taskId: "task_1",
      goal: "Compare the implementation",
      mode: "balanced",
      team: "full-squad",
      isolationRequested: "auto",
      isolationResolved: "current-repo",
      status: "active",
      projectPath: "/workspace/demo",
      workspacePath: "/workspace/demo",
      worktreePath: "/workspace/demo",
      branchName: "main",
      fallbackReason: null,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      roles: [],
      prompts: [],
    },
    messages: [],
    agents: [
      {
        id: "thread_1:researcher",
        threadId: "thread_1",
        label: "Researcher",
        roleId: "researcher",
        status: "idle",
        summary: "Research sources",
        worktreePath: "/workspace/demo",
        lastUpdatedAt: "2026-03-20T00:00:00.000Z",
      },
      {
        id: "thread_1:unity_architect",
        threadId: "thread_1",
        label: "Architect",
        roleId: "unity_architect",
        status: "idle",
        summary: "Review architecture",
        worktreePath: "/workspace/demo",
        lastUpdatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    approvals: [],
    agentDetail: null,
    artifacts: {},
    changedFiles: [],
    validationState: "pending",
    riskLevel: "medium",
    files: [],
    workflow: {
      currentStageId: "brief",
      stages: [],
      nextAction: "Wait",
      readinessSummary: "Ready",
    },
    orchestration: null,
  };
}

function buildCoordination(overrides: Partial<AgenticCoordinationState> = {}): AgenticCoordinationState {
  return {
    threadId: "thread_1",
    prompt: "Compare architecture and review",
    requestedRoleIds: ["researcher", "unity_architect"],
    recommendedMode: "team",
    mode: "team",
    intent: "review_heavy",
    status: "planning",
    nextAction: "Approve the plan",
    blockedReason: null,
    plan: null,
    delegateTasks: [],
    delegateResults: [],
    teamSession: null,
    resumePointer: null,
    guidance: [],
    updatedAt: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("taskExecutionRuntime", () => {
  it("forces quick mode to a single participant", () => {
    const plan = deriveExecutionPlan({
      enabledRoleIds: ["researcher", "unity_architect"],
      requestedRoleIds: ["researcher", "unity_architect"],
      prompt: "Compare and review",
      selectedMode: "quick",
    });
    expect(plan.mode).toBe("single");
    expect(plan.participantRoleIds).toHaveLength(1);
  });

  it("builds coordination execution plan respecting quick mode", () => {
    const plan = buildExecutionPlanFromCoordination(
      buildThreadDetail(),
      buildCoordination({ mode: "quick", requestedRoleIds: ["researcher", "unity_architect"] }),
    );
    expect(plan.mode).toBe("single");
    expect(plan.participantRoleIds).toEqual(["researcher"]);
  });

  it("dispatches a collaboration action for discussion plans", () => {
    const publishAction = vi.fn();
    dispatchTaskExecutionPlan({
      detail: buildThreadDetail(),
      prompt: "Compare and review",
      plan: deriveExecutionPlan({
        enabledRoleIds: ["researcher", "unity_architect"],
        requestedRoleIds: ["researcher", "unity_architect"],
        prompt: "Compare and review",
      }),
      publishAction,
    });
    expect(publishAction).toHaveBeenCalledWith(expect.objectContaining({ type: "run_task_collaboration" }));
  });

  it("creates a browser approval when multiple roles run in sequence", () => {
    const detail = buildThreadDetail();
    runBrowserExecutionPlan({
      detail,
      prompt: "Review the implementation",
      plan: {
        mode: "single",
        participantRoleIds: ["researcher", "unity_architect"],
        primaryRoleId: "researcher",
        synthesisRoleId: "researcher",
        maxParticipants: 3,
        maxRounds: 1,
        cappedParticipantCount: false,
      },
      timestamp: "2026-03-20T00:01:00.000Z",
      createId: (prefix) => `${prefix}_1`,
    });
    expect(detail.approvals).toHaveLength(1);
    expect(detail.messages.some((entry) => entry.eventKind === "agent_batch_running")).toBe(true);
  });
});
