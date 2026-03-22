import { t as translate } from "../../i18n";

export const UNITY_TASK_AGENT_PRESETS = [
  {
    id: "game_designer",
    label: "GAME DESIGNER",
    studioRoleId: "pm_planner",
    defaultSummary: "플레이어 목표와 기능 명세를 정리하면서 안전안/대담안/혼합안의 방향 차이도 함께 검토하고 있습니다.",
    defaultInstruction: "집중할 점: 대상 Unity 기능, 플레이어 목표, 범위, 제약 조건, 기능 명세와 open question을 한국어로 명확히 정리하세요. 먼저 안전안/대담안/혼합안처럼 서로 다른 3개 방향을 짧게 발산하고, 그중 가장 실행 가치가 높은 1안을 선택해 수렴하세요.",
    discussionLine: "GAME DESIGNER: 기능 목표와 플레이 판타지를 정리하면서 대비되는 3개 방향을 짧게 비교하고 가장 설득력 있는 1안으로 수렴하고 있습니다.",
    tagAliases: ["designer", "game_designer", "explorer", "planner", "spec", "brief"],
    defaultEnabled: false,
    stageOwnership: ["brief", "design"],
  },
  {
    id: "level_designer",
    label: "LEVEL DESIGNER",
    studioRoleId: "pm_creative_director",
    defaultSummary: "레벨 흐름과 전투 템포를 정리하면서 대비되는 경험 방향을 발산하고 있습니다.",
    defaultInstruction: "집중할 점: 씬 흐름, 전투 템포, 레벨별 설계 메모, encounter와 pacing 문제를 한국어로 정리하세요. 먼저 안전안/대담안/혼합안의 3개 레벨 경험 방향을 짧게 만들고, 플레이 감정선과 제작 현실성을 기준으로 최종 1안을 고르세요.",
    discussionLine: "LEVEL DESIGNER: 씬 흐름, 템포, 동선, 전투 가독성을 정리하면서 대비되는 레벨 경험 3안을 비교하고 있습니다.",
    tagAliases: ["level", "level_designer", "encounter", "pacing"],
    defaultEnabled: false,
    stageOwnership: ["design"],
  },
  {
    id: "researcher",
    label: "RESEARCHER",
    studioRoleId: "research_analyst",
    defaultSummary: "요청과 관련된 자료 검색, 웹 조사, 크롤링/스크래핑 접근 경로를 정리하고 있습니다.",
    defaultInstruction: "집중할 점: 사용자의 요청을 바탕으로 필요한 자료를 검색하고, 공식 문서/레퍼런스/웹페이지를 조사하며, 필요하면 크롤링/스크래핑 접근 방식과 수집 결과를 한국어로 구조화하세요.",
    discussionLine: "RESEARCHER: 관련 자료, 참고 링크, 검색 쿼리, 크롤링/스크래핑 포인트를 한국어로 정리하고 있습니다.",
    tagAliases: ["researcher", "research", "search", "web", "crawl", "crawler", "scrape", "scraper"],
    defaultEnabled: false,
    stageOwnership: ["brief"],
  },
  {
    id: "unity_architect",
    label: "UNITY ARCHITECT",
    studioRoleId: "system_programmer",
    defaultSummary: "Unity 아키텍처, 코드맵, 데이터 흐름, 성능과 통합 리스크를 검토하고 있습니다.",
    defaultInstruction: "집중할 점: 아키텍처, 시스템 경계, 코드맵, 데이터 흐름, 성능 병목, Unity 통합 리스크와 리뷰 포인트를 한국어로 검토하세요.",
    discussionLine: "UNITY ARCHITECT: 아키텍처 경계, 코드 구조, 성능 병목, 통합 리스크를 한국어로 점검하고 있습니다.",
    tagAliases: ["architect", "unity_architect", "reviewer", "review", "codemap", "code_mapper", "mapper", "performance", "perf"],
    defaultEnabled: false,
    stageOwnership: ["design", "integrate"],
  },
  {
    id: "unity_refactor_specialist",
    label: "UNITY REFACTOR SPECIALIST",
    studioRoleId: "system_programmer",
    defaultSummary: "대규모 Unity 코드 정리, 책임 분리, 파일 분해와 동작 보존 중심의 리팩토링 경로를 설계하고 있습니다.",
    defaultInstruction: "집중할 점: Unity/C# 코드의 리팩토링, 책임 분리, 큰 파일 분해, 결합도 완화, 안전한 마이그레이션 순서와 회귀 방지 포인트를 한국어로 정리하거나 직접 적용하세요. 기능 추가보다 동작 보존, diff 안정성, 단계적 추출을 우선하세요.",
    discussionLine: "UNITY REFACTOR SPECIALIST: 구조 개선 범위, 추출 순서, 동작 보존 기준, 회귀 위험을 한국어로 정리하고 있습니다.",
    tagAliases: ["refactor", "refactoring", "refactor_specialist", "refactoring_specialist", "cleanup", "restructure", "extract", "split"],
    defaultEnabled: false,
    stageOwnership: ["design", "implement", "integrate"],
  },
  {
    id: "unity_implementer",
    label: "UNITY IMPLEMENTER",
    studioRoleId: "client_programmer",
    defaultSummary: "Unity 게임플레이, UI, C# 구현과 디버깅 작업을 준비하고 있습니다.",
    defaultInstruction: "집중할 점: 요청된 Unity 변경을 안전하게 구현하고, C# 코드 수정, 버그 디버깅, UI 수정 결과와 핵심 diff를 한국어로 요약하세요.",
    discussionLine: "UNITY IMPLEMENTER: 구현 경로, 디버깅 포인트, 수정 가능성이 높은 파일을 한국어로 정리하고 있습니다.",
    tagAliases: ["implementer", "unity_implementer", "worker", "csharp", "csharp_developer", "debug", "debugger", "fixer", "ui", "ui_fixer"],
    defaultEnabled: false,
    stageOwnership: ["implement"],
  },
  {
    id: "technical_artist",
    label: "TECHNICAL ARTIST",
    studioRoleId: "art_pipeline",
    defaultSummary: "아트 파이프라인 제약을 점검하면서 시각 방향 2안까지 안전하게 비교하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 통합을 위한 프리팹, 셰이더, VFX, 렌더링, 콘텐츠 연결 제약과 시각 품질 리스크를 한국어로 검토하세요. 필요한 경우 시각 방향은 최대 2안까지만 비교하고, 항상 연결 안전성과 성능을 우선 기준으로 두세요.",
    discussionLine: "TECHNICAL ARTIST: 에셋 연결, 프리팹 안전성, 셰이더/VFX 제약을 점검하면서 필요한 경우 시각 방향 2안만 제한적으로 비교하고 있습니다.",
    tagAliases: ["techart", "technical_artist", "shader", "vfx", "prefab"],
    defaultEnabled: false,
    stageOwnership: ["integrate"],
  },
  {
    id: "unity_editor_tools",
    label: "UNITY EDITOR TOOLS",
    studioRoleId: "tooling_engineer",
    defaultSummary: "에디터 툴링, 자동화, 검증 보조 도구와 생산성 개선을 설계하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 에디터 툴, 자동화, 검증 보조 기능, 개발 생산성 개선 도구를 한국어로 설계하거나 개선하세요.",
    discussionLine: "UNITY EDITOR TOOLS: 이 작업에 필요한 에디터 자동화, validator, 툴 지원을 한국어로 검토하고 있습니다.",
    tagAliases: ["tools", "unity_editor_tools", "automation", "editor", "validator"],
    defaultEnabled: false,
    stageOwnership: ["implement"],
  },
  {
    id: "qa_playtester",
    label: "QA PLAYTESTER",
    studioRoleId: "qa_engineer",
    defaultSummary: "Unity 검증 절차, 재현 케이스, 테스트 작성과 플레이테스트 항목을 준비하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 변경에 대한 플레이테스트 절차, 검증 항목, 회귀 체크, 테스트 시나리오 작성을 한국어로 정리하세요.",
    discussionLine: "QA PLAYTESTER: 검증 범위, 테스트 시나리오, 재현 절차, 회귀 체크를 한국어로 정리하고 있습니다.",
    tagAliases: ["playtest", "qa_playtester", "qa", "tester", "test", "regression"],
    defaultEnabled: false,
    stageOwnership: ["playtest"],
  },
  {
    id: "release_steward",
    label: "RELEASE STEWARD",
    studioRoleId: "build_release",
    defaultSummary: "빌드 상태, 릴리즈 막힘 요소, CI와 최종 통합 준비 상태를 검토하고 있습니다.",
    defaultInstruction: "집중할 점: 마감 전에 릴리즈 준비 상태, 빌드/CI 정상 여부, 통합 막힘 요소를 한국어로 확인하세요.",
    discussionLine: "RELEASE STEWARD: 빌드 상태, CI 현황, 승인 상태, 릴리즈 준비 정도를 한국어로 점검하고 있습니다.",
    tagAliases: ["release", "release_steward", "build", "ci"],
    defaultEnabled: false,
    stageOwnership: ["integrate", "lock"],
  },
  {
    id: "handoff_writer",
    label: "HANDOFF WRITER",
    studioRoleId: "technical_writer",
    defaultSummary: "최종 인계 메모, 알려진 이슈, 문서화와 다음 단계 문서를 정리하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 작업의 최종 인계 내용, 변경 영역, 후속 메모, 문서화를 한국어로 정리하세요.",
    discussionLine: "HANDOFF WRITER: 다음 담당자를 위한 인계 문서, 문서화, 정리 내용을 한국어로 작성하고 있습니다.",
    tagAliases: ["docs", "handoff_writer", "documentation", "handoff"],
    defaultEnabled: false,
    stageOwnership: ["lock"],
  },
] as const;

export type TaskAgentPresetId = (typeof UNITY_TASK_AGENT_PRESETS)[number]["id"];
export type ThreadAgentPresetId = TaskAgentPresetId;

export type ThreadStageId = "brief" | "design" | "implement" | "integrate" | "playtest" | "lock";
export type ThreadStageStatus = "idle" | "active" | "blocked" | "ready" | "done" | "failed";

export type ThreadStageDefinition = {
  id: ThreadStageId;
  label: string;
  ownerPresetIds: TaskAgentPresetId[];
};

export type ThreadAgentPreset = (typeof UNITY_TASK_AGENT_PRESETS)[number];
export type TaskAgentOrchestrationProfile = {
  roleId: TaskAgentPresetId;
  label: string;
  summary: string;
  strengths: string[];
  limits: string[];
  useWhen: string[];
};

export const UNITY_THREAD_STAGE_DEFINITIONS: ThreadStageDefinition[] = [
  { id: "brief", label: "요청 정리", ownerPresetIds: ["researcher", "game_designer"] },
  { id: "design", label: "설계", ownerPresetIds: ["game_designer", "level_designer", "unity_architect", "unity_refactor_specialist"] },
  { id: "implement", label: "구현", ownerPresetIds: ["unity_implementer", "unity_refactor_specialist", "unity_editor_tools"] },
  { id: "integrate", label: "통합", ownerPresetIds: ["unity_architect", "unity_refactor_specialist", "technical_artist", "release_steward"] },
  { id: "playtest", label: "플레이테스트", ownerPresetIds: ["qa_playtester"] },
  { id: "lock", label: "마감", ownerPresetIds: ["handoff_writer", "release_steward"] },
];

const LEGACY_TASK_AGENT_ALIASES: Record<string, TaskAgentPresetId> = {
  explorer: "game_designer",
  researcher: "researcher",
  reviewer: "unity_architect",
  refactor: "unity_refactor_specialist",
  worker: "unity_implementer",
  qa: "qa_playtester",
};

const PRESET_BY_ID = new Map<TaskAgentPresetId, ThreadAgentPreset>(
  UNITY_TASK_AGENT_PRESETS.map((preset) => [preset.id, preset]),
);

const aliasEntries: Array<readonly [string, TaskAgentPresetId]> = [];
for (const preset of UNITY_TASK_AGENT_PRESETS) {
  aliasEntries.push([preset.id, preset.id]);
  for (const alias of preset.tagAliases) {
    aliasEntries.push([alias, preset.id]);
  }
}
for (const entry of Object.entries(LEGACY_TASK_AGENT_ALIASES) as Array<[string, TaskAgentPresetId]>) {
  aliasEntries.push(entry);
}

const ALIAS_TO_PRESET_ID = new Map<string, TaskAgentPresetId>(aliasEntries);

export const UNITY_TASK_AGENT_ORDER: TaskAgentPresetId[] = UNITY_TASK_AGENT_PRESETS.map((preset) => preset.id);

export const UNITY_TASK_TEAM_PRESETS: Record<"solo" | "duo" | "full-squad", TaskAgentPresetId[]> = {
  solo: ["game_designer", "researcher", "unity_implementer", "qa_playtester"],
  duo: ["game_designer", "researcher", "unity_implementer", "qa_playtester", "unity_architect", "technical_artist"],
  "full-squad": [
    "game_designer",
    "researcher",
    "unity_implementer",
    "qa_playtester",
    "unity_architect",
    "technical_artist",
    "level_designer",
    "unity_editor_tools",
    "release_steward",
    "handoff_writer",
  ],
};

export const UNITY_DEFAULT_THREAD_PRESET_IDS = UNITY_TASK_TEAM_PRESETS["full-squad"];

const TASK_AGENT_ORCHESTRATION_PROFILE_EXTRAS: Record<TaskAgentPresetId, Omit<TaskAgentOrchestrationProfile, "roleId" | "label" | "summary">> = {
  game_designer: {
    strengths: ["코어 루프와 플레이 훅을 빠르게 발상", "요구사항을 플레이어 경험 기준으로 재구성"],
    limits: ["세부 구현 난이도 추정은 약할 수 있음", "시장 근거 없이 아이디어를 밀어붙일 수 있음"],
    useWhen: ["게임 아이디어 발상", "기능 우선순위와 플레이 목표 정리"],
  },
  level_designer: {
    strengths: ["레벨 흐름, 전투 템포, 동선 구성", "플레이 감정선과 페이싱 조정"],
    limits: ["코드 구조나 시스템 경계 판단은 주력이 아님", "시장 조사 역할에는 부적합"],
    useWhen: ["스테이지 구조 설계", "게임 흐름과 전개 개선"],
  },
  researcher: {
    strengths: ["자료 조사, 레퍼런스 수집, 근거 정리", "클리셰/시장 신호/유사 사례 파악"],
    limits: ["최종 제품 방향을 혼자 결정하는 역할은 아님", "구현 세부사항 설계는 약함"],
    useWhen: ["웹 조사", "시장/유사작/문서 근거 수집"],
  },
  unity_architect: {
    strengths: ["시스템 경계, 구조 리스크, 통합 포인트 검토", "현실성/범위/성능 관점 점검"],
    limits: ["새 아이디어 발산의 주역으로 쓰면 과보수적일 수 있음", "세부 구현 작업 자체는 느릴 수 있음"],
    useWhen: ["구조 검토", "기술 리스크 평가", "통합 설계"],
  },
  unity_refactor_specialist: {
    strengths: ["큰 파일 분해, 책임 분리, 단계적 추출 계획", "동작 보존 중심 리팩토링"],
    limits: ["새 기능 발상보다 구조 정리에 초점", "제품 방향성 결정엔 약함"],
    useWhen: ["리팩토링", "구조 개선", "기존 코드 정리"],
  },
  unity_implementer: {
    strengths: ["Unity/C# 실제 구현과 디버깅", "요청된 변경을 직접 끝내는 실행력"],
    limits: ["큰 구조 설계는 보조가 필요할 수 있음", "시장/기획 조사에는 부적합"],
    useWhen: ["코드 구현", "버그 수정", "UI/게임플레이 작업"],
  },
  technical_artist: {
    strengths: ["에셋/프리팹/셰이더/VFX 통합 관점 검토", "시각 품질과 연결 안정성 균형"],
    limits: ["제품 기획이나 문서 조사에는 약함", "백엔드/시스템 구조 판단은 주력이 아님"],
    useWhen: ["아트 파이프라인 검토", "비주얼 통합 리스크 점검"],
  },
  unity_editor_tools: {
    strengths: ["에디터 자동화, 검증 도구, 생산성 개선 설계", "반복 작업을 도구화"],
    limits: ["최종 사용자 기능 기획과는 거리가 있음", "시장 조사 역할에는 부적합"],
    useWhen: ["툴링", "자동화", "검증 보조 도구 설계"],
  },
  qa_playtester: {
    strengths: ["재현 절차, 회귀 체크, 테스트 시나리오", "리텐션/사용성 리스크 조기 포착"],
    limits: ["구현 자체를 대신하지 않음", "기획 발산 역할은 제한적"],
    useWhen: ["검증 계획", "회귀 체크", "플레이테스트 관점 리뷰"],
  },
  release_steward: {
    strengths: ["빌드/CI/릴리즈 막힘 요소 파악", "마감 직전 통합 상태 점검"],
    limits: ["초기 아이데이션엔 과한 역할", "세부 기능 구현 역할은 아님"],
    useWhen: ["릴리즈 준비", "빌드 안정화", "최종 통합 체크"],
  },
  handoff_writer: {
    strengths: ["인계 문서, 요약, 다음 단계 정리", "복잡한 진행 상황을 명확히 문서화"],
    limits: ["기술 의사결정의 주역은 아님", "구현/조사 역할엔 부적합"],
    useWhen: ["최종 요약", "인계 문서", "다음 단계 정리"],
  },
};

export function resolveTaskAgentPresetId(input: string | null | undefined): TaskAgentPresetId | null {
  const normalized = String(input ?? "").trim().toLowerCase();
  return ALIAS_TO_PRESET_ID.get(normalized) ?? null;
}

export function getTaskAgentPreset(input: string | TaskAgentPresetId | null | undefined): ThreadAgentPreset | null {
  const id = resolveTaskAgentPresetId(String(input ?? ""));
  return id ? PRESET_BY_ID.get(id) ?? null : null;
}

export function getTaskAgentLabel(input: string | TaskAgentPresetId | null | undefined): string {
  return getTaskAgentPreset(input)?.label ?? String(input ?? "").trim().toUpperCase();
}

export function getTaskAgentStudioRoleId(input: string | TaskAgentPresetId | null | undefined): string | null {
  return getTaskAgentPreset(input)?.studioRoleId ?? null;
}

export function getTaskAgentPresetIdByStudioRoleId(input: string | null | undefined): TaskAgentPresetId | null {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return null;
  }
  const match = UNITY_TASK_AGENT_PRESETS.find((preset) => preset.studioRoleId === normalized);
  return match?.id ?? null;
}

export function getTaskAgentSummary(input: string | TaskAgentPresetId | null | undefined): string {
  return getTaskAgentPreset(input)?.defaultSummary ?? "다음 작업 단계를 준비하고 있습니다.";
}

export function getTaskAgentOrchestrationProfile(input: string | TaskAgentPresetId | null | undefined): TaskAgentOrchestrationProfile | null {
  const preset = getTaskAgentPreset(input);
  if (!preset) {
    return null;
  }
  const extras = TASK_AGENT_ORCHESTRATION_PROFILE_EXTRAS[preset.id];
  return {
    roleId: preset.id,
    label: preset.label,
    summary: preset.defaultSummary,
    strengths: [...extras.strengths],
    limits: [...extras.limits],
    useWhen: [...extras.useWhen],
  };
}

export function getTaskAgentOrchestrationProfiles(ids: Iterable<string>): TaskAgentOrchestrationProfile[] {
  return orderedTaskAgentPresetIds(ids)
    .map((id) => getTaskAgentOrchestrationProfile(id))
    .filter((value): value is TaskAgentOrchestrationProfile => Boolean(value));
}

export function buildTaskAgentPrompt(input: string | TaskAgentPresetId | null | undefined, prompt: string): string {
  const normalizedPrompt = String(prompt ?? "").trim();
  const preset = getTaskAgentPreset(input);
  return preset ? `${normalizedPrompt}\n\n${preset.defaultInstruction}` : normalizedPrompt;
}

export function getTaskAgentDiscussionLine(input: string | TaskAgentPresetId | null | undefined): string {
  return getTaskAgentPreset(input)?.discussionLine ?? "TASK AGENT: 다음 작업 단계를 한국어로 정리하고 있습니다.";
}

export function parseTaskAgentTags(input: string): TaskAgentPresetId[] {
  const matches = String(input ?? "").toLowerCase().match(/@([a-z0-9_-]+)/g) ?? [];
  const out: TaskAgentPresetId[] = [];
  for (const token of matches) {
    const resolved = resolveTaskAgentPresetId(token.replace(/^@/, ""));
    if (resolved && !out.includes(resolved)) {
      out.push(resolved);
    }
  }
  return out;
}

export function parseCoordinationModeTag(input: string): "quick" | "fanout" | "team" | null {
  const matches = [...String(input ?? "").toLowerCase().matchAll(/(?:^|\s)@(quick|fanout|team)(?=\s|$)/g)];
  const lastMatch = matches.length > 0 ? matches[matches.length - 1]?.[1] : null;
  if (lastMatch === "quick" || lastMatch === "fanout" || lastMatch === "team") {
    return lastMatch;
  }
  return null;
}

export function stripCoordinationModeTags(input: string): string {
  return String(input ?? "")
    .replace(/(^|\s)@(quick|fanout|team)(?=\s|$)/gi, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function orderedTaskAgentPresetIds(ids: Iterable<string>): TaskAgentPresetId[] {
  const normalized = new Set(
    [...ids]
      .map((id) => resolveTaskAgentPresetId(id))
      .filter((value): value is TaskAgentPresetId => Boolean(value)),
  );
  return UNITY_TASK_AGENT_ORDER.filter((id) => normalized.has(id));
}

export function getDefaultTaskAgentPresetIds(team: string | null | undefined): TaskAgentPresetId[] {
  const normalized = String(team ?? "").trim().toLowerCase();
  if (normalized === "solo" || normalized === "duo" || normalized === "full-squad") {
    return [...UNITY_TASK_TEAM_PRESETS[normalized]];
  }
  return [];
}

export function getDefaultRunPresetIds(enabledIds: Iterable<string>, requestedIds: Iterable<string>): TaskAgentPresetId[] {
  const enabled = orderedTaskAgentPresetIds(enabledIds);
  const requested = orderedTaskAgentPresetIds(requestedIds);
  if (requested.length > 0) {
    return requested.filter((id) => enabled.includes(id));
  }
  if (enabled.includes("game_designer")) {
    return ["game_designer"];
  }
  if (enabled.includes("unity_implementer")) {
    return ["unity_implementer"];
  }
  return enabled.slice(0, 1);
}

export function getNextTaskAgentPresetId(currentId: string, enabledIds: Iterable<string>): TaskAgentPresetId | null {
  const current = resolveTaskAgentPresetId(currentId);
  if (!current) return null;
  const enabled = orderedTaskAgentPresetIds(enabledIds);
  const index = enabled.indexOf(current);
  if (index < 0) return null;
  return enabled[index + 1] ?? null;
}

export function getWorkflowStageDetailTab(stageId: ThreadStageId): "files" | "workflow" {
  return stageId === "implement" ? "files" : "workflow";
}

export function getThreadStageLabel(input: string | ThreadStageId | null | undefined): string {
  const normalized = String(input ?? "").trim().toLowerCase() as ThreadStageId;
  const labels: Record<ThreadStageId, string> = {
    brief: translate("tasks.stageLabel.brief"),
    design: translate("tasks.stageLabel.design"),
    implement: translate("tasks.stageLabel.implement"),
    integrate: translate("tasks.stageLabel.integrate"),
    playtest: translate("tasks.stageLabel.playtest"),
    lock: translate("tasks.stageLabel.lock"),
  };
  return labels[normalized] ?? UNITY_THREAD_STAGE_DEFINITIONS.find((stage) => stage.id === normalized)?.label ?? String(input ?? "").trim().toUpperCase();
}

export function getTaskAgentWorkflowStageLabels(input: string | TaskAgentPresetId | null | undefined): string[] {
  const preset = getTaskAgentPreset(input);
  if (!preset) {
    return [];
  }
  return preset.stageOwnership.map((stageId) => getThreadStageLabel(stageId));
}

export function isValidationPresetId(input: string | null | undefined): boolean {
  return resolveTaskAgentPresetId(input) === "qa_playtester";
}

export function isDefaultPromptLabel(input: string | null | undefined): boolean {
  const normalized = String(input ?? "").trim().toLowerCase();
  return normalized === "new thread" || normalized === "새 thread" || normalized === "새 스레드";
}
