import {
  getDefaultRunPresetIds,
  orderedTaskAgentPresetIds,
  type TaskAgentPresetId,
} from "./taskAgentPresets";
import { orchestrateTaskPrompt, type TaskPromptIntent } from "./taskPromptOrchestration";

export type TaskExecutionMode = "single" | "discussion";

export type TaskExecutionPlan = {
  mode: TaskExecutionMode;
  intent: TaskPromptIntent;
  candidateRoleIds: TaskAgentPresetId[];
  participantRoleIds: TaskAgentPresetId[];
  requestedRoleIds: TaskAgentPresetId[];
  primaryRoleId: TaskAgentPresetId;
  synthesisRoleId: TaskAgentPresetId;
  criticRoleId?: TaskAgentPresetId;
  maxParticipants: number;
  maxRounds: number;
  cappedParticipantCount: boolean;
  rolePrompts: Partial<Record<TaskAgentPresetId, string>>;
  orchestrationSummary: string;
  useAdaptiveOrchestrator: boolean;
};

const MAX_DISCUSSION_PARTICIPANTS = 3;
const MAX_DISCUSSION_ROUNDS = 2;

const CRITIC_ROLE_PRIORITY: TaskAgentPresetId[] = [
  "unity_architect",
  "researcher",
  "qa_playtester",
  "release_steward",
  "technical_artist",
  "level_designer",
  "game_designer",
  "unity_editor_tools",
  "handoff_writer",
  "unity_implementer",
];

function uniqueRoleIds(ids: Iterable<string>): TaskAgentPresetId[] {
  return orderedTaskAgentPresetIds(ids);
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
  const requestedRoleIds = uniqueRoleIds(params.requestedRoleIds);
  const defaultRoleIds = getDefaultRunPresetIds(enabledRoleIds, requestedRoleIds);
  const orchestration = orchestrateTaskPrompt({
    enabledRoleIds: enabledRoleIds.length > 0 ? enabledRoleIds : defaultRoleIds,
    requestedRoleIds,
    prompt: params.prompt,
    maxParticipants: MAX_DISCUSSION_PARTICIPANTS,
  });
  const primaryRoleId = orchestration.primaryRoleId;
  const participantRoleIds = [
    primaryRoleId,
    ...orchestration.participantRoleIds.filter((roleId) => roleId !== primaryRoleId),
  ];
  const criticRoleId = pickCriticRole(primaryRoleId, participantRoleIds);
  const mode: TaskExecutionMode = participantRoleIds.length > 1 ? "discussion" : "single";

  return {
    mode,
    intent: orchestration.intent,
    candidateRoleIds: orchestration.candidateRoleIds,
    participantRoleIds,
    requestedRoleIds,
    primaryRoleId,
    synthesisRoleId: primaryRoleId,
    criticRoleId: mode === "discussion" ? criticRoleId : undefined,
    maxParticipants: MAX_DISCUSSION_PARTICIPANTS,
    maxRounds: mode === "discussion" ? MAX_DISCUSSION_ROUNDS : 1,
    cappedParticipantCount: orchestration.cappedParticipantCount,
    rolePrompts: orchestration.rolePrompts,
    orchestrationSummary: orchestration.orchestrationSummary,
    useAdaptiveOrchestrator: orchestration.useAdaptiveOrchestrator,
  };
}
