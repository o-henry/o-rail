import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import type { AgenticCoordinationState, CoordinationMode } from "../../features/orchestration/agentic/coordinationTypes";
import {
  getTaskAgentDiscussionLine,
  getTaskAgentLabel,
  getTaskAgentStudioRoleId,
  getTaskAgentSummary,
} from "./taskAgentPresets";
import { createTaskExecutionPlan, type TaskExecutionPlan } from "./taskExecutionPolicy";
import { buildBrowserFiles, createBrowserMessage, rolePrompt } from "./taskThreadBrowserState";
import type { ThreadDetail, ThreadRoleId } from "./threadTypes";
import { deriveThreadWorkflow } from "./threadWorkflow";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function cloneThreadDetail(detail: ThreadDetail): ThreadDetail {
  return {
    ...detail,
    thread: { ...detail.thread },
    task: {
      ...detail.task,
      roles: detail.task.roles.map((role) => ({ ...role })),
      prompts: detail.task.prompts.map((prompt) => ({ ...prompt })),
    },
    messages: detail.messages.map((message) => ({ ...message })),
    agents: detail.agents.map((agent) => ({ ...agent })),
    approvals: detail.approvals.map((approval) => ({
      ...approval,
      payload: approval.payload && typeof approval.payload === "object"
        ? { ...approval.payload }
        : approval.payload,
    })),
    agentDetail: detail.agentDetail,
    artifacts: { ...detail.artifacts },
    changedFiles: [...detail.changedFiles],
    files: detail.files.map((file) => ({ ...file })),
    workflow: {
      ...detail.workflow,
      stages: detail.workflow.stages.map((stage) => ({ ...stage })),
    },
    orchestration: detail.orchestration ? { ...detail.orchestration } : null,
  };
}

function preferOrchestratorFirstPlan(params: {
  plan: TaskExecutionPlan;
  requestedRoleIds: string[];
  selectedMode?: CoordinationMode | null;
}): TaskExecutionPlan {
  if (params.selectedMode === "quick") {
    return params.plan;
  }
  if (params.requestedRoleIds.length > 0) {
    return params.plan;
  }
  const participantRoleIds = params.plan.participantRoleIds.length > 1
    ? params.plan.participantRoleIds
    : [
      params.plan.primaryRoleId,
      ...params.plan.candidateRoleIds
        .filter((roleId) => roleId !== params.plan.primaryRoleId)
        .slice(0, params.plan.creativeMode ? 2 : 1),
    ];
  if (participantRoleIds.length <= 1) {
    return params.plan;
  }
  return {
    ...params.plan,
    mode: "discussion",
    participantRoleIds,
    criticRoleId: params.plan.criticRoleId && participantRoleIds.includes(params.plan.criticRoleId)
      ? params.plan.criticRoleId
      : participantRoleIds.find((roleId) => roleId !== params.plan.primaryRoleId),
    maxRounds: 2,
    useAdaptiveOrchestrator: true,
  };
}

export function deriveExecutionPlan(params: {
  enabledRoleIds: string[];
  requestedRoleIds: string[];
  prompt: string;
  selectedMode?: CoordinationMode | null;
  creativeMode?: boolean;
}): TaskExecutionPlan {
  const basePlan = createTaskExecutionPlan({
    enabledRoleIds: params.enabledRoleIds,
    requestedRoleIds: params.requestedRoleIds,
    prompt: params.prompt,
    creativeMode: params.creativeMode,
  });
  if (params.selectedMode !== "quick") {
    return preferOrchestratorFirstPlan({
      plan: basePlan,
      requestedRoleIds: params.requestedRoleIds,
      selectedMode: params.selectedMode,
    });
  }
  return {
    ...basePlan,
    mode: "single",
    participantRoleIds: [basePlan.primaryRoleId],
    useAdaptiveOrchestrator: true,
  };
}

export function buildExecutionPlanFromCoordination(detail: ThreadDetail, coordination: AgenticCoordinationState): TaskExecutionPlan {
  const requestedRoleIds = coordination.mode === "quick"
    ? coordination.requestedRoleIds.slice(0, 1)
    : coordination.requestedRoleIds;
  return deriveExecutionPlan({
    enabledRoleIds: detail.agents.map((agent) => agent.roleId),
    requestedRoleIds,
    prompt: coordination.prompt,
    selectedMode: coordination.mode,
    creativeMode: false,
  });
}

export function dispatchTaskExecutionPlan(params: {
  detail: ThreadDetail;
  prompt: string;
  plan: TaskExecutionPlan;
  publishAction: (action: AgenticAction) => void;
  preferredModels?: string[];
}) {
  if (params.plan.mode === "single" && !params.plan.useAdaptiveOrchestrator) {
    const roleId = params.plan.participantRoleIds[0];
    const studioRoleId = getTaskAgentStudioRoleId(roleId);
    if (!studioRoleId) {
      return;
    }
    params.publishAction({
      type: "run_role",
      payload: {
        roleId: studioRoleId,
        taskId: params.detail.task.taskId,
        prompt: params.plan.rolePrompts[roleId] ?? rolePrompt(params.detail, roleId, params.prompt),
        creativeMode: params.plan.creativeMode,
        sourceTab: "tasks-thread",
        preferredModels: params.preferredModels,
      },
    });
    return;
  }

  const rolePrompts = Object.fromEntries(
    params.plan.candidateRoleIds.flatMap((roleId) => {
      const prompt = params.plan.rolePrompts[roleId];
      if (!prompt) {
        return [];
      }
      return [[roleId, prompt] as const];
    }),
  );

  params.publishAction({
    type: "run_task_collaboration",
      payload: {
        taskId: params.detail.task.taskId,
        prompt: params.prompt,
        sourceTab: "tasks-thread",
        roleIds: [...params.plan.participantRoleIds],
        candidateRoleIds: [...params.plan.candidateRoleIds],
        requestedRoleIds: [...params.plan.requestedRoleIds],
        rolePrompts,
        intent: params.plan.intent,
        creativeMode: params.plan.creativeMode,
        primaryRoleId: params.plan.primaryRoleId,
        synthesisRoleId: params.plan.synthesisRoleId,
        criticRoleId: params.plan.criticRoleId || undefined,
        cappedParticipantCount: params.plan.cappedParticipantCount,
        useAdaptiveOrchestrator: params.plan.useAdaptiveOrchestrator,
        preferredModels: params.preferredModels,
      },
    });
}

export function runBrowserExecutionPlan(params: {
  detail: ThreadDetail;
  prompt: string;
  plan: TaskExecutionPlan;
  timestamp: string;
  createId: (prefix: string) => string;
}): ThreadDetail {
  const { detail, plan, prompt, timestamp } = params;
  const rolesToRun = plan.participantRoleIds;
  for (const roleId of rolesToRun) {
    if (!detail.agents.some((agent) => agent.roleId === roleId)) {
      detail.agents.push({
        id: `${detail.thread.threadId}:${roleId}`,
        threadId: detail.thread.threadId,
        label: getTaskAgentLabel(roleId),
        roleId,
        status: "idle",
        summary: getTaskAgentSummary(roleId),
        worktreePath: detail.task.worktreePath || detail.task.workspacePath,
        lastUpdatedAt: timestamp,
      });
      detail.messages.push(
        createBrowserMessage(
          detail.thread.threadId,
          "assistant",
          `${getTaskAgentLabel(roleId)} agent is ready. ${getTaskAgentSummary(roleId)}`,
          timestamp,
          {
            agentId: `${detail.thread.threadId}:${roleId}`,
            agentLabel: getTaskAgentLabel(roleId),
            sourceRoleId: roleId,
            eventKind: "agent_created",
          },
        ),
      );
    }
  }
  detail.agents = detail.agents.map((agent) => {
    const activeIndex = rolesToRun.indexOf(agent.roleId);
    if (!rolesToRun.includes(agent.roleId)) {
      return { ...agent, status: "idle", lastUpdatedAt: timestamp };
    }
    return {
      ...agent,
      status: plan.mode === "discussion" || activeIndex === 0 ? "thinking" : "awaiting_approval",
      summary: getTaskAgentSummary(agent.roleId),
      lastUpdatedAt: timestamp,
    };
  });
  for (const roleId of rolesToRun) {
    detail.messages.push(
      createBrowserMessage(detail.thread.threadId, "assistant", getTaskAgentDiscussionLine(roleId), timestamp, {
        agentId: `${detail.thread.threadId}:${roleId}`,
        agentLabel: getTaskAgentLabel(roleId),
        sourceRoleId: roleId,
        eventKind: "agent_status",
      }),
    );
  }
  if (rolesToRun.length > 1 && plan.mode !== "discussion") {
    const sourceRole = rolesToRun[0];
    const targetRole = rolesToRun[1] as ThreadRoleId;
    detail.approvals = [
      {
        id: params.createId("approval"),
        threadId: detail.thread.threadId,
        agentId: `${detail.thread.threadId}:${sourceRole}`,
        kind: "handoff",
        summary: `Approve handoff from ${getTaskAgentLabel(sourceRole)} to ${getTaskAgentLabel(targetRole)}.`,
        payload: {
          targetRole,
          prompt: `Continue the thread based on ${getTaskAgentLabel(sourceRole)} findings: ${prompt}`,
        },
        status: "pending",
        createdAt: timestamp,
        updatedAt: null,
      },
    ];
  }
  detail.messages.push(
    createBrowserMessage(
      detail.thread.threadId,
      "assistant",
      plan.mode === "discussion"
        ? `${rolesToRun.length} background agents are running a bounded discussion now. I will synthesize the answer after they exchange short briefs.`
        : `${rolesToRun.length} background agent is running now. I will synthesize the answer after its update arrives.`,
      timestamp,
      { eventKind: "agent_batch_running" },
    ),
  );
  detail.changedFiles = ["src/pages/tasks/TasksPage.tsx", "src/pages/tasks/useTasksThreadState.ts"];
  detail.files = buildBrowserFiles();
  detail.validationState = rolesToRun.includes("qa_playtester") ? "in review" : "pending";
  detail.riskLevel = rolesToRun.includes("unity_architect") ? "reviewing" : "medium";
  detail.artifacts = {
    ...detail.artifacts,
    brief: prompt,
    findings: rolesToRun.map((roleId) => `${getTaskAgentLabel(roleId)}: ${getTaskAgentSummary(roleId)}`).join("\n"),
    plan: `${plan.orchestrationSummary}\n\n${plan.mode === "discussion"
      ? `1. Run ${rolesToRun.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} brief\n2. Exchange a bounded critique\n3. Synthesize one answer`
      : `1. Run ${rolesToRun.map((roleId) => getTaskAgentLabel(roleId)).join(", ")}\n2. Review files\n3. Synthesize answer`}`,
  };
  detail.workflow = deriveThreadWorkflow(detail);
  return detail;
}

export function completeBrowserExecutionPlan(params: {
  detail: ThreadDetail;
  plan: TaskExecutionPlan;
  timestamp: string;
  finalSummary: string;
  artifactPath?: string | null;
}) {
  const synthesisRoleId = params.plan.synthesisRoleId || params.plan.primaryRoleId;
  params.detail.thread.status = "completed";
  params.detail.thread.updatedAt = params.timestamp;
  params.detail.task.status = "completed";
  params.detail.task.updatedAt = params.timestamp;
  params.detail.agents = params.detail.agents.map((agent) => (
    params.plan.participantRoleIds.includes(agent.roleId)
      ? { ...agent, status: "done", lastUpdatedAt: params.timestamp }
      : agent
  ));
  params.detail.messages.push(
    createBrowserMessage(
      params.detail.thread.threadId,
      "assistant",
      params.finalSummary,
      params.timestamp,
      {
        agentId: `${params.detail.thread.threadId}:${synthesisRoleId}`,
        agentLabel: getTaskAgentLabel(synthesisRoleId),
        sourceRoleId: synthesisRoleId,
        eventKind: "agent_result",
        artifactPath: String(params.artifactPath ?? "").trim() || undefined,
      },
    ),
  );
  if (params.artifactPath) {
    params.detail.artifacts = {
      ...params.detail.artifacts,
      final: params.artifactPath,
    };
  }
  params.detail.workflow = deriveThreadWorkflow(params.detail);
  return params.detail;
}

export function buildOptimisticRuntimeExecutionDetail(params: {
  detail: ThreadDetail;
  prompt: string;
  plan: TaskExecutionPlan;
  timestamp: string;
  createId: (prefix: string) => string;
}): ThreadDetail {
  const optimistic = cloneThreadDetail(params.detail);
  optimistic.thread.status = "running";
  optimistic.thread.updatedAt = params.timestamp;
  optimistic.task.updatedAt = params.timestamp;
  optimistic.task.status = "active";
  return runBrowserExecutionPlan({
    detail: optimistic,
    prompt: params.prompt,
    plan: params.plan,
    timestamp: params.timestamp,
    createId: params.createId,
  });
}

export async function runRuntimeExecutionPlan(params: {
  detail: ThreadDetail;
  prompt: string;
  plan: TaskExecutionPlan;
  cwd: string;
  invokeFn: InvokeFn;
  hydrateThreadDetail: (detail: ThreadDetail | null) => ThreadDetail | null;
  publishAction: (action: AgenticAction) => void;
  preferredModels?: string[];
}): Promise<ThreadDetail> {
  let nextDetail = params.detail;
  for (const roleId of params.plan.participantRoleIds) {
    if (!nextDetail.agents.some((agent) => agent.roleId === roleId)) {
      nextDetail = params.hydrateThreadDetail(await params.invokeFn<ThreadDetail>("thread_add_agent", {
        cwd: params.cwd,
        threadId: nextDetail.thread.threadId,
        roleId,
        label: getTaskAgentLabel(roleId),
      })) ?? nextDetail;
    }
  }
  const spawned = params.hydrateThreadDetail(await params.invokeFn<ThreadDetail>("thread_spawn_agents", {
    cwd: params.cwd,
    threadId: nextDetail.thread.threadId,
    prompt: params.prompt,
    roles: params.plan.participantRoleIds,
    suppressApproval: params.plan.mode === "discussion",
  })) ?? nextDetail;
  dispatchTaskExecutionPlan({
    detail: spawned,
    prompt: params.prompt,
    plan: params.plan,
    publishAction: params.publishAction,
    preferredModels: params.preferredModels,
  });
  return spawned;
}
