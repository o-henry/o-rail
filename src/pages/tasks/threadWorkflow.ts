import {
  UNITY_THREAD_STAGE_DEFINITIONS,
  type TaskAgentPresetId,
  type ThreadStageDefinition,
} from "./taskAgentPresets";
import type { ApprovalRecord, BackgroundAgentRecord, ThreadDetail, ThreadWorkflow, ThreadWorkflowStage, ThreadWorkflowSummary } from "./threadTypes";
import { t as translate } from "../../i18n";

function hasArtifactContent(content: string | null | undefined): boolean {
  return String(content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .some((line) => !line.startsWith("#") && line !== "- pending");
}

function pendingApprovalCount(approvals: ApprovalRecord[]): number {
  return approvals.filter((approval) => approval.status === "pending").length;
}

function latestStageEventAt(detail: ThreadDetail, ownerPresetIds: TaskAgentPresetId[]): string | null {
  const relevant = detail.task.roles
    .filter((role) => ownerPresetIds.includes(role.id as TaskAgentPresetId))
    .filter((role) => role.lastPromptAt || role.lastRunId)
    .map((role) => role.lastPromptAt || role.updatedAt || "")
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left));
  return relevant[0] ?? null;
}

function hasAgentEvidence(agents: BackgroundAgentRecord[], ownerPresetIds: TaskAgentPresetId[]): boolean {
  return agents.some(
    (agent) =>
      ownerPresetIds.includes(agent.roleId as TaskAgentPresetId)
      && agent.status !== "idle"
      && agent.status !== "failed",
  );
}

function hasActiveAgentStatus(agents: BackgroundAgentRecord[], ownerPresetIds: TaskAgentPresetId[]): boolean {
  return agents.some(
    (agent) =>
      ownerPresetIds.includes(agent.roleId as TaskAgentPresetId)
      && (agent.status === "thinking" || agent.status === "awaiting_approval"),
  );
}

function stageEvidenceAt(detail: ThreadDetail, ownerPresetIds: TaskAgentPresetId[], hasEvidence: boolean): string | null {
  return latestStageEventAt(detail, ownerPresetIds) || (hasEvidence ? detail.thread.updatedAt : null);
}

function validationSatisfied(detail: ThreadDetail): boolean {
  const normalized = String(detail.validationState ?? "").trim().toLowerCase();
  return normalized === "validated" || normalized === "done" || normalized === "passed" || normalized === "ready";
}

function buildStageSummary(detail: ThreadDetail, stage: ThreadStageDefinition, readyChecks: number): string {
  if (stage.id === "brief") {
    return detail.thread.userPrompt || detail.task.goal || translate("tasks.summary.brief.empty");
  }
  if (stage.id === "design") {
    if (hasArtifactContent(detail.artifacts.findings)) {
      return translate("tasks.summary.design.ready");
    }
    return translate("tasks.summary.design.empty");
  }
  if (stage.id === "implement") {
    if (detail.changedFiles.length > 0) {
      return translate("tasks.summary.implement.changed", { count: detail.changedFiles.length });
    }
    if (hasArtifactContent(detail.artifacts.patch)) {
      return translate("tasks.summary.implement.ready");
    }
    return translate("tasks.summary.implement.empty");
  }
  if (stage.id === "integrate") {
    const approvals = pendingApprovalCount(detail.approvals);
    return approvals > 0
      ? translate("tasks.summary.integrate.blocked", { count: approvals })
      : translate("tasks.summary.integrate.ready");
  }
  if (stage.id === "playtest") {
    return translate("tasks.summary.playtest", { state: String(detail.validationState || translate("tasks.workflow.pending")).trim() });
  }
  return translate("tasks.summary.lock", { count: readyChecks });
}

function buildStage(
  detail: ThreadDetail,
  stage: ThreadStageDefinition,
  status: ThreadWorkflowStage["status"],
  blockerCount: number,
  readyChecks: number,
  hasEvidence: boolean,
): ThreadWorkflowStage {
  return {
    id: stage.id,
    label: stage.label,
    status,
    ownerPresetIds: stage.ownerPresetIds,
    summary: buildStageSummary(detail, stage, readyChecks),
    artifactKeys:
      stage.id === "brief"
        ? ["brief"]
        : stage.id === "design"
          ? ["findings", "plan"]
          : stage.id === "implement"
            ? ["patch"]
            : stage.id === "integrate"
              ? ["handoff"]
          : stage.id === "playtest"
                ? ["validation"]
                : ["handoff", "validation"],
    blockerCount,
    startedAt: stageEvidenceAt(detail, stage.ownerPresetIds, hasEvidence),
    completedAt: status === "done" || status === "ready" ? detail.thread.updatedAt : null,
  };
}

export function deriveThreadWorkflow(detail: ThreadDetail): ThreadWorkflow {
  const approvalsPending = pendingApprovalCount(detail.approvals);
  const designEvidence =
    hasArtifactContent(detail.artifacts.findings)
    || hasArtifactContent(detail.artifacts.plan)
    || hasAgentEvidence(detail.agents, ["game_designer", "level_designer", "unity_architect"]);
  const implementEvidence =
    detail.changedFiles.length > 0
    || hasArtifactContent(detail.artifacts.patch)
    || hasAgentEvidence(detail.agents, ["unity_implementer", "unity_editor_tools"]);
  const integrateEvidence =
    detail.approvals.length > 0
    || hasArtifactContent(detail.artifacts.handoff)
    || hasAgentEvidence(detail.agents, ["unity_architect", "technical_artist", "release_steward"]);
  const playtestEvidence =
    validationSatisfied(detail)
    || hasArtifactContent(detail.artifacts.validation)
    || hasAgentEvidence(detail.agents, ["qa_playtester"]);
  const handoffReady = hasArtifactContent(detail.artifacts.handoff);
  const designActive = hasActiveAgentStatus(detail.agents, ["game_designer", "level_designer", "unity_architect"]);
  const implementActive = hasActiveAgentStatus(detail.agents, ["unity_implementer", "unity_editor_tools"]);
  const integrateActive = hasActiveAgentStatus(detail.agents, ["unity_architect", "technical_artist", "release_steward"]);
  const playtestActive = hasActiveAgentStatus(detail.agents, ["qa_playtester"]);

  const briefDone = !["", "new thread", "새 thread", "새 스레드"].includes(String(detail.thread.userPrompt ?? "").trim().toLowerCase())
    || !["", "new thread", "새 thread", "새 스레드"].includes(String(detail.task.goal ?? "").trim().toLowerCase());
  const designDone = designEvidence;
  const implementDone = implementEvidence;
  const integrateBlocked = approvalsPending > 0;
  const integrateDone = integrateEvidence && !integrateBlocked;
  const playtestDone = playtestEvidence;
  const readyChecks = [implementDone, playtestDone, handoffReady].filter(Boolean).length;
  const lockReady = readyChecks === 3 && !integrateBlocked;

  const latestEvidenceStageId = [...UNITY_THREAD_STAGE_DEFINITIONS]
    .map((stage, index) => ({
      id: stage.id,
      index,
      evidenceAt:
        stage.id === "brief"
          ? (briefDone ? detail.thread.updatedAt : null)
          : stage.id === "design"
            ? stageEvidenceAt(detail, stage.ownerPresetIds, designEvidence)
            : stage.id === "implement"
              ? stageEvidenceAt(detail, stage.ownerPresetIds, implementEvidence)
              : stage.id === "integrate"
                ? stageEvidenceAt(detail, stage.ownerPresetIds, integrateEvidence)
                : stage.id === "playtest"
                  ? stageEvidenceAt(detail, stage.ownerPresetIds, playtestEvidence)
                  : lockReady
                    ? detail.thread.updatedAt
                    : null,
    }))
    .filter((stage) => Boolean(stage.evidenceAt))
    .sort((left, right) => {
      const timestampDelta = String(right.evidenceAt).localeCompare(String(left.evidenceAt));
      return timestampDelta || right.index - left.index;
    })[0]?.id ?? null;

  const activeStageId =
    (!briefDone ? "brief" : null)
    || (designActive ? "design" : null)
    || (implementActive ? "implement" : null)
    || (integrateActive ? "integrate" : null)
    || (playtestActive ? "playtest" : null);

  const currentStageId: ThreadWorkflowStage["id"] = integrateBlocked
    ? "integrate"
    : (activeStageId as ThreadWorkflowStage["id"] | null)
      ?? (lockReady ? "lock" : null)
      ?? (latestEvidenceStageId as ThreadWorkflowStage["id"] | null)
      ?? "brief";

  const stages = UNITY_THREAD_STAGE_DEFINITIONS.map((stage) => {
    if (stage.id === "brief") {
      return buildStage(detail, stage, currentStageId === "brief" && !briefDone ? "active" : briefDone ? "done" : "idle", 0, readyChecks, briefDone);
    }
    if (stage.id === "design") {
      return buildStage(detail, stage, designActive ? "active" : designDone ? "done" : "idle", 0, readyChecks, designEvidence);
    }
    if (stage.id === "implement") {
      return buildStage(detail, stage, implementActive ? "active" : implementDone ? "done" : "idle", 0, readyChecks, implementEvidence);
    }
    if (stage.id === "integrate") {
      return buildStage(
        detail,
        stage,
        integrateBlocked ? "blocked" : integrateActive ? "active" : integrateDone ? "done" : "idle",
        approvalsPending,
        readyChecks,
        integrateEvidence,
      );
    }
    if (stage.id === "playtest") {
      return buildStage(detail, stage, playtestActive ? "active" : playtestDone ? "done" : "idle", 0, readyChecks, playtestEvidence);
    }
    return buildStage(detail, stage, lockReady ? "ready" : "idle", 0, readyChecks, lockReady);
  });

  return {
    currentStageId,
    stages,
    nextAction:
      currentStageId === "brief"
        ? translate("tasks.nextAction.brief")
        : currentStageId === "design"
          ? translate("tasks.nextAction.design")
          : currentStageId === "implement"
            ? translate("tasks.nextAction.implement")
            : currentStageId === "integrate"
              ? approvalsPending > 0
                ? translate("tasks.nextAction.integrate.blocked")
                : translate("tasks.nextAction.integrate")
              : currentStageId === "playtest"
                ? translate("tasks.nextAction.playtest")
                : lockReady
                  ? translate("tasks.nextAction.lock.ready")
                  : translate("tasks.nextAction.lock"),
    readinessSummary: translate(lockReady ? "tasks.readiness.ready" : "tasks.readiness.preparing", { count: readyChecks }),
  };
}

export function deriveThreadWorkflowSummary(detail: ThreadDetail): ThreadWorkflowSummary {
  const workflow = detail.workflow ?? deriveThreadWorkflow(detail);
  const currentStage = workflow.stages.find((stage) => stage.id === workflow.currentStageId) ?? workflow.stages[0];
  return {
    currentStageId: workflow.currentStageId,
    status: currentStage?.status ?? "idle",
    blocked: workflow.stages.some((stage) => stage.status === "blocked"),
    failed: currentStage?.status === "failed",
    degraded: false,
    pendingApprovalCount: pendingApprovalCount(detail.approvals),
  };
}
