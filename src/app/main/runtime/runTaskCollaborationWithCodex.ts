import { getWebProviderFromExecutor } from "../../../features/workflow/domain";
import { findRuntimeModelOption } from "../../../features/workflow/runtimeModelOptions";
import {
  buildAdaptiveOrchestrationPrompt,
  parseAdaptiveOrchestrationPlan,
} from "./taskCollaborationOrchestrator";
import {
  buildTaskCollaborationContract,
  renderTaskCollaborationContract,
} from "./taskCollaborationContracts";
import {
  buildJudgePrompt,
  buildVerifierPrompt,
  buildVerifierRepairPrompt,
  parseJudgeVerdict,
  parseVerifierVerdict,
  renderJudgeVerdict,
  renderVerifierVerdict,
  resolveTaskCollaborationRiskProfile,
  type TaskCollaborationJudgeVerdict,
  type TaskCollaborationVerifierVerdict,
} from "./taskCollaborationEvaluation";
import { buildStructuredExternalWebPerspective } from "./externalWebPerspective";

type CollaborationRoleRunResult = {
  roleId: string;
  runId: string;
  summary: string;
  artifactPaths: string[];
};

type ExecuteRoleRun = (params: {
  roleId: string;
  prompt: string;
  promptMode: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
  intent?: string;
  internal: boolean;
  model?: string;
  models?: string[];
  reasoning?: string;
  outputArtifactName?: string;
  includeRoleKnowledge?: boolean;
}) => Promise<CollaborationRoleRunResult>;

type CollaborationProgress = {
  roleId?: string;
  stage: "codex" | "critic" | "save";
  message: string;
};

type ParticipantPromptMode = "direct" | "brief";

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
const JUDGE_MODEL = "GPT-5.4-Mini";
const JUDGE_REASONING = "높음";
const VERIFY_MODEL = "GPT-5.4-Mini";
const VERIFY_REASONING = "높음";
const FINAL_MODEL = "GPT-5.4";
const FINAL_REASONING = "높음";
const JUDGE_MAX_ATTEMPTS = 2;
const VERIFY_MAX_ATTEMPTS = 2;

function shouldPreferThreadRuntimeModel(model?: string): boolean {
  const normalized = String(model ?? "").trim();
  if (!normalized) {
    return false;
  }
  return Boolean(getWebProviderFromExecutor(findRuntimeModelOption(normalized).executor));
}

function hasPreferredWebRuntime(params: {
  preferredModel?: string;
  preferredModels?: string[];
}): boolean {
  const preferredModels = [...new Set((params.preferredModels ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  return (
    preferredModels.some((value) => shouldPreferThreadRuntimeModel(value))
    || shouldPreferThreadRuntimeModel(params.preferredModel)
  );
}

function resolveStageRuntime(params: {
  preferredModel?: string;
  preferredModels?: string[];
  preferredReasoning?: string;
  fallbackModel: string;
  fallbackReasoning: string;
  allowExternalWeb?: boolean;
}): { model?: string; models?: string[]; reasoning?: string } {
  if (!params.allowExternalWeb) {
    return {
      model: params.fallbackModel,
      reasoning: params.fallbackReasoning,
    };
  }
  const preferredModels = [...new Set((params.preferredModels ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (preferredModels.length > 0 && preferredModels.every((value) => shouldPreferThreadRuntimeModel(value))) {
    return {
      model: preferredModels[0],
      models: preferredModels,
      reasoning: String(params.preferredReasoning ?? "").trim() || undefined,
    };
  }
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

function resolveSharedWebRuntime(params: {
  collectExternalWebResearch: boolean;
  preferredModel?: string;
  preferredModels?: string[];
  preferredReasoning?: string;
}): { model?: string; models?: string[]; reasoning?: string } | null {
  if (!params.collectExternalWebResearch) {
    return null;
  }
  if (hasPreferredWebRuntime({
    preferredModel: params.preferredModel,
    preferredModels: params.preferredModels,
  })) {
    return resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredModels: params.preferredModels,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: BRIEF_MODEL,
      fallbackReasoning: BRIEF_REASONING,
      allowExternalWeb: true,
    });
  }
  return {
    model: "GPT-Web",
    reasoning: String(params.preferredReasoning ?? "").trim() || "중간",
  };
}

function buildSharedWebPerspectivePrompt(params: {
  prompt: string;
  intent?: string;
  contextSummary: string;
  creativeMode?: boolean;
  researchFocus?: string;
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  return [
    "# 작업 모드",
    "외부 웹 AI 관점 수집",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    params.researchFocus?.trim() ? "# 외부 조사 포커스" : "",
    params.researchFocus?.trim() || "",
    params.researchFocus?.trim() ? "" : "",
    "# 출력 규칙",
    "- 최종 사용자 답변을 그대로 작성하지 않는다.",
    "- 아래 요청에 대해 외부 AI 관점에서 참고할 만한 핵심 포인트만 정리한다.",
    "- 가능하면 claims / ideas / risks / disagreements / novelty_signals 관점으로 나눠 bullet로 적는다.",
    isIdeation
      ? "- 특히 상투적인 아이디어 패턴, 차별화 포인트, 리텐션 훅, 실패 가능성, 과장된 후보를 어떻게 걸러야 하는지에 집중한다."
      : "- 특히 놓치기 쉬운 리스크, 구현 함정, 검증 포인트, 대안 접근을 짚는다.",
    params.creativeMode && isIdeation
      ? "- Creative Mode가 켜져 있다. 평균적 답변 패턴과 상투적 장르 조합을 경계한다."
      : "- 안전한 평균론만 반복하지 않는다.",
    "- 내부 역할 배정, handoff, 다음 단계 제안으로 답변을 대체하지 않는다.",
  ].filter(Boolean).join("\n");
}

function clip(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function extractSectionBetweenMarkers(params: {
  input: string;
  startMarker: string;
  endMarkers?: string[];
}): string {
  const source = String(params.input ?? "").trim();
  if (!source) {
    return "";
  }
  const startIndex = source.indexOf(params.startMarker);
  if (startIndex < 0) {
    return "";
  }
  const start = startIndex + params.startMarker.length;
  const tail = source.slice(start);
  const endIndex = (params.endMarkers ?? [])
    .map((marker) => tail.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return (endIndex == null ? tail : tail.slice(0, endIndex)).trim();
}

function extractRoleSpecificGoals(participantPrompt: string): string[] {
  return extractSectionBetweenMarkers({
    input: participantPrompt,
    startMarker: "# ROLE-SPECIFIC GOALS",
    endMarkers: ["# USER REQUEST"],
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function extractAssignedRoleLabel(participantPrompt: string): string {
  const section = extractSectionBetweenMarkers({
    input: participantPrompt,
    startMarker: "# ORCHESTRATION",
    endMarkers: ["# ROLE-SPECIFIC GOALS"],
  });
  const roleLine = section
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("당신의 역할:"));
  return clip(roleLine?.slice("당신의 역할:".length).trim() || "", 120);
}

function buildCompactContextSummary(params: {
  contextSummary: string;
  intent?: string;
  directPass?: boolean;
}): string {
  const normalized = String(params.contextSummary ?? "").trim();
  if (!normalized) {
    return "";
  }
  const limit = params.directPass && String(params.intent ?? "").trim().toLowerCase() === "ideation"
    ? 500
    : 1200;
  return clip(normalized, limit);
}

function takeBulletLines(section: string, maxLines: number): string[] {
  return String(section ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function buildIdeationDirectReferenceContext(contextSummary: string): string {
  const normalized = String(contextSummary ?? "").trim();
  if (!normalized) {
    return "";
  }
  const sections = [
    {
      title: "외부 관점 핵심",
      rows: takeBulletLines(
        extractSectionBetweenMarkers({
          input: normalized,
          startMarker: "## claims",
          endMarkers: ["## ideas", "## risks", "## disagreements", "## novelty_signals", "# 외부 웹 AI 원문"],
        }),
        3,
      ),
    },
    {
      title: "후보 아이디어 힌트",
      rows: takeBulletLines(
        extractSectionBetweenMarkers({
          input: normalized,
          startMarker: "## ideas",
          endMarkers: ["## risks", "## disagreements", "## novelty_signals", "# 외부 웹 AI 원문"],
        }),
        4,
      ),
    },
    {
      title: "차별화 신호",
      rows: takeBulletLines(
        extractSectionBetweenMarkers({
          input: normalized,
          startMarker: "## novelty_signals",
          endMarkers: ["# 외부 웹 AI 원문"],
        }),
        3,
      ),
    },
    {
      title: "주의할 함정",
      rows: takeBulletLines(
        extractSectionBetweenMarkers({
          input: normalized,
          startMarker: "## risks",
          endMarkers: ["## disagreements", "## novelty_signals", "# 외부 웹 AI 원문"],
        }),
        3,
      ),
    },
  ].filter((section) => section.rows.length > 0);
  if (sections.length === 0) {
    return "";
  }
  return sections
    .map((section) => [`### ${section.title}`, ...section.rows.map((row) => `- ${row}`)].join("\n"))
    .join("\n\n");
}

function buildRawExternalWebPerspective(summary: string): string {
  const normalized = String(summary ?? "").trim();
  if (!normalized) {
    return "";
  }
  return [
    "# 외부 웹 AI 원문",
    normalized,
  ].join("\n\n");
}

function renderRoleSummary(result: CollaborationRoleRunResult): string {
  return `## ${result.roleId}\n${clip(result.summary, 900)}`;
}

function buildBriefPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  participantPrompt: string;
  contextSummary: string;
  priorRoleSummaries?: CollaborationRoleRunResult[];
  participantRoleIds: string[];
  cappedParticipantCount: boolean;
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  const creativeMode = Boolean(params.creativeMode) && isIdeation;
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
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
    params.priorRoleSummaries?.length ? "# 이전 역할 결과" : "",
    params.priorRoleSummaries?.length
      ? params.priorRoleSummaries.map(renderRoleSummary).join("\n\n")
      : "",
    params.priorRoleSummaries?.length ? "" : "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    contract,
    "",
    "# 협업 규칙",
    `- 참여 에이전트 수: ${params.participantRoleIds.length}${params.cappedParticipantCount ? " (상한 적용)" : ""}`,
    ...(creativeMode
      ? [
          "- Creative Mode: 최근 평균 답변 표현이나 내부 브리프 문체를 반복하지 말고, 서로 다른 방향의 후보를 충분히 벌린다.",
          "- 먼저 최소 12개 이상의 거친 후보를 내부적으로 발산한 뒤, 그중 기억에 남는 후보만 남긴다.",
          "- 대표작 두 개 조합처럼 들리거나 장르 태그 두 개만 섞은 후보, 설명만 화려하고 루프가 빈약한 후보는 스스로 탈락시킨다.",
        ]
      : []),
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

function buildDirectParticipantPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  participantPrompt: string;
  contextSummary: string;
  priorRoleSummaries?: CollaborationRoleRunResult[];
  participantRoleIds: string[];
  cappedParticipantCount: boolean;
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  const creativeMode = Boolean(params.creativeMode) && isIdeation;
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
  const roleLabel = extractAssignedRoleLabel(params.participantPrompt);
  const roleSpecificGoals = extractRoleSpecificGoals(params.participantPrompt);
  const directReferenceContext = isIdeation
    ? buildIdeationDirectReferenceContext(params.contextSummary)
    : buildCompactContextSummary({
        contextSummary: params.contextSummary,
        intent: params.intent,
        directPass: true,
      });
  return [
    "# 작업 모드",
    "역할별 직접 응답",
    "",
    roleLabel ? "# 역할" : "",
    roleLabel || "",
    roleLabel ? "" : "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    roleSpecificGoals.length > 0 ? "# 역할별 목표" : "",
    ...roleSpecificGoals.map((goal) => `- ${goal}`),
    roleSpecificGoals.length > 0 ? "" : "",
    params.priorRoleSummaries?.length ? "# 이전 역할 결과" : "",
    params.priorRoleSummaries?.length
      ? params.priorRoleSummaries.map(renderRoleSummary).join("\n\n")
      : "",
    params.priorRoleSummaries?.length ? "" : "",
    directReferenceContext ? "# 외부 참고 요약" : "",
    directReferenceContext || "",
    directReferenceContext ? "" : "",
    contract,
    "",
    "# 협업 규칙",
    `- 참여 에이전트 수: ${params.participantRoleIds.length}${params.cappedParticipantCount ? " (상한 적용)" : ""}`,
    "- 내부 브리프나 handoff 문서 형식으로 답하지 않는다.",
    "- 자기 역할 관점에서 바로 최종 합성에 쓸 수 있는 실질 재료만 남긴다.",
    ...(creativeMode
      ? [
          "- Creative Mode가 켜져 있다. 가장 무난한 평균 답을 경계하고, 기억에 남는 후보와 탈락 이유를 우선 남긴다.",
          "- 상투적인 조합, 대표작 짜깁기, 설명만 화려한 후보는 스스로 제외한다.",
        ]
      : []),
    isIdeation
      ? "- 아이디어 후보, 훅, 핵심 루프, 리텐션 포인트, 아류작 냄새가 약한 이유를 우선 남긴다."
      : "- 핵심 사실, 리스크, 구현 포인트, 놓치면 안 되는 검증 항목만 남긴다.",
    "- 불필요한 서론 없이 6개 이하 bullet 또는 짧은 문단으로 답한다.",
    "- 추정과 사실을 구분한다.",
  ].filter(Boolean).join("\n");
}

function buildCritiquePrompt(params: {
  prompt: string;
  intent?: string;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
  creativeMode?: boolean;
}): string {
  const creativeMode = Boolean(params.creativeMode);
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
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
    contract,
    "",
    "# 출력 규칙",
    ...(creativeMode
      ? [
          "- 평균적 장르 조합, 최근 대화 표현 반복, 대표작 2개를 바로 떠올리게 하는 후보를 우선 탈락시킨다.",
          "- 안전한 후보를 더 다듬는 것보다 무난한 후보를 과감히 버리는 데 집중한다.",
        ]
      : []),
    "- 서로 충돌하는 주장, 빠진 확인 포인트, 구현/테스트 리스크만 6개 이하 bullet로 적는다.",
    "- 최종 답변 문체 금지.",
    "- 이미 같은 내용은 반복하지 않는다.",
  ].join("\n");
}

function buildFinalPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
  criticSummary?: string;
  judgeVerdict?: TaskCollaborationJudgeVerdict | null;
  verifierVerdict?: TaskCollaborationVerifierVerdict | null;
  failedRoleIds?: string[];
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  const creativeMode = Boolean(params.creativeMode) && isIdeation;
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
  const compactContextSummary = buildCompactContextSummary({
    contextSummary: params.contextSummary,
    intent: params.intent,
    directPass: isIdeation,
  });
  return [
    "# 작업 모드",
    "최종 합성 답변",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    compactContextSummary || "없음",
    "",
    "# 참여 에이전트 브리프",
    params.roleSummaries.map(renderRoleSummary).join("\n\n"),
    params.failedRoleIds?.length
      ? ["", "# 실패한 참여 에이전트", params.failedRoleIds.map((roleId) => `- ${roleId}`).join("\n")].join("\n")
      : "",
    params.criticSummary
      ? ["", "# 충돌/누락 검토", clip(params.criticSummary, 800)].join("\n")
      : "",
    params.judgeVerdict
      ? ["", renderJudgeVerdict(params.judgeVerdict)].join("\n")
      : "",
    params.verifierVerdict
      ? ["", renderVerifierVerdict(params.verifierVerdict)].join("\n")
      : "",
    "",
    contract,
    "",
    "# 출력 규칙",
    "- 한국어로 최종 답변을 작성한다.",
    ...(creativeMode
      ? [
          "- Creative Mode가 켜져 있다. 무난한 평균 답보다 기억에 남는 후보를 우선한다.",
          "- 최종안에는 왜 상투적이지 않은지와 어떤 평균적 대안을 탈락시켰는지가 드러나야 한다.",
        ]
      : []),
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

function buildFallbackFinalPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  contextSummary: string;
  judgeVerdict?: TaskCollaborationJudgeVerdict | null;
  verifierVerdict?: TaskCollaborationVerifierVerdict | null;
  failedRoleIds?: string[];
}): string {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  const creativeMode = Boolean(params.creativeMode) && isIdeation;
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
  const compactContextSummary = buildCompactContextSummary({
    contextSummary: params.contextSummary,
    intent: params.intent,
    directPass: isIdeation,
  });
  return [
    "# 작업 모드",
    "최종 답변 직접 생성",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    compactContextSummary || "없음",
    params.failedRoleIds?.length
      ? ["", "# 실패한 참여 에이전트", params.failedRoleIds.map((roleId) => `- ${roleId}`).join("\n")].join("\n")
      : "",
    params.judgeVerdict
      ? ["", renderJudgeVerdict(params.judgeVerdict)].join("\n")
      : "",
    params.verifierVerdict
      ? ["", renderVerifierVerdict(params.verifierVerdict)].join("\n")
      : "",
    "",
    contract,
    "",
    "# 출력 규칙",
    "- 한국어로 최종 답변을 작성한다.",
    ...(creativeMode
      ? [
          "- Creative Mode가 켜져 있다. 무난한 평균 답보다 기억에 남는 후보를 우선한다.",
          "- 상투적인 조합, 대표작 짜깁기, 설명만 화려한 후보는 스스로 제외한다.",
        ]
      : []),
    isIdeation
      ? "- 지금 바로 사용자에게 전달할 아이디어 답변만 작성한다."
      : "- 필요한 경우 핵심 리스크와 다음 행동을 짧게 정리한다.",
    isIdeation
      ? "- 사용자 요청에 숫자 요구가 있으면 그 수를 충족하도록 번호 목록으로 제시한다."
      : "",
    isIdeation
      ? "- 각 아이디어마다 한 줄 훅, 핵심 루프, 왜 지금 먹히는지, 왜 아류작 냄새가 약한지까지 포함한다."
      : "",
    "- 내부 브리프, handoff, 파일 수정 보고, 메타데이터를 답변에 섞지 않는다.",
  ].filter(Boolean).join("\n");
}

function normalizeErrorText(error: unknown): string {
  return String(error ?? "").trim().toLowerCase();
}

function formatCollaborationErrorMessage(error: unknown): string {
  const raw = String(error ?? "").trim();
  const normalized = raw.toLowerCase();
  if (normalized.includes("codex turn finished without a readable response")) {
    return "코덱스 실행은 끝났지만 읽을 수 있는 응답 본문이 없었습니다.";
  }
  if (normalized.includes("codex turn failed")) {
    return "코덱스 실행이 실패했습니다.";
  }
  if (normalized.includes("cancelled") || normalized.includes("canceled") || normalized.includes("interrupted")) {
    return "사용자에 의해 중단되었습니다.";
  }
  return raw || "알 수 없는 오류";
}

function isUserInterruptedError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("cancelled") ||
    text.includes("canceled") ||
    text.includes("interrupted") ||
    text.includes("중단") ||
    text.includes("취소")
  );
}

function isRetryableStageError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("readable response") ||
    text.includes("응답 본문이 없었습니다") ||
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

function isUnreadableResponseError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("readable response") ||
    text.includes("응답 본문이 없었습니다") ||
    text.includes("last_agent_message") ||
    text.includes("usermessage")
  );
}

function shouldPreferDirectParticipantPass(params: {
  intent?: string;
  creativeMode?: boolean;
}): boolean {
  const intent = String(params.intent ?? "").trim().toLowerCase();
  return intent === "ideation" || Boolean(params.creativeMode);
}

function buildRetryPrompt(params: {
  prompt: string;
  roleId: string;
  promptMode: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
  attempt: number;
  maxAttempts: number;
  error: unknown;
}): string {
  return [
    params.prompt,
    "",
    "# 직전 실패 메모",
    `- 역할: ${params.roleId}`,
    `- 단계: ${params.promptMode}`,
    `- 시도: ${params.attempt}/${params.maxAttempts}`,
    `- 실패 요약: ${formatCollaborationErrorMessage(params.error)}`,
    "- 같은 작업 목표는 유지하되, 직전 실패 원인을 반복하지 않도록 응답 형식과 마무리를 스스로 점검한다.",
    "- 이 메모를 답변 본문에 드러내지 않는다.",
  ].join("\n");
}

function buildRecoveryFinalPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
  criticSummary?: string;
  judgeVerdict?: TaskCollaborationJudgeVerdict | null;
  verifierVerdict?: TaskCollaborationVerifierVerdict | null;
  failedRoleIds?: string[];
  finalError: unknown;
}): string {
  return [
    buildFinalPrompt({
      prompt: params.prompt,
      intent: params.intent,
      creativeMode: params.creativeMode,
      contextSummary: params.contextSummary,
      roleSummaries: params.roleSummaries,
      criticSummary: params.criticSummary,
      judgeVerdict: params.judgeVerdict,
      verifierVerdict: params.verifierVerdict,
      failedRoleIds: params.failedRoleIds,
    }),
    "",
    "# 보수적 복구 지시",
    `- 직전 최종 합성 실패 요약: ${formatCollaborationErrorMessage(params.finalError)}`,
    "- 문장을 더 화려하게 늘리지 말고, 검증 가능한 핵심만 남겨 하나의 보수적인 최종 답변으로 다시 작성한다.",
    "- 참여 에이전트 결과 중 불확실한 부분은 과감히 버리고, 남은 근거만으로 답한다.",
  ].join("\n");
}

async function executeRoleRunWithRetry(params: {
  executeRoleRun: ExecuteRoleRun;
  roleId: string;
  prompt: string;
  promptMode: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
  intent?: string;
  internal: boolean;
  model?: string;
  models?: string[];
  reasoning?: string;
  outputArtifactName?: string;
  includeRoleKnowledge?: boolean;
  maxAttempts: number;
  onRetryMessage?: (message: string) => void;
}): Promise<CollaborationRoleRunResult> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= params.maxAttempts; attempt += 1) {
    const effectivePrompt = attempt === 1
      ? params.prompt
      : buildRetryPrompt({
          prompt: params.prompt,
          roleId: params.roleId,
          promptMode: params.promptMode,
          attempt,
          maxAttempts: params.maxAttempts,
          error: lastError,
        });
    try {
      return await params.executeRoleRun({
        roleId: params.roleId,
        prompt: effectivePrompt,
        promptMode: params.promptMode,
        intent: params.intent,
        internal: params.internal,
        model: params.model,
        models: params.models,
        reasoning: params.reasoning,
        outputArtifactName: params.outputArtifactName,
        includeRoleKnowledge: params.includeRoleKnowledge,
      });
    } catch (error) {
      if (isUserInterruptedError(error)) {
        throw error instanceof Error ? error : new Error(String(error ?? "cancelled"));
      }
      lastError = error;
      const unreadableResponse = isUnreadableResponseError(error);
      const allowUnreadableRetry =
        unreadableResponse &&
        (params.promptMode === "direct"
          || params.promptMode === "final"
          || params.promptMode === "brief"
          || params.promptMode === "judge"
          || params.promptMode === "verify");
      const canRetry = attempt < params.maxAttempts && (allowUnreadableRetry || isRetryableStageError(error));
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
  creativeMode?: boolean;
  synthesisRoleId: string;
  criticRoleId?: string;
  cappedParticipantCount: boolean;
  useAdaptiveOrchestrator?: boolean;
  preferredModel?: string;
  preferredModels?: string[];
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
  const preferDirectParticipantPass = shouldPreferDirectParticipantPass({
    intent: params.intent,
    creativeMode: params.creativeMode,
  });
  let participantRoleIds = [...params.participantRoleIds];
  let synthesisRoleId = params.synthesisRoleId;
  let criticRoleId = params.criticRoleId;
  let participantPrompts = { ...(params.participantPrompts ?? {}) };
  const participantResults: CollaborationRoleRunResult[] = [];
  const failedRoleIds: string[] = [];
  let judgeResult: CollaborationRoleRunResult | undefined;
  let judgeVerdict: TaskCollaborationJudgeVerdict | null = null;
  let verifierResult: CollaborationRoleRunResult | undefined;
  let verifierVerdict: TaskCollaborationVerifierVerdict | null = null;
  let resolvedOrchestrationSummary = "";
  let enrichedContextSummary = params.contextSummary;
  let collectExternalWebResearch = hasPreferredWebRuntime({
    preferredModel: params.preferredModel,
    preferredModels: params.preferredModels,
  });
  let externalWebResearchFocus = "";
  let riskProfile = resolveTaskCollaborationRiskProfile({
    intent: params.intent,
    creativeMode: params.creativeMode,
    participantCount: participantRoleIds.length,
    candidateCount: params.candidateRoleIds?.length ?? participantRoleIds.length,
    contextSummary: enrichedContextSummary,
    useAdaptiveOrchestrator: params.useAdaptiveOrchestrator,
  });

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
          preferredModels: params.preferredModels,
          preferredReasoning: params.preferredReasoning,
          fallbackModel: ORCHESTRATOR_MODEL,
          fallbackReasoning: ORCHESTRATOR_REASONING,
          allowExternalWeb: false,
        });
        const orchestrationResult = await executeRoleRunWithRetry({
          executeRoleRun: params.executeRoleRun,
          roleId: synthesisRoleId,
          prompt: buildAdaptiveOrchestrationPrompt({
            prompt: params.prompt,
            intent: String(params.intent ?? "").trim() || "planning",
            contextSummary: enrichedContextSummary,
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
          models: orchestrationRuntime.models,
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
          collectExternalWebResearch = adaptivePlan.collectExternalWebResearch || collectExternalWebResearch;
          externalWebResearchFocus = adaptivePlan.externalWebResearchFocus || externalWebResearchFocus;
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
        if (isUserInterruptedError(error)) {
          throw error;
        }
        params.onProgress?.({
          roleId: synthesisRoleId,
          stage: "codex",
          message: `메인 오케스트레이션 실패, 규칙 기반 계획으로 계속 진행합니다: ${formatCollaborationErrorMessage(error)}`,
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
  riskProfile = resolveTaskCollaborationRiskProfile({
    intent: params.intent,
    creativeMode: params.creativeMode,
    participantCount: participantRoleIds.length,
    candidateCount: params.candidateRoleIds?.length ?? participantRoleIds.length,
    contextSummary: enrichedContextSummary,
    useAdaptiveOrchestrator: params.useAdaptiveOrchestrator,
  });

  const sharedWebRuntime = resolveSharedWebRuntime({
    collectExternalWebResearch,
    preferredModel: params.preferredModel,
    preferredModels: params.preferredModels,
    preferredReasoning: params.preferredReasoning,
  });
  if (sharedWebRuntime) {
    params.onProgress?.({
      roleId: synthesisRoleId,
      stage: "codex",
      message: "오케스트레이터 결정 이후 외부 웹 AI 관점을 한 번 수집합니다.",
    });
    try {
      const sharedWebResult = await executeRoleRunWithRetry({
        executeRoleRun: params.executeRoleRun,
        roleId: synthesisRoleId,
        prompt: buildSharedWebPerspectivePrompt({
          prompt: params.prompt,
          intent: params.intent,
          contextSummary: enrichedContextSummary,
          creativeMode: params.creativeMode,
          researchFocus: externalWebResearchFocus,
        }),
        promptMode: "brief",
        intent: params.intent,
        internal: true,
        model: sharedWebRuntime.model,
        models: sharedWebRuntime.models,
        reasoning: sharedWebRuntime.reasoning,
        outputArtifactName: "shared_web_perspective.md",
        includeRoleKnowledge: false,
        maxAttempts: BRIEF_MAX_ATTEMPTS,
        onRetryMessage: (message) => params.onProgress?.({
          roleId: synthesisRoleId,
          stage: "codex",
          message,
        }),
      });
      const structuredWebPerspective = buildStructuredExternalWebPerspective(sharedWebResult.summary);
      const rawWebPerspective = buildRawExternalWebPerspective(sharedWebResult.summary);
      enrichedContextSummary = [
        enrichedContextSummary.trim(),
        structuredWebPerspective,
        rawWebPerspective,
      ].filter(Boolean).join("\n\n");
      riskProfile = resolveTaskCollaborationRiskProfile({
        intent: params.intent,
        creativeMode: params.creativeMode,
        participantCount: participantRoleIds.length,
        candidateCount: params.candidateRoleIds?.length ?? participantRoleIds.length,
        contextSummary: enrichedContextSummary,
        useAdaptiveOrchestrator: params.useAdaptiveOrchestrator,
      });
    } catch (error) {
      if (isUserInterruptedError(error)) {
        throw error;
      }
      params.onProgress?.({
        roleId: synthesisRoleId,
        stage: "codex",
        message: `외부 웹 AI 관점 수집 실패, 내부 협업만으로 계속 진행합니다: ${String(error ?? "unknown error")}`,
      });
    }
  }

  for (const roleId of participantRoleIds) {
    const participantPrompt = String(participantPrompts[roleId] ?? params.prompt).trim();
    const participantPromptMode: ParticipantPromptMode = preferDirectParticipantPass ? "direct" : "brief";
    const participantRuntime = resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredModels: params.preferredModels,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: participantPromptMode === "direct" ? FINAL_MODEL : BRIEF_MODEL,
      fallbackReasoning: participantPromptMode === "direct" ? FINAL_REASONING : BRIEF_REASONING,
      allowExternalWeb: false,
    });
    params.onProgress?.({
      roleId,
      stage: "codex",
      message: participantPromptMode === "direct" ? `${roleId} 역할 응답 생성` : `${roleId} 브리프 생성`,
    });
    let lastError: unknown = null;
    try {
      participantResults.push(await executeRoleRunWithRetry({
        executeRoleRun: params.executeRoleRun,
        roleId,
        prompt: participantPromptMode === "direct"
          ? buildDirectParticipantPrompt({
              prompt: params.prompt,
              intent: params.intent,
              creativeMode: params.creativeMode,
              participantPrompt,
              contextSummary: enrichedContextSummary,
              priorRoleSummaries: participantResults,
              participantRoleIds,
              cappedParticipantCount: params.cappedParticipantCount,
            })
          : buildBriefPrompt({
              prompt: params.prompt,
              intent: params.intent,
              creativeMode: params.creativeMode,
              participantPrompt,
              contextSummary: enrichedContextSummary,
              priorRoleSummaries: participantResults,
              participantRoleIds,
              cappedParticipantCount: params.cappedParticipantCount,
            }),
        promptMode: participantPromptMode,
        intent: params.intent,
        internal: true,
        model: participantRuntime.model,
        models: participantRuntime.models,
        reasoning: participantRuntime.reasoning,
        outputArtifactName: participantPromptMode === "direct" ? "discussion_direct.md" : "discussion_brief.md",
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
      if (isUserInterruptedError(error)) {
        throw error;
      }
      lastError = error;
      if (!preferDirectParticipantPass && isUnreadableResponseError(error)) {
        params.onProgress?.({
          roleId,
          stage: "codex",
          message: `${roleId} 브리프 실패, 직접 역할 응답으로 우회합니다.`,
        });
        try {
          participantResults.push(await executeRoleRunWithRetry({
            executeRoleRun: params.executeRoleRun,
            roleId,
            prompt: buildDirectParticipantPrompt({
              prompt: params.prompt,
              intent: params.intent,
              creativeMode: params.creativeMode,
              participantPrompt,
              contextSummary: enrichedContextSummary,
              priorRoleSummaries: participantResults,
              participantRoleIds,
              cappedParticipantCount: params.cappedParticipantCount,
            }),
            promptMode: "direct",
            intent: params.intent,
            internal: true,
            model: participantRuntime.model,
            models: participantRuntime.models,
            reasoning: participantRuntime.reasoning,
            outputArtifactName: "discussion_direct.md",
            includeRoleKnowledge: false,
            maxAttempts: BRIEF_MAX_ATTEMPTS,
            onRetryMessage: (message) => params.onProgress?.({
              roleId,
              stage: "codex",
              message,
            }),
          }));
          lastError = null;
        } catch (fallbackError) {
          if (isUserInterruptedError(fallbackError)) {
            throw fallbackError;
          }
          lastError = fallbackError;
          params.onProgress?.({
            roleId,
            stage: "codex",
            message: `${roleId} 직접 역할 응답도 실패: ${formatCollaborationErrorMessage(fallbackError)}`,
          });
        }
      } else {
        params.onProgress?.({
          roleId,
          stage: "codex",
          message: `${roleId} ${participantPromptMode === "direct" ? "역할 응답" : "브리프"} 실패: ${formatCollaborationErrorMessage(error)}`,
        });
      }
    }
    if (lastError) {
      failedRoleIds.push(roleId);
      continue;
    }
  }

  let criticResult: CollaborationRoleRunResult | undefined;
  if (!preferDirectParticipantPass && criticRoleId && criticRoleId !== synthesisRoleId && participantResults.length > 1) {
    const critiqueRuntime = resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredModels: params.preferredModels,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: CRITIQUE_MODEL,
      fallbackReasoning: CRITIQUE_REASONING,
      allowExternalWeb: false,
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
          intent: params.intent,
          contextSummary: enrichedContextSummary,
          roleSummaries: participantResults,
          creativeMode: params.creativeMode,
        }),
        promptMode: "critique",
        intent: params.intent,
        internal: true,
        model: critiqueRuntime.model,
        models: critiqueRuntime.models,
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
      if (isUserInterruptedError(error)) {
        throw error;
      }
      params.onProgress?.({
        roleId: criticRoleId,
        stage: "critic",
        message: `${criticRoleId} 검토 실패: ${String(error ?? "unknown error")}`,
      });
    }
  }
  riskProfile = resolveTaskCollaborationRiskProfile({
    intent: params.intent,
    creativeMode: params.creativeMode,
    participantCount: participantResults.length,
    candidateCount: params.candidateRoleIds?.length ?? participantRoleIds.length,
    contextSummary: enrichedContextSummary,
    failedRoleCount: failedRoleIds.length,
    useAdaptiveOrchestrator: params.useAdaptiveOrchestrator,
  });

  const judgeRoleId = criticRoleId || synthesisRoleId;
  if (riskProfile.runJudge && participantResults.length > 0) {
    const judgeRuntime = resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredModels: params.preferredModels,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: JUDGE_MODEL,
      fallbackReasoning: JUDGE_REASONING,
      allowExternalWeb: false,
    });
    params.onProgress?.({
      roleId: judgeRoleId,
      stage: "critic",
      message: `${judgeRoleId} 품질 판정`,
    });
    try {
      judgeResult = await executeRoleRunWithRetry({
        executeRoleRun: params.executeRoleRun,
        roleId: judgeRoleId,
        prompt: buildJudgePrompt({
          prompt: params.prompt,
          intent: params.intent,
          creativeMode: params.creativeMode,
          contextSummary: enrichedContextSummary,
          roleSummaries: participantResults,
          criticSummary: criticResult?.summary,
          failedRoleIds,
          riskProfile,
        }),
        promptMode: "judge",
        intent: params.intent,
        internal: true,
        model: judgeRuntime.model,
        models: judgeRuntime.models,
        reasoning: judgeRuntime.reasoning,
        outputArtifactName: "discussion_judge.json",
        includeRoleKnowledge: false,
        maxAttempts: JUDGE_MAX_ATTEMPTS,
        onRetryMessage: (message) => params.onProgress?.({
          roleId: judgeRoleId,
          stage: "critic",
          message,
        }),
      });
      judgeVerdict = parseJudgeVerdict(judgeResult.summary);
      if (!judgeVerdict) {
        params.onProgress?.({
          roleId: judgeRoleId,
          stage: "critic",
          message: "품질 판정이 구조화되지 않아, 보수적으로 최종 합성을 계속 진행합니다.",
        });
      }
    } catch (error) {
      if (isUserInterruptedError(error)) {
        throw error;
      }
      params.onProgress?.({
        roleId: judgeRoleId,
        stage: "critic",
        message: `${judgeRoleId} 품질 판정 실패, 기존 결과로 계속 진행합니다: ${formatCollaborationErrorMessage(error)}`,
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
    preferredModels: params.preferredModels,
    preferredReasoning: params.preferredReasoning,
    fallbackModel: FINAL_MODEL,
    fallbackReasoning: FINAL_REASONING,
    allowExternalWeb: false,
  });
  if (participantResults.length === 0) {
    params.onProgress?.({
      roleId: synthesisRoleId,
      stage: "save",
      message: "참여 역할 결과가 없어, 원 질문과 수집된 컨텍스트만으로 최종 답변을 직접 생성합니다.",
    });
    const fallbackFinalResult = await executeRoleRunWithRetry({
      executeRoleRun: params.executeRoleRun,
      roleId: synthesisRoleId,
      prompt: buildFallbackFinalPrompt({
        prompt: params.prompt,
        intent: params.intent,
        creativeMode: params.creativeMode,
        contextSummary: enrichedContextSummary,
        failedRoleIds,
      }),
      promptMode: "final",
      intent: params.intent,
      internal: false,
      model: finalRuntime.model,
      models: finalRuntime.models,
      reasoning: finalRuntime.reasoning,
      outputArtifactName: "final_response.md",
      includeRoleKnowledge: false,
      maxAttempts: FINAL_MAX_ATTEMPTS,
      onRetryMessage: (message) => params.onProgress?.({
        roleId: synthesisRoleId,
        stage: "save",
        message,
      }),
    });
    if (!String(fallbackFinalResult.summary ?? "").trim()) {
      throw new Error(preferDirectParticipantPass
        ? "모든 역할 응답이 실패해 최종 답변을 생성하지 못했습니다."
        : "모든 내부 브리프가 실패해 최종 답변을 생성하지 못했습니다.");
    }
    return {
      participantResults,
      criticResult,
      finalResult: fallbackFinalResult,
    };
  }
  const initialFinalPrompt = judgeVerdict?.status === "fallback"
    ? buildFallbackFinalPrompt({
        prompt: params.prompt,
        intent: params.intent,
        creativeMode: params.creativeMode,
        contextSummary: enrichedContextSummary,
        judgeVerdict,
        failedRoleIds,
      })
    : buildFinalPrompt({
        prompt: params.prompt,
        intent: params.intent,
        creativeMode: params.creativeMode,
        contextSummary: enrichedContextSummary,
        roleSummaries: participantResults,
        criticSummary: criticResult?.summary,
        judgeVerdict,
        failedRoleIds,
      });
  let finalResult: CollaborationRoleRunResult;
  try {
    finalResult = await executeRoleRunWithRetry({
      executeRoleRun: params.executeRoleRun,
      roleId: synthesisRoleId,
      prompt: initialFinalPrompt,
      promptMode: "final",
      intent: params.intent,
      internal: false,
      model: finalRuntime.model,
      models: finalRuntime.models,
      reasoning: finalRuntime.reasoning,
      outputArtifactName: "final_response.md",
      includeRoleKnowledge: String(params.intent ?? "").trim().toLowerCase() !== "ideation",
      maxAttempts: FINAL_MAX_ATTEMPTS,
      onRetryMessage: (message) => params.onProgress?.({
        roleId: synthesisRoleId,
        stage: "save",
        message,
      }),
    });
  } catch (error) {
    if (isUserInterruptedError(error)) {
      throw error;
    }
    params.onProgress?.({
      roleId: synthesisRoleId,
      stage: "save",
      message: `최종 합성 실패, 보수적 단일 답변으로 강등합니다: ${formatCollaborationErrorMessage(error)}`,
    });
    finalResult = await executeRoleRunWithRetry({
      executeRoleRun: params.executeRoleRun,
      roleId: synthesisRoleId,
      prompt: buildRecoveryFinalPrompt({
        prompt: params.prompt,
        intent: params.intent,
        creativeMode: params.creativeMode,
        contextSummary: enrichedContextSummary,
        roleSummaries: participantResults,
        criticSummary: criticResult?.summary,
        judgeVerdict,
        failedRoleIds,
        finalError: error,
      }),
      promptMode: "final",
      intent: params.intent,
      internal: false,
      model: finalRuntime.model,
      models: finalRuntime.models,
      reasoning: finalRuntime.reasoning,
      outputArtifactName: "final_response.md",
      includeRoleKnowledge: false,
      maxAttempts: FINAL_MAX_ATTEMPTS,
      onRetryMessage: (message) => params.onProgress?.({
        roleId: synthesisRoleId,
        stage: "save",
        message,
      }),
    });
  }
  if (riskProfile.runVerifier && String(finalResult.summary ?? "").trim()) {
    const verifierRoleId = criticRoleId || synthesisRoleId;
    const verifierRuntime = resolveStageRuntime({
      preferredModel: params.preferredModel,
      preferredModels: params.preferredModels,
      preferredReasoning: params.preferredReasoning,
      fallbackModel: VERIFY_MODEL,
      fallbackReasoning: VERIFY_REASONING,
      allowExternalWeb: false,
    });
    params.onProgress?.({
      roleId: verifierRoleId,
      stage: "save",
      message: `${verifierRoleId} 최종 답변 검증`,
    });
    try {
      verifierResult = await executeRoleRunWithRetry({
        executeRoleRun: params.executeRoleRun,
        roleId: verifierRoleId,
        prompt: buildVerifierPrompt({
          prompt: params.prompt,
          intent: params.intent,
          creativeMode: params.creativeMode,
          contextSummary: enrichedContextSummary,
          finalAnswer: finalResult.summary,
          judgeVerdict,
          riskProfile,
        }),
        promptMode: "verify",
        intent: params.intent,
        internal: true,
        model: verifierRuntime.model,
        models: verifierRuntime.models,
        reasoning: verifierRuntime.reasoning,
        outputArtifactName: "final_verification.json",
        includeRoleKnowledge: false,
        maxAttempts: VERIFY_MAX_ATTEMPTS,
        onRetryMessage: (message) => params.onProgress?.({
          roleId: verifierRoleId,
          stage: "save",
          message,
        }),
      });
      verifierVerdict = parseVerifierVerdict(verifierResult.summary);
      if (verifierVerdict?.status === "repair" || verifierVerdict?.status === "fallback") {
        params.onProgress?.({
          roleId: synthesisRoleId,
          stage: "save",
          message: `${synthesisRoleId} 검증 기반 보정 합성`,
        });
        finalResult = await executeRoleRunWithRetry({
          executeRoleRun: params.executeRoleRun,
          roleId: synthesisRoleId,
          prompt: verifierVerdict.status === "fallback"
            ? buildFallbackFinalPrompt({
                prompt: params.prompt,
                intent: params.intent,
                creativeMode: params.creativeMode,
                contextSummary: enrichedContextSummary,
                judgeVerdict,
                verifierVerdict,
                failedRoleIds,
              })
            : buildVerifierRepairPrompt({
                prompt: params.prompt,
                intent: params.intent,
                creativeMode: params.creativeMode,
                contextSummary: enrichedContextSummary,
                finalAnswer: finalResult.summary,
                judgeVerdict,
                verifierVerdict,
              }),
          promptMode: "final",
          intent: params.intent,
          internal: false,
          model: finalRuntime.model,
          models: finalRuntime.models,
          reasoning: finalRuntime.reasoning,
          outputArtifactName: "final_response.md",
          includeRoleKnowledge: false,
          maxAttempts: FINAL_MAX_ATTEMPTS,
          onRetryMessage: (message) => params.onProgress?.({
            roleId: synthesisRoleId,
            stage: "save",
            message,
          }),
        });
      }
    } catch (error) {
      if (isUserInterruptedError(error)) {
        throw error;
      }
      params.onProgress?.({
        roleId: verifierRoleId,
        stage: "save",
        message: `${verifierRoleId} 최종 검증 실패, 현재 최종 답변으로 계속 진행합니다: ${formatCollaborationErrorMessage(error)}`,
      });
    }
  }
  if (!String(finalResult.summary ?? "").trim()) {
    throw new Error("최종 합성 답변이 비어 있어 성공 처리할 수 없습니다.");
  }

  return {
    participantResults,
    criticResult,
    finalResult,
  };
}
