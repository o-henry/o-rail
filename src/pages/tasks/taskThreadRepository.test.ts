import { describe, expect, it, vi } from "vitest";
import { refreshThreadStateSilently, reloadThreadList } from "./taskThreadRepository";

describe("taskThreadRepository", () => {
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

  it("passes the selected project path when silently refreshing the current thread", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_list") {
        return [];
      }
      if (command === "thread_load") {
        return null;
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await refreshThreadStateSilently({
      threadId: "thread-1",
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

    expect(invokeFn).toHaveBeenCalledWith("thread_list", {
      cwd: "/workspace/root",
      projectPath: "/workspace/projects/rail-docs",
    });
  });
});
