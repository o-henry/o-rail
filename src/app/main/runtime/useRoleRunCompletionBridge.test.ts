import { describe, expect, it } from "vitest";
import { buildKnowledgeEntriesFromRoleRunCompletion } from "./useRoleRunCompletionBridge";

describe("buildKnowledgeEntriesFromRoleRunCompletion", () => {
  it("keeps generated markdown/json artifacts visible even when the role run failed", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "pm_planner",
        runId: "role-123",
        taskId: "thread-123",
        prompt: "아이디어 5개를 정리해줘",
        internal: false,
        artifactPaths: [
          "/tmp/workspace/.rail/studio_runs/role-123/artifacts/final_response.md",
          "/tmp/workspace/.rail/studio_runs/role-123/artifacts/response.json",
        ],
      },
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      runId: "role-123",
      taskId: "thread-123",
      markdownPath: "/tmp/workspace/.rail/studio_runs/role-123/artifacts/final_response.md",
    });
    expect(entries[1]).toMatchObject({
      runId: "role-123",
      taskId: "thread-123",
      jsonPath: "/tmp/workspace/.rail/studio_runs/role-123/artifacts/response.json",
    });
  });

  it("maps internal collaboration roles to task agent metadata for stored artifacts", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "research_analyst",
        runId: "role-456",
        taskId: "thread-456",
        prompt: "시장성 리스크를 검토해줘",
        internal: true,
        artifactPaths: [
          "/tmp/workspace/.rail/studio_runs/role-456/artifacts/discussion_brief.md",
        ],
      },
    });

    expect(entries[0]).toMatchObject({
      taskAgentId: "researcher",
      taskAgentLabel: "RESEARCHER",
      studioRoleLabel: "리서처",
      markdownPath: "/tmp/workspace/.rail/studio_runs/role-456/artifacts/discussion_brief.md",
    });
  });
});
