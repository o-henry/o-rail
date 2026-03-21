import { describe, expect, it } from "vitest";
import { buildOptimisticThreadDeleteState } from "./taskThreadOptimisticDelete";
import type { ThreadListItem } from "./threadTypes";

function item(threadId: string, projectPath = "/workspace"): ThreadListItem {
  return {
    thread: {
      threadId,
      taskId: threadId,
      title: threadId,
      userPrompt: "",
      status: "idle",
      cwd: projectPath,
      accessMode: "Local",
      model: "5.4",
      reasoning: "중간",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    },
    projectPath,
    agentCount: 1,
    pendingApprovalCount: 0,
    workflowSummary: {
      currentStageId: "brief",
      status: "idle",
      blocked: false,
      pendingApprovalCount: 0,
    },
  };
}

describe("buildOptimisticThreadDeleteState", () => {
  it("removes the target thread and selects the next visible thread", () => {
    const result = buildOptimisticThreadDeleteState({
      threadItems: [item("a"), item("b"), item("c")],
      targetThreadId: "b",
      activeThreadId: "b",
      projectPath: "/workspace",
      cwd: "/workspace",
    });

    expect(result.nextThreadItems.map((row) => row.thread.threadId)).toEqual(["a", "c"]);
    expect(result.nextActiveThreadId).toBe("a");
  });

  it("keeps the current active thread when a different thread is deleted", () => {
    const result = buildOptimisticThreadDeleteState({
      threadItems: [item("a"), item("b"), item("c")],
      targetThreadId: "c",
      activeThreadId: "a",
      projectPath: "/workspace",
      cwd: "/workspace",
    });

    expect(result.nextThreadItems.map((row) => row.thread.threadId)).toEqual(["a", "b"]);
    expect(result.nextActiveThreadId).toBe("a");
  });

  it("uses all remaining visible threads when no project is selected", () => {
    const result = buildOptimisticThreadDeleteState({
      threadItems: [item("a", "/repo/one"), item("b", "/repo/two"), item("c", "/repo/three")],
      targetThreadId: "b",
      activeThreadId: "b",
      projectPath: "",
      cwd: "/repo/hidden",
    });

    expect(result.nextThreadItems.map((row) => row.thread.threadId)).toEqual(["a", "c"]);
    expect(result.nextActiveThreadId).toBe("a");
  });
});
