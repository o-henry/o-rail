import { getStudioRoleModeOptions, resolvePmPlanningMode } from "../../../features/studio/pmPlanningMode";
import { toStudioRoleId } from "../../../features/studio/roleUtils";

type RoleNodeInlineActionsInput = {
  sourceKind?: unknown;
  handoffRoleId?: unknown;
  pmPlanningMode?: unknown;
  internalChildCount?: number;
};

export type RoleNodeInlineActionsMeta = {
  showInternalToggle: boolean;
  showPerspective: boolean;
  showReview: boolean;
  showModeButtons: boolean;
  modeOptions: Array<"creative" | "logical">;
  pmMode: "creative" | "logical" | null;
};

export function getRoleNodeInlineActionsMeta(input: RoleNodeInlineActionsInput): RoleNodeInlineActionsMeta {
  const sourceKind = String(input.sourceKind ?? "").trim().toLowerCase();
  const roleId = toStudioRoleId(String(input.handoffRoleId ?? "").trim().toLowerCase());
  const isHandoffRoleNode = sourceKind === "handoff" && roleId !== null;
  const internalChildCount = Math.max(0, Number(input.internalChildCount ?? 0) || 0);
  const modeOptions = getStudioRoleModeOptions(roleId);
  const pmMode = resolvePmPlanningMode(roleId, input.pmPlanningMode);

  return {
    showInternalToggle: isHandoffRoleNode && internalChildCount > 0,
    showPerspective: isHandoffRoleNode,
    showReview: isHandoffRoleNode,
    showModeButtons: isHandoffRoleNode && modeOptions.length > 0 && pmMode !== null,
    modeOptions,
    pmMode,
  };
}
