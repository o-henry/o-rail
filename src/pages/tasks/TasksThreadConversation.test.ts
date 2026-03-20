import { describe, expect, it } from "vitest";
import { isFinishedThreadMessage } from "./TasksThreadConversation";

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
