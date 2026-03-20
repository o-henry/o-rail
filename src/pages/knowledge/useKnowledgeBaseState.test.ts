import { describe, expect, it } from "vitest";
import { buildKnowledgeGroupDeleteRequest } from "./useKnowledgeBaseState";

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
});
