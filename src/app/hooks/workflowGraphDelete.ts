import type { GraphData } from "../../features/workflow/types";

export function removeGraphNodesPreservingLayout(graph: GraphData, nodeIds: string[]): GraphData {
  const targets = nodeIds.filter((id, index, rows) => rows.indexOf(id) === index);
  if (targets.length === 0) {
    return graph;
  }
  const targetSet = new Set(targets);
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !targetSet.has(node.id)),
    edges: graph.edges.filter((edge) => !targetSet.has(edge.from.nodeId) && !targetSet.has(edge.to.nodeId)),
  };
}
