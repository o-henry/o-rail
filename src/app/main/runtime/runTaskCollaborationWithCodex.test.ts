import { describe, expect, it, vi } from "vitest";
import { runTaskCollaborationWithCodex } from "./runTaskCollaborationWithCodex";

describe("runTaskCollaborationWithCodex", () => {
  it("runs bounded briefs, one critique, then final synthesis", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "brief" | "critique" | "final";
      internal: boolean;
    }) => ({
      roleId: params.roleId,
      runId: `${params.roleId}-${params.promptMode}`,
      summary: `${params.roleId}-${params.promptMode}-summary`,
      artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
    }));

    const result = await runTaskCollaborationWithCodex({
      prompt: "플레이어 이동 버그를 고쳐줘",
      contextSummary: "PlayerController와 테스트 씬이 관련됨",
      participantRoleIds: ["unity_implementer", "unity_architect", "qa_playtester"],
      synthesisRoleId: "unity_implementer",
      criticRoleId: "unity_architect",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenCalledTimes(5);
    expect(executeRoleRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roleId: "unity_implementer",
      promptMode: "brief",
      internal: true,
      model: "GPT-5.4-Mini",
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(4, expect.objectContaining({
      roleId: "unity_architect",
      promptMode: "critique",
      internal: true,
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(5, expect.objectContaining({
      roleId: "unity_implementer",
      promptMode: "final",
      internal: false,
      model: "GPT-5.4",
    }));
    expect(result.finalResult.summary).toContain("final");
  });
});
