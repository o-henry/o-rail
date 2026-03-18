import { describe, expect, it } from "vitest";
import { createTasksThreadTerminalPane, buildTasksThreadTerminalSessionId, resolveTasksThreadTerminalCwd } from "./taskThreadTerminalState";
import type { ThreadDetail } from "./threadTypes";

function makeDetail(overrides?: Partial<ThreadDetail>): ThreadDetail {
  return {
    thread: {
      threadId: "thread_123",
      taskId: "task_123",
      title: "NEW THREAD",
      userPrompt: "",
      status: "active",
      cwd: "/repo",
      branchLabel: null,
      accessMode: "Local",
      model: "GPT-5.4",
      reasoning: "중간",
      createdAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    },
    task: {
      taskId: "task_123",
      goal: "",
      mode: "balanced",
      team: "solo",
      isolationRequested: "worktree",
      isolationResolved: "worktree",
      status: "active",
      projectPath: "/repo",
      workspacePath: "/repo",
      worktreePath: "/repo/.worktrees/thread_123",
      branchName: "thread/thread_123",
      fallbackReason: null,
      createdAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
      roles: [],
      prompts: [],
    },
    messages: [],
    agents: [],
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
      nextAction: "",
      readinessSummary: "",
    },
    ...overrides,
  };
}

describe("taskThreadTerminalState", () => {
  it("builds a stable session id from the thread id", () => {
    expect(buildTasksThreadTerminalSessionId("thread_abc")).toBe("tasks-thread-terminal:thread_abc");
  });

  it("prefers worktree path over workspace path for cwd", () => {
    expect(resolveTasksThreadTerminalCwd(makeDetail())).toBe("/repo/.worktrees/thread_123");
  });

  it("creates a thread terminal pane with the resolved cwd", () => {
    const pane = createTasksThreadTerminalPane(makeDetail());
    expect(pane).toMatchObject({
      id: "tasks-thread-terminal:thread_123",
      title: "THREAD TERMINAL",
      subtitle: "/repo/.worktrees/thread_123",
      status: "idle",
    });
  });
});
