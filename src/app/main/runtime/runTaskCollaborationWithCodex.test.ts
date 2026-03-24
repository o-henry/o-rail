import { describe, expect, it, vi } from "vitest";
import { runTaskCollaborationWithCodex } from "./runTaskCollaborationWithCodex";

describe("runTaskCollaborationWithCodex", () => {
  it("runs bounded briefs, one critique, then final synthesis", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
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
      reasoning: "중간",
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(4, expect.objectContaining({
      roleId: "unity_architect",
      promptMode: "critique",
      internal: true,
      model: "GPT-5.4-Mini",
      reasoning: "중간",
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(5, expect.objectContaining({
      roleId: "unity_implementer",
      promptMode: "final",
      internal: false,
      model: "GPT-5.4",
      reasoning: "높음",
    }));
    expect(result.finalResult.summary).toContain("final");
  });

  it("retries a transient participant brief failure once before continuing", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
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

  it("retries participant briefs when a materialization RPC error occurs", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      if (params.roleId === "researcher" && params.promptMode === "brief") {
        const attempts = executeRoleRun.mock.calls.filter(
          ([call]) => call.roleId === "researcher" && call.promptMode === "brief",
        ).length;
        if (attempts === 1) {
          throw new Error("rpc error -32600: thread 019d0bf2-ca61-7fd1-b911-f04b9a736eb9 is not materialized yet; includeTurns is unavailable before first user message");
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
      participantRoleIds: ["researcher", "game_designer"],
      synthesisRoleId: "researcher",
      criticRoleId: "game_designer",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(
      executeRoleRun.mock.calls.filter(([call]) => call.roleId === "researcher" && call.promptMode === "brief"),
    ).toHaveLength(2);
    expect(result.finalResult.summary).toContain("final");
  });

  it("falls back to a direct final answer when every participant brief fails", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
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

    const result = await runTaskCollaborationWithCodex({
      prompt: "스팀 장르를 조사해줘",
      contextSummary: "관련 스레드 없음",
      participantRoleIds: ["researcher", "unity_architect"],
      synthesisRoleId: "researcher",
      criticRoleId: "unity_architect",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenCalledTimes(3);
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "critique" }));
    expect(executeRoleRun).toHaveBeenLastCalledWith(expect.objectContaining({ promptMode: "final", internal: false }));
    expect(result.finalResult.summary).toContain("final");
  });

  it("aborts the whole collaboration immediately when a participant run is interrupted by the user", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
    }) => {
      if (params.roleId === "researcher" && params.promptMode === "brief") {
        throw new Error("현재 작업을 중단했습니다.");
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
    ).rejects.toThrow("현재 작업을 중단했습니다.");

    expect(executeRoleRun).toHaveBeenCalledTimes(1);
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "critique" }));
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "final" }));
  });

  it("aborts the whole collaboration immediately when a participant run is interrupted by the user", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
    }) => {
      if (params.roleId === "researcher" && params.promptMode === "brief") {
        throw new Error("현재 작업을 중단했습니다.");
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
    ).rejects.toThrow("현재 작업을 중단했습니다.");

    expect(executeRoleRun).toHaveBeenCalledTimes(1);
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "critique" }));
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ promptMode: "final" }));
  });

  it("retries critique and final synthesis on transient RPC errors", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      const attempts = executeRoleRun.mock.calls.filter(
        ([call]) => call.roleId === params.roleId && call.promptMode === params.promptMode,
      ).length;
      if (params.promptMode === "critique" && attempts === 1) {
        throw new Error("rpc error -32600: thread not materialized yet; includeTurns is unavailable before first user message");
      }
      if (params.promptMode === "final" && attempts === 1) {
        throw new Error("network temporarily unavailable");
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    const result = await runTaskCollaborationWithCodex({
      prompt: "정리해줘",
      contextSummary: "관련 스레드 있음",
      participantRoleIds: ["researcher", "game_designer"],
      synthesisRoleId: "researcher",
      criticRoleId: "game_designer",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(
      executeRoleRun.mock.calls.filter(([call]) => call.roleId === "game_designer" && call.promptMode === "critique"),
    ).toHaveLength(2);
    expect(
      executeRoleRun.mock.calls.filter(([call]) => call.roleId === "researcher" && call.promptMode === "final"),
    ).toHaveLength(2);
    expect(result.finalResult.summary).toContain("final");
  });

  it("injects per-role orchestration prompts into participant briefs", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => ({
      roleId: params.roleId,
      runId: `${params.roleId}-${params.promptMode}`,
      summary: params.prompt,
      artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
    }));

    await runTaskCollaborationWithCodex({
      prompt: "새 게임 아이디어를 만들어줘",
      contextSummary: "",
      participantRoleIds: ["researcher", "game_designer"],
      participantPrompts: {
        researcher: "researcher-assignment",
        game_designer: "designer-assignment",
      },
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roleId: "researcher",
      promptMode: "brief",
      prompt: expect.stringContaining("researcher-assignment"),
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      roleId: "game_designer",
      promptMode: "brief",
      prompt: expect.stringContaining("designer-assignment"),
    }));
  });

  it("adds creative divergence and rejection instructions when creative mode is enabled", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => ({
      roleId: params.roleId,
      runId: `${params.roleId}-${params.promptMode}`,
      summary: params.prompt,
      artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
    }));

    await runTaskCollaborationWithCodex({
      prompt: "아류작이 아닌 게임 아이디어 10개를 제안해줘",
      contextSummary: "최근 대화 요약",
      participantRoleIds: ["game_designer", "researcher"],
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      creativeMode: true,
      intent: "ideation",
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "direct",
      prompt: expect.stringContaining("Creative Mode"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "direct",
      prompt: expect.not.stringContaining("# ORCHESTRATION"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "direct",
      prompt: expect.not.stringContaining("TASK_ID"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "direct",
      prompt: expect.not.stringContaining("최근 대화"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "direct",
      prompt: expect.not.stringContaining("# 참고 컨텍스트"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "final",
      prompt: expect.stringContaining("무난한 평균 답보다 기억에 남는 후보"),
    }));
  });

  it("keeps ideation direct prompts focused on the role, user request, and short web perspective instead of dumping thread metadata", async () => {
    let capturedPrompt = "";
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      outputArtifactName?: string;
    }) => {
      if (params.roleId === "game_designer" && params.promptMode === "direct") {
        capturedPrompt = params.prompt;
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "아류작이 아닌 게임 아이디어 10개를 제안해줘",
      intent: "ideation",
      creativeMode: true,
      contextSummary: [
        "TASK_ID: task-123",
        "최근 대화: USER: 새 스레드",
        "# 외부 웹 AI 관점",
        "## claims",
        "- 사람들이 반복 플레이하는 게임은 짧은 세션에서도 즉시 손맛이 온다.",
        "## ideas",
        "- 한 조작만으로 예측과 반전이 동시에 생기는 구조가 유리하다.",
        "## novelty_signals",
        "- 대표작 두 개를 섞은 설명은 즉시 탈락시켜야 한다.",
        "# 외부 웹 AI 원문",
        "길고 지저분한 원문 덤프",
      ].join("\n"),
      participantRoleIds: ["game_designer"],
      synthesisRoleId: "game_designer",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(capturedPrompt).toContain("# 사용자 요청");
    expect(capturedPrompt).toContain("# 외부 참고 요약");
    expect(capturedPrompt).toContain("짧은 세션에서도 즉시 손맛");
    expect(capturedPrompt).toContain("대표작 두 개를 섞은 설명");
    expect(capturedPrompt).not.toContain("TASK_ID");
    expect(capturedPrompt).not.toContain("최근 대화");
    expect(capturedPrompt).not.toContain("길고 지저분한 원문 덤프");
    expect(capturedPrompt).not.toContain("# 참고 컨텍스트");
  });

  it("runs orchestrator first and then uses direct participant passes for ideation", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      model?: string;
      reasoning?: string;
    }) => {
      if (params.promptMode === "orchestrate") {
        return {
          roleId: params.roleId,
          runId: `${params.roleId}-orchestrate`,
          summary: JSON.stringify({
            participant_role_ids: ["game_designer", "researcher", "unity_architect"],
            primary_role_id: "game_designer",
            critic_role_id: "unity_architect",
            orchestration_summary: "메인 오케스트레이터가 designer 중심으로 재배치했습니다.",
            role_assignments: {
              game_designer: "designer-plan",
              researcher: "research-plan",
              unity_architect: "architect-plan",
            },
          }),
          artifactPaths: ["/orchestration.json"],
        };
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "새 게임 아이디어를 fanout으로 토론해서 골라줘",
      contextSummary: "",
      participantRoleIds: ["game_designer", "researcher"],
      candidateRoleIds: ["game_designer", "researcher", "unity_architect"],
      requestedRoleIds: ["researcher", "unity_architect"],
      participantPrompts: {
        game_designer: "designer-base",
        researcher: "research-base",
        unity_architect: "architect-base",
      },
      intent: "ideation",
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      useAdaptiveOrchestrator: true,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roleId: "game_designer",
      promptMode: "orchestrate",
      model: "GPT-5.4",
      reasoning: "매우 높음",
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      roleId: "game_designer",
      promptMode: "direct",
      model: "GPT-5.4",
      reasoning: "높음",
      includeRoleKnowledge: false,
      prompt: expect.stringContaining("# 작업 모드\n역할별 직접 응답"),
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(3, expect.objectContaining({
      roleId: "researcher",
      promptMode: "direct",
      model: "GPT-5.4",
      reasoning: "높음",
      includeRoleKnowledge: false,
      prompt: expect.stringContaining("새 게임 아이디어를 fanout으로 토론해서 골라줘"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "unity_architect",
      promptMode: "direct",
      prompt: expect.stringContaining("새 게임 아이디어를 fanout으로 토론해서 골라줘"),
    }));
  });

  it("builds an ideation final prompt that demands final numbered ideas instead of handoff text", async () => {
    let finalPrompt = "";
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      outputArtifactName?: string;
    }) => {
      if (params.promptMode === "final") {
        finalPrompt = params.prompt;
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: params.promptMode === "final" ? "1. 아이디어 A\n2. 아이디어 B" : `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "장르 불문 게임 아이디어 10개를 제안해줘",
      intent: "ideation",
      contextSummary: "최근 Steam 흐름 참고",
      participantRoleIds: ["game_designer", "researcher"],
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(finalPrompt).toContain("지금 바로 사용자에게 전달할 최종 아이디어 답변만 작성한다.");
    expect(finalPrompt).toContain("번호 목록으로 아이디어를 제시");
    expect(finalPrompt).toContain("handoff");
  });

  it("passes failed participant ids into the final synthesis prompt when a brief fails", async () => {
    let finalPrompt = "";
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      if (params.roleId === "researcher" && params.promptMode === "brief") {
        throw new Error("researcher failed");
      }
      if (params.promptMode === "final") {
        finalPrompt = params.prompt;
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "정리해줘",
      contextSummary: "최근 스레드 있음",
      participantRoleIds: ["game_designer", "researcher"],
      synthesisRoleId: "game_designer",
      criticRoleId: "game_designer",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(finalPrompt).toContain("# 실패한 참여 에이전트");
    expect(finalPrompt).toContain("- researcher");
  });

  it("keeps orchestration inside the approved worker set even when the model proposes legacy aliases", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      model?: string;
      reasoning?: string;
    }) => {
      if (params.promptMode === "orchestrate") {
        return {
          roleId: params.roleId,
          runId: `${params.roleId}-orchestrate`,
          summary: JSON.stringify({
            participant_role_ids: ["game_designer", "researcher"],
            primary_role_id: "game_designer",
            critic_role_id: "researcher",
            orchestration_summary: "designer + researcher",
            role_assignments: {
              game_designer: "designer-plan",
              researcher: "research-plan",
            },
          }),
          artifactPaths: ["/orchestration.json"],
        };
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "10개 게임 아이디어를 만들어줘",
      contextSummary: "",
      participantRoleIds: ["pm_planner", "system_programmer"],
      candidateRoleIds: ["pm_planner", "research_analyst", "system_programmer"],
      requestedRoleIds: [],
      participantPrompts: {
        pm_planner: "designer-fallback",
        research_analyst: "research-fallback",
        system_programmer: "architect-fallback",
      },
      intent: "ideation",
      synthesisRoleId: "pm_planner",
      criticRoleId: "system_programmer",
      cappedParticipantCount: false,
      useAdaptiveOrchestrator: true,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roleId: "pm_planner",
      promptMode: "orchestrate",
      prompt: expect.stringContaining("# 작업 모드\n메인 오케스트레이터"),
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      roleId: "pm_planner",
      promptMode: "direct",
      prompt: expect.stringContaining("# 작업 모드\n역할별 직접 응답"),
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(3, expect.objectContaining({
      roleId: "research_analyst",
      promptMode: "direct",
      prompt: expect.stringContaining("10개 게임 아이디어를 만들어줘"),
    }));
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({
      roleId: "system_programmer",
      promptMode: "direct",
    }));
  });

  it("falls back from an unreadable participant brief to a direct participant pass", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      if (params.roleId === "researcher" && params.promptMode === "brief") {
        throw new Error("Codex turn finished without a readable response");
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
      participantRoleIds: ["researcher", "game_designer"],
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "researcher",
      promptMode: "brief",
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "researcher",
      promptMode: "direct",
      outputArtifactName: "discussion_direct.md",
    }));
    expect(result.finalResult.summary).toContain("final");
  });

  it("retries an unreadable direct participant response in ideation mode before failing", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      model?: string;
      includeRoleKnowledge?: boolean;
    }) => {
      if (params.roleId === "game_designer" && params.promptMode === "direct") {
        const attempts = executeRoleRun.mock.calls.filter(
          ([call]) => call.roleId === "game_designer" && call.promptMode === "direct",
        ).length;
        if (attempts === 1) {
          throw new Error("Codex turn finished without a readable response");
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
      prompt: "아류작이 아닌 게임 아이디어 10개를 제안해줘",
      contextSummary: "최근 대화 요약",
      participantRoleIds: ["game_designer", "researcher"],
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      creativeMode: true,
      intent: "ideation",
      executeRoleRun,
    });

    expect(
      executeRoleRun.mock.calls.filter(([call]) => call.roleId === "game_designer" && call.promptMode === "direct"),
    ).toHaveLength(2);
    expect(
      executeRoleRun.mock.calls
        .filter(([call]) => call.roleId === "game_designer" && call.promptMode === "direct")
        .every(([call]) => call.model === "GPT-5.4" && call.includeRoleKnowledge === false),
    ).toBe(true);
    expect(result.finalResult.summary).toContain("final");
  });

  it("retries an unreadable final synthesis response before surfacing failure", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      if (params.promptMode === "final") {
        const attempts = executeRoleRun.mock.calls.filter(
          ([call]) => call.promptMode === "final",
        ).length;
        if (attempts === 1) {
          throw new Error("Codex turn finished without a readable response");
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
      prompt: "아류작이 아닌 게임 아이디어 10개를 제안해줘",
      contextSummary: "최근 대화 요약",
      participantRoleIds: ["game_designer", "researcher"],
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      creativeMode: true,
      intent: "ideation",
      executeRoleRun,
    });

    expect(
      executeRoleRun.mock.calls.filter(([call]) => call.promptMode === "final"),
    ).toHaveLength(2);
    expect(result.finalResult.summary).toContain("final-summary");
  });

  it("collects shared web perspective once and keeps internal collaboration stages on Codex models", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      model?: string;
      reasoning?: string;
    }) => ({
      roleId: params.roleId,
      runId: `${params.roleId}-${params.promptMode}`,
      summary: `${params.roleId}-${params.promptMode}-summary`,
      artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
    }));

    await runTaskCollaborationWithCodex({
      prompt: "웹 AI로 각 역할 브리프를 돌려서 최종 답변을 합쳐줘",
      contextSummary: "",
      participantRoleIds: ["game_designer", "researcher"],
      candidateRoleIds: ["game_designer", "researcher", "unity_architect"],
      requestedRoleIds: [],
      participantPrompts: {
        game_designer: "designer-base",
        researcher: "research-base",
      },
      intent: "planning",
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      useAdaptiveOrchestrator: true,
      preferredModel: "GPT-Web",
      preferredReasoning: "중간",
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      promptMode: "orchestrate",
      model: "GPT-5.4",
      reasoning: "매우 높음",
    }));
    expect(executeRoleRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      promptMode: "brief",
      model: "GPT-Web",
      reasoning: "중간",
      outputArtifactName: "shared_web_perspective.md",
      prompt: expect.stringContaining("외부 웹 AI 관점 수집"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "orchestrate",
      model: "GPT-5.4",
      reasoning: "매우 높음",
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "brief",
      model: "GPT-5.4-Mini",
      reasoning: "중간",
      prompt: expect.stringContaining("# 외부 웹 AI 관점"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "brief",
      prompt: expect.stringContaining("## claims"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "brief",
      prompt: expect.stringContaining("# 외부 웹 AI 원문"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "brief",
      prompt: expect.stringContaining("game_designer-brief-summary"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "final",
      model: "GPT-5.4",
      reasoning: "높음",
      prompt: expect.stringContaining("# 외부 웹 AI 관점"),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "final",
      prompt: expect.stringContaining("# 외부 웹 AI 원문"),
    }));
  });

  it("lets the orchestrator decide whether external web research runs instead of relying on prompt keywords", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      model?: string;
      reasoning?: string;
    }) => {
      if (params.promptMode === "orchestrate") {
        return {
          roleId: params.roleId,
          runId: `${params.roleId}-orchestrate`,
          summary: JSON.stringify({
            participant_role_ids: ["game_designer", "researcher"],
            primary_role_id: "game_designer",
            critic_role_id: "researcher",
            collect_external_web_research: false,
            external_web_research_focus: "",
            orchestration_summary: "내부 지식만으로 우선 정리",
            role_assignments: {
              game_designer: "designer-plan",
              researcher: "research-plan",
            },
          }),
          artifactPaths: ["/orchestration.json"],
        };
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "스팀, 메타크리틱, 커뮤니티를 조사해서 게임 아이디어를 추천해줘",
      contextSummary: "",
      participantRoleIds: ["game_designer", "researcher"],
      candidateRoleIds: ["game_designer", "researcher"],
      requestedRoleIds: [],
      participantPrompts: {
        game_designer: "designer-base",
        researcher: "research-base",
      },
      intent: "ideation",
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      useAdaptiveOrchestrator: true,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      promptMode: "orchestrate",
    }));
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({
      outputArtifactName: "shared_web_perspective.md",
    }));
  });

  it("passes the orchestrator's external research focus into shared web collection", async () => {
    let sharedWebPrompt = "";
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      outputArtifactName?: string;
    }) => {
      if (params.promptMode === "orchestrate") {
        return {
          roleId: params.roleId,
          runId: `${params.roleId}-orchestrate`,
          summary: JSON.stringify({
            participant_role_ids: ["game_designer", "researcher"],
            primary_role_id: "game_designer",
            critic_role_id: "researcher",
            collect_external_web_research: true,
            external_web_research_focus: "Steam 유저 반응, 메타크리틱 호평 포인트, 커뮤니티 반복 불만을 요약",
            orchestration_summary: "외부 시장 반응을 먼저 훑고 합성",
            role_assignments: {
              game_designer: "designer-plan",
              researcher: "research-plan",
            },
          }),
          artifactPaths: ["/orchestration.json"],
        };
      }
      if (params.outputArtifactName === "shared_web_perspective.md") {
        sharedWebPrompt = params.prompt;
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "게임 아이디어를 추천해줘",
      contextSummary: "",
      participantRoleIds: ["game_designer", "researcher"],
      candidateRoleIds: ["game_designer", "researcher"],
      requestedRoleIds: [],
      participantPrompts: {
        game_designer: "designer-base",
        researcher: "research-base",
      },
      intent: "ideation",
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      cappedParticipantCount: false,
      useAdaptiveOrchestrator: true,
      executeRoleRun,
    });

    expect(sharedWebPrompt).toContain("# 외부 조사 포커스");
    expect(sharedWebPrompt).toContain("Steam 유저 반응");
    expect(sharedWebPrompt).toContain("메타크리틱 호평 포인트");
  });

  it("forces ideation final synthesis to produce direct numbered idea output instead of handoff guidance", async () => {
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
      intent?: string;
    }) => ({
      roleId: params.roleId,
      runId: `${params.roleId}-${params.promptMode}`,
      summary: params.promptMode === "final" ? "1. 아이디어 A\n2. 아이디어 B" : `${params.roleId}-${params.promptMode}-summary`,
      artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
    }));

    await runTaskCollaborationWithCodex({
      prompt: "장르 불문 게임 아이디어 10개를 제안해줘",
      contextSummary: "",
      participantRoleIds: ["game_designer", "researcher"],
      synthesisRoleId: "game_designer",
      criticRoleId: "researcher",
      intent: "ideation",
      cappedParticipantCount: false,
      executeRoleRun,
    });

    expect(executeRoleRun).toHaveBeenLastCalledWith(expect.objectContaining({
      promptMode: "final",
      intent: "ideation",
      includeRoleKnowledge: false,
      prompt: expect.stringContaining("지금 바로 사용자에게 전달할 최종 아이디어 답변만 작성한다."),
    }));
    expect(executeRoleRun).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("사용자 요청에 숫자 요구가 있으면 그 수를 충족하도록 번호 목록으로 아이디어를 제시한다."),
    }));
  });

  it("localizes empty-codex-response errors in orchestration progress messages", async () => {
    const onProgress = vi.fn();
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => {
      if (params.promptMode === "orchestrate") {
        throw new Error("Codex turn finished without a readable response");
      }
      return {
        roleId: params.roleId,
        runId: `${params.roleId}-${params.promptMode}`,
        summary: `${params.roleId}-${params.promptMode}-summary`,
        artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
      };
    });

    await runTaskCollaborationWithCodex({
      prompt: "새 게임 아이디어를 fanout으로 토론해서 골라줘",
      contextSummary: "",
      participantRoleIds: ["pm_planner"],
      synthesisRoleId: "pm_planner",
      cappedParticipantCount: false,
      useAdaptiveOrchestrator: true,
      executeRoleRun,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("코덱스 실행은 끝났지만 읽을 수 있는 응답 본문이 없었습니다."),
    }));
  });
});
