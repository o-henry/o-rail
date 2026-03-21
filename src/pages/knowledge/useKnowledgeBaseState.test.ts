import { describe, expect, it } from "vitest";
import { buildKnowledgeGroupDeleteRequest } from "./useKnowledgeBaseState";
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
});
