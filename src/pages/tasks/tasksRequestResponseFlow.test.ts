import { describe, expect, it, vi } from "vitest";
import { runTaskCollaborationWithCodex } from "../../app/main/runtime/runTaskCollaborationWithCodex";
import {
  deriveExecutionPlan,
  runRuntimeExecutionPlan,
} from "./taskExecutionRuntime";
import type { ThreadDetail } from "./threadTypes";

function buildThreadDetail(): ThreadDetail {
  return {
    thread: {
      threadId: "thread_ideation",
      taskId: "task_ideation",
      title: "Creative game ideas",
      userPrompt: "placeholder",
      status: "idle",
      cwd: "/workspace/rail-docs",
      branchLabel: "main",
      accessMode: "Local",
      model: "GPT-5.4",
      reasoning: "높음",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    },
    task: {
      taskId: "task_ideation",
      goal: "Creative game ideas",
      mode: "balanced",
      team: "full-squad",
      isolationRequested: "auto",
      isolationResolved: "current-repo",
      status: "active",
      projectPath: "/workspace/rail-docs",
      workspacePath: "/workspace/rail-docs",
      worktreePath: "/workspace/rail-docs",
      branchName: "main",
      fallbackReason: null,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      roles: [],
      prompts: [],
    },
    messages: [],
    agents: [],
    approvals: [],
    agentDetail: null,
    artifacts: {},
    changedFiles: [],
    validationState: "pending",
    riskLevel: "medium",
    files: [],
    workflow: {
      currentStageId: "brief",
      stages: [],
      nextAction: "Wait",
      readinessSummary: "Ready",
    },
    orchestration: null,
  };
}

describe("tasks request/response flow", () => {
  it("keeps ideation collaboration on task agent ids and produces a final result without remapping to internal pm roles", async () => {
    const prompt = "나는 1인 인디 게임 개발자야. 창의적인 게임 아이디어가 필요해. 아이디어는 커뮤니티, 스팀, 메타크리틱 등 게임 관련 리소스들을 조사해서, 재밌는, 인기있는, 사람들이 좋아하는 게임이 무엇인지 학습한 후 나에게 아이디어 10개를 추천해줘. (단, 아류작은 안돼)";
    const requestedRoleIds = ["game_designer", "level_designer", "unity_architect"] as const;
    const plan = deriveExecutionPlan({
      enabledRoleIds: [...requestedRoleIds],
      requestedRoleIds: [...requestedRoleIds],
      prompt,
      creativeMode: true,
    });
    const publishAction = vi.fn();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_spawn_agents" || command === "thread_add_agent") {
        return buildThreadDetail();
      }
      throw new Error(`unexpected command: ${command}`);
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await runRuntimeExecutionPlan({
      detail: buildThreadDetail(),
      prompt,
      plan,
      cwd: "/workspace/rail-docs",
      invokeFn,
      hydrateThreadDetail: (detail) => detail,
      publishAction,
    });

    expect(publishAction).toHaveBeenCalledTimes(1);
    expect(publishAction).toHaveBeenCalledWith(expect.objectContaining({
      type: "run_task_collaboration",
      payload: expect.objectContaining({
        roleIds: expect.arrayContaining([...requestedRoleIds]),
        candidateRoleIds: expect.arrayContaining([...requestedRoleIds]),
      }),
    }));

    const collaborationAction = publishAction.mock.calls[0]?.[0];
    const executeRoleRun = vi.fn(async (params: {
      roleId: string;
      prompt: string;
      promptMode: "direct" | "orchestrate" | "brief" | "critique" | "final";
      internal: boolean;
    }) => ({
      roleId: params.roleId,
      runId: `${params.roleId}-${params.promptMode}`,
      summary: params.promptMode === "final"
        ? "1. 아이디어 A\n2. 아이디어 B\n3. 아이디어 C"
        : `${params.roleId}-${params.promptMode}-summary`,
      artifactPaths: [`/${params.roleId}/${params.promptMode}.md`],
    }));

    const result = await runTaskCollaborationWithCodex({
      prompt: collaborationAction.payload.prompt,
      contextSummary: "",
      participantRoleIds: collaborationAction.payload.roleIds,
      candidateRoleIds: collaborationAction.payload.candidateRoleIds,
      requestedRoleIds: collaborationAction.payload.requestedRoleIds,
      participantPrompts: collaborationAction.payload.rolePrompts,
      intent: collaborationAction.payload.intent,
      creativeMode: collaborationAction.payload.creativeMode,
      synthesisRoleId: collaborationAction.payload.synthesisRoleId,
      criticRoleId: collaborationAction.payload.criticRoleId,
      cappedParticipantCount: collaborationAction.payload.cappedParticipantCount,
      useAdaptiveOrchestrator: collaborationAction.payload.useAdaptiveOrchestrator,
      executeRoleRun,
    });

    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ roleId: "pm_planner" }));
    expect(executeRoleRun).not.toHaveBeenCalledWith(expect.objectContaining({ roleId: "pm_creative_director" }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "game_designer",
      promptMode: "direct",
      prompt: expect.stringContaining(prompt),
    }));
    expect(executeRoleRun).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "level_designer",
      promptMode: "direct",
    }));
    expect(result.participantResults).toHaveLength(3);
    expect(result.finalResult.summary).toContain("아이디어");
  });
});
