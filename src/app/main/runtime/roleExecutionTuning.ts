import type { TurnContextBudget } from "../../../features/workflow/turnExecutionTuning";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import {
  normalizeStudioRoleSelection,
  resolvePmPlanningMode,
} from "../../../features/studio/pmPlanningMode";

type RoleExecutionTuning = {
  temperature: number;
  contextBudget: TurnContextBudget;
  maxInputChars: number;
};

const LOGICAL_TUNING: RoleExecutionTuning = {
  temperature: 0.18,
  contextBudget: "balanced",
  maxInputChars: 3600,
};

const CREATIVE_TUNING: RoleExecutionTuning = {
  temperature: 0.4,
  contextBudget: "wide",
  maxInputChars: 5000,
};

const PM_CREATIVE_TUNING: RoleExecutionTuning = {
  temperature: 0.48,
  contextBudget: "wide",
  maxInputChars: 5600,
};

const PM_LOGICAL_TUNING: RoleExecutionTuning = {
  temperature: 0.14,
  contextBudget: "wide",
  maxInputChars: 5200,
};

const CLIENT_CREATIVE_TUNING: RoleExecutionTuning = {
  temperature: 0.34,
  contextBudget: "wide",
  maxInputChars: 4600,
};

export function resolveStudioRoleExecutionTuning(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): RoleExecutionTuning | null {
  const baseRoleId = normalizeStudioRoleSelection(roleId);
  if (!baseRoleId) {
    return null;
  }
  const mode = resolvePmPlanningMode(roleId ?? baseRoleId, rawMode);
  if (!mode) {
    return null;
  }
  if (baseRoleId === "pm_planner") {
    return mode === "creative" ? PM_CREATIVE_TUNING : PM_LOGICAL_TUNING;
  }
  if (baseRoleId === "client_programmer" && mode === "creative") {
    return CLIENT_CREATIVE_TUNING;
  }
  if (mode === "creative") {
    return CREATIVE_TUNING;
  }
  return LOGICAL_TUNING;
}

export function resolveStudioRoleExecutionConfigPatch(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): Record<string, unknown> {
  const tuning = resolveStudioRoleExecutionTuning(roleId, rawMode);
  if (!tuning) {
    return {};
  }
  return {
    temperature: tuning.temperature,
    contextBudget: tuning.contextBudget,
    maxInputChars: tuning.maxInputChars,
  };
}
