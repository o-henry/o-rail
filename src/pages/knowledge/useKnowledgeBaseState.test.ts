import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGroupDeleteRequest,
  resolveKnowledgeEntryIdForArtifactPath,
  shouldHydrateKnowledgeWorkspaceData,
  shouldRefreshKnowledgeEntriesFromEvent,
} from "./useKnowledgeBaseState";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import { isRuntimeNoiseKnowledgeEntry } from "./knowledgeEntryMapping";

describe("buildKnowledgeGroupDeleteRequest", () => {
  it("creates a pending delete request without deleting anything immediately", () => {
    expect(buildKnowledgeGroupDeleteRequest(["run-123", "run-456"], "task-abc", "게임 아이디어 요청")).toEqual({
      runIds: ["run-123", "run-456"],
      taskId: "task-abc",
      promptLabel: "게임 아이디어 요청",
    });
  });

  it("returns null when run ids are empty", () => {
    expect(buildKnowledgeGroupDeleteRequest([], "task-abc", "게임 아이디어 요청")).toBeNull();
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

  it("resolves a knowledge entry from a relative artifact path suffix", () => {
    const entry: KnowledgeEntry = {
      id: "entry-1",
      runId: "run-1",
      taskId: "task-1" as KnowledgeEntry["taskId"],
      roleId: "technical_writer",
      sourceKind: "artifact",
      title: "run.json",
      summary: "",
      createdAt: "2026-03-23T00:00:00Z",
      jsonPath: "/tmp/workspace/.rail/studio_runs/role-1/run.json",
    };
    expect(resolveKnowledgeEntryIdForArtifactPath([entry], ".rail/studio_runs/role-1/run.json")).toBe("entry-1");
  });
});
