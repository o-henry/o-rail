export const UNITY_TASK_AGENT_PRESETS = [
  {
    id: "game_designer",
    label: "GAME DESIGNER",
    studioRoleId: "pm_planner",
    defaultSummary: "플레이어 목표, 작업 범위, 핵심 메커닉 의도를 정리하고 있습니다.",
    defaultInstruction: "집중할 점: 대상 Unity 기능, 플레이어 목표, 범위, 제약 조건을 한국어로 명확히 정리하세요.",
    discussionLine: "GAME DESIGNER: 기능 목표, 플레이 판타지, 구현 범위를 한국어로 정리하고 있습니다.",
    tagAliases: ["designer", "game_designer", "explorer"],
    defaultEnabled: false,
    stageOwnership: ["brief", "design"],
  },
  {
    id: "level_designer",
    label: "LEVEL DESIGNER",
    studioRoleId: "pm_creative_director",
    defaultSummary: "레벨 흐름, 전투 템포, 공간 연출 의도를 정리하고 있습니다.",
    defaultInstruction: "집중할 점: 씬 흐름, 전투 템포, 레벨별 설계 메모를 한국어로 정리하세요.",
    discussionLine: "LEVEL DESIGNER: 씬 흐름, 템포, 전투 가독성을 한국어로 정리하고 있습니다.",
    tagAliases: ["level", "level_designer"],
    defaultEnabled: false,
    stageOwnership: ["design"],
  },
  {
    id: "unity_architect",
    label: "UNITY ARCHITECT",
    studioRoleId: "system_programmer",
    defaultSummary: "Unity 아키텍처, 데이터 흐름, 통합 리스크를 검토하고 있습니다.",
    defaultInstruction: "집중할 점: 아키텍처, 시스템 경계, 데이터 흐름, Unity 통합 리스크를 한국어로 검토하세요.",
    discussionLine: "UNITY ARCHITECT: 아키텍처 경계, 의존성, 통합 리스크를 한국어로 점검하고 있습니다.",
    tagAliases: ["architect", "unity_architect", "reviewer"],
    defaultEnabled: false,
    stageOwnership: ["design", "integrate"],
  },
  {
    id: "unity_implementer",
    label: "UNITY IMPLEMENTER",
    studioRoleId: "client_programmer",
    defaultSummary: "Unity 게임플레이, UI, 콘텐츠 구현 작업을 준비하고 있습니다.",
    defaultInstruction: "집중할 점: 요청된 Unity 변경을 안전하게 구현하고, 수정 파일과 결과를 한국어로 요약하세요.",
    discussionLine: "UNITY IMPLEMENTER: 구현 경로와 수정 가능성이 높은 파일을 한국어로 정리하고 있습니다.",
    tagAliases: ["implementer", "unity_implementer", "worker"],
    defaultEnabled: false,
    stageOwnership: ["implement"],
  },
  {
    id: "technical_artist",
    label: "TECHNICAL ARTIST",
    studioRoleId: "art_pipeline",
    defaultSummary: "아트 파이프라인, 셰이더, 프리팹, 에셋 연결 제약을 확인하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 통합을 위한 프리팹, 셰이더, VFX, 콘텐츠 연결 제약을 한국어로 검토하세요.",
    discussionLine: "TECHNICAL ARTIST: 에셋 연결, 프리팹 안전성, 렌더링 제약을 한국어로 점검하고 있습니다.",
    tagAliases: ["techart", "technical_artist"],
    defaultEnabled: false,
    stageOwnership: ["integrate"],
  },
  {
    id: "unity_editor_tools",
    label: "UNITY EDITOR TOOLS",
    studioRoleId: "tooling_engineer",
    defaultSummary: "에디터 툴링, 자동화, 검증 보조 도구를 설계하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 에디터 툴, 자동화, 검증 보조 기능을 한국어로 설계하거나 개선하세요.",
    discussionLine: "UNITY EDITOR TOOLS: 이 작업에 필요한 에디터 자동화와 툴 지원을 한국어로 검토하고 있습니다.",
    tagAliases: ["tools", "unity_editor_tools"],
    defaultEnabled: false,
    stageOwnership: ["implement"],
  },
  {
    id: "qa_playtester",
    label: "QA PLAYTESTER",
    studioRoleId: "qa_engineer",
    defaultSummary: "Unity 검증 절차, 재현 케이스, 플레이테스트 항목을 준비하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 변경에 대한 플레이테스트 절차, 검증 항목, 회귀 체크를 한국어로 정리하세요.",
    discussionLine: "QA PLAYTESTER: 검증 범위, 재현 절차, 회귀 체크를 한국어로 정리하고 있습니다.",
    tagAliases: ["playtest", "qa_playtester", "qa"],
    defaultEnabled: false,
    stageOwnership: ["playtest"],
  },
  {
    id: "release_steward",
    label: "RELEASE STEWARD",
    studioRoleId: "build_release",
    defaultSummary: "빌드 상태, 릴리즈 막힘 요소, 최종 통합 준비 상태를 검토하고 있습니다.",
    defaultInstruction: "집중할 점: 마감 전에 릴리즈 준비 상태, 빌드 정상 여부, 통합 막힘 요소를 한국어로 확인하세요.",
    discussionLine: "RELEASE STEWARD: 빌드 상태, 승인 현황, 릴리즈 준비 정도를 한국어로 점검하고 있습니다.",
    tagAliases: ["release", "release_steward"],
    defaultEnabled: false,
    stageOwnership: ["integrate", "lock"],
  },
  {
    id: "handoff_writer",
    label: "HANDOFF WRITER",
    studioRoleId: "technical_writer",
    defaultSummary: "최종 인계 메모, 알려진 이슈, 다음 단계 문서를 정리하고 있습니다.",
    defaultInstruction: "집중할 점: Unity 작업의 최종 인계 내용, 변경 영역, 후속 메모를 한국어로 정리하세요.",
    discussionLine: "HANDOFF WRITER: 다음 담당자를 위한 인계 문서와 정리 내용을 한국어로 작성하고 있습니다.",
    tagAliases: ["docs", "handoff_writer"],
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

export const UNITY_THREAD_STAGE_DEFINITIONS: ThreadStageDefinition[] = [
  { id: "brief", label: "요청 정리", ownerPresetIds: ["game_designer"] },
  { id: "design", label: "설계", ownerPresetIds: ["game_designer", "level_designer", "unity_architect"] },
  { id: "implement", label: "구현", ownerPresetIds: ["unity_implementer", "unity_editor_tools"] },
  { id: "integrate", label: "통합", ownerPresetIds: ["unity_architect", "technical_artist", "release_steward"] },
  { id: "playtest", label: "플레이테스트", ownerPresetIds: ["qa_playtester"] },
  { id: "lock", label: "마감", ownerPresetIds: ["handoff_writer", "release_steward"] },
];

const LEGACY_TASK_AGENT_ALIASES: Record<string, TaskAgentPresetId> = {
  explorer: "game_designer",
  reviewer: "unity_architect",
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
  solo: ["game_designer", "unity_implementer", "qa_playtester"],
  duo: ["game_designer", "unity_implementer", "qa_playtester", "unity_architect", "technical_artist"],
  "full-squad": [
    "game_designer",
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

export function getTaskAgentSummary(input: string | TaskAgentPresetId | null | undefined): string {
  return getTaskAgentPreset(input)?.defaultSummary ?? "다음 Unity 제작 단계를 준비하고 있습니다.";
}

export function buildTaskAgentPrompt(input: string | TaskAgentPresetId | null | undefined, prompt: string): string {
  const normalizedPrompt = String(prompt ?? "").trim();
  const preset = getTaskAgentPreset(input);
  return preset ? `${normalizedPrompt}\n\n${preset.defaultInstruction}` : normalizedPrompt;
}

export function getTaskAgentDiscussionLine(input: string | TaskAgentPresetId | null | undefined): string {
  return getTaskAgentPreset(input)?.discussionLine ?? "UNITY AGENT: 다음 제작 단계를 한국어로 정리하고 있습니다.";
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
  return UNITY_THREAD_STAGE_DEFINITIONS.find((stage) => stage.id === normalized)?.label ?? String(input ?? "").trim().toUpperCase();
}

export function isValidationPresetId(input: string | null | undefined): boolean {
  return resolveTaskAgentPresetId(input) === "qa_playtester";
}

export function isDefaultPromptLabel(input: string | null | undefined): boolean {
  const normalized = String(input ?? "").trim().toLowerCase();
  return normalized === "new thread" || normalized === "새 thread" || normalized === "새 스레드";
}
