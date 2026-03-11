import type { StudioRoleId } from "../../features/studio/handoffTypes";
import { normalizeStudioRoleSelection } from "../../features/studio/pmPlanningMode";
import { toStudioRoleId } from "../../features/studio/roleUtils";
import type { GraphData, GraphNode } from "../../features/workflow/types";

function resolveNormalizedRoleId(node: GraphNode): StudioRoleId | null {
  if (node.type !== "turn") {
    return null;
  }
  const config = (node.config ?? {}) as Record<string, unknown>;
  const sourceKind = String(config.sourceKind ?? "").trim().toLowerCase();
  if (sourceKind !== "handoff") {
    return null;
  }
  return normalizeStudioRoleSelection(toStudioRoleId(String(config.handoffRoleId ?? "")));
}

function isPrimaryTopLevelRoleNode(node: GraphNode): boolean {
  if (node.type !== "turn") {
    return false;
  }
  const config = (node.config ?? {}) as Record<string, unknown>;
  const sourceKind = String(config.sourceKind ?? "").trim().toLowerCase();
  const internalParentNodeId = String(config.internalParentNodeId ?? "").trim();
  const roleMode = String(config.roleMode ?? "").trim().toLowerCase();
  return sourceKind === "handoff" && !internalParentNodeId && (roleMode === "" || roleMode === "primary");
}

export function resolveWorkflowRoleRequestTargetNodeIds(params: {
  graph: GraphData;
  roleId: StudioRoleId;
  selectedNodeId?: string | null;
}): string[] {
  const normalizedRoleId = normalizeStudioRoleSelection(params.roleId);
  if (!normalizedRoleId) {
    return [];
  }

  const selectedNode = params.graph.nodes.find((node) => node.id === String(params.selectedNodeId ?? "").trim());
  if (selectedNode && resolveNormalizedRoleId(selectedNode) === normalizedRoleId) {
    return [selectedNode.id];
  }

  return params.graph.nodes
    .filter((node) => isPrimaryTopLevelRoleNode(node))
    .filter((node) => resolveNormalizedRoleId(node) === normalizedRoleId)
    .map((node) => node.id);
}

export function collectWorkflowRoleQueuedRequests(params: {
  targetNodeIds: string[];
  pendingNodeRequests: Record<string, string[]>;
}): string[] {
  const rows = params.targetNodeIds.flatMap((nodeId) => params.pendingNodeRequests[nodeId] ?? []);
  return [...new Set(rows.map((row) => String(row ?? "").trim()).filter(Boolean))];
}

export function removeWorkflowRoleQueuedRequest(params: {
  targetNodeIds: string[];
  pendingNodeRequests: Record<string, string[]>;
  text: string;
}): Record<string, string[]> {
  const targetIds = new Set(params.targetNodeIds.map((nodeId) => String(nodeId ?? "").trim()).filter(Boolean));
  const targetText = String(params.text ?? "").trim();
  if (targetIds.size === 0 || !targetText) {
    return params.pendingNodeRequests;
  }

  let changed = false;
  const nextEntries = Object.entries(params.pendingNodeRequests).map(([nodeId, requests]) => {
    if (!targetIds.has(nodeId)) {
      return [nodeId, requests] as const;
    }
    const nextRequests = requests.filter((request) => String(request ?? "").trim() !== targetText);
    if (nextRequests.length !== requests.length) {
      changed = true;
    }
    return [nodeId, nextRequests] as const;
  });

  return changed ? Object.fromEntries(nextEntries) : params.pendingNodeRequests;
}
