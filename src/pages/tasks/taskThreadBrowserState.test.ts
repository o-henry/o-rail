import { describe, expect, it } from "vitest";
import { defaultSelectedAgent } from "./taskThreadBrowserState";
import { UNITY_DEFAULT_THREAD_PRESET_IDS } from "./taskAgentPresets";
import type { ThreadDetail } from "./threadTypes";

function buildDetail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  const updatedAt = "2026-03-21T03:00:00.000Z";
  return {
    thread: {
      threadId: "thread-1",
      taskId: "task-1",
      title: "Research market trends",
      userPrompt: "@researcher 시장 조사해줘",
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
      goal: "@researcher 시장 조사해줘",
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
        status: "idle",
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
      brief: "",
      findings: "",
      plan: "",
      patch: "",
      validation: "",
      handoff: "",
    },
    changedFiles: [],
    validationState: "pending",
    riskLevel: "low",
    files: [],
    workflow: {} as ThreadDetail["workflow"],
    ...overrides,
  };
}

describe("defaultSelectedAgent", () => {
  it("prefers the most recently active non-idle agent over the preset order", () => {
    const detail = buildDetail({
      agents: [
        {
          id: "thread-1:game_designer",
          threadId: "thread-1",
          label: "GAME DESIGNER",
          roleId: "game_designer",
          status: "idle",
          summary: "designer",
          worktreePath: "/tmp/project",
          lastUpdatedAt: "2026-03-21T03:00:00.000Z",
        },
        {
          id: "thread-1:researcher",
          threadId: "thread-1",
          label: "RESEARCHER",
          roleId: "researcher",
          status: "done",
          summary: "research",
          worktreePath: "/tmp/project",
          lastUpdatedAt: "2026-03-21T03:05:00.000Z",
        },
      ],
    });

    expect(defaultSelectedAgent(detail)).toBe("thread-1:researcher");
  });
});
