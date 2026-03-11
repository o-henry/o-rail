import { useMemo } from "react";
import { buildSimpleReadonlyTurnEdges, getGraphEdgeKey } from "../../../features/workflow/graph-utils";
import type { GraphData, GraphEdge, GraphNode, KnowledgeConfig } from "../../../features/workflow/types";
import { closestNumericOptionValue } from "../../mainAppUtils";
import type { CanvasDisplayEdge } from "../index";

export function resolveQuestionDirectInputNodeIds(graph: GraphData): Set<string> {
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

  return new Set(
    graph.nodes
      .filter((node) => !internalNodeIds.has(node.id))
      .filter((node) => !incomingNodeIds.has(node.id))
      .map((node) => node.id),
  );
}

export function useCanvasGraphDerivedState(params: any) {
  const expandedRoleNodeIds = params.expandedRoleNodeIds as Set<string> | undefined;
  const canvasNodes = useMemo<GraphNode[]>(() => {
    const baseNodes = !params.simpleWorkflowUi
      ? (params.graph as GraphData).nodes
      : (params.graph as GraphData).nodes.filter((node) => node.type === "turn");
    return baseNodes.filter((node) => {
      const config = (node.config ?? {}) as Record<string, unknown>;
      const internalParentNodeId = String(config.internalParentNodeId ?? "").trim();
      if (!internalParentNodeId) {
        return true;
      }
      if (String(params.selectedNodeId ?? "").trim() === node.id) {
        return true;
      }
      return Boolean(expandedRoleNodeIds?.has(internalParentNodeId));
    });
  }, [expandedRoleNodeIds, params.graph.nodes, params.selectedNodeId, params.simpleWorkflowUi]);

  const canvasNodeIdSet = useMemo<Set<string>>(
    () => new Set(canvasNodes.map((node) => node.id)),
    [canvasNodes],
  );
  const canvasNodeMap = useMemo<Map<string, GraphNode>>(
    () => new Map(canvasNodes.map((node) => [node.id, node])),
    [canvasNodes],
  );

  const canvasEdges = useMemo<GraphEdge[]>(() => {
    return (params.graph as GraphData).edges.filter(
      (edge) => canvasNodeIdSet.has(edge.from.nodeId) && canvasNodeIdSet.has(edge.to.nodeId),
    );
  }, [params.graph.edges, canvasNodeIdSet]);

  const canvasDisplayEdges = useMemo<CanvasDisplayEdge[]>(() => {
    const editableEdges: CanvasDisplayEdge[] = canvasEdges.map((edge) => ({
      edge,
      edgeKey: getGraphEdgeKey(edge),
      readOnly: false,
    }));
    if (!params.simpleWorkflowUi) {
      return editableEdges;
    }

    const editablePairSet = new Set(
      editableEdges.map((row) => `${row.edge.from.nodeId}->${row.edge.to.nodeId}`),
    );
    const readonlyPairs = buildSimpleReadonlyTurnEdges(params.graph, canvasNodeIdSet).filter(
      (pair) => !editablePairSet.has(`${pair.fromId}->${pair.toId}`),
    );
    const readonlyEdges: CanvasDisplayEdge[] = readonlyPairs.map((pair) => ({
      edge: {
        from: { nodeId: pair.fromId, port: "out" },
        to: { nodeId: pair.toId, port: "in" },
      },
      edgeKey: `readonly:${pair.fromId}->${pair.toId}`,
      readOnly: true,
    }));

    return [...editableEdges, ...readonlyEdges];
  }, [canvasEdges, canvasNodeIdSet, params.graph, params.simpleWorkflowUi]);

  const selectedEdgeNodeIdSet = useMemo(() => {
    const selected = canvasDisplayEdges.find((row) => row.edgeKey === params.selectedEdgeKey);
    if (!selected) {
      return new Set<string>();
    }
    return new Set([selected.edge.from.nodeId, selected.edge.to.nodeId]);
  }, [canvasDisplayEdges, params.selectedEdgeKey]);

  const selectedNode = (params.graph as GraphData).nodes.find((node) => node.id === params.selectedNodeId) ?? null;

  const questionDirectInputNodeIds = useMemo<Set<string>>(() => {
    return resolveQuestionDirectInputNodeIds(params.graph as GraphData);
  }, [params.graph.edges, params.graph.nodes]);

  const graphKnowledge = params.normalizeKnowledgeConfig(params.graph.knowledge) as KnowledgeConfig;
  const enabledKnowledgeFiles = graphKnowledge.files.filter((row) => row.enabled);
  const selectedKnowledgeMaxCharsOption = closestNumericOptionValue(
    params.knowledgeMaxCharsOptions,
    graphKnowledge.maxChars,
    params.knowledgeDefaultMaxChars,
  );

  return {
    canvasNodes,
    canvasNodeIdSet,
    canvasNodeMap,
    canvasEdges,
    canvasDisplayEdges,
    selectedEdgeNodeIdSet,
    selectedNode,
    questionDirectInputNodeIds,
    graphKnowledge,
    enabledKnowledgeFiles,
    selectedKnowledgeMaxCharsOption,
  };
}
