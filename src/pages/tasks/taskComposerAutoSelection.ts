import { deriveExecutionPlan } from "./taskExecutionRuntime";
import {
  getDefaultTaskAgentPresetIds,
  orderedTaskAgentPresetIds,
  parseCoordinationModeTag,
  parseTaskAgentTags,
  type TaskAgentPresetId,
} from "./taskAgentPresets";
import type { CoordinationMode } from "../../features/orchestration/agentic/coordinationTypes";

export function deriveAutoSelectedComposerRoleIds(params: {
  draft: string;
  selectedComposerRoleIds: TaskAgentPresetId[];
  enabledRoleIds?: string[];
  modeOverride?: CoordinationMode | null;
}): TaskAgentPresetId[] {
  const rawPrompt = String(params.draft ?? "").trim();
  if (!rawPrompt) {
    return [];
  }
  const enabledRoleIds = orderedTaskAgentPresetIds(
    params.enabledRoleIds?.length ? params.enabledRoleIds : getDefaultTaskAgentPresetIds("full-squad"),
  );
  if (enabledRoleIds.length === 0) {
    return [];
  }
  const requestedRoleIds = orderedTaskAgentPresetIds([
    ...params.selectedComposerRoleIds,
    ...parseTaskAgentTags(rawPrompt),
  ]);
  const plan = deriveExecutionPlan({
    enabledRoleIds,
    requestedRoleIds,
    prompt: rawPrompt,
    selectedMode: params.modeOverride ?? parseCoordinationModeTag(rawPrompt),
  });
  return plan.participantRoleIds.filter((roleId) => !requestedRoleIds.includes(roleId));
}
