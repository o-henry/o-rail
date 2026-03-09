import { getTurnExecutor } from "./domain";
import type { GraphData, GraphNode } from "./types";

export type WorkflowGraphViewMode = "graph" | "rag";

export function isViaFlowTurnNode(node: GraphNode): boolean {
  if (node.type !== "turn") {
    return false;
  }
  return getTurnExecutor(node.config) === "via_flow";
}

export function isVisibleRagWorkspaceNode(node: GraphNode): boolean {
  if (!isViaFlowTurnNode(node)) {
    return false;
  }
  const internalParentNodeId = String((node.config as Record<string, unknown>)?.internalParentNodeId ?? "").trim();
  return internalParentNodeId.length === 0;
}

export function buildGraphForViewMode(graph: GraphData, mode: WorkflowGraphViewMode): GraphData {
  if (mode !== "rag") {
    return graph;
  }

  const ragNodes = graph.nodes.filter((node) => isVisibleRagWorkspaceNode(node));
  const ragNodeIds = new Set(ragNodes.map((node) => node.id));
  const ragEdges = graph.edges.filter(
    (edge) => ragNodeIds.has(edge.from.nodeId) && ragNodeIds.has(edge.to.nodeId),
  );

  return {
    ...graph,
    nodes: ragNodes,
    edges: ragEdges,
  };
}
