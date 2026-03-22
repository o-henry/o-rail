import { describe, expect, it, vi } from "vitest";
import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";
import {
  buildExecutionPlanFromCoordination,
  deriveExecutionPlan,
  dispatchTaskExecutionPlan,
  runBrowserExecutionPlan,
  runRuntimeExecutionPlan,
} from "./taskExecutionRuntime";
import type { ThreadDetail } from "./threadTypes";

function buildThreadDetail(): ThreadDetail {
  return {
    thread: {
      threadId: "thread_1",
      taskId: "task_1",
      title: "Test thread",
      userPrompt: "Compare the implementation",
      status: "idle",
      cwd: "/workspace/demo",
      branchLabel: "main",
      accessMode: "Local",
      model: "GPT-5.4",
      reasoning: "중간",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    },
    task: {
      taskId: "task_1",
      goal: "Compare the implementation",
      mode: "balanced",
      team: "full-squad",
      isolationRequested: "auto",
      isolationResolved: "current-repo",
      status: "active",
      projectPath: "/workspace/demo",
      workspacePath: "/workspace/demo",
      worktreePath: "/workspace/demo",
      branchName: "main",
      fallbackReason: null,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      roles: [],
      prompts: [],
    },
    messages: [],
    agents: [
      {
        id: "thread_1:researcher",
        threadId: "thread_1",
        label: "Researcher",
        roleId: "researcher",
        status: "idle",
        summary: "Research sources",
        worktreePath: "/workspace/demo",
        lastUpdatedAt: "2026-03-20T00:00:00.000Z",
      },
      {
        id: "thread_1:unity_architect",
        threadId: "thread_1",
        label: "Architect",
        roleId: "unity_architect",
        status: "idle",
        summary: "Review architecture",
        worktreePath: "/workspace/demo",
        lastUpdatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
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

function buildCoordination(overrides: Partial<AgenticCoordinationState> = {}): AgenticCoordinationState {
  return {
    threadId: "thread_1",
    prompt: "Compare architecture and review",
    requestedRoleIds: ["researcher", "unity_architect"],
    recommendedMode: "team",
    mode: "team",
    intent: "review_heavy",
    status: "planning",
    nextAction: "Approve the plan",
    blockedReason: null,
    plan: null,
    delegateTasks: [],
    delegateResults: [],
    teamSession: null,
    resumePointer: null,
    guidance: [],
    updatedAt: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("taskExecutionRuntime", () => {
  it("prefers orchestrator-first execution for untagged prompts outside quick mode", () => {
    const plan = deriveExecutionPlan({
      enabledRoleIds: ["game_designer", "researcher", "unity_architect", "unity_implementer"],
      requestedRoleIds: [],
      prompt: "1인 인디게임 시장을 조사하고 지금 만들만한 방향을 추천해줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.useAdaptiveOrchestrator).toBe(true);
    expect(plan.participantRoleIds).toEqual(["researcher", "game_designer"]);
  });

  it("forces quick mode to a single participant", () => {
    const plan = deriveExecutionPlan({
      enabledRoleIds: ["researcher", "unity_architect"],
      requestedRoleIds: ["researcher", "unity_architect"],
      prompt: "Compare and review",
      selectedMode: "quick",
    });
    expect(plan.mode).toBe("single");
    expect(plan.participantRoleIds).toHaveLength(1);
  });

  it("builds coordination execution plan respecting quick mode", () => {
    const plan = buildExecutionPlanFromCoordination(
      buildThreadDetail(),
      buildCoordination({ mode: "quick", requestedRoleIds: ["researcher", "unity_architect"] }),
    );
    expect(plan.mode).toBe("single");
    expect(plan.participantRoleIds).toEqual(["unity_architect"]);
  });

  it("dispatches a collaboration action for discussion plans", () => {
    const publishAction = vi.fn();
    dispatchTaskExecutionPlan({
      detail: buildThreadDetail(),
      prompt: "Compare and review",
      plan: deriveExecutionPlan({
        enabledRoleIds: ["researcher", "unity_architect"],
        requestedRoleIds: ["researcher", "unity_architect"],
        prompt: "Compare and review",
      }),
      publishAction,
    });
    expect(publishAction).toHaveBeenCalledWith(expect.objectContaining({
      type: "run_task_collaboration",
      payload: expect.objectContaining({
        candidateRoleIds: expect.any(Array),
        requestedRoleIds: expect.any(Array),
        useAdaptiveOrchestrator: expect.any(Boolean),
        rolePrompts: expect.any(Object),
      }),
    }));
  });

  it("dispatches a single-role runtime action with the mapped studio role id", () => {
    const publishAction = vi.fn();
    dispatchTaskExecutionPlan({
      detail: buildThreadDetail(),
      prompt: "구조를 검토해줘",
      plan: {
        mode: "single",
        intent: "review",
        candidateRoleIds: ["unity_architect"],
        participantRoleIds: ["unity_architect"],
        requestedRoleIds: ["unity_architect"],
        primaryRoleId: "unity_architect",
        synthesisRoleId: "unity_architect",
        criticRoleId: undefined,
        maxParticipants: 1,
        maxRounds: 1,
        cappedParticipantCount: false,
        rolePrompts: {
          unity_architect: "아키텍처 경계를 점검해줘",
        },
        orchestrationSummary: "",
        useAdaptiveOrchestrator: false,
      },
      publishAction,
    });

    expect(publishAction).toHaveBeenCalledWith({
      type: "run_role",
      payload: {
        roleId: "system_programmer",
        taskId: "task_1",
        prompt: "아키텍처 경계를 점검해줘",
        sourceTab: "tasks-thread",
      },
    });
  });

  it("runs the runtime collaboration flow end-to-end with add-agent, spawn, and collaboration dispatch", async () => {
    const publishAction = vi.fn();
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "thread_add_agent") {
        const detail = buildThreadDetail();
        detail.agents = detail.agents.filter((agent) => agent.roleId !== "unity_architect");
        detail.agents.push({
          id: "thread_1:unity_architect",
          threadId: "thread_1",
          label: "UNITY ARCHITECT",
          roleId: "unity_architect",
          status: "idle",
          summary: "Review architecture",
          worktreePath: "/workspace/demo",
          lastUpdatedAt: "2026-03-20T00:00:00.000Z",
        });
        return detail;
      }
      if (command === "thread_spawn_agents") {
        expect(args).toMatchObject({
          cwd: "/workspace/demo",
          threadId: "thread_1",
          prompt: "시장성과 구조를 같이 검토해줘",
          roles: ["researcher", "unity_architect"],
          suppressApproval: true,
        });
        return buildThreadDetail();
      }
      throw new Error(`unexpected command: ${command}`);
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const detail = buildThreadDetail();
    detail.agents = detail.agents.filter((agent) => agent.roleId !== "unity_architect");
    const plan = deriveExecutionPlan({
      enabledRoleIds: ["researcher", "unity_architect"],
      requestedRoleIds: ["researcher", "unity_architect"],
      prompt: "시장성과 구조를 같이 검토해줘",
    });

    const result = await runRuntimeExecutionPlan({
      detail,
      prompt: "시장성과 구조를 같이 검토해줘",
      plan,
      cwd: "/workspace/demo",
      invokeFn,
      hydrateThreadDetail: (next) => next,
      publishAction,
    });

    expect(result.thread.threadId).toBe("thread_1");
    expect(invokeFn).toHaveBeenNthCalledWith(1, "thread_add_agent", expect.objectContaining({
      cwd: "/workspace/demo",
      threadId: "thread_1",
      roleId: "unity_architect",
      label: "UNITY ARCHITECT",
    }));
    expect(invokeFn).toHaveBeenNthCalledWith(2, "thread_spawn_agents", expect.any(Object));
    expect(publishAction).toHaveBeenCalledWith(expect.objectContaining({
      type: "run_task_collaboration",
      payload: expect.objectContaining({
        taskId: "task_1",
        sourceTab: "tasks-thread",
        roleIds: ["research_analyst", "system_programmer"],
        candidateRoleIds: expect.arrayContaining(["research_analyst", "system_programmer"]),
        requestedRoleIds: ["research_analyst", "system_programmer"],
        primaryRoleId: "research_analyst",
        synthesisRoleId: "research_analyst",
      }),
    }));
  });

  it("runs the runtime single-role flow without adding agents that already exist", async () => {
    const publishAction = vi.fn();
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "thread_spawn_agents") {
        expect(args).toMatchObject({
          roles: ["researcher"],
          suppressApproval: false,
        });
        return buildThreadDetail();
      }
      throw new Error(`unexpected command: ${command}`);
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await runRuntimeExecutionPlan({
      detail: buildThreadDetail(),
      prompt: "자료 조사해줘",
      plan: {
        mode: "single",
        intent: "research",
        candidateRoleIds: ["researcher"],
        participantRoleIds: ["researcher"],
        requestedRoleIds: ["researcher"],
        primaryRoleId: "researcher",
        synthesisRoleId: "researcher",
        criticRoleId: undefined,
        maxParticipants: 1,
        maxRounds: 1,
        cappedParticipantCount: false,
        rolePrompts: {
          researcher: "자료 조사해줘",
        },
        orchestrationSummary: "",
        useAdaptiveOrchestrator: false,
      },
      cwd: "/workspace/demo",
      invokeFn,
      hydrateThreadDetail: (next) => next,
      publishAction,
    });

    expect(invokeFn).toHaveBeenCalledTimes(1);
    expect(invokeFn).not.toHaveBeenCalledWith("thread_add_agent", expect.anything());
    expect(publishAction).toHaveBeenCalledWith({
      type: "run_role",
      payload: {
        roleId: "research_analyst",
        taskId: "task_1",
        prompt: "자료 조사해줘",
        sourceTab: "tasks-thread",
      },
    });
  });

  it("creates a browser approval when multiple roles run in sequence", () => {
    const detail = buildThreadDetail();
    runBrowserExecutionPlan({
      detail,
      prompt: "Review the implementation",
      plan: {
        mode: "single",
        intent: "review",
        candidateRoleIds: ["researcher", "unity_architect"],
        participantRoleIds: ["researcher", "unity_architect"],
        requestedRoleIds: ["researcher", "unity_architect"],
        primaryRoleId: "researcher",
        synthesisRoleId: "researcher",
        maxParticipants: 3,
        maxRounds: 1,
        cappedParticipantCount: false,
        rolePrompts: {},
        orchestrationSummary: "",
        useAdaptiveOrchestrator: false,
      },
      timestamp: "2026-03-20T00:01:00.000Z",
      createId: (prefix) => `${prefix}_1`,
    });
    expect(detail.approvals).toHaveLength(1);
    expect(detail.messages.some((entry) => entry.eventKind === "agent_batch_running")).toBe(true);
  });
});
