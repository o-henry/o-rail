import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import { cloneAdaptiveRoleTemplate } from "../adaptation/defaults";
import type { AdaptiveChampionRecord } from "../adaptation/types";
import { resolvePmPlanningMode, resolveStudioRoleDisplayLabel } from "../../features/studio/pmPlanningMode";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import type { StudioRoleId } from "../../features/studio/handoffTypes";
import { toStudioRoleId } from "../../features/studio/roleUtils";
import { arrangeExpandedRoleInternalNodes } from "../../features/workflow/graph-utils";
import { buildRoleNodeScaffold } from "../main/runtime/roleNodeScaffold";
import type { GraphData, GraphEdge, GraphNode } from "../../features/workflow/types";
import { GRAPH_STAGE_INSET_X, GRAPH_STAGE_INSET_Y, NODE_HEIGHT, NODE_WIDTH } from "../main";
import { computeCanvasRevealViewport } from "../main/canvas/canvasRevealViewport";
import { getCanvasViewportCenterLogical } from "../main/canvas/canvasViewport";

type UseWorkflowRoleCollaborationParams = {
  graph: GraphData;
  canvasNodeIdSet: Set<string>;
  selectedNode: GraphNode | null;
  expandedRoleNodeIds: string[];
  setExpandedRoleNodeIds: Dispatch<SetStateAction<string[]>>;
  applyGraphChange: (
    updater: (prev: GraphData) => GraphData,
    options?: { autoLayout?: boolean },
  ) => void;
  setNodeSelection: (nodeIds: string[], focusedNodeId?: string) => void;
  appendWorkspaceEvent: (event: {
    source: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    message: string;
  }) => void;
  setStatus: (message: string) => void;
  canvasZoom: number;
  graphCanvasRef: RefObject<HTMLDivElement | null>;
  setCanvasZoom: (updater: (prev: number) => number) => void;
  clampCanvasZoom: (next: number) => number;
  resolveAdaptiveRoleChampion: (family: string) => AdaptiveChampionRecord | null;
};

function cloneIncomingExternalEdges(params: {
  graph: GraphData;
  nodeId: string;
  nextNodeId: string;
}): GraphEdge[] {
  return params.graph.edges
    .filter((edge) => edge.to.nodeId === params.nodeId)
    .filter((edge) => {
      const sourceNode = params.graph.nodes.find((node) => node.id === edge.from.nodeId);
      const sourceConfig = (sourceNode?.config ?? {}) as Record<string, unknown>;
      return !String(sourceConfig.internalParentNodeId ?? "").trim();
    })
    .map((edge) => ({
      ...edge,
      to: { ...edge.to, nodeId: params.nextNodeId },
    }));
}

function focusExpandedRoleNodes(params: {
  graph: GraphData;
  nodeId: string;
  graphCanvasRef: RefObject<HTMLDivElement | null>;
  canvasZoom: number;
  setCanvasZoom: (updater: (prev: number) => number) => void;
  clampCanvasZoom: (next: number) => number;
}) {
  const canvas = params.graphCanvasRef.current;
  if (!canvas) {
    return;
  }
  const focusNodes = params.graph.nodes.filter((node) => {
    const config = (node.config ?? {}) as Record<string, unknown>;
    return node.id === params.nodeId || String(config.internalParentNodeId ?? "").trim() === params.nodeId;
  });
  if (focusNodes.length === 0) {
    return;
  }

  const bounds = focusNodes.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, Number(node.position?.x ?? 0)),
      minY: Math.min(acc.minY, Number(node.position?.y ?? 0)),
      maxX: Math.max(acc.maxX, Number(node.position?.x ?? 0) + NODE_WIDTH),
      maxY: Math.max(acc.maxY, Number(node.position?.y ?? 0) + NODE_HEIGHT),
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 },
  );
  const reveal = computeCanvasRevealViewport({
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight,
    currentZoom: params.canvasZoom,
    bounds,
    stageInsetX: GRAPH_STAGE_INSET_X,
    stageInsetY: GRAPH_STAGE_INSET_Y,
  });
  const nextZoom = params.clampCanvasZoom(reveal.zoom);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  params.setCanvasZoom(() => nextZoom);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const currentCanvas = params.graphCanvasRef.current;
      if (!currentCanvas) {
        return;
      }
      currentCanvas.scrollLeft = Math.max(
        0,
        centerX * nextZoom + GRAPH_STAGE_INSET_X - currentCanvas.clientWidth / 2,
      );
      currentCanvas.scrollTop = Math.max(
        0,
        centerY * nextZoom + GRAPH_STAGE_INSET_Y - currentCanvas.clientHeight / 2,
      );
    });
  });
}

export function useWorkflowRoleCollaboration(params: UseWorkflowRoleCollaborationParams) {
  const resolveRoleNodeTarget = useCallback((nodeId?: string) => {
    const normalizedNodeId = String(nodeId ?? "").trim();
    const targetNode = normalizedNodeId
      ? params.graph.nodes.find((node) => node.id === normalizedNodeId)
      : params.selectedNode;
    if (!targetNode || targetNode.type !== "turn") {
      return null;
    }
    const config = targetNode.config as Record<string, unknown>;
    if (String(config.sourceKind ?? "").trim().toLowerCase() !== "handoff") {
      return null;
    }
    const roleId = toStudioRoleId(String(config.handoffRoleId ?? ""));
    if (!roleId) {
      return null;
    }
    const roleLabel = resolveStudioRoleDisplayLabel(roleId, config.pmPlanningMode)
      || STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label
      || roleId;
    return {
      node: targetNode,
      config,
      roleId,
      roleLabel,
      roleExecutionMode: resolvePmPlanningMode(roleId, config.pmPlanningMode) ?? undefined,
    };
  }, [params.graph.nodes, params.selectedNode]);

  const onAddRoleNode = useCallback(
    (roleId: StudioRoleId, includeResearch: boolean) => {
      const center = getCanvasViewportCenterLogical({
        canvasZoom: params.canvasZoom,
        graphCanvasRef: params.graphCanvasRef,
      });
      const maxX = params.graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.x ?? 0)), 40);
      const maxY = params.graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.y ?? 0)), 40);
      const roleX = center ? Math.round(center.x - NODE_WIDTH / 2) : maxX + (includeResearch ? 820 : 320);
      const roleY = center ? Math.max(40, Math.round(center.y - NODE_HEIGHT / 2)) : Math.max(60, maxY);
      const roleLabel = STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label ?? roleId;
      const scaffold =
        cloneAdaptiveRoleTemplate({
          champion: params.resolveAdaptiveRoleChampion(`role:${roleId}`),
          roleId,
          anchorX: roleX,
          anchorY: roleY,
          roleInstanceId: `${roleId}:primary`,
          roleInstanceLabel: roleLabel,
        }) ??
        buildRoleNodeScaffold({
          roleId,
          anchorX: roleX,
          anchorY: roleY,
          includeResearch,
        });

      params.applyGraphChange(
        (prev) => ({
          ...prev,
          nodes: [...prev.nodes, ...scaffold.nodes],
          edges: [...prev.edges, ...scaffold.edges],
        }),
        { autoLayout: false },
      );
      params.setNodeSelection([scaffold.roleNodeId], scaffold.roleNodeId);
      params.appendWorkspaceEvent({
        source: "workflow",
        message: includeResearch
          ? `역할 노드 추가: ${roleLabel} + 자동 리서치`
          : `역할 노드 추가: ${roleLabel}`,
        actor: "user",
        level: "info",
      });
      params.setStatus(
        includeResearch
          ? `${roleLabel} 역할 노드와 자동 리서치 그래프를 추가했습니다.`
          : `${roleLabel} 역할 노드를 추가했습니다.`,
      );
      params.setCanvasZoom((prev) => params.clampCanvasZoom(Math.min(prev, 0.88)));
    },
    [params],
  );

  const toggleRoleInternalExpanded = useCallback((nodeId: string) => {
    const normalizedNodeId = String(nodeId ?? "").trim();
    if (!normalizedNodeId) {
      return;
    }
    const isExpanding = !params.expandedRoleNodeIds.includes(normalizedNodeId);
    let arrangedGraph: GraphData | null = null;
    if (isExpanding) {
      params.applyGraphChange((prev) => {
        const next = arrangeExpandedRoleInternalNodes(prev, normalizedNodeId, params.canvasNodeIdSet);
        arrangedGraph = next;
        return next;
      });
    }
    params.setExpandedRoleNodeIds((prev) =>
      prev.includes(normalizedNodeId) ? prev.filter((id) => id !== normalizedNodeId) : [...prev, normalizedNodeId],
    );
    if (isExpanding && arrangedGraph) {
      requestAnimationFrame(() => {
        focusExpandedRoleNodes({
          graph: arrangedGraph as GraphData,
          nodeId: normalizedNodeId,
          graphCanvasRef: params.graphCanvasRef,
          canvasZoom: params.canvasZoom,
          setCanvasZoom: params.setCanvasZoom,
          clampCanvasZoom: params.clampCanvasZoom,
        });
      });
    }
  }, [params]);

  const addRolePerspectivePassForNode = useCallback((nodeId?: string) => {
    const target = resolveRoleNodeTarget(nodeId);
    if (!target) {
      return;
    }
    const altCount = params.graph.nodes.filter((node) => {
      const row = node.config as Record<string, unknown>;
      return (
        String(row.sourceKind ?? "").trim().toLowerCase() === "handoff" &&
        String(row.handoffRoleId ?? "") === target.roleId &&
        String(row.roleMode ?? "") === "perspective"
      );
    }).length;
    const scaffold = buildRoleNodeScaffold({
      roleId: target.roleId,
      anchorX: Number(target.node.position?.x ?? 0) + 420,
      anchorY: Number(target.node.position?.y ?? 0) + 180,
      includeResearch: true,
      roleInstanceId: `${target.roleId}:alt-${altCount + 1}`,
      roleInstanceLabel: `${target.roleLabel} · 추가 시각 ${altCount + 1}`,
      roleMode: "perspective",
      pmPlanningMode: target.roleExecutionMode,
      reviewPrompt: "기존 기본 시각과 다른 관점에서 우선순위, 리스크, 대안, 반박 포인트를 제시합니다.",
    });
    const clonedIncomingEdges = cloneIncomingExternalEdges({
      graph: params.graph,
      nodeId: target.node.id,
      nextNodeId: scaffold.roleNodeId,
    });

    params.applyGraphChange(
      (prev) => ({
        ...prev,
        nodes: [...prev.nodes, ...scaffold.nodes],
        edges: [...prev.edges, ...clonedIncomingEdges, ...scaffold.edges],
      }),
      { autoLayout: false },
    );
    params.setExpandedRoleNodeIds((prev) => [...new Set([...prev, scaffold.roleNodeId])]);
    params.setNodeSelection([scaffold.roleNodeId], scaffold.roleNodeId);
    params.appendWorkspaceEvent({
      source: "workflow",
      actor: "user",
      level: "info",
      message: `${target.roleLabel} 추가 시각 노드 생성`,
    });
    params.setStatus(`${target.roleLabel} 역할의 추가 시각 노드를 만들었습니다.`);
  }, [params, resolveRoleNodeTarget]);

  const addRolePerspectivePass = useCallback(() => {
    addRolePerspectivePassForNode(params.selectedNode?.id);
  }, [addRolePerspectivePassForNode, params.selectedNode?.id]);

  const addRoleReviewPassForNode = useCallback((nodeId?: string) => {
    const target = resolveRoleNodeTarget(nodeId);
    if (!target) {
      return;
    }
    const baseInstanceId = String(target.config.roleInstanceId ?? `${target.roleId}:primary`).trim();
    const scaffold = buildRoleNodeScaffold({
      roleId: target.roleId,
      anchorX: Number(target.node.position?.x ?? 0) + 420,
      anchorY: Number(target.node.position?.y ?? 0),
      includeResearch: false,
      roleInstanceId: baseInstanceId,
      roleInstanceLabel: `${target.roleLabel} · 재검토`,
      roleMode: "review",
      pmPlanningMode: target.roleExecutionMode,
      reviewPrompt:
        "이전 역할 산출물을 비판적으로 재검토하고, 다른 역할의 피드백과 충돌 지점을 반영해 수정된 판단, 남는 리스크, 다음 handoff를 정리합니다.",
    });
    params.applyGraphChange(
      (prev) => ({
        ...prev,
        nodes: [...prev.nodes, ...scaffold.nodes],
        edges: [
          ...prev.edges,
          {
            from: { nodeId: target.node.id, port: "out" as const },
            to: { nodeId: scaffold.roleNodeId, port: "in" as const },
          },
        ],
      }),
      { autoLayout: false },
    );
    params.setNodeSelection([scaffold.roleNodeId], scaffold.roleNodeId);
    params.appendWorkspaceEvent({
      source: "workflow",
      actor: "user",
      level: "info",
      message: `${target.roleLabel} 재검토 패스 생성`,
    });
    params.setStatus(`${target.roleLabel} 역할의 재검토 패스를 추가했습니다.`);
  }, [params, resolveRoleNodeTarget]);

  const addRoleReviewPass = useCallback(() => {
    addRoleReviewPassForNode(params.selectedNode?.id);
  }, [addRoleReviewPassForNode, params.selectedNode?.id]);

  return {
    onAddRoleNode,
    toggleRoleInternalExpanded,
    addRolePerspectivePass,
    addRolePerspectivePassForNode,
    addRoleReviewPass,
    addRoleReviewPassForNode,
  };
}
