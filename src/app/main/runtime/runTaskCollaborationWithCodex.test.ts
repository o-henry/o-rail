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

  it("retries a transient participant brief failure once before continuing", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      if (params.roleId === "researcher" && params.promptMode === "brief") {
        const attempts = executeRoleRun.mock.calls.filter(
          ([call]) => call.roleId === "researcher" && call.promptMode === "brief",
        ).length;
        if (attempts === 1) {
          throw new Error("Codex turn did not complete (inprogress)");
        }
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    const result = await runTaskCollaborationWithCodex({
      prompt: "스팀 장르를 조사해줘",
      contextSummary: "최근 스레드 없음",
      participantRoleIds: ["researcher", "unity_architect"],
      synthesisRoleId: "researcher",
      criticRoleId: "unity_architect",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(
      executeRoleRun.mock.calls.filter(([call]) => call.roleId === "researcher" && call.promptMode === "brief"),
    ).toHaveLength(2);
    expect(result.participantResults).toHaveLength(2);
    expect(result.finalResult.summary).toContain("final");
  });

  it("does not run critique or final synthesis when every participant brief fails", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "brief" | "critique" | "final";
    }) => {
      if (params.promptMode === "brief") {
        throw new Error(`${params.roleId} failed`);
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await expect(
      runTaskCollaborationWithCodex({
        prompt: "스팀 장르를 조사해줘",
        contextSummary: "관련 스레드 없음",
        participantRoleIds: ["researcher", "unity_architect"],
        synthesisRoleId: "researcher",
        criticRoleId: "unity_architect",
        cappedParticipantCount: false,
        executeRoleRun,
      }),
    ).rejects.toThrow("모든 내부 브리프가 실패");

    expect(executeRoleRun).toHaveBeenCalledTimes(2);
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "critique" }));
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "final" }));
  });
});
