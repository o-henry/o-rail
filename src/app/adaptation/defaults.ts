import type { GraphData, GraphEdge, GraphNode } from "../../features/workflow/types";
import type { AdaptiveChampionRecord } from "./types";

type RoleTemplateCloneResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  roleNodeId: string;
  researchNodeIds: string[];
};

function cloneGraph(graph: GraphData): GraphData {
  return JSON.parse(JSON.stringify(graph)) as GraphData;
}

function createCloneId(node: GraphNode, index: number): string {
  return `${node.type}-${Date.now().toString(36)}-${index.toString(36)}`;
}

export function resolveAdaptivePresetGraph(
  kind: string,
  builtGraph: GraphData,
  champion: AdaptiveChampionRecord | null,
): GraphData {
  if (!champion || champion.family !== `preset:${kind}` || !champion.recipe.graphTemplate) {
    return builtGraph;
  }
  return cloneGraph(champion.recipe.graphTemplate);
}

export function cloneAdaptiveRoleTemplate(params: {
  champion: AdaptiveChampionRecord | null;
  roleId: string;
  anchorX: number;
  anchorY: number;
  roleMode?: "primary" | "perspective" | "review";
  roleInstanceId: string;
  roleInstanceLabel: string;
}): RoleTemplateCloneResult | null {
  if (!params.champion || !params.champion.family.startsWith("role:") || params.champion.family !== `role:${params.roleId}`) {
    return null;
  }
  const templateGraph = params.champion.recipe.graphTemplate;
  const templateRoleNodeId = params.champion.recipe.templateRoleNodeId;
  if (!templateGraph || !templateRoleNodeId || params.roleMode && params.roleMode !== "primary") {
    return null;
  }
  const roleNode = templateGraph.nodes.find((node) => node.id === templateRoleNodeId);
  if (!roleNode) {
    return null;
  }
  const idMap = new Map<string, string>();
  const nodes = templateGraph.nodes.map((node, index) => {
    const clonedId = createCloneId(node, index);
    idMap.set(node.id, clonedId);
    return clonedId;
  });
  const xDelta = params.anchorX - Number(roleNode.position?.x ?? 0);
  const yDelta = params.anchorY - Number(roleNode.position?.y ?? 0);
  const clonedNodes = templateGraph.nodes.map((node) => {
    const nextId = idMap.get(node.id) ?? node.id;
    const nextConfig = { ...(node.config as Record<string, unknown>) };
    if (nextConfig.internalParentNodeId) {
      nextConfig.internalParentNodeId = idMap.get(String(nextConfig.internalParentNodeId)) ?? nextConfig.internalParentNodeId;
    }
    if (nextId === (idMap.get(templateRoleNodeId) ?? templateRoleNodeId)) {
      nextConfig.roleInstanceId = params.roleInstanceId;
      nextConfig.roleInstanceLabel = params.roleInstanceLabel;
      nextConfig.roleMode = "primary";
    } else if (nextConfig.roleInstanceId) {
      nextConfig.roleInstanceId = params.roleInstanceId;
    }
    return {
      ...node,
      id: nextId,
      position: {
        x: Math.round(Number(node.position?.x ?? 0) + xDelta),
        y: Math.round(Number(node.position?.y ?? 0) + yDelta),
      },
      config: nextConfig,
    };
  });
  const clonedEdges = templateGraph.edges.map((edge) => ({
    ...edge,
    from: {
      ...edge.from,
      nodeId: idMap.get(edge.from.nodeId) ?? edge.from.nodeId,
    },
    to: {
      ...edge.to,
      nodeId: idMap.get(edge.to.nodeId) ?? edge.to.nodeId,
    },
  }));
  const clonedRoleNodeId = idMap.get(templateRoleNodeId) ?? templateRoleNodeId;
  const researchNodeIds = clonedNodes
    .filter((node) => String((node.config as Record<string, unknown>).internalParentNodeId ?? "") === clonedRoleNodeId)
    .map((node) => node.id);
  void nodes;
  return {
    nodes: clonedNodes,
    edges: clonedEdges,
    roleNodeId: clonedRoleNodeId,
    researchNodeIds,
  };
}
