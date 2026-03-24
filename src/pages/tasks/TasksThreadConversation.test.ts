import { describe, expect, it } from "vitest";
import {
  buildTimelineRenderEntries,
  compactTasksTimelineCopy,
  isFailedThreadMessage,
  isFinishedThreadMessage,
  normalizeTasksTimelineCopy,
  resolveLiveConversationEntries,
  resolveLatestRunParticipationBadges,
  resolveLatestRunParticipationBadgeRoleIds,
  resolveThreadParticipationBadgeRoleIds,
  shouldProgressivelyRevealMessage,
} from "./TasksThreadConversation";

describe("isFinishedThreadMessage", () => {
  it("returns true for completed assistant result messages", () => {
    expect(isFinishedThreadMessage({
      id: "1",
      threadId: "thread-1",
      role: "assistant",
      content: "완료했습니다.",
      eventKind: "agent_result",
      createdAt: "2026-03-20T00:00:00Z",
    })).toBe(true);
  });

  it("returns false for non-result or non-assistant messages", () => {
    expect(isFinishedThreadMessage({
      id: "2",
      threadId: "thread-1",
      role: "assistant",
      content: "진행 중입니다.",
      eventKind: "agent_status",
      createdAt: "2026-03-20T00:00:00Z",
    })).toBe(false);
    expect(isFinishedThreadMessage({
      id: "3",
      threadId: "thread-1",
      role: "system",
      content: "완료",
      eventKind: "agent_result",
      createdAt: "2026-03-20T00:00:00Z",
    })).toBe(false);
  });
});

describe("isFailedThreadMessage", () => {
  it("returns true for failed assistant result messages", () => {
    expect(isFailedThreadMessage({
      id: "4",
      threadId: "thread-1",
      role: "assistant",
      content: "실패했습니다.",
      eventKind: "agent_failed",
      createdAt: "2026-03-20T00:00:00Z",
    })).toBe(true);
  });

  it("returns false for non-failed messages", () => {
    expect(isFailedThreadMessage({
      id: "5",
      threadId: "thread-1",
      role: "assistant",
      content: "완료했습니다.",
      eventKind: "agent_result",
      createdAt: "2026-03-20T00:00:00Z",
    })).toBe(false);
  });
});

describe("normalizeTasksTimelineCopy", () => {
  it("normalizes timeline-only system copy without touching markdown rendering paths", () => {
    expect(normalizeTasksTimelineCopy("Created UNITY ARCHITECT")).toBe("CREATED UNITY ARCHITECT");
    expect(normalizeTasksTimelineCopy("[Codex 실행] runtime attached")).toBe("[코덱스 실행] 실행 세션 연결됨");
  });

  it("collapses internal prompt dump text in timeline logs", () => {
    expect(normalizeTasksTimelineCopy(
      "Formatting re-enabled\n<role_profile>role_name: 기획(PM)</role_profile>\n[ROLE_KB_INJECT]\nfoo\n[/ROLE_KB_INJECT]\n<task_request>bar</task_request>",
    )).toBe("내부 역할 프롬프트와 역할 지식을 준비했습니다.");
  });
});

describe("compactTasksTimelineCopy", () => {
  it("shortens very long urls in timeline copy for live cards", () => {
    const compacted = compactTasksTimelineCopy(
      "Error: steel fetch failed at https://duckduckgo.com/html/?q=very-long-query-string-that-should-not-stretch-the-layout-because-it-keeps-going-and-going",
    );
    expect(compacted).toContain("https://duckduckgo.com/html/?...");
    expect(compacted).not.toContain("very-long-query-string-that-should-not-stretch-the-layout");
  });
});

describe("buildTimelineRenderEntries", () => {
  it("groups consecutive setup/status timeline messages into one pre-render block", () => {
    expect(buildTimelineRenderEntries([
      {
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "Created GAME DESIGNER ...",
        eventKind: "agent_created",
        createdAt: "2026-03-22T00:00:01Z",
      },
      {
        id: "assistant-2",
        threadId: "thread-1",
        role: "assistant",
        content: "Created UNITY ARCHITECT ...",
        eventKind: "agent_created",
        createdAt: "2026-03-22T00:00:02Z",
      },
      {
        id: "assistant-3",
        threadId: "thread-1",
        role: "assistant",
        content: "완료했습니다.",
        eventKind: "agent_result",
        createdAt: "2026-03-22T00:00:03Z",
      },
    ])).toEqual([
      expect.objectContaining({
        kind: "single",
        message: expect.objectContaining({ id: "assistant-3" }),
      }),
    ]);
  });

  it("drops redundant agent_created timeline messages and keeps the real status/update line", () => {
    expect(buildTimelineRenderEntries([
      {
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "Created GAME DESIGNER. GAME DESIGNER: 기능 목표를 정리하고 있습니다.",
        eventKind: "agent_created",
        createdAt: "2026-03-22T00:00:01Z",
      },
      {
        id: "assistant-2",
        threadId: "thread-1",
        role: "assistant",
        content: "GAME DESIGNER: 기능 목표를 정리하고 있습니다.",
        eventKind: "agent_status",
        createdAt: "2026-03-22T00:00:02Z",
      },
    ])).toEqual([
      expect.objectContaining({
        kind: "group",
        messages: [
          expect.objectContaining({ id: "assistant-2" }),
        ],
      }),
    ]);
  });

  it("hides non-assigned role status rows once orchestration resolves to different participants", () => {
    expect(buildTimelineRenderEntries([
      {
        id: "assistant-1",
        threadId: "thread-1",
        role: "assistant",
        content: "UNITY ARCHITECT: 아키텍처를 검토하고 있습니다.",
        eventKind: "agent_status",
        sourceRoleId: "unity_architect",
        createdAt: "2026-03-22T00:00:01Z",
      },
      {
        id: "assistant-2",
        threadId: "thread-1",
        role: "assistant",
        content: "GAME DESIGNER: 아이디어를 정리하고 있습니다.",
        eventKind: "agent_status",
        sourceRoleId: "game_designer",
        createdAt: "2026-03-22T00:00:02Z",
      },
    ], ["game_designer"])).toEqual([
      expect.objectContaining({
        kind: "group",
        messages: [
          expect.objectContaining({ id: "assistant-2" }),
        ],
      }),
    ]);
  });
});

describe("resolveThreadParticipationBadgeRoleIds", () => {
  it("prefers assigned orchestration participants", () => {
    expect(resolveThreadParticipationBadgeRoleIds({
      threadId: "thread-1",
      prompt: "아이디어 추천",
      requestedRoleIds: ["researcher", "game_designer"],
      assignedRoleIds: ["unity_architect", "researcher"],
      recommendedMode: "team",
      mode: "team",
      intent: "research",
      status: "completed",
      nextAction: "done",
      blockedReason: null,
      plan: null,
      delegateTasks: [],
      delegateResults: [],
      teamSession: null,
      resumePointer: null,
      guidance: [],
      updatedAt: "2026-03-20T00:01:00Z",
    })).toEqual(["researcher", "unity_architect"]);
  });

  it("falls back to requested participants when orchestration has not resolved yet", () => {
    expect(resolveThreadParticipationBadgeRoleIds({
      threadId: "thread-1",
      prompt: "아이디어 추천",
      requestedRoleIds: ["researcher", "game_designer"],
      assignedRoleIds: [],
      recommendedMode: "team",
      mode: "team",
      intent: "research",
      status: "running",
      nextAction: "running",
      blockedReason: null,
      plan: null,
      delegateTasks: [],
      delegateResults: [],
      teamSession: null,
      resumePointer: null,
      guidance: [],
      updatedAt: "2026-03-20T00:01:00Z",
    })).toEqual(["game_designer", "researcher"]);
  });

  it("returns an empty list when orchestration is unavailable", () => {
    expect(resolveThreadParticipationBadgeRoleIds(null)).toEqual([]);
  });
});

describe("resolveLatestRunParticipationBadgeRoleIds", () => {
  it("falls back to message-emitted role ids when orchestration is gone", () => {
    expect(resolveLatestRunParticipationBadgeRoleIds({
      orchestration: null,
      liveAgents: [],
      messages: [
        {
          id: "user-1",
          threadId: "thread-1",
          role: "user",
          content: "아이디어 줘",
          createdAt: "2026-03-22T00:00:00Z",
        },
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          content: "Created GAME DESIGNER ...",
          sourceRoleId: "game_designer",
          eventKind: "agent_created",
          createdAt: "2026-03-22T00:00:01Z",
        },
        {
          id: "assistant-2",
          threadId: "thread-1",
          role: "assistant",
          content: "Created UNITY ARCHITECT ...",
          sourceRoleId: "unity_architect",
          eventKind: "agent_created",
          createdAt: "2026-03-22T00:00:02Z",
        },
      ],
    })).toEqual(["game_designer", "unity_architect"]);
  });

  it("prefers roles that emitted real progress over created-only placeholder roles", () => {
    expect(resolveLatestRunParticipationBadgeRoleIds({
      orchestration: {
        threadId: "thread-1",
        prompt: "아이디어 추천",
        requestedRoleIds: ["game_designer", "unity_architect"],
        assignedRoleIds: ["game_designer", "unity_architect"],
        recommendedMode: "team",
        mode: "team",
        intent: "multi_step",
        status: "running",
        nextAction: "running",
        blockedReason: null,
        plan: null,
        delegateTasks: [],
        delegateResults: [],
        teamSession: null,
        resumePointer: null,
        guidance: [],
        updatedAt: "2026-03-20T00:01:00Z",
      },
      liveAgents: [],
      messages: [
        {
          id: "user-1",
          threadId: "thread-1",
          role: "user",
          content: "아이디어 줘",
          createdAt: "2026-03-22T00:00:00Z",
        },
        {
          id: "assistant-1",
          threadId: "thread-1",
          role: "assistant",
          content: "Created UNITY ARCHITECT ...",
          sourceRoleId: "unity_architect",
          eventKind: "agent_created",
          createdAt: "2026-03-22T00:00:01Z",
        },
        {
          id: "assistant-2",
          threadId: "thread-1",
          role: "assistant",
          content: "GAME DESIGNER: 아이디어를 정리하고 있습니다.",
          sourceRoleId: "game_designer",
          eventKind: "agent_status",
          createdAt: "2026-03-22T00:00:02Z",
        },
      ],
    })).toEqual(["game_designer"]);
  });
});

describe("resolveLatestRunParticipationBadges", () => {
  it("includes agent, provider, and internal badges together", () => {
    expect(resolveLatestRunParticipationBadges({
      orchestration: {
        threadId: "thread-1",
        prompt: "아이디어 추천",
        requestedRoleIds: ["researcher"],
        assignedRoleIds: ["researcher"],
        recommendedMode: "team",
        mode: "team",
        intent: "research",
        status: "running",
        nextAction: "running",
        blockedReason: null,
        plan: null,
        delegateTasks: [],
        delegateResults: [],
        teamSession: null,
        resumePointer: null,
        guidance: [],
        updatedAt: "2026-03-20T00:01:00Z",
      },
      liveAgents: [],
      messages: [],
      internalBadges: [
        { key: "internal:orchestrator", label: "ORCHESTRATOR", kind: "internal" },
        { key: "internal:creative-mode", label: "창의성 모드: ON", kind: "internal" },
        { key: "provider:@STEEL", label: "@STEEL", kind: "provider" },
      ],
    })).toEqual([
      { key: "agent:researcher", label: "RESEARCHER", kind: "agent" },
      { key: "internal:orchestrator", label: "ORCHESTRATOR", kind: "internal" },
      { key: "internal:creative-mode", label: "창의성 모드: ON", kind: "internal" },
      { key: "provider:@STEEL", label: "@STEEL", kind: "provider" },
    ]);
  });
});

describe("resolveLiveConversationEntries", () => {
  it("merges repeated live process events into one entry per role", () => {
    expect(resolveLiveConversationEntries({
      liveAgents: [
        {
          agentId: "agent-1",
          roleId: "game_designer",
          label: "GAME DESIGNER",
          status: "thinking",
          lastRunId: "run-1",
          summary: "기능 목표를 정리하고 있습니다.",
          updatedAt: "2026-03-22T00:00:01Z",
          latestArtifactPath: "",
        },
      ],
      liveProcessEvents: [
        {
          id: "event-1",
          runId: "run-1",
          roleId: "game_designer",
          agentLabel: "GAME DESIGNER",
          type: "run_started",
          stage: "codex",
          message: "역할 실행 시작",
          at: "2026-03-22T00:00:01Z",
        },
        {
          id: "event-2",
          runId: "run-1",
          roleId: "game_designer",
          agentLabel: "GAME DESIGNER",
          type: "stage_started",
          stage: "codex",
          message: "runtime attached",
          at: "2026-03-22T00:00:03Z",
        },
      ],
    })).toEqual([
      expect.objectContaining({
        roleId: "game_designer",
        label: "GAME DESIGNER",
        latestEvent: expect.objectContaining({
          id: "event-2",
          message: "runtime attached",
        }),
      }),
    ]);
  });

  it("keeps event-only roles visible even before a live agent card arrives", () => {
    expect(resolveLiveConversationEntries({
      liveAgents: [],
      liveProcessEvents: [
        {
          id: "event-3",
          runId: "run-2",
          roleId: "unity_architect",
          agentLabel: "UNITY ARCHITECT",
          type: "run_started",
          stage: "codex",
          message: "역할 실행 시작",
          at: "2026-03-22T00:00:04Z",
        },
      ],
    })).toEqual([
      expect.objectContaining({
        roleId: "unity_architect",
        label: "UNITY ARCHITECT",
      }),
    ]);
  });
});

describe("shouldProgressivelyRevealMessage", () => {
  it("does not progressively reveal large logs anymore", () => {
    expect(shouldProgressivelyRevealMessage({
      id: "1",
      threadId: "thread-1",
      role: "assistant",
      content: "",
      eventKind: "agent_created",
      createdAt: "2026-03-22T00:00:00Z",
    }, "x".repeat(240))).toBe(false);
  });

  it("skips short system interruptions", () => {
    expect(shouldProgressivelyRevealMessage({
      id: "2",
      threadId: "thread-1",
      role: "system",
      content: "",
      eventKind: "run_interrupted",
      createdAt: "2026-03-22T00:00:00Z",
    }, "중단")).toBe(false);
  });
});
