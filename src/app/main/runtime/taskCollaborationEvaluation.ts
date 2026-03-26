import {
  buildTaskCollaborationContract,
  renderTaskCollaborationContract,
} from "./taskCollaborationContracts";

export type TaskCollaborationRiskLevel = "low" | "medium" | "high";

export type TaskCollaborationRiskProfile = {
  level: TaskCollaborationRiskLevel;
  runJudge: boolean;
  runVerifier: boolean;
  preferConservativeFinal: boolean;
  reasons: string[];
};

type SummaryRecord = {
  roleId: string;
  summary: string;
};

export type TaskCollaborationJudgeVerdict = {
  status: "pass" | "repair" | "fallback";
  confidence: "low" | "medium" | "high";
  strengths: string[];
  missing: string[];
  risks: string[];
  repairInstructions: string[];
  userAnswerRequirements: string[];
};

export type TaskCollaborationVerifierVerdict = {
  status: "pass" | "repair" | "fallback";
  confidence: "low" | "medium" | "high";
  summary: string;
  unsupportedClaims: string[];
  keptClaims: string[];
  repairInstructions: string[];
};

function clip(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function buildPromptBlock(title: string, rows: string[]): string {
  const filtered = rows.map((row) => String(row ?? "").trim()).filter(Boolean);
  if (filtered.length === 0) {
    return "";
  }
  return [title, ...filtered].join("\n");
}

function renderSummaries(title: string, summaries: SummaryRecord[]): string {
  if (summaries.length === 0) {
    return "";
  }
  return [
    title,
    ...summaries.map((summary) => `## ${summary.roleId}\n${clip(summary.summary, 900)}`),
  ].join("\n\n");
}

function extractJsonBlock(input: string): string {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const lines = normalized.split("\n");
  if (lines[0]?.trim().startsWith("```") && lines[lines.length - 1]?.trim() === "```") {
    return lines.slice(1, -1).join("\n").trim();
  }
  return normalized;
}

function parseStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseConfidence(value: unknown): "low" | "medium" | "high" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "medium";
}

function parseStatus<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (allowed.find((candidate) => candidate === normalized) ?? fallback) as T;
}

export function resolveTaskCollaborationRiskProfile(params: {
  intent?: string;
  creativeMode?: boolean;
  participantCount: number;
  candidateCount?: number;
  contextSummary: string;
  failedRoleCount?: number;
  useAdaptiveOrchestrator?: boolean;
}): TaskCollaborationRiskProfile {
  const reasons: string[] = [];
  let score = 0;
  if (String(params.intent ?? "").trim().toLowerCase() === "ideation") {
    score += 2;
    reasons.push("ideation");
  }
  if (params.creativeMode) {
    score += 2;
    reasons.push("creative_mode");
  }
  if (params.useAdaptiveOrchestrator) {
    score += 1;
    reasons.push("adaptive_orchestrator");
  }
  if (params.participantCount >= 3) {
    score += 2;
    reasons.push("many_participants");
  } else if (params.participantCount >= 2) {
    score += 1;
    reasons.push("multi_participant");
  }
  if ((params.candidateCount ?? params.participantCount) > params.participantCount) {
    score += 1;
    reasons.push("route_choice_available");
  }
  if (String(params.contextSummary ?? "").trim().length > 900) {
    score += 1;
    reasons.push("large_context");
  }
  if ((params.failedRoleCount ?? 0) > 0) {
    score += 2;
    reasons.push("prior_failures");
  }

  const level: TaskCollaborationRiskLevel = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return {
    level,
    runJudge: level !== "low" || params.participantCount > 1 || (params.failedRoleCount ?? 0) > 0,
    runVerifier: level === "high" || (params.failedRoleCount ?? 0) > 0 || params.participantCount > 1,
    preferConservativeFinal: level === "high" || (params.failedRoleCount ?? 0) > 0,
    reasons,
  };
}

export function renderTaskCollaborationRiskProfile(profile: TaskCollaborationRiskProfile): string {
  return [
    "# 리스크 라우팅",
    `- 위험도: ${profile.level}`,
    `- judge 단계: ${profile.runJudge ? "실행" : "생략"}`,
    `- verifier 단계: ${profile.runVerifier ? "실행" : "생략"}`,
    `- 보수적 최종 답변 우선: ${profile.preferConservativeFinal ? "예" : "아니오"}`,
    ...(profile.reasons.length > 0 ? profile.reasons.map((reason) => `- 라우팅 근거: ${reason}`) : []),
  ].join("\n");
}

export function buildJudgePrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  contextSummary: string;
  roleSummaries: SummaryRecord[];
  criticSummary?: string;
  failedRoleIds?: string[];
  riskProfile: TaskCollaborationRiskProfile;
}): string {
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
  return [
    "# 작업 모드",
    "멀티에이전트 품질 판정",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    contract,
    "",
    renderTaskCollaborationRiskProfile(params.riskProfile),
    "",
    buildPromptBlock("# 압축된 스레드 컨텍스트", [params.contextSummary.trim() || "없음"]),
    "",
    renderSummaries("# 참여 결과", params.roleSummaries),
    params.failedRoleIds?.length
      ? ["", "# 실패한 참여 에이전트", ...params.failedRoleIds.map((roleId) => `- ${roleId}`)].join("\n")
      : "",
    params.criticSummary
      ? ["", "# 비평 요약", clip(params.criticSummary, 900)].join("\n")
      : "",
    "",
    "# 출력 형식",
    "아래 JSON 객체만 반환한다. 코드펜스 없이 반환한다.",
    "{",
    '  "status": "pass | repair | fallback",',
    '  "confidence": "low | medium | high",',
    '  "strengths": ["..."],',
    '  "missing": ["..."],',
    '  "risks": ["..."],',
    '  "repair_instructions": ["..."],',
    '  "user_answer_requirements": ["..."]',
    "}",
  ].filter(Boolean).join("\n");
}

export function parseJudgeVerdict(input: string): TaskCollaborationJudgeVerdict | null {
  const candidate = extractJsonBlock(input);
  if (!candidate) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      status: parseStatus(parsed.status, ["pass", "repair", "fallback"] as const, "repair"),
      confidence: parseConfidence(parsed.confidence),
      strengths: parseStringArray(parsed.strengths, 6),
      missing: parseStringArray(parsed.missing, 6),
      risks: parseStringArray(parsed.risks, 6),
      repairInstructions: parseStringArray(parsed.repair_instructions, 6),
      userAnswerRequirements: parseStringArray(parsed.user_answer_requirements, 6),
    };
  } catch {
    return null;
  }
}

export function renderJudgeVerdict(verdict: TaskCollaborationJudgeVerdict | null | undefined): string {
  if (!verdict) {
    return "";
  }
  return [
    "# 품질 판정",
    `- 판정: ${verdict.status}`,
    `- 신뢰도: ${verdict.confidence}`,
    ...verdict.strengths.map((value) => `- 강점: ${value}`),
    ...verdict.missing.map((value) => `- 누락: ${value}`),
    ...verdict.risks.map((value) => `- 리스크: ${value}`),
    ...verdict.repairInstructions.map((value) => `- 보정 지시: ${value}`),
    ...verdict.userAnswerRequirements.map((value) => `- 사용자 답변 요구: ${value}`),
  ].join("\n");
}

export function buildVerifierPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  contextSummary: string;
  finalAnswer: string;
  judgeVerdict?: TaskCollaborationJudgeVerdict | null;
  riskProfile: TaskCollaborationRiskProfile;
}): string {
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
  const judgeBlock = renderJudgeVerdict(params.judgeVerdict);
  return [
    "# 작업 모드",
    "최종 답변 검증",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    contract,
    "",
    renderTaskCollaborationRiskProfile(params.riskProfile),
    "",
    buildPromptBlock("# 압축된 스레드 컨텍스트", [clip(params.contextSummary.trim() || "없음", 900)]),
    judgeBlock ? ["", judgeBlock].join("\n") : "",
    "",
    "# 현재 최종 답변",
    params.finalAnswer.trim(),
    "",
    "# 출력 형식",
    "아래 JSON 객체만 반환한다. 코드펜스 없이 반환한다.",
    "{",
    '  "status": "pass | repair | fallback",',
    '  "confidence": "low | medium | high",',
    '  "summary": "...",',
    '  "unsupported_claims": ["..."],',
    '  "kept_claims": ["..."],',
    '  "repair_instructions": ["..."]',
    "}",
  ].filter(Boolean).join("\n");
}

export function parseVerifierVerdict(input: string): TaskCollaborationVerifierVerdict | null {
  const candidate = extractJsonBlock(input);
  if (!candidate) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      status: parseStatus(parsed.status, ["pass", "repair", "fallback"] as const, "repair"),
      confidence: parseConfidence(parsed.confidence),
      summary: clip(String(parsed.summary ?? "").trim(), 600),
      unsupportedClaims: parseStringArray(parsed.unsupported_claims, 6),
      keptClaims: parseStringArray(parsed.kept_claims, 6),
      repairInstructions: parseStringArray(parsed.repair_instructions, 6),
    };
  } catch {
    return null;
  }
}

export function renderVerifierVerdict(verdict: TaskCollaborationVerifierVerdict | null | undefined): string {
  if (!verdict) {
    return "";
  }
  return [
    "# 최종 검증",
    `- 판정: ${verdict.status}`,
    `- 신뢰도: ${verdict.confidence}`,
    verdict.summary ? `- 요약: ${verdict.summary}` : "",
    ...verdict.unsupportedClaims.map((value) => `- 제거 대상 주장: ${value}`),
    ...verdict.keptClaims.map((value) => `- 유지된 주장: ${value}`),
    ...verdict.repairInstructions.map((value) => `- 보정 지시: ${value}`),
  ].filter(Boolean).join("\n");
}

export function buildVerifierRepairPrompt(params: {
  prompt: string;
  intent?: string;
  creativeMode?: boolean;
  contextSummary: string;
  finalAnswer: string;
  judgeVerdict?: TaskCollaborationJudgeVerdict | null;
  verifierVerdict?: TaskCollaborationVerifierVerdict | null;
}): string {
  const contract = renderTaskCollaborationContract(buildTaskCollaborationContract({
    intent: params.intent,
    creativeMode: params.creativeMode,
  }));
  const judgeBlock = renderJudgeVerdict(params.judgeVerdict);
  const verifierBlock = renderVerifierVerdict(params.verifierVerdict);
  return [
    "# 작업 모드",
    "검증 기반 최종 답변 보정",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    contract,
    "",
    buildPromptBlock("# 압축된 스레드 컨텍스트", [clip(params.contextSummary.trim() || "없음", 900)]),
    judgeBlock ? ["", judgeBlock].join("\n") : "",
    verifierBlock ? ["", verifierBlock].join("\n") : "",
    "",
    "# 현재 최종 답변",
    params.finalAnswer.trim(),
    "",
    "# 출력 규칙",
    "- 한국어로 최종 답변만 다시 작성한다.",
    "- 검증에서 흔들린 주장과 과장된 표현은 제거하거나 약화한다.",
    "- 남은 근거만으로 더 보수적이고 완결된 답변으로 다시 쓴다.",
    "- 내부 검증 과정, 메타데이터, JSON을 답변에 드러내지 않는다.",
  ].filter(Boolean).join("\n");
}
