import { describe, expect, it } from "vitest";
import { UNITY_DEFAULT_THREAD_PRESET_IDS } from "./taskAgentPresets";
import { deriveThreadWorkflow } from "./threadWorkflow";
import type { ThreadDetail } from "./threadTypes";

function buildDetail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  const updatedAt = "2026-03-18T12:00:00.000Z";
  return {
    thread: {
      threadId: "thread-1",
      taskId: "task-1",
      title: "Add boss arena",
      userPrompt: "Add a boss arena to the dungeon scene.",
      status: "active",
      cwd: "/tmp/project",
      branchLabel: null,
      accessMode: "Local",
      model: "5.4",
      reasoning: "MEDIUM",
      createdAt: updatedAt,
      updatedAt,
    },
    task: {
      taskId: "task-1",
      goal: "Add a boss arena to the dungeon scene.",
      mode: "balanced",
      team: "full-squad",
      isolationRequested: "auto",
      isolationResolved: "auto",
      status: "active",
      projectPath: "/tmp/project",
      workspacePath: "/tmp/project",
      worktreePath: null,
      branchName: null,
      fallbackReason: null,
      createdAt: updatedAt,
      updatedAt,
      roles: UNITY_DEFAULT_THREAD_PRESET_IDS.map((roleId) => ({
        id: roleId,
        label: roleId.replace(/_/g, " ").toUpperCase(),
        studioRoleId: `${roleId}-studio`,
        enabled: true,
        status: "ready",
        lastPrompt: null,
        lastPromptAt: null,
        lastRunId: null,
        artifactPaths: [],
        updatedAt,
      })),
      prompts: [],
    },
    messages: [],
    agents: [],
    approvals: [],
    agentDetail: null,
    artifacts: {
      brief: "# BRIEF\n\n- pending",
      findings: "# FINDINGS\n\n- pending",
      plan: "# PLAN\n\n- pending",
      patch: "# PATCH\n\n- pending",
      validation: "# VALIDATION\n\n- pending",
      handoff: "# HANDOFF\n\n- pending",
    },
    changedFiles: [],
    validationState: "pending",
    riskLevel: "low",
    files: [],
    workflow: {} as ThreadDetail["workflow"],
    ...overrides,
  };
}

describe("deriveThreadWorkflow", () => {
  it("prioritizes active stages ahead of earlier incomplete stages", () => {
    const workflow = deriveThreadWorkflow(buildDetail({
      agents: [
        {
          id: "thread-1:qa_playtester",
          threadId: "thread-1",
          label: "QA PLAYTESTER",
          roleId: "qa_playtester",
          status: "thinking",
          summary: null,
          worktreePath: "/tmp/project",
          lastUpdatedAt: "2026-03-18T12:01:00.000Z",
        },
      ],
    }));

    expect(workflow.currentStageId).toBe("playtest");
    expect(workflow.stages.find((stage) => stage.id === "playtest")?.status).toBe("active");
  });

  it("falls back to the latest evidence stage when nothing is actively running", () => {
    const workflow = deriveThreadWorkflow(buildDetail({
      changedFiles: ["Assets/Scripts/BossArenaController.cs"],
    }));

    expect(workflow.currentStageId).toBe("implement");
    expect(workflow.stages.find((stage) => stage.id === "implement")?.status).toBe("done");
  });

  it("marks integrate as blocked when approvals are pending", () => {
    const workflow = deriveThreadWorkflow(buildDetail({
      approvals: [
        {
          id: "approval-1",
          threadId: "thread-1",
          agentId: "thread-1:unity_architect",
          kind: "handoff",
          summary: "Approve the integration handoff.",
          payload: {
            targetRole: "release_steward",
          },
          status: "pending",
          createdAt: "2026-03-18T12:03:00.000Z",
          updatedAt: null,
        },
      ],
    }));

    expect(workflow.currentStageId).toBe("integrate");
    expect(workflow.stages.find((stage) => stage.id === "integrate")?.status).toBe("blocked");
  });

  it("marks lock as ready when implementation, validation, and handoff evidence exist", () => {
    const workflow = deriveThreadWorkflow(buildDetail({
      artifacts: {
        brief: "# BRIEF\n\nBoss arena scope confirmed.",
        findings: "# FINDINGS\n\nArena flow mapped.",
        plan: "# PLAN\n\nImplementation sequence locked.",
        patch: "# PATCH\n\nImplemented the encounter controller.",
        validation: "# VALIDATION\n\nPlaytest passed.",
        handoff: "# HANDOFF\n\nReady for merge.",
      },
      validationState: "validated",
    }));

    expect(workflow.currentStageId).toBe("lock");
    expect(workflow.stages.find((stage) => stage.id === "lock")?.status).toBe("ready");
    expect(workflow.readinessSummary).toContain("마감 준비 완료");
  });
});
