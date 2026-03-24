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
  implementation: ["unity_implementer", "unity_refactor_specialist", "unity_architect", "qa_playtester"],
  research: ["researcher", "game_designer", "unity_architect"],
  ideation: ["game_designer", "researcher", "level_designer", "unity_architect"],
  review: ["unity_architect", "unity_refactor_specialist", "qa_playtester", "unity_implementer"],
  validation: ["qa_playtester", "unity_implementer", "unity_architect"],
  documentation: ["handoff_writer", "unity_architect", "game_designer"],
  planning: ["game_designer", "unity_architect", "unity_refactor_specialist", "researcher"],
};

const ORCHESTRATOR_FALLBACK_ROLE_PRIORITY: TaskAgentPresetId[] = [
  "researcher",
  "game_designer",
  "unity_architect",
  "unity_refactor_specialist",
  "unity_implementer",
  "qa_playtester",
  "technical_artist",
  "unity_editor_tools",
  "level_designer",
  "release_steward",
  "handoff_writer",
];

function includesPattern(prompt: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(prompt));
}

const IDEATION_SIGNAL_PATTERNS = [
  /\b(idea|ideas|brainstorm|concept|hook|pitch)\b/i,
  /(아이디어|브레인스토밍|컨셉|후크)/i,
];

const RESEARCH_SIGNAL_PATTERNS = [
  /\b(research|search|source|reference|crawl|scrape|trend|market|community|steam|metacritic|reddit)\b/i,
  /(조사|검색|자료|레퍼런스|시장|트렌드|크롤링|스크래핑|커뮤니티|스팀|메타크리틱|레딧)/i,
];

export function inferTaskPromptIntent(prompt: string): TaskPromptIntent {
  const normalized = String(prompt ?? "").trim();
  if (!normalized) {
    return "planning";
  }
  if (includesPattern(normalized, [/\b(code|fix|bug|debug|patch|implement|build|compile|c#|refactor|restructure|extract|split)\b/i, /(버그|수정|구현|디버그|패치|컴파일|코드|리팩토링|구조 개선|책임 분리|파일 분리|모듈 분리)/i])) {
    return "implementation";
  }
  if (includesPattern(normalized, [/\b(test|qa|verify|validation|regression)\b/i, /(재현|검증|테스트|회귀)/i])) {
    return "validation";
  }
  if (includesPattern(normalized, IDEATION_SIGNAL_PATTERNS)) {
    return "ideation";
  }
  if (includesPattern(normalized, RESEARCH_SIGNAL_PATTERNS)) {
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

function buildCandidateRoleIds(params: {
  enabledRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
  primaryRoleId: TaskAgentPresetId;
}): TaskAgentPresetId[] {
  return uniqueRoleIds([
    params.primaryRoleId,
    ...params.requestedRoleIds,
    ...params.enabledRoleIds,
  ]);
}

function desiredParticipantCount(params: {
  intent: TaskPromptIntent;
  prompt: string;
  requestedRoleCount: number;
  creativeMode?: boolean;
}): number {
  const { intent, prompt, requestedRoleCount, creativeMode } = params;
  if (requestedRoleCount > 1) {
    return 3;
  }
  if (
    intent === "implementation"
    && includesPattern(String(prompt ?? ""), [/\b(refactor|restructure|extract|split|decouple)\b/i, /(리팩토링|구조 개선|책임 분리|파일 분리|모듈 분리|결합도)/i])
  ) {
    return 3;
  }
  if (intent === "implementation") {
    return requestedRoleCount === 0 ? 2 : 1;
  }
  if (intent === "documentation") {
    return 1;
  }
  if (intent === "validation" || intent === "review") {
    return 2;
  }
  if (intent === "ideation") {
    if (creativeMode) {
      return 3;
    }
    return /\b(같이|서로|토론|fanout|team|논의|선정|비교|추천)\b/i.test(prompt) ? 3 : 2;
  }
  if (intent === "research") {
    return requestedRoleCount === 0 ? 2 : 1;
  }
  if (intent === "planning") {
    return requestedRoleCount === 0 ? 2 : 1;
  }
  return 1;
}

function shouldUseNeutralFallbackPriority(intent: TaskPromptIntent, requestedRoleCount: number): boolean {
  if (requestedRoleCount > 0) {
    return false;
  }
  return intent === "research" || intent === "review" || intent === "planning";
}

function selectPrimaryRole(
  intent: TaskPromptIntent,
  prompt: string,
  availableRoleIds: TaskAgentPresetId[],
  requestedRoleCount: number,
): TaskAgentPresetId {
  if (shouldUseNeutralFallbackPriority(intent, requestedRoleCount)) {
    return (
      ORCHESTRATOR_FALLBACK_ROLE_PRIORITY.find((roleId) => availableRoleIds.includes(roleId))
      ?? availableRoleIds[0]
      ?? "game_designer"
    );
  }
  if (
    intent === "implementation"
    && availableRoleIds.includes("unity_refactor_specialist")
    && includesPattern(String(prompt ?? ""), [/\b(refactor|restructure|extract|split|decouple)\b/i, /(리팩토링|구조 개선|책임 분리|파일 분리|모듈 분리|결합도)/i])
  ) {
    return "unity_refactor_specialist";
  }
  return INTENT_ROLE_PRIORITY[intent].find((roleId) => availableRoleIds.includes(roleId)) ?? availableRoleIds[0] ?? "game_designer";
}

function pickParticipantRoles(params: {
  intent: TaskPromptIntent;
  prompt: string;
  enabledRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
  maxParticipants: number;
  creativeMode?: boolean;
}): { primaryRoleId: TaskAgentPresetId; participantRoleIds: TaskAgentPresetId[]; cappedParticipantCount: boolean } {
  const requestedRoleIds = uniqueRoleIds(params.requestedRoleIds);
  const enabledRoleIds = uniqueRoleIds(params.enabledRoleIds);
  const availableRoleIds = uniqueRoleIds([...requestedRoleIds, ...enabledRoleIds]);
  const primaryRoleId = selectPrimaryRole(
    params.intent,
    params.prompt,
    availableRoleIds,
    requestedRoleIds.length,
  );
  const desiredCount = Math.min(params.maxParticipants, desiredParticipantCount({
    intent: params.intent,
    prompt: params.prompt,
    requestedRoleCount: requestedRoleIds.length,
    creativeMode: params.creativeMode,
  }));
  const ordered: TaskAgentPresetId[] = [primaryRoleId];
  for (const roleId of requestedRoleIds) {
    if (!ordered.includes(roleId)) {
      ordered.push(roleId);
    }
  }
  if (requestedRoleIds.length === 0 && shouldUseNeutralFallbackPriority(params.intent, requestedRoleIds.length)) {
    for (const roleId of ORCHESTRATOR_FALLBACK_ROLE_PRIORITY) {
      if (availableRoleIds.includes(roleId) && !ordered.includes(roleId)) {
        ordered.push(roleId);
      }
    }
  } else if (requestedRoleIds.length <= 1) {
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
  if (intent === "ideation" && roleId === "level_designer") {
    return [
      "- 장르 이름보다 플레이 순간의 감정선, 동선, 템포, 실패 비용이 어떻게 새롭게 느껴지는지를 제안한다.",
      "- 이해는 빠르지만 감각은 낯선 후보를 우선하고, 한 문장 hook만 화려한 후보는 줄인다.",
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
  if ((intent === "implementation" || intent === "review") && roleId === "unity_refactor_specialist") {
    return [
      "- 새 기능 제안보다 리팩토링 범위, 책임 분리, 파일 분해 순서, 동작 보존 기준을 우선한다.",
      "- 한 번에 뒤엎지 말고 단계적 추출과 회귀 방지 체크포인트를 제시한다.",
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
  creativeMode?: boolean;
  userPrompt: string;
  primaryRoleId: TaskAgentPresetId;
  participantRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
}): string {
  const isPrimary = params.roleId === params.primaryRoleId;
  const creativeMode = Boolean(params.creativeMode);
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
    ...(creativeMode && params.intent === "ideation"
      ? [
          "- Creative Mode가 켜져 있다. 최근 평균 답변, 안전한 장르 조합, 이전 브리프 표현을 반복하지 말고 더 멀리 발산한다.",
          "- 먼저 서로 다른 방향의 후보를 충분히 벌린 뒤에만 수렴한다. 가장 무난한 후보를 바로 고르지 않는다.",
          "- 대표작 두 개를 섞은 듯한 아이디어, 장르 태그 두 개만 합친 아이디어, 설명만 화려하고 루프가 빈약한 아이디어는 스스로 폐기한다.",
        ]
      : []),
    "- 사용자 금지 조건과 선호 조건을 임의로 무시하지 않는다.",
    "- 다른 역할이 맡을 내용을 전부 대신하려 하지 말고, 자기 역할에 맞는 정보만 압축한다.",
    "",
    "# USER REQUEST",
    params.userPrompt.trim(),
  ].join("\n");
}

function buildOrchestrationSummary(
  intent: TaskPromptIntent,
  participantRoleIds: TaskAgentPresetId[],
  primaryRoleId: TaskAgentPresetId,
  creativeMode = false,
): string {
  return `${intent} 요청으로 해석했고 ${getTaskAgentLabel(primaryRoleId)} 중심으로 ${participantRoleIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} 를 배치했습니다.${creativeMode && intent === "ideation" ? " Creative Mode로 발산 -> 탈락 -> 수렴 흐름을 우선합니다." : ""}`;
}

export function orchestrateTaskPrompt(params: {
  enabledRoleIds: Iterable<string>;
  requestedRoleIds: Iterable<string>;
  prompt: string;
  maxParticipants: number;
  creativeMode?: boolean;
}): TaskPromptOrchestration & { cappedParticipantCount: boolean } {
  const requestedRoleIds = uniqueRoleIds(params.requestedRoleIds);
  const enabledRoleIds = uniqueRoleIds(params.enabledRoleIds);
  const fallbackIntent = inferTaskPromptIntent(params.prompt);
  const picked = pickParticipantRoles({
    intent: fallbackIntent,
    prompt: params.prompt,
    enabledRoleIds,
    requestedRoleIds,
    maxParticipants: params.maxParticipants,
    creativeMode: params.creativeMode,
  });
  const candidateRoleIds = buildCandidateRoleIds({
    enabledRoleIds,
    requestedRoleIds,
    primaryRoleId: picked.primaryRoleId,
  });
  const useAdaptiveOrchestrator = true;
  const rolePrompts = Object.fromEntries(
    candidateRoleIds.map((roleId) => [
      roleId,
      buildRoleAssignmentPrompt({
        roleId,
        intent: fallbackIntent,
        creativeMode: params.creativeMode,
        userPrompt: params.prompt,
        primaryRoleId: picked.primaryRoleId,
        participantRoleIds: picked.participantRoleIds,
        requestedRoleIds,
      }),
    ]),
  ) as Partial<Record<TaskAgentPresetId, string>>;
  return {
    intent: fallbackIntent,
    candidateRoleIds,
    participantRoleIds: picked.participantRoleIds,
    primaryRoleId: picked.primaryRoleId,
    synthesisRoleId: picked.primaryRoleId,
    rolePrompts,
    orchestrationSummary: buildOrchestrationSummary(fallbackIntent, picked.participantRoleIds, picked.primaryRoleId, Boolean(params.creativeMode)),
    useAdaptiveOrchestrator,
    cappedParticipantCount: picked.cappedParticipantCount,
  };
}
