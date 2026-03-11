import { MouseEvent as ReactMouseEvent, useCallback } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import {
  arrangeGraphAfterEdgeConnect,
  defaultNodeConfig,
  getAutoConnectionSides,
  getNodeAnchorPoint,
  makeNodeId,
} from "../../features/workflow/graph-utils";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  NodeAnchorSide,
  NodeType,
} from "../../features/workflow/types";
import type { LogicalPoint, NodeRunState, NodeVisualSize } from "../main";
import {
  GRAPH_STAGE_INSET_Y,
  NODE_DRAG_MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "../main";
import { getCanvasViewportCenterLogical as resolveCanvasViewportCenterLogical } from "../main/canvas/canvasViewport";

type UseWorkflowGraphActionsParams = {
  graph: GraphData;
  canvasNodeIdSet: Set<string>;
  selectedNodeIds: string[];
  getBoundedStageSize: () => { width: number; height: number };
  canvasZoom: number;
  graphCanvasRef: RefObject<HTMLDivElement | null>;
  graphClipboardRef: MutableRefObject<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    copiedAt: number;
  } | null>;
  graphPasteSerialRef: MutableRefObject<number>;
  connectFromNodeId: string;
  connectFromSide: NodeAnchorSide | null;
  setConnectFromNodeId: Dispatch<SetStateAction<string>>;
  setConnectFromSide: Dispatch<SetStateAction<NodeAnchorSide | null>>;
  setConnectPreviewStartPoint: Dispatch<SetStateAction<LogicalPoint | null>>;
  setConnectPreviewPoint: Dispatch<SetStateAction<LogicalPoint | null>>;
  setIsConnectingDrag: Dispatch<SetStateAction<boolean>>;
  setMarqueeSelection: Dispatch<SetStateAction<{
    start: LogicalPoint;
    current: LogicalPoint;
    append: boolean;
  } | null>>;
  setNodeSelection: (nextIds: string[], primaryId?: string) => void;
  setSelectedEdgeKey: Dispatch<SetStateAction<string>>;
  setNodeStates: Dispatch<SetStateAction<Record<string, NodeRunState>>>;
  setStatus: (value: string) => void;
  applyGraphChange: (
    updater: (prev: GraphData) => GraphData,
    options?: { autoLayout?: boolean },
  ) => void;
  getNodeVisualSize: (nodeId: string) => NodeVisualSize;
};

export function useWorkflowGraphActions(params: UseWorkflowGraphActionsParams) {
  const {
    graph,
    canvasNodeIdSet,
    selectedNodeIds,
    getBoundedStageSize,
    canvasZoom,
    graphCanvasRef,
    graphClipboardRef,
    graphPasteSerialRef,
    connectFromNodeId,
    connectFromSide,
    setConnectFromNodeId,
    setConnectFromSide,
    setConnectPreviewStartPoint,
    setConnectPreviewPoint,
    setIsConnectingDrag,
    setMarqueeSelection,
    setNodeSelection,
    setSelectedEdgeKey,
    setNodeStates,
    setStatus,
    applyGraphChange,
    getNodeVisualSize,
  } = params;

  const getCanvasViewportCenterLogical = useCallback((): { x: number; y: number } | null => {
    return resolveCanvasViewportCenterLogical({ canvasZoom, graphCanvasRef });
  }, [canvasZoom, graphCanvasRef]);

  const addNode = useCallback(
    (type: NodeType) => {
      const center = getCanvasViewportCenterLogical();
      const fallbackIndex = graph.nodes.length;
      const boundedStage = getBoundedStageSize();
      const minX = -NODE_DRAG_MARGIN;
      const minY = (24 - GRAPH_STAGE_INSET_Y) / canvasZoom;
      const maxX = Math.max(minX, boundedStage.width - NODE_WIDTH + NODE_DRAG_MARGIN);
      const maxY = Math.max(minY, boundedStage.height - NODE_HEIGHT + NODE_DRAG_MARGIN);
      const baseX = center
        ? Math.round(center.x - NODE_WIDTH / 2)
        : 40 + (fallbackIndex % 4) * 280;
      const baseY = center
        ? Math.round(center.y - NODE_HEIGHT / 2)
        : 40 + Math.floor(fallbackIndex / 4) * 180;
      const node: GraphNode = {
        id: makeNodeId(type),
        type,
        position: {
          x: Math.min(maxX, Math.max(minX, baseX)),
          y: Math.min(maxY, Math.max(minY, baseY)),
        },
        config: defaultNodeConfig(type),
      };

      applyGraphChange((prev) => {
        return {
          ...prev,
          nodes: [...prev.nodes, node],
        };
      }, { autoLayout: true });

      setNodeSelection([node.id], node.id);
      setSelectedEdgeKey("");
    },
    [
      applyGraphChange,
      getBoundedStageSize,
      getCanvasViewportCenterLogical,
      graph.nodes.length,
      setNodeSelection,
      setSelectedEdgeKey,
    ],
  );

  const deleteNodes = useCallback(
    (nodeIds: string[]) => {
      const targets = nodeIds.filter((id, index, arr) => arr.indexOf(id) === index);
      if (targets.length === 0) {
        return;
      }
      const targetSet = new Set(targets);
      applyGraphChange((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => !targetSet.has(n.id)),
        edges: prev.edges.filter((e) => !targetSet.has(e.from.nodeId) && !targetSet.has(e.to.nodeId)),
      }), { autoLayout: true });
      setNodeSelection(selectedNodeIds.filter((id) => !targetSet.has(id)));
      setSelectedEdgeKey("");
      setNodeStates((prev) => {
        const next = { ...prev };
        for (const nodeId of targetSet) {
          delete next[nodeId];
        }
        return next;
      });
      if (connectFromNodeId && targetSet.has(connectFromNodeId)) {
        setConnectFromNodeId("");
        setConnectFromSide(null);
        setConnectPreviewStartPoint(null);
        setConnectPreviewPoint(null);
        setIsConnectingDrag(false);
        setMarqueeSelection(null);
      }
    },
    [
      applyGraphChange,
      connectFromNodeId,
      selectedNodeIds,
      setConnectFromNodeId,
      setConnectFromSide,
      setConnectPreviewPoint,
      setConnectPreviewStartPoint,
      setIsConnectingDrag,
      setMarqueeSelection,
      setNodeSelection,
      setNodeStates,
      setSelectedEdgeKey,
    ],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      deleteNodes([nodeId]);
    },
    [deleteNodes],
  );

  const hasUserTextSelection = useCallback((): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    return !selection.isCollapsed && selection.toString().trim().length > 0;
  }, []);

  const copySelectedNodesToClipboard = useCallback((): boolean => {
    const targetIds = selectedNodeIds.filter((id) => canvasNodeIdSet.has(id));
    if (targetIds.length === 0) {
      return false;
    }
    const targetSet = new Set(targetIds);
    const nodes = graph.nodes
      .filter((node) => targetSet.has(node.id))
      .map((node) => ({
        ...node,
        position: { ...node.position },
        config: JSON.parse(JSON.stringify(node.config ?? {})),
      }));
    const edges = graph.edges
      .filter((edge) => targetSet.has(edge.from.nodeId) && targetSet.has(edge.to.nodeId))
      .map((edge) => ({
        from: { ...edge.from },
        to: { ...edge.to },
        control: edge.control ? { ...edge.control } : undefined,
      }));

    graphClipboardRef.current = {
      nodes,
      edges,
      copiedAt: Date.now(),
    };
    setStatus(nodes.length > 1 ? `노드 ${nodes.length}개 복사됨` : "노드 복사됨");
    return true;
  }, [canvasNodeIdSet, graph.edges, graph.nodes, graphClipboardRef, selectedNodeIds, setStatus]);

  const pasteNodesFromClipboard = useCallback((): boolean => {
    const snapshot = graphClipboardRef.current;
    if (!snapshot || snapshot.nodes.length === 0) {
      return false;
    }

    const minX = -NODE_DRAG_MARGIN;
    const minY = (24 - GRAPH_STAGE_INSET_Y) / canvasZoom;
    const offsetStep = 48;
    graphPasteSerialRef.current += 1;
    const offset = graphPasteSerialRef.current * offsetStep;

    const idMap = new Map<string, string>();
    const pastedNodes: GraphNode[] = snapshot.nodes.map((node) => {
      const nextId = makeNodeId(node.type);
      idMap.set(node.id, nextId);
      return {
        ...node,
        id: nextId,
        position: {
          x: Math.max(minX, Math.round(node.position.x + offset)),
          y: Math.max(minY, Math.round(node.position.y + offset)),
        },
        config: JSON.parse(JSON.stringify(node.config ?? {})),
      };
    });

    const pastedEdges = snapshot.edges.reduce<GraphEdge[]>((acc, edge) => {
      const fromId = idMap.get(edge.from.nodeId);
      const toId = idMap.get(edge.to.nodeId);
      if (!fromId || !toId || fromId === toId) {
        return acc;
      }
      acc.push({
        from: { ...edge.from, nodeId: fromId },
        to: { ...edge.to, nodeId: toId },
        ...(edge.control
          ? { control: { ...edge.control, x: edge.control.x + offset, y: edge.control.y + offset } }
          : {}),
      });
      return acc;
    }, []);

    applyGraphChange((prev) => ({
      ...prev,
      nodes: [...prev.nodes, ...pastedNodes],
      edges: [...prev.edges, ...pastedEdges],
    }));

    const nextSelection = pastedNodes.map((node) => node.id);
    setNodeSelection(nextSelection, nextSelection[0]);
    setSelectedEdgeKey("");
    setStatus(pastedNodes.length > 1 ? `노드 ${pastedNodes.length}개 붙여넣기됨` : "노드 붙여넣기됨");
    return true;
  }, [applyGraphChange, graphClipboardRef, graphPasteSerialRef, setNodeSelection, setSelectedEdgeKey, setStatus]);

  const createEdgeConnection = useCallback(
    (
      fromNodeId: string,
      toNodeId: string,
      fromSide?: NodeAnchorSide,
      toSide?: NodeAnchorSide,
    ) => {
      if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
        return;
      }

      const reverseExistsNow = graph.edges.some(
        (edge) => edge.from.nodeId === toNodeId && edge.to.nodeId === fromNodeId,
      );
      if (reverseExistsNow) {
        setStatus("양방향 연결은 허용되지 않습니다.");
        return;
      }

      const fromNode = graph.nodes.find((node) => node.id === fromNodeId);
      const toNode = graph.nodes.find((node) => node.id === toNodeId);
      if (!fromNode || !toNode) {
        return;
      }

      const auto = getAutoConnectionSides(fromNode, toNode);
      const resolvedFromSide = fromSide ?? auto.fromSide;
      const resolvedToSide = toSide ?? auto.toSide;

      applyGraphChange((prev) => {
        const exists = prev.edges.some(
          (edge) => edge.from.nodeId === fromNodeId && edge.to.nodeId === toNodeId,
        );
        if (exists) {
          return prev;
        }
        const reverseExists = prev.edges.some(
          (edge) => edge.from.nodeId === toNodeId && edge.to.nodeId === fromNodeId,
        );
        if (reverseExists) {
          return prev;
        }
        const edge: GraphEdge = {
          from: { nodeId: fromNodeId, port: "out", side: resolvedFromSide },
          to: { nodeId: toNodeId, port: "in", side: resolvedToSide },
        };
        return arrangeGraphAfterEdgeConnect(
          { ...prev, edges: [...prev.edges, edge] },
          {
            fromNodeId,
            toNodeId,
            fromSide: resolvedFromSide,
            toSide: resolvedToSide,
          },
        );
      });
    },
    [applyGraphChange, graph.edges, graph.nodes, setStatus],
  );

  const onNodeAnchorDragStart = useCallback(
    (
      e: ReactMouseEvent<HTMLButtonElement>,
      nodeId: string,
      side: NodeAnchorSide,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const sourceNode = graph.nodes.find((node) => node.id === nodeId);
      if (!sourceNode) {
        return;
      }
      const point = getNodeAnchorPoint(sourceNode, side, getNodeVisualSize(sourceNode.id));
      setConnectFromNodeId(nodeId);
      setConnectFromSide(side);
      setConnectPreviewStartPoint(point);
      setConnectPreviewPoint(point);
      setIsConnectingDrag(true);
    },
    [
      getNodeVisualSize,
      graph.nodes,
      setConnectFromNodeId,
      setConnectFromSide,
      setConnectPreviewPoint,
      setConnectPreviewStartPoint,
      setIsConnectingDrag,
    ],
  );

  const onNodeAnchorDrop = useCallback(
    (
      e: ReactMouseEvent<HTMLButtonElement>,
      targetNodeId: string,
      targetSide: NodeAnchorSide,
    ) => {
      if (!connectFromNodeId) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      createEdgeConnection(connectFromNodeId, targetNodeId, connectFromSide ?? undefined, targetSide);
      setConnectFromNodeId("");
      setConnectFromSide(null);
      setConnectPreviewStartPoint(null);
      setConnectPreviewPoint(null);
      setIsConnectingDrag(false);
    },
    [
      connectFromNodeId,
      connectFromSide,
      createEdgeConnection,
      setConnectFromNodeId,
      setConnectFromSide,
      setConnectPreviewPoint,
      setConnectPreviewStartPoint,
      setIsConnectingDrag,
    ],
  );

  const onNodeConnectDrop = useCallback(
    (targetNodeId: string, targetSide?: NodeAnchorSide) => {
      if (!connectFromNodeId || connectFromNodeId === targetNodeId) {
        return;
      }
      createEdgeConnection(
        connectFromNodeId,
        targetNodeId,
        connectFromSide ?? undefined,
        targetSide,
      );
      setConnectFromNodeId("");
      setConnectFromSide(null);
      setConnectPreviewStartPoint(null);
      setConnectPreviewPoint(null);
      setIsConnectingDrag(false);
    },
    [
      connectFromNodeId,
      connectFromSide,
      createEdgeConnection,
      setConnectFromNodeId,
      setConnectFromSide,
      setConnectPreviewPoint,
      setConnectPreviewStartPoint,
      setIsConnectingDrag,
    ],
  );

  return {
    addNode,
    deleteNodes,
    deleteNode,
    hasUserTextSelection,
    copySelectedNodesToClipboard,
    pasteNodesFromClipboard,
    createEdgeConnection,
    onNodeAnchorDragStart,
    onNodeAnchorDrop,
    onNodeConnectDrop,
  };
}
