import { describe, expect, it } from "vitest";
import {
  isFailedThreadMessage,
  isFinishedThreadMessage,
  resolveLatestRunParticipationBadgeRoleIds,
  resolveProgressiveRevealStep,
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
});

describe("resolveProgressiveRevealStep", () => {
  it("keeps a sensible minimum chunk size for short answers", () => {
    expect(resolveProgressiveRevealStep(12)).toBe(48);
  });

  it("caps chunk size for large answers", () => {
    expect(resolveProgressiveRevealStep(20000)).toBe(220);
  });
});

describe("shouldProgressivelyRevealMessage", () => {
  it("reveals large assistant logs progressively", () => {
    expect(shouldProgressivelyRevealMessage({
      id: "1",
      threadId: "thread-1",
      role: "assistant",
      content: "",
      eventKind: "agent_created",
      createdAt: "2026-03-22T00:00:00Z",
    }, "x".repeat(240))).toBe(true);
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
