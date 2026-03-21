import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHiddenKnowledgeIdsForTest, readKnowledgeEntries, upsertKnowledgeEntry } from "./knowledgeIndex";
import {
  clearWorkspaceKnowledgeHydrationCacheForTest,
  hydrateKnowledgeEntriesFromWorkspaceArtifacts,
  hydrateKnowledgeEntriesFromWorkspaceSources,
} from "./workspaceKnowledgeHydration";

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    get length(): number {
      return store.size;
    },
  };
}

function entry(id: string, runId: string) {
  return {
    id,
    runId,
    taskId: "TASK_UNKNOWN",
    roleId: "technical_writer" as const,
    sourceKind: "artifact" as const,
    title: `title-${id}`,
    summary: `summary-${id}`,
    createdAt: "2026-03-05T00:00:00.000Z",
  };
}

describe("workspaceKnowledgeHydration", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock(),
    } as unknown as Window & typeof globalThis);
  });

  afterEach(() => {
    clearHiddenKnowledgeIdsForTest();
    clearWorkspaceKnowledgeHydrationCacheForTest();
    vi.unstubAllGlobals();
  });

  it("hydrates workspace artifact scan results into local storage", async () => {
    upsertKnowledgeEntry(entry("local-a", "run-local"));

    const hydrated = await hydrateKnowledgeEntriesFromWorkspaceArtifacts({
      cwd: "/tmp/workspace",
      invokeFn: (async (command) => {
        expect(command).toBe("knowledge_scan_workspace_artifacts");
        return [
          {
            id: "artifact-a",
            runId: "role-run-1",
            taskId: "task-1",
            roleId: "research_analyst",
            sourceKind: "artifact",
            title: "리서처 · task-1 · research_collection.json",
            summary: "복구된 리서치 산출물",
            createdAt: "2026-03-21T00:00:00.000Z",
            jsonPath: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.json",
            sourceFile: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.json",
          },
        ];
      }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    });

    expect(hydrated.map((row) => row.id)).toEqual(["artifact-a", "local-a"]);
    expect(readKnowledgeEntries().map((row) => row.id)).toEqual(["artifact-a", "local-a"]);
    expect(readKnowledgeEntries()[0]?.workspacePath).toBe("/tmp/workspace");
  });

  it("hydrates workspace index and artifact scan together", async () => {
    const hydrated = await hydrateKnowledgeEntriesFromWorkspaceSources({
      cwd: "/tmp/workspace",
      invokeFn: (async (command) => {
        if (command === "workspace_read_text") {
          return JSON.stringify([entry("workspace-index", "run-index")]);
        }
        if (command === "knowledge_scan_workspace_artifacts") {
          return [
            {
              id: "artifact-a",
              runId: "role-run-1",
              taskId: "task-1",
              roleId: "research_analyst",
              sourceKind: "artifact",
              title: "리서처 · task-1 · research_collection.md",
              summary: "복구된 리서치 산출물",
              createdAt: "2026-03-21T00:00:00.000Z",
              markdownPath: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.md",
              sourceFile: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.md",
            },
          ];
        }
        throw new Error(`unexpected command: ${command}`);
      }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    });

    expect(hydrated.map((row) => row.id)).toEqual(["artifact-a", "workspace-index"]);
    expect(readKnowledgeEntries().map((row) => row.id)).toEqual(["artifact-a", "workspace-index"]);
    expect(readKnowledgeEntries().every((row) => row.workspacePath === "/tmp/workspace")).toBe(true);
  });

  it("reuses fresh workspace artifact cache for the immediate response", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "knowledge_scan_workspace_artifacts") {
        return [
          {
            id: "artifact-a",
            runId: "role-run-1",
            taskId: "task-1",
            roleId: "research_analyst",
            sourceKind: "artifact",
            title: "리서처 · task-1 · research_collection.json",
            summary: "복구된 리서치 산출물",
            createdAt: "2026-03-21T00:00:00.000Z",
            jsonPath: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.json",
            sourceFile: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.json",
          },
        ];
      }
      throw new Error(`unexpected command: ${command}`);
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const first = await hydrateKnowledgeEntriesFromWorkspaceArtifacts({
      cwd: "/tmp/workspace",
      invokeFn,
    });
    const second = await hydrateKnowledgeEntriesFromWorkspaceArtifacts({
      cwd: "/tmp/workspace",
      invokeFn,
      revalidateInBackground: false,
    });

    expect(first.map((row) => row.id)).toEqual(["artifact-a"]);
    expect(second.map((row) => row.id)).toEqual(["artifact-a"]);
    expect(invokeFn).toHaveBeenCalledTimes(1);
  });

  it("returns cached rows immediately and revalidates in the background", async () => {
    const invokeFn = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "artifact-a",
          runId: "role-run-1",
          taskId: "task-1",
          roleId: "research_analyst",
          sourceKind: "artifact",
          title: "리서처 · task-1 · research_collection.json",
          summary: "복구된 리서치 산출물",
          createdAt: "2026-03-21T00:00:00.000Z",
          jsonPath: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.json",
          sourceFile: "/tmp/workspace/.rail/tasks/task-1/codex_runs/role-run-1/research_collection.json",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "artifact-b",
          runId: "role-run-2",
          taskId: "task-2",
          roleId: "research_analyst",
          sourceKind: "artifact",
          title: "리서처 · task-2 · research_collection.json",
          summary: "복구된 리서치 산출물",
          createdAt: "2026-03-21T01:00:00.000Z",
          jsonPath: "/tmp/workspace/.rail/tasks/task-2/codex_runs/role-run-2/research_collection.json",
          sourceFile: "/tmp/workspace/.rail/tasks/task-2/codex_runs/role-run-2/research_collection.json",
        },
      ]) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await hydrateKnowledgeEntriesFromWorkspaceArtifacts({ cwd: "/tmp/workspace", invokeFn });
    const onUpdate = vi.fn();
    const second = await hydrateKnowledgeEntriesFromWorkspaceArtifacts({
      cwd: "/tmp/workspace",
      invokeFn,
      onUpdate,
    });

    expect(second.map((row) => row.id)).toEqual(["artifact-a"]);
    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "artifact-b" })]),
      );
    });
  });
});
