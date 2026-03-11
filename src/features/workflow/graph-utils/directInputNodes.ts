import type { GraphData } from "../types";

export function resolveQuestionDirectInputNodeIds(graph: GraphData): string[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const incomingNodeIds = new Set<string>();
  const internalNodeIds = new Set(
    graph.nodes
      .filter((node) => {
        const config = (node.config ?? {}) as Record<string, unknown>;
        return String(config.internalParentNodeId ?? "").trim().length > 0;
      })
      .map((node) => node.id),
  );

  graph.edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.from.nodeId);
    const sourceConfig = (sourceNode?.config ?? {}) as Record<string, unknown>;
    const sourceInternalParentNodeId = String(sourceConfig.internalParentNodeId ?? "").trim();
    if (sourceInternalParentNodeId) {
      return;
    }
    incomingNodeIds.add(edge.to.nodeId);
  });

  return graph.nodes
    .filter((node) => !internalNodeIds.has(node.id))
    .filter((node) => !incomingNodeIds.has(node.id))
    .map((node) => node.id);
}
