import type { StudioRoleId } from "./handoffTypes";
import { STUDIO_ROLE_TEMPLATES } from "./roleTemplates";

export type PmPlanningMode = "creative" | "logical";

export const DEFAULT_PM_PLANNING_MODE: PmPlanningMode = "creative";

const STUDIO_ROLE_MODE_CONFIG: Partial<Record<StudioRoleId, {
  modes: PmPlanningMode[];
  defaultMode: PmPlanningMode;
}>> = {
  pm_planner: {
    modes: ["creative", "logical"],
    defaultMode: "creative",
  },
  client_programmer: {
    modes: ["creative", "logical"],
    defaultMode: "logical",
  },
  system_programmer: {
    modes: ["logical"],
    defaultMode: "logical",
  },
  tooling_engineer: {
    modes: ["logical"],
    defaultMode: "logical",
  },
  art_pipeline: {
    modes: ["logical"],
    defaultMode: "logical",
  },
  qa_engineer: {
    modes: ["logical"],
    defaultMode: "logical",
  },
  build_release: {
    modes: ["logical"],
    defaultMode: "logical",
  },
  technical_writer: {
    modes: ["logical"],
    defaultMode: "logical",
  },
};

const LEGACY_PM_ROLE_TO_MODE: Partial<Record<StudioRoleId, PmPlanningMode>> = {
  pm_creative_director: "creative",
  pm_feasibility_critic: "logical",
};

function resolveTemplate(roleId: StudioRoleId | null | undefined) {
  if (!roleId) {
    return null;
  }
  return STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId) ?? null;
}

export function isLegacyPmStudioRole(roleId: StudioRoleId | null | undefined): boolean {
  return roleId === "pm_creative_director" || roleId === "pm_feasibility_critic";
}

export function isPmStudioRole(roleId: StudioRoleId | null | undefined): boolean {
  return roleId === "pm_planner" || isLegacyPmStudioRole(roleId);
}

export function normalizePmPlanningMode(raw: unknown): PmPlanningMode {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (
    normalized === "logical" ||
    normalized === "logic" ||
    normalized === "critic" ||
    normalized === "critical" ||
    normalized === "critique" ||
    normalized === "feasibility"
  ) {
    return "logical";
  }
  return DEFAULT_PM_PLANNING_MODE;
}

export function getStudioRoleModeOptions(
  roleId: StudioRoleId | null | undefined,
): PmPlanningMode[] {
  const baseRoleId = normalizeStudioRoleSelection(roleId);
  if (!baseRoleId) {
    return [];
  }
  return [...(STUDIO_ROLE_MODE_CONFIG[baseRoleId]?.modes ?? [])];
}

export function resolvePmPlanningMode(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): PmPlanningMode | null {
  if (!roleId) {
    return null;
  }
  if (isLegacyPmStudioRole(roleId)) {
    return LEGACY_PM_ROLE_TO_MODE[roleId] ?? DEFAULT_PM_PLANNING_MODE;
  }
  const baseRoleId = normalizeStudioRoleSelection(roleId);
  if (!baseRoleId) {
    return null;
  }
  const modeConfig = STUDIO_ROLE_MODE_CONFIG[baseRoleId];
  if (!modeConfig) {
    return null;
  }
  const normalizedMode = normalizePmPlanningMode(rawMode);
  return modeConfig.modes.includes(normalizedMode) ? normalizedMode : modeConfig.defaultMode;
}

export function normalizeStudioRoleSelection(
  roleId: StudioRoleId | null | undefined,
): StudioRoleId | null {
  if (!roleId) {
    return null;
  }
  if (isLegacyPmStudioRole(roleId)) {
    return "pm_planner";
  }
  return roleId;
}

export function resolveEffectiveStudioRoleId(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): StudioRoleId | null {
  if (!roleId) {
    return null;
  }
  if (isLegacyPmStudioRole(roleId)) {
    return roleId;
  }
  if (roleId === "pm_planner") {
    return normalizePmPlanningMode(rawMode) === "logical"
      ? "pm_feasibility_critic"
      : "pm_creative_director";
  }
  return roleId;
}

export function resolveStudioRoleDisplayLabel(
  roleId: StudioRoleId | null | undefined,
  _rawMode?: unknown,
): string {
  const baseRoleId = normalizeStudioRoleSelection(roleId);
  if (!baseRoleId) {
    return "";
  }
  if (baseRoleId === "pm_planner") {
    return "기획(PM)";
  }
  return resolveTemplate(baseRoleId)?.label ?? baseRoleId;
}

export function resolveStudioRolePromptLabel(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): string {
  const baseRoleId = normalizeStudioRoleSelection(roleId);
  if (!baseRoleId) {
    return "";
  }
  const mode = resolvePmPlanningMode(roleId ?? baseRoleId, rawMode);
  if (mode) {
    return `${resolveStudioRoleDisplayLabel(baseRoleId, rawMode)} · ${mode === "logical" ? "논리" : "창의성"} 모드`;
  }
  const effectiveRoleId = resolveEffectiveStudioRoleId(baseRoleId, rawMode);
  return resolveTemplate(effectiveRoleId)?.label ?? resolveTemplate(baseRoleId)?.label ?? baseRoleId;
}

export function resolveStudioRoleGoal(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): string {
  const effectiveRoleId = resolveEffectiveStudioRoleId(roleId, rawMode);
  if (!effectiveRoleId) {
    return "";
  }
  const template = resolveTemplate(effectiveRoleId);
  return template?.goal ?? effectiveRoleId;
}

export function resolveStudioRoleNodeDisplayName(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): string {
  const label = resolveStudioRoleDisplayLabel(roleId, rawMode);
  const mode = resolvePmPlanningMode(roleId, rawMode);
  if (label && mode) {
    return `${label} · ${resolvePmPlanningModeLabel(mode)} AGENT`;
  }
  return label ? `${label} AGENT` : "AGENT";
}

export function resolvePmPlanningModeLabel(mode: PmPlanningMode): string {
  return mode === "logical" ? "논리" : "창의성";
}

export function buildStudioRoleModeGuidance(
  roleId: StudioRoleId | null | undefined,
  rawMode?: unknown,
): string[] {
  const baseRoleId = normalizeStudioRoleSelection(roleId);
  const mode = resolvePmPlanningMode(roleId, rawMode);
  if (!baseRoleId || !mode || isPmStudioRole(baseRoleId)) {
    return [];
  }
  if (baseRoleId === "client_programmer" && mode === "creative") {
    return [
      "익숙한 구현 패턴 복제보다 UX 감각과 상호작용의 차별화 대안을 최소 1개 함께 제시합니다.",
      "창의적인 제안도 현재 코드베이스와 입력/상태 구조 안에서 구현 가능한 수준으로 제한합니다.",
    ];
  }
  if (mode === "logical") {
    return [
      "아이디어 확장보다 정확성, 실패 가능성, 검증 가능성, 보수적인 변경 범위를 우선합니다.",
      "모호한 표현 대신 근거, 제약, 확인 절차를 먼저 제시합니다.",
    ];
  }
  return [];
}

export function isStudioRolePaletteVisible(roleId: StudioRoleId): boolean {
  return !isLegacyPmStudioRole(roleId);
}
