import { type Dispatch, type SetStateAction, useCallback } from "react";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import type { StudioRoleId } from "../../features/studio/handoffTypes";
import { toStudioRoleId } from "../../features/studio/roleUtils";
import { buildRoleNodeScaffold } from "../main/runtime/roleNodeScaffold";
import type { GraphData, GraphEdge, GraphNode } from "../../features/workflow/types";

type UseWorkflowRoleCollaborationParams = {
  graph: GraphData;
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
  setCanvasZoom: (updater: (prev: number) => number) => void;
  clampCanvasZoom: (next: number) => number;
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

export function useWorkflowRoleCollaboration(params: UseWorkflowRoleCollaborationParams) {
  const onAddRoleNode = useCallback(
    (roleId: StudioRoleId, includeResearch: boolean) => {
      const maxX = params.graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.x ?? 0)), 40);
      const maxY = params.graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.y ?? 0)), 40);
      const roleX = maxX + (includeResearch ? 820 : 320);
      const roleY = Math.max(60, maxY);
      const scaffold = buildRoleNodeScaffold({
        roleId,
        anchorX: roleX,
        anchorY: roleY,
        includeResearch,
      });
      const roleLabel = STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label ?? roleId;

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
    params.setExpandedRoleNodeIds((prev) =>
      prev.includes(normalizedNodeId) ? prev.filter((id) => id !== normalizedNodeId) : [...prev, normalizedNodeId],
    );
  }, [params]);

  const addRolePerspectivePass = useCallback(() => {
    if (!params.selectedNode || params.selectedNode.type !== "turn") {
      return;
    }
    const config = params.selectedNode.config as Record<string, unknown>;
    if (String(config.sourceKind ?? "").trim().toLowerCase() !== "handoff") {
      return;
    }
    const roleId = toStudioRoleId(String(config.handoffRoleId ?? ""));
    if (!roleId) {
      return;
    }
    const roleLabel = STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label ?? roleId;
    const altCount = params.graph.nodes.filter((node) => {
      const row = node.config as Record<string, unknown>;
      return (
        String(row.sourceKind ?? "").trim().toLowerCase() === "handoff" &&
        String(row.handoffRoleId ?? "") === roleId &&
        String(row.roleMode ?? "") === "perspective"
      );
    }).length;
    const scaffold = buildRoleNodeScaffold({
      roleId,
      anchorX: Number(params.selectedNode.position?.x ?? 0) + 420,
      anchorY: Number(params.selectedNode.position?.y ?? 0) + 180,
      includeResearch: true,
      roleInstanceId: `${roleId}:alt-${altCount + 1}`,
      roleInstanceLabel: `${roleLabel} · 추가 시각 ${altCount + 1}`,
      roleMode: "perspective",
      reviewPrompt: "기존 기본 시각과 다른 관점에서 우선순위, 리스크, 대안, 반박 포인트를 제시합니다.",
    });
    const clonedIncomingEdges = cloneIncomingExternalEdges({
      graph: params.graph,
      nodeId: params.selectedNode.id,
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
      message: `${roleLabel} 추가 시각 노드 생성`,
    });
    params.setStatus(`${roleLabel} 역할의 추가 시각 노드를 만들었습니다.`);
  }, [params]);

  const addRoleReviewPass = useCallback(() => {
    if (!params.selectedNode || params.selectedNode.type !== "turn") {
      return;
    }
    const config = params.selectedNode.config as Record<string, unknown>;
    if (String(config.sourceKind ?? "").trim().toLowerCase() !== "handoff") {
      return;
    }
    const roleId = toStudioRoleId(String(config.handoffRoleId ?? ""));
    if (!roleId) {
      return;
    }
    const roleLabel = STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label ?? roleId;
    const baseInstanceId = String(config.roleInstanceId ?? `${roleId}:primary`).trim();
    const scaffold = buildRoleNodeScaffold({
      roleId,
      anchorX: Number(params.selectedNode.position?.x ?? 0) + 420,
      anchorY: Number(params.selectedNode.position?.y ?? 0),
      includeResearch: false,
      roleInstanceId: baseInstanceId,
      roleInstanceLabel: `${roleLabel} · 재검토`,
      roleMode: "review",
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
            from: { nodeId: params.selectedNode!.id, port: "out" as const },
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
      message: `${roleLabel} 재검토 패스 생성`,
    });
    params.setStatus(`${roleLabel} 역할의 재검토 패스를 추가했습니다.`);
  }, [params]);

  return {
    onAddRoleNode,
    toggleRoleInternalExpanded,
    addRolePerspectivePass,
    addRoleReviewPass,
  };
}
