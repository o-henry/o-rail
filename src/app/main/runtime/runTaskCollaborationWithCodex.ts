import { getWebProviderFromExecutor } from "../../../features/workflow/domain";
import { findRuntimeModelOption } from "../../../features/workflow/runtimeModelOptions";
import {
  buildAdaptiveOrchestrationPrompt,
  parseAdaptiveOrchestrationPlan,
} from "./taskCollaborationOrchestrator";

type CollaborationRoleRunResult = {
  roleId: string;
  runId: string;
  summary: string;
  artifactPaths: string[];
};

type ExecuteRoleRun = (params: {
  roleId: string;
  prompt: string;
  promptMode: "orchestrate" | "brief" | "critique" | "final";
  intent?: string;
  internal: boolean;
  model?: string;
  reasoning?: string;
  outputArtifactName?: string;
  includeRoleKnowledge?: boolean;
}) => Promise<CollaborationRoleRunResult>;

type CollaborationProgress = {
  roleId?: string;
  stage: "codex" | "critic" | "save";
  message: string;
};

export type TaskCollaborationResult = {
  participantResults: CollaborationRoleRunResult[];
  criticResult?: CollaborationRoleRunResult;
  finalResult: CollaborationRoleRunResult;
};

const BRIEF_MAX_ATTEMPTS = 2;
const CRITIQUE_MAX_ATTEMPTS = 2;
const FINAL_MAX_ATTEMPTS = 2;
const ORCHESTRATOR_MAX_ATTEMPTS = 2;
const ORCHESTRATOR_MODEL = "GPT-5.4";
const ORCHESTRATOR_REASONING = "매우 높음";
const BRIEF_MODEL = "GPT-5.4-Mini";
const BRIEF_REASONING = "중간";
const CRITIQUE_MODEL = "GPT-5.4-Mini";
const CRITIQUE_REASONING = "중간";
const FINAL_MODEL = "GPT-5.4";
const FINAL_REASONING = "높음";

function shouldPreferThreadRuntimeModel(model?: string): boolean {
  const normalized = String(model ?? "").trim();
  if (!normalized) {
    return false;
  }
  return Boolean(getWebProviderFromExecutor(findRuntimeModelOption(normalized).executor));
}

function resolveStageRuntime(params: {
  preferredModel?: string;
  preferredReasoning?: string;
  fallbackModel: string;
  fallbackReasoning: string;
}): { model?: string; reasoning?: string } {
  if (shouldPreferThreadRuntimeModel(params.preferredModel)) {
    return {
      model: String(params.preferredModel ?? "").trim() || undefined,
      reasoning: String(params.preferredReasoning ?? "").trim() || undefined,
    };
  }
  return {
    model: params.fallbackModel,
    reasoning: params.fallbackReasoning,
  };
}

function clip(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function renderRoleSummary(result: CollaborationRoleRunResult): string {
  return `## ${result.roleId}\n${clip(result.summary, 900)}`;
}

function buildBriefPrompt(params: {
  prompt: string;
  intent?: string;
  participantPrompt: string;
  contextSummary: string;
  participantRoleIds: string[];
  cappedParticipantCount: boolean;
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  return [
    "# 작업 모드",
    "내부 멀티에이전트 1차 브리프",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 역할별 배정",
    params.participantPrompt.trim() || params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 협업 규칙",
    `- 참여 에이전트 수: ${params.participantRoleIds.length}${params.cappedParticipantCount ? " (상한 적용)" : ""}`,
    isIdeation
      ? "- 최종 사용자 답변 형식은 아니어도 되지만, 실제 아이디어 후보/시장 검증/탈락 사유처럼 최종 산출에 바로 쓸 수 있는 재료를 남긴다."
      : "- 최종 답변을 쓰지 말고, 자기 전문영역 기준 핵심 사실/리스크/권장 접근만 짧게 정리한다.",
    isIdeation
      ? "- 기준 정리, 다음 단계 제안, handoff 문구만 남기고 끝내지 않는다."
      : "- 다음 단계 제안만 남기고 끝내지 않는다.",
    "- 불필요한 서론 없이 6개 이하 bullet로 답한다.",
    "- 추정과 사실을 구분한다.",
  ].join("\n");
}

function buildCritiquePrompt(params: {
  prompt: string;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
}): string {
  return [
    "# 작업 모드",
    "내부 멀티에이전트 충돌/누락 검토",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 역할별 1차 브리프",
    params.roleSummaries.map(renderRoleSummary).join("\n\n"),
    "",
    "# 출력 규칙",
    "- 서로 충돌하는 주장, 빠진 확인 포인트, 구현/테스트 리스크만 6개 이하 bullet로 적는다.",
    "- 최종 답변 문체 금지.",
    "- 이미 같은 내용은 반복하지 않는다.",
  ].join("\n");
}

function buildFinalPrompt(params: {
  prompt: string;
  intent?: string;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
  criticSummary?: string;
  failedRoleIds?: string[];
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  return [
    "# 작업 모드",
    "최종 합성 답변",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 참여 에이전트 브리프",
    params.roleSummaries.map(renderRoleSummary).join("\n\n"),
    params.failedRoleIds?.length
      ? ["", "# 실패한 참여 에이전트", params.failedRoleIds.map((roleId) => `- ${roleId}`).join("\n")].join("\n")
      : "",
    params.criticSummary
      ? ["", "# 충돌/누락 검토", clip(params.criticSummary, 800)].join("\n")
      : "",
    "",
    "# 출력 규칙",
    "- 한국어로 최종 답변을 작성한다.",
    isIdeation
      ? "- 지금 바로 사용자에게 전달할 최종 아이디어 답변만 작성한다."
      : "- 필요한 경우 수정 후보 파일, 확인해야 할 리스크, 다음 행동을 짧게 정리한다.",
    isIdeation
      ? "- 내부 브리프, 기준 확정, handoff, 다음 단계 제안, 파일 수정 보고로 답변을 대체하지 않는다."
      : "- 역할별 원문을 나열하지 말고 하나의 응답으로 합친다.",
    isIdeation
      ? "- 사용자 요청에 숫자 요구가 있으면 그 수를 충족하도록 번호 목록으로 아이디어를 제시한다."
      : "",
    isIdeation
      ? "- 각 아이디어마다 한 줄 훅, 핵심 루프, 왜 지금 먹히는지, 왜 아류작 냄새가 약한지까지 포함한다."
      : "",
    "- 일부 참여 에이전트가 실패했다면 그 한계를 숨기지 말고 답변에 짧게 명시한다.",
  ].filter(Boolean).join("\n");
}

function normalizeErrorText(error: unknown): string {
  return String(error ?? "").trim().toLowerCase();
}

function isRetryableStageError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("did not complete") ||
    text.includes("not materialized yet") ||
    text.includes("includeturns is unavailable") ||
    text.includes("rpc error -32600") ||
    text.includes("timeout") ||
    text.includes("temporarily") ||
    text.includes("network") ||
    text.includes("rate limit") ||
    text.includes("busy") ||
    text.includes("econnreset") ||
    text.includes("socket hang up")
  );
}

async function executeRoleRunWithRetry(params: {
  executeRoleRun: ExecuteRoleRun;
  roleId: string;
  prompt: string;
  promptMode: "orchestrate" | "brief" | "critique" | "final";
  intent?: string;
  internal: boolean;
  model?: string;
  reasoning?: string;
  outputArtifactName?: string;
  includeRoleKnowledge?: boolean;
  maxAttempts: number;
  onRetryMessage?: (message: string) => void;
}): Promise<CollaborationRoleRunResult> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= params.maxAttempts; attempt += 1) {
    try {
      return await params.executeRoleRun({
        roleId: params.roleId,
        prompt: params.prompt,
        promptMode: params.promptMode,
        intent: params.intent,
        internal: params.internal,
        model: params.model,
        reasoning: params.reasoning,
        outputArtifactName: params.outputArtifactName,
        includeRoleKnowledge: params.includeRoleKnowledge,
      });
    } catch (error) {
      lastError = error;
      const canRetry = attempt < params.maxAttempts && isRetryableStageError(error);
      if (canRetry) {
        params.onRetryMessage?.(`${params.roleId} ${params.promptMode} 실패: ${String(error ?? "unknown error")} (재시도 ${attempt}/${params.maxAttempts - 1})`);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "unknown error"));
}

export async function runTaskCollaborationWithCodex(params: {
  prompt: string;
  contextSummary: string;
  participantRoleIds: string[];
  candidateRoleIds?: string[];
  requestedRoleIds?: string[];
  participantPrompts?: Record<string, string>;
  intent?: string;
  synthesisRoleId: string;
  criticRoleId?: string;
  cappedParticipantCount: boolean;
  useAdaptiveOrchestrator?: boolean;
  preferredModel?: string;
  preferredReasoning?: string;
  executeRoleRun: ExecuteRoleRun;
  onProgress?: (progress: CollaborationProgress) => void;
  onOrchestrationResolved?: (plan: {
    participantRoleIds: string[];
    primaryRoleId: string;
    criticRoleId?: string;
    orchestrationSummary: string;
  }) => void;
}): Promise<TaskCollaborationResult> {
  let participantRoleIds = [...params.participantRoleIds];
  let synthesisRoleId = params.synthesisRoleId;
  let criticRoleId = params.criticRoleId;
  let participantPrompts = { ...(params.participantPrompts ?? {}) };
  const participantResults: CollaborationRoleRunResult[] = [];
  const failedRoleIds: string[] = [];
  let resolvedOrchestrationSummary = "";

  if (params.useAdaptiveOrchestrator) {
    const allowedRoleIds = [...new Set((params.candidateRoleIds ?? participantRoleIds).map((roleId) => String(roleId ?? "").trim()).filter(Boolean))];
    if (allowedRoleIds.length > 0) {
      params.onProgress?.({
        roleId: synthesisRoleId,
        stage: "codex",
        message: `${synthesisRoleId} 메인 오케스트레이션`,
      });
      try {
        const orchestrationRuntime = resolveStageRuntime({
          preferredModel: params.preferredModel,
          preferredReasoning: params.preferredReasoning,
          fallbackModel: ORCHESTRATOR_MODEL,
          fallbackReasoning: ORCHESTRATOR_REASONING,
        });
        const orchestrationResult = await executeRoleRunWithRetry({
          executeRoleRun: params.executeRoleRun,
          roleId: synthesisRoleId,
          prompt: buildAdaptiveOrchestrationPrompt({
            prompt: params.prompt,
            intent: String(params.intent ?? "").trim() || "planning",
            contextSummary: params.contextSummary,
            requestedRoleIds: (params.requestedRoleIds ?? []).map((roleId) => String(roleId ?? "").trim()).filter(Boolean),
            candidateRoleIds: allowedRoleIds,
            candidateRolePrompts: participantPrompts,
            maxParticipants: Math.max(1, Math.min(3, allowedRoleIds.length || 1)),
            heuristicPrimaryRoleId: params.synthesisRoleId,
            heuristicParticipantRoleIds: participantRoleIds,
          }),
          promptMode: "orchestrate",
          intent: params.intent,
          internal: true,
          model: orchestrationRuntime.model,
          reasoning: orchestrationRuntime.reasoning,
          outputArtifactName: "orchestration_plan.json",
          includeRoleKnowledge: false,
          maxAttempts: ORCHESTRATOR_MAX_ATTEMPTS,
          onRetryMessage: (message) => params.onProgress?.({
            roleId: synthesisRoleId,
            stage: "codex",
            message,
          }),
        });
        const adaptivePlan = parseAdaptiveOrchestrationPlan({
          text: orchestrationResult.summary,
          allowedRoleIds,
          maxParticipants: Math.max(1, Math.min(3, allowedRoleIds.length || 1)),
          fallbackPrimaryRoleId: params.synthesisRoleId,
          fallbackCriticRoleId: params.criticRoleId,
          fallbackRolePrompts: participantPrompts,
        });
        if (adaptivePlan) {
          participantRoleIds = adaptivePlan.participantRoleIds;
          synthesisRoleId = adaptivePlan.primaryRoleId;
          criticRoleId = adaptivePlan.criticRoleId;
          participantPrompts = {
            ...participantPrompts,
            ...adaptivePlan.rolePrompts,
          };
          resolvedOrchestrationSummary = adaptivePlan.orchestrationSummary;
          params.onProgress?.({
            roleId: synthesisRoleId,
            stage: "codex",
            message: adaptivePlan.orchestrationSummary,
          });
        }
      } catch (error) {
        params.onProgress?.({
          roleId: synthesisRoleId,
          stage: "codex",
          message: `메인 오케스트레이션 실패, 규칙 기반 계획으로 계속 진행합니다: ${String(error ?? "unknown error")}`,
        });
      }
    }
  }

  params.onOrchestrationResolved?.({
    participantRoleIds: [...participantRoleIds],
    primaryRoleId: synthesisRoleId,
    criticRoleId,
    orchestrationSummary: resolvedOrchestrationSummary || `${participantRoleIds.join(", ")} assigned`,
  });

  for (const roleId of participantRoleIds) {
    const participantPrompt = String(participantPrompts[roleId] ?? params.prompt).trim();
    const briefRuntime = resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: BRIEF_MODEL,
      fallbackReasoning: BRIEF_REASONING,
    });
    params.onProgress?.({
      roleId,
      stage: "codex",
      message: `${roleId} 브리프 생성`,
    });
    let lastError: unknown = null;
    try {
      participantResults.push(await executeRoleRunWithRetry({
        executeRoleRun: params.executeRoleRun,
        roleId,
          prompt: buildBriefPrompt({
            prompt: params.prompt,
            intent: params.intent,
            participantPrompt,
            contextSummary: params.contextSummary,
            participantRoleIds,
            cappedParticipantCount: params.cappedParticipantCount,
          }),
        promptMode: "brief",
        intent: params.intent,
        internal: true,
        model: briefRuntime.model,
        reasoning: briefRuntime.reasoning,
        outputArtifactName: "discussion_brief.md",
        includeRoleKnowledge: false,
        maxAttempts: BRIEF_MAX_ATTEMPTS,
        onRetryMessage: (message) => params.onProgress?.({
          roleId,
          stage: "codex",
          message,
        }),
      }));
      lastError = null;
    } catch (error) {
      lastError = error;
      params.onProgress?.({
        roleId,
        stage: "codex",
        message: `${roleId} 브리프 실패: ${String(error ?? "unknown error")}`,
      });
    }
    if (lastError) {
      failedRoleIds.push(roleId);
      continue;
    }
  }

  let criticResult: CollaborationRoleRunResult | undefined;
  if (criticRoleId && criticRoleId !== synthesisRoleId && participantResults.length > 1) {
    const critiqueRuntime = resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: CRITIQUE_MODEL,
      fallbackReasoning: CRITIQUE_REASONING,
    });
    params.onProgress?.({
      roleId: criticRoleId,
      stage: "critic",
      message: `${criticRoleId} 충돌/누락 검토`,
    });
    try {
      criticResult = await executeRoleRunWithRetry({
        executeRoleRun: params.executeRoleRun,
        roleId: criticRoleId,
        prompt: buildCritiquePrompt({
          prompt: params.prompt,
          contextSummary: params.contextSummary,
          roleSummaries: participantResults,
        }),
        promptMode: "critique",
        intent: params.intent,
        internal: true,
        model: critiqueRuntime.model,
        reasoning: critiqueRuntime.reasoning,
        outputArtifactName: "discussion_critique.md",
        includeRoleKnowledge: false,
        maxAttempts: CRITIQUE_MAX_ATTEMPTS,
        onRetryMessage: (message) => params.onProgress?.({
          roleId: criticRoleId,
          stage: "critic",
          message,
        }),
      });
    } catch (error) {
      params.onProgress?.({
        roleId: criticRoleId,
        stage: "critic",
        message: `${criticRoleId} 검토 실패: ${String(error ?? "unknown error")}`,
      });
    }
  }

  params.onProgress?.({
    roleId: synthesisRoleId,
    stage: "save",
    message: `${synthesisRoleId} 최종 합성`,
  });
  const finalRuntime = resolveStageRuntime({
    preferredModel: params.preferredModel,
    preferredReasoning: params.preferredReasoning,
    fallbackModel: FINAL_MODEL,
    fallbackReasoning: FINAL_REASONING,
  });
  if (participantResults.length === 0) {
    throw new Error("모든 내부 브리프가 실패해 최종 합성을 진행할 수 없습니다.");
  }
  const finalResult = await executeRoleRunWithRetry({
    executeRoleRun: params.executeRoleRun,
    roleId: synthesisRoleId,
    prompt: buildFinalPrompt({
      prompt: params.prompt,
      intent: params.intent,
      contextSummary: params.contextSummary,
      roleSummaries: participantResults,
      criticSummary: criticResult?.summary,
      failedRoleIds,
    }),
    promptMode: "final",
    intent: params.intent,
    internal: false,
    model: finalRuntime.model,
    reasoning: finalRuntime.reasoning,
    outputArtifactName: "final_response.md",
    includeRoleKnowledge: true,
    maxAttempts: FINAL_MAX_ATTEMPTS,
    onRetryMessage: (message) => params.onProgress?.({
      roleId: synthesisRoleId,
      stage: "save",
      message,
    }),
  });
  if (!String(finalResult.summary ?? "").trim()) {
    throw new Error("최종 합성 답변이 비어 있어 성공 처리할 수 없습니다.");
  }

  return {
    participantResults,
    criticResult,
    finalResult,
  };
}
