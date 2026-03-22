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
      ...params.plan.candidateRoleIds.filter((roleId) => roleId !== params.plan.primaryRoleId).slice(0, 1),
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
}): TaskExecutionPlan {
  const basePlan = createTaskExecutionPlan({
    enabledRoleIds: params.enabledRoleIds,
    requestedRoleIds: params.requestedRoleIds,
    prompt: params.prompt,
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
    useAdaptiveOrchestrator: false,
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
  });
}

export function dispatchTaskExecutionPlan(params: {
  detail: ThreadDetail;
  prompt: string;
  plan: TaskExecutionPlan;
  publishAction: (action: AgenticAction) => void;
}) {
  if (params.plan.mode === "single") {
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
        sourceTab: "tasks-thread",
      },
    });
    return;
  }

  const rolePrompts = Object.fromEntries(
    params.plan.candidateRoleIds.flatMap((roleId) => {
      const studioRoleId = getTaskAgentStudioRoleId(roleId);
      const prompt = params.plan.rolePrompts[roleId];
      if (!studioRoleId || !prompt) {
        return [];
      }
      return [[studioRoleId, prompt] as const];
    }),
  );

  params.publishAction({
    type: "run_task_collaboration",
      payload: {
        taskId: params.detail.task.taskId,
        prompt: params.prompt,
        sourceTab: "tasks-thread",
        roleIds: params.plan.participantRoleIds.map((roleId) => getTaskAgentStudioRoleId(roleId)).filter(Boolean) as string[],
        candidateRoleIds: params.plan.candidateRoleIds.map((roleId) => getTaskAgentStudioRoleId(roleId)).filter(Boolean) as string[],
        requestedRoleIds: params.plan.requestedRoleIds.map((roleId) => getTaskAgentStudioRoleId(roleId)).filter(Boolean) as string[],
        rolePrompts,
        intent: params.plan.intent,
        primaryRoleId: String(getTaskAgentStudioRoleId(params.plan.primaryRoleId) ?? "").trim(),
        synthesisRoleId: String(getTaskAgentStudioRoleId(params.plan.synthesisRoleId) ?? "").trim(),
        criticRoleId: String(getTaskAgentStudioRoleId(params.plan.criticRoleId ?? "") ?? "").trim() || undefined,
        cappedParticipantCount: params.plan.cappedParticipantCount,
        useAdaptiveOrchestrator: params.plan.useAdaptiveOrchestrator,
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

export async function runRuntimeExecutionPlan(params: {
  detail: ThreadDetail;
  prompt: string;
  plan: TaskExecutionPlan;
  cwd: string;
  invokeFn: InvokeFn;
  hydrateThreadDetail: (detail: ThreadDetail | null) => ThreadDetail | null;
  publishAction: (action: AgenticAction) => void;
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
  });
  return spawned;
}
