import { describe, expect, it } from "vitest";
import {
  buildKnowledgeEntriesFromRoleRunCompletion,
  filterUserFacingRoleArtifactPaths,
  isUserFacingRoleArtifactPath,
} from "./useRoleRunCompletionBridge";

describe("useRoleRunCompletionBridge artifact filtering", () => {
  it("hides internal runtime artifacts from user-facing role results", () => {
    expect(filterUserFacingRoleArtifactPaths([
      "/tmp/task/prompt.md",
      "/tmp/task/response.json",
      "/tmp/task/run.json",
      "/tmp/task/orchestration_plan.json",
      "/tmp/task/discussion_direct.md",
      "/tmp/task/web_gpt_response.md",
      "/tmp/task/final_answer.md",
      "/tmp/task/research_collection.md",
    ])).toEqual([
      "/tmp/task/final_answer.md",
      "/tmp/task/research_collection.md",
    ]);
  });

  it("keeps only user-facing artifacts when creating knowledge entries", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "research_analyst",
        runId: "run-1",
        taskId: "task-1",
        prompt: "시장 조사",
        artifactPaths: [
          "/tmp/task/prompt.md",
          "/tmp/task/web_gpt_response.md",
          "/tmp/task/research_collection.json",
          "/tmp/task/research_findings.md",
        ],
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.markdownPath).toBe("/tmp/task/research_findings.md");
  });

  it("recognizes web response markdown as internal noise", () => {
    expect(isUserFacingRoleArtifactPath("/tmp/task/web_gpt_response.md")).toBe(false);
  });
});
