import { describe, expect, it } from "vitest";
import { buildLiveAgentCards, displayArtifactName } from "./liveAgentState";
import type { ThreadDetail } from "./threadTypes";

function buildDetail(): ThreadDetail {
  return {
    thread: {
      threadId: "thread-1",
      taskId: "thread-1",
      title: "Test",
      userPrompt: "hello",
      status: "active",
      cwd: "/workspace",
      accessMode: "Local",
      model: "GPT-5.4",
      reasoning: "중간",
      createdAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    task: {
      taskId: "thread-1",
      goal: "Test",
      mode: "balanced",
      team: "full-squad",
      isolationRequested: "auto",
      isolationResolved: "auto",
      status: "active",
      projectPath: "/workspace",
      workspacePath: "/workspace",
      createdAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
      roles: [
        {
          id: "game_designer",
          label: "GAME DESIGNER",
          studioRoleId: "pm_planner",
          enabled: true,
          status: "running",
          lastPrompt: "Scope the feature",
          lastPromptAt: "2026-03-18T00:00:00.000Z",
          lastRunId: "run-designer",
          artifactPaths: [".rail/tasks/thread-1/brief.md", ".rail/tasks/thread-1/findings.md"],
          updatedAt: "2026-03-18T00:00:00.000Z",
        },
      ],
      prompts: [],
    },
    messages: [],
    agents: [
      {
        id: "thread-1:game_designer",
        threadId: "thread-1",
        label: "GAME DESIGNER",
        roleId: "game_designer",
        status: "thinking",
        summary: "기획 정리 중",
        worktreePath: "/workspace",
        lastUpdatedAt: "2026-03-18T00:00:00.000Z",
      },
      {
        id: "thread-1:qa_playtester",
        threadId: "thread-1",
        label: "QA PLAYTESTER",
        roleId: "qa_playtester",
        status: "done",
        summary: "완료",
        worktreePath: "/workspace",
        lastUpdatedAt: "2026-03-18T00:00:00.000Z",
      },
      {
        id: "thread-1:unity_implementer",
        threadId: "thread-1",
        label: "UNITY IMPLEMENTER",
        roleId: "unity_implementer",
        status: "failed",
        summary: "실패",
        worktreePath: "/workspace",
        lastUpdatedAt: "2026-03-18T00:00:00.000Z",
      },
    ],
    approvals: [],
    artifacts: {},
    changedFiles: [],
    validationState: "pending",
    riskLevel: "medium",
    files: [],
    workflow: {
      currentStageId: "brief",
      nextAction: "Continue",
      readinessSummary: "ready",
      stages: [],
    },
    orchestration: null,
  };
}

describe("buildLiveAgentCards", () => {
  it("returns only live agents and includes latest artifact metadata", () => {
    const cards = buildLiveAgentCards(buildDetail());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      agentId: "thread-1:game_designer",
      label: "GAME DESIGNER",
      summary: "기획 정리 중",
      latestArtifactPath: ".rail/tasks/thread-1/findings.md",
      lastRunId: "run-designer",
    });
  });

  it("excludes failed agents from the live placeholder list", () => {
    const cards = buildLiveAgentCards(buildDetail());
    expect(cards.some((card) => card.roleId === "unity_implementer")).toBe(false);
  });

  it("shows an interrupted summary when orchestration is blocked for resume", () => {
    const detail = buildDetail();
    detail.orchestration = {
      threadId: "thread-1",
      prompt: "hello",
      requestedRoleIds: ["game_designer"],
      recommendedMode: "quick",
      mode: "quick",
      intent: "simple",
      status: "needs_resume",
      nextAction: "Resume when ready.",
      blockedReason: "Interrupted by operator.",
      plan: null,
      delegateTasks: [],
      delegateResults: [],
      teamSession: null,
      resumePointer: null,
      guidance: [],
      updatedAt: "2026-03-18T00:00:00.000Z",
    };

    const cards = buildLiveAgentCards(detail);
    expect(cards[0]?.summary).toBe("중단되었습니다.");
    expect(cards[0]?.latestArtifactPath).toBe("");
  });
});

describe("displayArtifactName", () => {
  it("returns the file name from a path", () => {
    expect(displayArtifactName(".rail/tasks/thread-1/findings.md")).toBe("findings.md");
  });
});
