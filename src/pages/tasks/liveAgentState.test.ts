import { describe, expect, it } from "vitest";
import {
  buildLiveAgentCards,
  describeLiveCurrentWork,
  displayArtifactName,
  formatRelativeUpdateAge,
  inferNextLiveAction,
  resolveLiveStageProgress,
  resolveLiveServiceStatus,
  resolveLatestFailureReason,
  resolveLiveActivityState,
  resolveRecentSourceCount,
  shouldShowRelativeLiveSignalAge,
} from "./liveAgentState";
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

  it("hides stale running agents after the runtime stops reporting progress", () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse("2026-03-18T00:06:30.000Z");
    try {
      const detail = buildDetail();
      detail.orchestration = {
        threadId: "thread-1",
        prompt: "hello",
        requestedRoleIds: ["game_designer"],
        recommendedMode: "team",
        mode: "team",
        intent: "multi_step",
        status: "running",
        nextAction: "Wait",
        blockedReason: null,
        plan: null,
        delegateTasks: [],
        delegateResults: [],
        teamSession: null,
        resumePointer: null,
        guidance: [],
        updatedAt: "2026-03-18T00:00:00.000Z",
      };

      expect(buildLiveAgentCards(detail)).toEqual([]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("hides stale live cards when the task is already archived", () => {
    const detail = buildDetail();
    detail.task.status = "archived";
    detail.thread.status = "active";

    expect(buildLiveAgentCards(detail)).toEqual([]);
  });
});

describe("shouldShowRelativeLiveSignalAge", () => {
  it("hides stale or disconnected signal ages", () => {
    expect(shouldShowRelativeLiveSignalAge({
      activityState: "stalled",
      signalDisconnected: false,
    })).toBe(false);
    expect(shouldShowRelativeLiveSignalAge({
      activityState: "active",
      signalDisconnected: true,
    })).toBe(false);
  });

  it("shows relative ages only while signals are still active or merely delayed", () => {
    expect(shouldShowRelativeLiveSignalAge({
      activityState: "active",
      signalDisconnected: false,
    })).toBe(true);
    expect(shouldShowRelativeLiveSignalAge({
      activityState: "delayed",
      signalDisconnected: false,
    })).toBe(true);
  });
});

describe("displayArtifactName", () => {
  it("returns the file name from a path", () => {
    expect(displayArtifactName(".rail/tasks/thread-1/findings.md")).toBe("findings.md");
  });
});

describe("resolveLiveActivityState", () => {
  it("marks recent updates as active", () => {
    expect(resolveLiveActivityState("2026-03-21T00:00:20.000Z", Date.parse("2026-03-21T00:00:40.000Z"))).toBe("active");
  });

  it("marks older updates as delayed", () => {
    expect(resolveLiveActivityState("2026-03-21T00:00:00.000Z", Date.parse("2026-03-21T00:00:45.000Z"))).toBe("delayed");
  });

  it("marks long pauses as stalled", () => {
    expect(resolveLiveActivityState("2026-03-21T00:00:00.000Z", Date.parse("2026-03-21T00:02:10.000Z"))).toBe("stalled");
  });
});

describe("resolveLiveServiceStatus", () => {
  it("reports running roles from the latest backend-backed thread detail", () => {
    const detail = buildDetail();
    const status = resolveLiveServiceStatus(detail);
    expect(status).toMatchObject({
      state: "running",
      detail: "서비스 기준으로 GAME DESIGNER 실행 중입니다.",
    });
  });

  it("reports failed service state when every enabled role failed", () => {
    const detail = buildDetail();
    detail.task.roles = detail.task.roles.map((role) => ({
      ...role,
      status: "error",
    }));

    const status = resolveLiveServiceStatus(detail);
    expect(status).toMatchObject({
      state: "failed",
      detail: "서비스 기준으로 모든 내부 브리프 또는 역할 실행이 실패했습니다.",
    });
  });
});

describe("formatRelativeUpdateAge", () => {
  it("formats recent timestamps as just now", () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse("2026-03-21T00:00:30.000Z");
    try {
      expect(formatRelativeUpdateAge("2026-03-21T00:00:00.000Z", {
        justNow: "방금",
        minutesAgo: (value) => `${value}분 전`,
        hoursAgo: (value) => `${value}시간 전`,
        daysAgo: (value) => `${value}일 전`,
      })).toBe("방금");
    } finally {
      Date.now = originalNow;
    }
  });

  it("formats minute-based timestamps", () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse("2026-03-21T00:03:00.000Z");
    try {
      expect(formatRelativeUpdateAge("2026-03-21T00:00:00.000Z", {
        justNow: "방금",
        minutesAgo: (value) => `${value}분 전`,
        hoursAgo: (value) => `${value}시간 전`,
        daysAgo: (value) => `${value}일 전`,
      })).toBe("3분 전");
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("resolveRecentSourceCount", () => {
  it("extracts source counts from ratio messages", () => {
    expect(resolveRecentSourceCount([
      { type: "stage_done", stage: "crawler", message: "ROLE_KB_BOOTSTRAP 완료 (6/7)", at: "2026-03-21T00:00:00.000Z" },
    ])).toBe(6);
  });
});

describe("resolveLatestFailureReason", () => {
  it("returns the latest explicit error message", () => {
    expect(resolveLatestFailureReason([
      { type: "stage_started", stage: "codex", message: "역할 실행 시작", at: "2026-03-21T00:00:00.000Z" },
      { type: "stage_error", stage: "codex", message: "role execution timed out after 300000ms", at: "2026-03-21T00:01:00.000Z" },
    ])).toBe("role execution timed out after 300000ms");
  });

  it("treats bootstrap failure summaries as a failure reason", () => {
    expect(resolveLatestFailureReason([
      { type: "stage_done", stage: "crawler", message: "ROLE_KB_BOOTSTRAP 실패 (0/7)", at: "2026-03-21T00:01:00.000Z" },
    ])).toBe("ROLE_KB_BOOTSTRAP 실패 (0/7)");
  });
});

describe("inferNextLiveAction", () => {
  it("suggests a retry-oriented next action after failure", () => {
    expect(inferNextLiveAction({
      stage: "codex",
      activityState: "stalled",
      failureReason: "role execution timed out after 300000ms",
    })).toContain("재시도");
  });

  it("suggests source discovery work during crawler stage", () => {
    expect(inferNextLiveAction({
      stage: "crawler",
      activityState: "active",
      failureReason: "",
    })).toContain("후보 소스");
  });

  it("flags degraded codex execution when bootstrap found no sources", () => {
    expect(inferNextLiveAction({
      stage: "codex",
      activityState: "active",
      recentSourceCount: 0,
      failureReason: "ROLE_KB_BOOTSTRAP 실패 (0/7)",
    })).toContain("외부 근거 없이");
  });
});

describe("describeLiveCurrentWork", () => {
  it("explains crawler work in plain language", () => {
    expect(describeLiveCurrentWork({
      stage: "crawler",
      eventType: "stage_started",
      recentSourceCount: 3,
    })).toContain("3개");
  });

  it("explains codex generation in plain language", () => {
    expect(describeLiveCurrentWork({
      stage: "codex",
      eventType: "stage_started",
      failureReason: "",
    })).toContain("응답을 생성");
  });

  it("explains degraded no-source execution clearly", () => {
    expect(describeLiveCurrentWork({
      stage: "codex",
      eventType: "stage_started",
      failureReason: "ROLE_KB_BOOTSTRAP 실패 (0/7)",
      recentSourceCount: 0,
    })).toContain("외부 근거 수집이 비어");
  });
});

describe("resolveLiveStageProgress", () => {
  it("maps known stages to a fixed progress counter", () => {
    expect(resolveLiveStageProgress("crawler")).toEqual({ current: 1, total: 6 });
    expect(resolveLiveStageProgress("critic")).toEqual({ current: 4, total: 6 });
    expect(resolveLiveStageProgress("approval")).toEqual({ current: 6, total: 6 });
  });

  it("returns null for unknown stages", () => {
    expect(resolveLiveStageProgress("unknown")).toBeNull();
  });
});
