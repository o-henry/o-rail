import {
  getTaskAgentLabel,
  orderedTaskAgentPresetIds,
  type TaskAgentPresetId,
} from "./taskAgentPresets";

export type TaskPromptIntent =
  | "implementation"
  | "research"
  | "ideation"
  | "review"
  | "validation"
  | "documentation"
  | "planning";

export type TaskPromptOrchestration = {
  intent: TaskPromptIntent;
  candidateRoleIds: TaskAgentPresetId[];
  participantRoleIds: TaskAgentPresetId[];
  primaryRoleId: TaskAgentPresetId;
  synthesisRoleId: TaskAgentPresetId;
  rolePrompts: Partial<Record<TaskAgentPresetId, string>>;
  orchestrationSummary: string;
  useAdaptiveOrchestrator: boolean;
};

const INTENT_ROLE_PRIORITY: Record<TaskPromptIntent, TaskAgentPresetId[]> = {
  implementation: ["unity_implementer", "unity_architect", "qa_playtester"],
  research: ["researcher", "game_designer", "unity_architect"],
  ideation: ["game_designer", "unity_architect", "researcher"],
  review: ["unity_architect", "qa_playtester", "unity_implementer"],
  validation: ["qa_playtester", "unity_implementer", "unity_architect"],
  documentation: ["handoff_writer", "unity_architect", "game_designer"],
  planning: ["game_designer", "unity_architect", "researcher"],
};

function includesPattern(prompt: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(prompt));
}

export function inferTaskPromptIntent(prompt: string): TaskPromptIntent {
  const normalized = String(prompt ?? "").trim();
  if (!normalized) {
    return "planning";
  }
  if (includesPattern(normalized, [/\b(code|fix|bug|debug|patch|implement|build|compile|c#)\b/i, /(버그|수정|구현|디버그|패치|컴파일|코드)/i])) {
    return "implementation";
  }
  if (includesPattern(normalized, [/\b(test|qa|verify|validation|regression)\b/i, /(재현|검증|테스트|회귀)/i])) {
    return "validation";
  }
  if (includesPattern(normalized, [/\b(idea|ideas|brainstorm|concept|hook|pitch)\b/i, /(아이디어|브레인스토밍|컨셉|후크)/i])) {
    return "ideation";
  }
  if (includesPattern(normalized, [/\b(research|search|source|reference|crawl|scrape|trend|market)\b/i, /(조사|검색|자료|레퍼런스|시장|트렌드|크롤링|스크래핑)/i])) {
    return "research";
  }
  if (includesPattern(normalized, [/\b(review|architecture|architect|compare|trade-?off)\b/i, /(검토|아키텍처|비교|트레이드오프|구조)/i])) {
    return "review";
  }
  if (includesPattern(normalized, [/\b(doc|documentation|handoff|summary)\b/i, /(정리|문서|인계|요약)/i])) {
    return "documentation";
  }
  return "planning";
}

function uniqueRoleIds(ids: Iterable<string>): TaskAgentPresetId[] {
  return orderedTaskAgentPresetIds(ids);
}

function clauseCount(prompt: string): number {
  return String(prompt ?? "")
    .split(/[\n.!?。！？]+/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function buildCandidateRoleIds(params: {
  intent: TaskPromptIntent;
  enabledRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
  primaryRoleId: TaskAgentPresetId;
}): TaskAgentPresetId[] {
  return uniqueRoleIds([
    params.primaryRoleId,
    ...params.requestedRoleIds,
    ...INTENT_ROLE_PRIORITY[params.intent],
    ...params.enabledRoleIds,
  ]).slice(0, 5);
}

function shouldUseAdaptiveOrchestrator(params: {
  intent: TaskPromptIntent;
  prompt: string;
  requestedRoleIds: TaskAgentPresetId[];
  participantRoleIds: TaskAgentPresetId[];
}): boolean {
  const normalizedPrompt = String(params.prompt ?? "").trim();
  if (params.requestedRoleIds.length >= 2) {
    return true;
  }
  if (/\b(fanout|team|debate|discuss|compare|cross-check)\b/i.test(normalizedPrompt)) {
    return true;
  }
  if (/(서로|같이|토론|논의|교차검토|합의|선정|너희들끼리)/i.test(normalizedPrompt)) {
    return true;
  }
  if (normalizedPrompt.length >= 220 || clauseCount(normalizedPrompt) >= 4) {
    return params.participantRoleIds.length > 1 || params.intent === "planning" || params.intent === "review";
  }
  return false;
}

function desiredParticipantCount(intent: TaskPromptIntent, prompt: string, requestedRoleCount: number): number {
  if (requestedRoleCount > 1) {
    return 3;
  }
  if (intent === "implementation" || intent === "documentation") {
    return 1;
  }
  if (intent === "validation" || intent === "review") {
    return 2;
  }
  if (intent === "ideation") {
    return /\b(같이|서로|토론|fanout|team|논의|선정|비교|추천)\b/i.test(prompt) ? 3 : 2;
  }
  if (intent === "research") {
    return /\b(추천|선정|적용|해석|요약|정리)\b/i.test(prompt) ? 2 : 1;
  }
  return 1;
}

function selectPrimaryRole(intent: TaskPromptIntent, availableRoleIds: TaskAgentPresetId[]): TaskAgentPresetId {
  return INTENT_ROLE_PRIORITY[intent].find((roleId) => availableRoleIds.includes(roleId)) ?? availableRoleIds[0] ?? "game_designer";
}

function pickParticipantRoles(params: {
  intent: TaskPromptIntent;
  prompt: string;
  enabledRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
  maxParticipants: number;
}): { primaryRoleId: TaskAgentPresetId; participantRoleIds: TaskAgentPresetId[]; cappedParticipantCount: boolean } {
  const requestedRoleIds = uniqueRoleIds(params.requestedRoleIds);
  const enabledRoleIds = uniqueRoleIds(params.enabledRoleIds);
  const availableRoleIds = uniqueRoleIds([...requestedRoleIds, ...enabledRoleIds]);
  const primaryRoleId = selectPrimaryRole(params.intent, availableRoleIds);
  const desiredCount = Math.min(params.maxParticipants, desiredParticipantCount(params.intent, params.prompt, requestedRoleIds.length));
  const ordered: TaskAgentPresetId[] = [primaryRoleId];
  for (const roleId of requestedRoleIds) {
    if (!ordered.includes(roleId)) {
      ordered.push(roleId);
    }
  }
  if (requestedRoleIds.length <= 1) {
    for (const roleId of INTENT_ROLE_PRIORITY[params.intent]) {
      if (availableRoleIds.includes(roleId) && !ordered.includes(roleId)) {
        ordered.push(roleId);
      }
    }
  }
  const participantRoleIds = ordered.slice(0, desiredCount);
  return {
    primaryRoleId,
    participantRoleIds,
    cappedParticipantCount: ordered.length > participantRoleIds.length,
  };
}

function buildIntentLead(roleId: TaskAgentPresetId, intent: TaskPromptIntent, isPrimary: boolean): string[] {
  if (intent === "ideation" && roleId === "researcher") {
    return [
      "- 아이디어 자체를 대신 확정하지 말고, 유사작/시장 신호/클리셰 위험/차별화 단서만 짧게 정리한다.",
      "- 근거가 부족해도 아이디어 생성 자체를 멈추게 하지 말고, 부족한 부분만 명시한다.",
    ];
  }
  if (intent === "ideation" && roleId === "unity_architect") {
    return [
      "- 각 후보의 1인 개발 현실성, 프로토타입 1주 가능성, 기술 리스크만 냉정하게 평가한다.",
      "- 새 아이디어를 많이 발산하기보다 후보를 줄이는 기준을 제시한다.",
    ];
  }
  if (intent === "ideation" && roleId === "game_designer") {
    return [
      "- 사용자의 요청을 직접 해결하는 주 역할이다. 실제 아이디어 후보와 30초 hook를 만들어야 한다.",
      "- 다른 역할의 근거와 리스크를 받아 최종 후보를 수렴한다.",
    ];
  }
  if (intent === "research" && roleId === "game_designer") {
    return [
      "- 조사 결과를 그대로 나열하지 말고, 사용자의 의사결정에 어떤 의미가 있는지 해석한다.",
      "- researcher의 근거를 바탕으로 추천/선정/정리 역할을 맡는다.",
    ];
  }
  if (intent === "implementation" && roleId === "unity_architect") {
    return [
      "- 구현을 대신하지 말고, 수정 범위, 구조 리스크, 안전한 경계만 짧게 제시한다.",
    ];
  }
  if (intent === "validation" && roleId === "qa_playtester") {
    return [
      "- 검증 시나리오, 재현 절차, 회귀 체크를 우선한다.",
    ];
  }
  return [
    isPrimary
      ? "- 이 요청의 주 책임 역할로서 사용자 질문을 직접 해결하는 산출물을 만든다."
      : "- 주 책임 역할을 돕는 보조 역할로서 자기 전문영역의 핵심 판단만 제공한다.",
  ];
}

function buildRoleAssignmentPrompt(params: {
  roleId: TaskAgentPresetId;
  intent: TaskPromptIntent;
  userPrompt: string;
  primaryRoleId: TaskAgentPresetId;
  participantRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
}): string {
  const isPrimary = params.roleId === params.primaryRoleId;
  return [
    "# ORCHESTRATION",
    `작업 유형: ${params.intent}`,
    `당신의 역할: ${getTaskAgentLabel(params.roleId)}`,
    `주 책임 역할: ${getTaskAgentLabel(params.primaryRoleId)}`,
    `참여 역할: ${params.participantRoleIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ")}`,
    params.requestedRoleIds.length > 0 ? `사용자 멘션 힌트: ${params.requestedRoleIds.map((roleId) => `@${roleId}`).join(", ")}` : "사용자 멘션 힌트: 없음",
    "",
    "# ROLE-SPECIFIC GOALS",
    ...buildIntentLead(params.roleId, params.intent, isPrimary),
    "- 사용자 금지 조건과 선호 조건을 임의로 무시하지 않는다.",
    "- 다른 역할이 맡을 내용을 전부 대신하려 하지 말고, 자기 역할에 맞는 정보만 압축한다.",
    "",
    "# USER REQUEST",
    params.userPrompt.trim(),
  ].join("\n");
}

function buildOrchestrationSummary(intent: TaskPromptIntent, participantRoleIds: TaskAgentPresetId[], primaryRoleId: TaskAgentPresetId): string {
  return `${intent} 요청으로 해석했고 ${getTaskAgentLabel(primaryRoleId)} 중심으로 ${participantRoleIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} 를 배치했습니다.`;
}

export function orchestrateTaskPrompt(params: {
  enabledRoleIds: Iterable<string>;
  requestedRoleIds: Iterable<string>;
  prompt: string;
  maxParticipants: number;
}): TaskPromptOrchestration & { cappedParticipantCount: boolean } {
  const intent = inferTaskPromptIntent(params.prompt);
  const requestedRoleIds = uniqueRoleIds(params.requestedRoleIds);
  const picked = pickParticipantRoles({
    intent,
    prompt: params.prompt,
    enabledRoleIds: uniqueRoleIds(params.enabledRoleIds),
    requestedRoleIds,
    maxParticipants: params.maxParticipants,
  });
  const candidateRoleIds = buildCandidateRoleIds({
    intent,
    enabledRoleIds: uniqueRoleIds(params.enabledRoleIds),
    requestedRoleIds,
    primaryRoleId: picked.primaryRoleId,
  });
  const useAdaptiveOrchestrator = shouldUseAdaptiveOrchestrator({
    intent,
    prompt: params.prompt,
    requestedRoleIds,
    participantRoleIds: picked.participantRoleIds,
  });
  const rolePrompts = Object.fromEntries(
    candidateRoleIds.map((roleId) => [
      roleId,
      buildRoleAssignmentPrompt({
        roleId,
        intent,
        userPrompt: params.prompt,
        primaryRoleId: picked.primaryRoleId,
        participantRoleIds: picked.participantRoleIds,
        requestedRoleIds,
      }),
    ]),
  ) as Partial<Record<TaskAgentPresetId, string>>;
  return {
    intent,
    candidateRoleIds,
    participantRoleIds: picked.participantRoleIds,
    primaryRoleId: picked.primaryRoleId,
    synthesisRoleId: picked.primaryRoleId,
    rolePrompts,
    orchestrationSummary: buildOrchestrationSummary(intent, picked.participantRoleIds, picked.primaryRoleId),
    useAdaptiveOrchestrator,
    cappedParticipantCount: picked.cappedParticipantCount,
  };
}
