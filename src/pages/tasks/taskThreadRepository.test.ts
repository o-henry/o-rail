import { describe, expect, it, vi } from "vitest";
import { refreshThreadListSilently, refreshThreadStateSilently, reloadThreadList } from "./taskThreadRepository";
import type { ThreadDetail } from "./threadTypes";

describe("taskThreadRepository", () => {
  function buildThreadDetail(): ThreadDetail {
    return {
      thread: {
        threadId: "thread-1",
        taskId: "task-1",
        title: "Thread",
        userPrompt: "Prompt",
        status: "running",
        cwd: "/workspace/root",
        accessMode: "Local",
        model: "GPT-5.4",
        reasoning: "중간",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      task: {
        taskId: "task-1",
        goal: "Prompt",
        mode: "balanced",
        team: "full-squad",
        isolationRequested: "auto",
        isolationResolved: "current-repo",
        status: "active",
        projectPath: "/workspace/projects/rail-docs",
        workspacePath: "/workspace/projects/rail-docs",
        worktreePath: "/workspace/projects/rail-docs",
        branchName: "main",
        fallbackReason: null,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        roles: [],
        prompts: [],
      },
      messages: [
        {
          id: "msg-1",
          threadId: "thread-1",
          role: "assistant",
          content: "hello",
          createdAt: "2026-03-20T00:00:00.000Z",
        },
      ],
      agents: [],
      approvals: [],
      agentDetail: null,
      artifacts: {},
      changedFiles: [],
      validationState: "pending",
      riskLevel: "medium",
      files: [{ path: "README.md", changed: false }],
      workflow: {
        currentStageId: "brief",
        stages: [],
        nextAction: "Wait",
        readinessSummary: "Ready",
      },
      orchestration: null,
    };
  }

  it("passes the selected project path to thread_list during reload", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_list") {
        return [];
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await reloadThreadList({
      preferredThreadId: "",
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn,
      browserStoreRef: { current: { details: {}, order: [] } },
      applyBrowserStore: () => null,
      activeThreadId: "",
      loadThread: async () => null,
      setActiveThread: vi.fn(),
      setActiveThreadId: vi.fn(),
      setLoading: vi.fn(),
      setSelectedAgentId: vi.fn(),
      setSelectedAgentDetail: vi.fn(),
      setSelectedFilePath: vi.fn(),
      setSelectedFileDiff: vi.fn(),
      setThreadItems: vi.fn(),
      onError: vi.fn(),
    });

    expect(invokeFn).toHaveBeenCalledWith("thread_list", {
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
    });
  });

  it("silently refreshes the current thread with runtime snapshot data when message and file state did not change", async () => {
    const currentDetail = buildThreadDetail();
    const setActiveThread = vi.fn();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_runtime_snapshot") {
        return {
          ...currentDetail,
          messageCount: 1,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await refreshThreadStateSilently({
      threadId: "thread-1",
      currentDetail,
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn,
      hydratePersistedCoordination: async () => null,
      selectedAgentIdsByThread: {},
      selectedFilePathsByThread: {},
      rememberSelectedAgent: vi.fn(),
      rememberSelectedFile: vi.fn(),
      setActiveThread,
      setActiveThreadId: vi.fn(),
      setThreadItems: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenCalledTimes(1);
    expect(invokeFn).toHaveBeenCalledWith("thread_runtime_snapshot", {
      cwd: "/workspace/root",
      threadId: "thread-1",
    });
    const renderedDetail = setActiveThread.mock.calls[0]?.[0];
    expect(renderedDetail.messages).toEqual(currentDetail.messages);
    expect(renderedDetail.files).toEqual(currentDetail.files);
  });

  it("reuses the current detail for snapshot-only updates even when changed files changed", async () => {
    const currentDetail = {
      ...buildThreadDetail(),
      changedFiles: ["README.md"],
    };
    const setActiveThread = vi.fn();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_runtime_snapshot") {
        return {
          ...currentDetail,
          changedFiles: ["docs/PLAN.md"],
          messageCount: 1,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await refreshThreadStateSilently({
      threadId: "thread-1",
      currentDetail,
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn,
      hydratePersistedCoordination: async () => null,
      selectedAgentIdsByThread: {},
      selectedFilePathsByThread: {},
      rememberSelectedAgent: vi.fn(),
      rememberSelectedFile: vi.fn(),
      setActiveThread,
      setActiveThreadId: vi.fn(),
      setThreadItems: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenCalledTimes(1);
    const renderedDetail = setActiveThread.mock.calls[0]?.[0];
    expect(renderedDetail.changedFiles).toEqual(["docs/PLAN.md"]);
    expect(renderedDetail.messages).toHaveLength(1);
  });

  it("applies only a message delta when the runtime snapshot reports appended messages", async () => {
    const currentDetail = buildThreadDetail();
    const setActiveThread = vi.fn();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_runtime_snapshot") {
        return {
          ...currentDetail,
          messageCount: 2,
        };
      }
      if (command === "thread_message_delta") {
        return {
          messages: [
            {
              id: "msg-2",
              threadId: "thread-1",
              role: "assistant",
              content: "new message",
              createdAt: "2026-03-20T00:00:05.000Z",
            },
          ],
          totalCount: 2,
          resetRequired: false,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await refreshThreadStateSilently({
      threadId: "thread-1",
      currentDetail,
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn,
      hydratePersistedCoordination: async () => null,
      selectedAgentIdsByThread: {},
      selectedFilePathsByThread: {},
      rememberSelectedAgent: vi.fn(),
      rememberSelectedFile: vi.fn(),
      setActiveThread,
      setActiveThreadId: vi.fn(),
      setThreadItems: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenNthCalledWith(1, "thread_runtime_snapshot", {
      cwd: "/workspace/root",
      threadId: "thread-1",
    });
    expect(invokeFn).toHaveBeenNthCalledWith(2, "thread_message_delta", {
      cwd: "/workspace/root",
      threadId: "thread-1",
      afterCount: 1,
    });
    const renderedDetail = setActiveThread.mock.calls[0]?.[0];
    expect(renderedDetail.messages).toHaveLength(2);
    expect(renderedDetail.messages[1]?.content).toBe("new message");
  });

  it("falls back to a full thread load when the message delta requires a reset", async () => {
    const currentDetail = buildThreadDetail();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_runtime_snapshot") {
        return {
          ...currentDetail,
          messageCount: 2,
        };
      }
      if (command === "thread_message_delta") {
        return {
          messages: [],
          totalCount: 0,
          resetRequired: true,
        };
      }
      if (command === "thread_load") {
        return {
          ...currentDetail,
          messages: [
            ...currentDetail.messages,
            {
              id: "msg-2",
              threadId: "thread-1",
              role: "assistant",
              content: "new message",
              createdAt: "2026-03-20T00:00:05.000Z",
            },
          ],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await refreshThreadStateSilently({
      threadId: "thread-1",
      currentDetail,
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn,
      hydratePersistedCoordination: async () => null,
      selectedAgentIdsByThread: {},
      selectedFilePathsByThread: {},
      rememberSelectedAgent: vi.fn(),
      rememberSelectedFile: vi.fn(),
      setActiveThread: vi.fn(),
      setActiveThreadId: vi.fn(),
      setThreadItems: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenNthCalledWith(1, "thread_runtime_snapshot", {
      cwd: "/workspace/root",
      threadId: "thread-1",
    });
    expect(invokeFn).toHaveBeenNthCalledWith(2, "thread_message_delta", {
      cwd: "/workspace/root",
      threadId: "thread-1",
      afterCount: 1,
    });
    expect(invokeFn).toHaveBeenNthCalledWith(3, "thread_load", {
      cwd: "/workspace/root",
      threadId: "thread-1",
    });
  });

  it("reports a failed refresh when the runtime snapshot cannot be read", async () => {
    const result = await refreshThreadStateSilently({
      threadId: "thread-1",
      currentDetail: buildThreadDetail(),
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn: vi.fn(async () => {
        throw new Error("snapshot unavailable");
      }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      hydratePersistedCoordination: async () => null,
      selectedAgentIdsByThread: {},
      selectedFilePathsByThread: {},
      rememberSelectedAgent: vi.fn(),
      rememberSelectedFile: vi.fn(),
      setActiveThread: vi.fn(),
      setActiveThreadId: vi.fn(),
      setThreadItems: vi.fn(),
    });

    expect(result.ok).toBe(false);
  });

  it("refreshes only thread metadata without loading the active thread again", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_list") {
        return [];
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await refreshThreadListSilently({
      hasTauriRuntime: true,
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
      invokeFn,
      setThreadItems: vi.fn(),
    });

    expect(invokeFn).toHaveBeenCalledTimes(1);
    expect(invokeFn).toHaveBeenCalledWith("thread_list", {
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
    });
  });
});
