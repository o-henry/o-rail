import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGroupDeleteRequest,
  shouldHydrateKnowledgeWorkspaceData,
  shouldRefreshKnowledgeEntriesFromEvent,
} from "./useKnowledgeBaseState";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import { isRuntimeNoiseKnowledgeEntry } from "./knowledgeEntryMapping";

describe("buildKnowledgeGroupDeleteRequest", () => {
  it("creates a pending delete request without deleting anything immediately", () => {
    expect(buildKnowledgeGroupDeleteRequest("run-123", "task-abc")).toEqual({
      runId: "run-123",
      taskId: "task-abc",
    });
  });

  it("returns null when run id is empty", () => {
    expect(buildKnowledgeGroupDeleteRequest("", "task-abc")).toBeNull();
  });

  it("allows workspace-aware filtering to hide runtime noise records", () => {
    const entry: Partial<KnowledgeEntry> = {
      title: "리서처 · task-1 · run.json",
      jsonPath: ".rail/studio_runs/role-1/run.json",
    };
    expect(isRuntimeNoiseKnowledgeEntry(entry)).toBe(true);
  });

  it("hydrates workspace data only for an active tab that has not been loaded yet", () => {
    expect(shouldHydrateKnowledgeWorkspaceData({
      cwd: "/tmp/workspace",
      hydratedWorkspaceCwd: "",
      isActive: true,
    })).toBe(true);
    expect(shouldHydrateKnowledgeWorkspaceData({
      cwd: "/tmp/workspace",
      hydratedWorkspaceCwd: "/tmp/workspace",
      isActive: true,
    })).toBe(false);
    expect(shouldHydrateKnowledgeWorkspaceData({
      cwd: "/tmp/workspace",
      hydratedWorkspaceCwd: "",
      isActive: false,
    })).toBe(false);
  });

  it("refreshes knowledge entries only for active matching workspaces", () => {
    expect(shouldRefreshKnowledgeEntriesFromEvent({
      cwd: "/tmp/workspace",
      eventCwd: "/tmp/workspace",
      isActive: true,
    })).toBe(true);
    expect(shouldRefreshKnowledgeEntriesFromEvent({
      cwd: "/tmp/workspace",
      eventCwd: "",
      isActive: true,
    })).toBe(true);
    expect(shouldRefreshKnowledgeEntriesFromEvent({
      cwd: "/tmp/workspace",
      eventCwd: "/tmp/other",
      isActive: true,
    })).toBe(false);
    expect(shouldRefreshKnowledgeEntriesFromEvent({
      cwd: "/tmp/workspace",
      eventCwd: "/tmp/workspace",
      isActive: false,
    })).toBe(false);
  });
});
