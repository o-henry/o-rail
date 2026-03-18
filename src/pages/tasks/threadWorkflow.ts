import {
  UNITY_THREAD_STAGE_DEFINITIONS,
  type TaskAgentPresetId,
  type ThreadStageDefinition,
} from "./taskAgentPresets";
import type { ApprovalRecord, BackgroundAgentRecord, ThreadDetail, ThreadWorkflow, ThreadWorkflowStage, ThreadWorkflowSummary } from "./threadTypes";

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
    return detail.thread.userPrompt || detail.task.goal || "유니티 작업 범위와 대상 시스템을 먼저 정리하세요.";
  }
  if (stage.id === "design") {
    if (hasArtifactContent(detail.artifacts.findings)) {
      return "설계 메모와 조사 결과가 정리되었습니다.";
    }
    return "시스템 흐름, 씬 의도, 열려 있는 설계 질문을 정리하세요.";
  }
  if (stage.id === "implement") {
    if (detail.changedFiles.length > 0) {
      return `검토할 변경 파일 ${detail.changedFiles.length}개가 준비되었습니다.`;
    }
    if (hasArtifactContent(detail.artifacts.patch)) {
      return "구현 산출물이 정리되어 있습니다.";
    }
    return "아직 구현 산출물이 없습니다.";
  }
  if (stage.id === "integrate") {
    const approvals = pendingApprovalCount(detail.approvals);
    return approvals > 0
      ? `승인 ${approvals}건 때문에 통합이 막혀 있습니다.`
      : "통합, 인계, 릴리즈 확인이 현재까지는 문제 없습니다.";
  }
  if (stage.id === "playtest") {
    return `검증 상태: ${String(detail.validationState || "pending").trim()}.`;
  }
  return `마감 준비 항목 ${readyChecks}/3개가 충족되었습니다.`;
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
        ? "유니티 기능 목표, 대상 씬, 제약 조건을 먼저 분명히 하세요."
        : currentStageId === "design"
          ? "설계 메모, 시스템 경계, 열려 있는 질문을 정리하세요."
          : currentStageId === "implement"
            ? "코드, 데이터, 프리팹, 에디터 변경을 만들어 검토 가능한 상태로 올리세요."
            : currentStageId === "integrate"
              ? approvalsPending > 0
                ? "대기 중인 승인을 처리해서 통합을 다시 진행하세요."
                : "에셋, 시스템, 인계 메모를 한 흐름으로 묶으세요."
              : currentStageId === "playtest"
                ? "마감 전에 검증과 플레이테스트를 진행하세요."
                : lockReady
                  ? "이 작업은 인계하거나 머지할 준비가 되었습니다."
                  : "마감 단계에 들어가려면 검증과 인계 메모를 마무리하세요.",
    readinessSummary: `마감 ${lockReady ? "준비 완료" : "준비 중"} · ${readyChecks}/3`,
  };
}

export function deriveThreadWorkflowSummary(detail: ThreadDetail): ThreadWorkflowSummary {
  const workflow = detail.workflow ?? deriveThreadWorkflow(detail);
  const currentStage = workflow.stages.find((stage) => stage.id === workflow.currentStageId) ?? workflow.stages[0];
  return {
    currentStageId: workflow.currentStageId,
    status: currentStage?.status ?? "idle",
    blocked: workflow.stages.some((stage) => stage.status === "blocked"),
    pendingApprovalCount: pendingApprovalCount(detail.approvals),
  };
}
