import {
  getDefaultRunPresetIds,
  orderedTaskAgentPresetIds,
  type TaskAgentPresetId,
} from "./taskAgentPresets";

export type TaskExecutionMode = "single" | "discussion";

export type TaskExecutionPlan = {
  mode: TaskExecutionMode;
  participantRoleIds: TaskAgentPresetId[];
  primaryRoleId: TaskAgentPresetId;
  synthesisRoleId: TaskAgentPresetId;
  criticRoleId?: TaskAgentPresetId;
  maxParticipants: number;
  maxRounds: number;
  cappedParticipantCount: boolean;
};

const MAX_DISCUSSION_PARTICIPANTS = 3;
const MAX_DISCUSSION_ROUNDS = 2;

const PRIMARY_ROLE_PRIORITY: TaskAgentPresetId[] = [
  "unity_implementer",
  "unity_architect",
  "qa_playtester",
  "game_designer",
  "level_designer",
  "technical_artist",
  "unity_editor_tools",
  "release_steward",
  "handoff_writer",
];

const CRITIC_ROLE_PRIORITY: TaskAgentPresetId[] = [
  "unity_architect",
  "qa_playtester",
  "release_steward",
  "technical_artist",
  "level_designer",
  "game_designer",
  "unity_editor_tools",
  "handoff_writer",
  "unity_implementer",
];

const KEYWORD_ROLE_HINTS: Array<{ roleId: TaskAgentPresetId; patterns: RegExp[] }> = [
  {
    roleId: "unity_implementer",
    patterns: [
      /\b(c#|code|script|class|method|function|diff|patch|compile|null reference|fix|bug|debug)\b/i,
      /(구현|수정|버그|디버그|코드|스크립트|클래스|함수|컴파일|패치)/,
    ],
  },
  {
    roleId: "unity_architect",
    patterns: [
      /\b(architecture|architect|refactor|perf|performance|codemap|dependency|design review)\b/i,
      /(아키텍처|구조|리팩터|성능|의존성|코드맵|설계 검토)/,
    ],
  },
  {
    roleId: "qa_playtester",
    patterns: [
      /\b(test|qa|repro|regression|verify|validation)\b/i,
      /(테스트|검증|재현|회귀|확인)/,
    ],
  },
  {
    roleId: "level_designer",
    patterns: [
      /\b(level|encounter|pacing|layout|map)\b/i,
      /(레벨|전투|동선|맵|레이아웃|템포)/,
    ],
  },
  {
    roleId: "technical_artist",
    patterns: [
      /\b(shader|vfx|prefab|asset|render)\b/i,
      /(셰이더|브이엑스|이펙트|프리팹|에셋|렌더)/,
    ],
  },
  {
    roleId: "release_steward",
    patterns: [
      /\b(build|release|ci|ship)\b/i,
      /(빌드|릴리즈|배포|마감|출시)/,
    ],
  },
  {
    roleId: "handoff_writer",
    patterns: [
      /\b(doc|documentation|handoff|note|summary)\b/i,
      /(문서|인계|정리|요약|메모)/,
    ],
  },
];

function uniqueRoleIds(ids: Iterable<string>): TaskAgentPresetId[] {
  return orderedTaskAgentPresetIds(ids);
}

function pickPrimaryRole(prompt: string, requested: TaskAgentPresetId[]): TaskAgentPresetId {
  const normalizedPrompt = String(prompt ?? "").trim();
  for (const hint of KEYWORD_ROLE_HINTS) {
    if (!requested.includes(hint.roleId)) {
      continue;
    }
    if (hint.patterns.some((pattern) => pattern.test(normalizedPrompt))) {
      return hint.roleId;
    }
  }
  return PRIMARY_ROLE_PRIORITY.find((roleId) => requested.includes(roleId)) ?? requested[0];
}

function pickCriticRole(primaryRoleId: TaskAgentPresetId, participants: TaskAgentPresetId[]): TaskAgentPresetId | undefined {
  return CRITIC_ROLE_PRIORITY.find((roleId) => roleId !== primaryRoleId && participants.includes(roleId));
}

export function createTaskExecutionPlan(params: {
  enabledRoleIds: Iterable<string>;
  requestedRoleIds: Iterable<string>;
  prompt: string;
}): TaskExecutionPlan {
  const enabledRoleIds = uniqueRoleIds(params.enabledRoleIds);
  const requestedRoleIds = uniqueRoleIds(params.requestedRoleIds).filter((roleId) => enabledRoleIds.includes(roleId));
  const defaultRoleIds = getDefaultRunPresetIds(enabledRoleIds, requestedRoleIds);
  const candidateRoleIds = requestedRoleIds.length > 0 ? requestedRoleIds : (enabledRoleIds.length > 0 ? enabledRoleIds : defaultRoleIds);
  const primaryRoleId = pickPrimaryRole(params.prompt, candidateRoleIds);
  const orderedParticipants = requestedRoleIds.length > 0
    ? [
        primaryRoleId,
        ...candidateRoleIds.filter((roleId) => roleId !== primaryRoleId),
      ]
    : [primaryRoleId];
  const participantRoleIds = orderedParticipants.slice(0, MAX_DISCUSSION_PARTICIPANTS);
  const criticRoleId = pickCriticRole(primaryRoleId, participantRoleIds);
  const mode: TaskExecutionMode = participantRoleIds.length > 1 ? "discussion" : "single";

  return {
    mode,
    participantRoleIds,
    primaryRoleId,
    synthesisRoleId: primaryRoleId,
    criticRoleId: mode === "discussion" ? criticRoleId : undefined,
    maxParticipants: MAX_DISCUSSION_PARTICIPANTS,
    maxRounds: mode === "discussion" ? MAX_DISCUSSION_ROUNDS : 1,
    cappedParticipantCount: orderedParticipants.length > participantRoleIds.length,
  };
}
