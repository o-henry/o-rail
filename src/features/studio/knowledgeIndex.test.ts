import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHiddenKnowledgeIdsForTest,
  hydrateKnowledgeEntriesFromWorkspace,
  isKnowledgeEntryIdHidden,
  isKnowledgeRunIdHidden,
  readKnowledgeEntries,
  removeKnowledgeEntry,
  removeKnowledgeEntriesByRunId,
  upsertKnowledgeEntry,
} from "./knowledgeIndex";

const STORAGE_KEY = "rail.studio.knowledge.index.v1";

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

describe("knowledgeIndex.removeKnowledgeEntriesByRunId", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock(),
    } as unknown as Window & typeof globalThis);
  });

  afterEach(() => {
    clearHiddenKnowledgeIdsForTest();
    vi.unstubAllGlobals();
  });

  it("removes all entries in the target run group", () => {
    upsertKnowledgeEntry(entry("a", "run-1"));
    upsertKnowledgeEntry(entry("b", "run-1"));
    upsertKnowledgeEntry(entry("c", "run-2"));

    const next = removeKnowledgeEntriesByRunId("run-1");

    expect(next.map((row) => row.id)).toEqual(["c"]);
    expect(readKnowledgeEntries().map((row) => row.id)).toEqual(["c"]);
  });

  it("returns original entries when run id is empty", () => {
    upsertKnowledgeEntry(entry("a", "run-1"));
    upsertKnowledgeEntry(entry("b", "run-2"));

    const next = removeKnowledgeEntriesByRunId("   ");

    expect(next).toHaveLength(2);
    expect(readKnowledgeEntries()).toHaveLength(2);
  });

  it("keeps storage key with updated rows", () => {
    upsertKnowledgeEntry(entry("a", "run-1"));
    upsertKnowledgeEntry(entry("b", "run-2"));

    removeKnowledgeEntriesByRunId("run-2");

    const serialized = window.localStorage.getItem(STORAGE_KEY);
    expect(serialized).toBeTruthy();
    const parsed = JSON.parse(String(serialized));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.runId).toBe("run-1");
  });

  it("marks run id hidden when removing a run group", () => {
    upsertKnowledgeEntry(entry("a", "run-1"));
    removeKnowledgeEntriesByRunId("run-1");
    expect(isKnowledgeRunIdHidden("run-1")).toBe(true);
  });

  it("does not upsert entries from hidden run", () => {
    removeKnowledgeEntriesByRunId("run-1");
    const next = upsertKnowledgeEntry(entry("a", "run-1"));
    expect(next).toHaveLength(0);
    expect(readKnowledgeEntries()).toHaveLength(0);
  });

  it("marks entry id hidden on remove", () => {
    upsertKnowledgeEntry(entry("a", "run-1"));
    removeKnowledgeEntry("a");
    expect(isKnowledgeEntryIdHidden("a")).toBe(true);
  });

  it("preserves task agent and orchestrator labels across storage", () => {
    upsertKnowledgeEntry({
      ...entry("a", "run-1"),
      taskAgentId: "researcher",
      taskAgentLabel: "RESEARCHER",
      studioRoleLabel: "리서처",
      orchestratorAgentId: "researcher",
      orchestratorAgentLabel: "RESEARCHER",
    });

    expect(readKnowledgeEntries()[0]).toMatchObject({
      taskAgentId: "researcher",
      taskAgentLabel: "RESEARCHER",
      studioRoleLabel: "리서처",
      orchestratorAgentId: "researcher",
      orchestratorAgentLabel: "RESEARCHER",
    });
  });

  it("hydrates workspace knowledge index into local storage", async () => {
    upsertKnowledgeEntry(entry("local-a", "run-local"));

    const hydrated = await hydrateKnowledgeEntriesFromWorkspace({
      cwd: "/tmp/workspace",
      invokeFn: (async (command, args) => {
        expect(command).toBe("workspace_read_text");
        expect(args).toMatchObject({
          cwd: "/tmp/workspace",
          path: ".rail/studio_index/knowledge/index.json",
        });
        return JSON.stringify([
          entry("workspace-a", "run-workspace"),
          {
            ...entry("workspace-b", "run-workspace"),
            taskAgentId: "researcher",
            taskAgentLabel: "RESEARCHER",
          },
        ]);
      }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    });

    expect(hydrated.map((row) => row.id)).toEqual(["local-a", "workspace-a", "workspace-b"]);
    expect(readKnowledgeEntries().map((row) => row.id)).toEqual(["local-a", "workspace-a", "workspace-b"]);
  });
});
