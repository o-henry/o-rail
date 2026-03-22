import { describe, expect, it } from "vitest";
import { isFailedThreadMessage, isFinishedThreadMessage, resolveAssistantParticipationBadgeRoleIds } from "./TasksThreadConversation";

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

describe("resolveAssistantParticipationBadgeRoleIds", () => {
  it("shows orchestration participants on the latest assistant result", () => {
    const messages = [
      {
        id: "1",
        threadId: "thread-1",
        role: "assistant" as const,
        content: "중간 상태",
        eventKind: "agent_status",
        createdAt: "2026-03-20T00:00:00Z",
      },
      {
        id: "2",
        threadId: "thread-1",
        role: "assistant" as const,
        content: "최종 답변",
        eventKind: "agent_result",
        createdAt: "2026-03-20T00:01:00Z",
      },
    ];

    expect(resolveAssistantParticipationBadgeRoleIds({
      message: messages[1]!,
      messages,
      orchestration: {
        threadId: "thread-1",
        prompt: "아이디어 추천",
        requestedRoleIds: ["researcher", "game_designer"],
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
      },
    })).toEqual(["game_designer", "researcher"]);
  });

  it("does not show the badge list on older assistant results", () => {
    const messages = [
      {
        id: "1",
        threadId: "thread-1",
        role: "assistant" as const,
        content: "첫 결과",
        eventKind: "agent_result",
        createdAt: "2026-03-20T00:00:00Z",
      },
      {
        id: "2",
        threadId: "thread-1",
        role: "assistant" as const,
        content: "둘째 결과",
        eventKind: "agent_result",
        createdAt: "2026-03-20T00:01:00Z",
      },
    ];

    expect(resolveAssistantParticipationBadgeRoleIds({
      message: messages[0]!,
      messages,
      orchestration: null,
    })).toEqual([]);
  });
});
