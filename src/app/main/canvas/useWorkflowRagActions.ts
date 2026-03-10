import { useCallback } from "react";
import type { RefObject } from "react";
import { connectViaDefaultEdges, countViaNodesByType, insertMissingViaTemplateNodes, VIA_NODE_BASE_POSITION_BY_TYPE } from "../../../features/workflow/viaGraphBuilder";
import { RAG_TEMPLATE_NODE_TYPES, RAG_TEMPLATE_OPTIONS, type RagTemplateId } from "../../../features/workflow/ragTemplates";
import { viaNodeLabel, type ViaNodeType } from "../../../features/workflow/viaCatalog";
import { defaultNodeConfig, makeNodeId } from "../../../features/workflow/graph-utils";
import type { GraphNode } from "../../../features/workflow/types";
import type { WorkflowGraphViewMode } from "../../../features/workflow/viaGraph";
import { NODE_HEIGHT, NODE_WIDTH } from "../../main";
import { getCanvasViewportCenterLogical } from "./canvasViewport";

type Params = {
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
  }) => void;
  applyGraphChange: (updater: (prev: any) => any) => void;
  clampCanvasZoom: (value: number) => number;
  canvasZoom: number;
  graphNodes: GraphNode[];
  graphCanvasRef: RefObject<HTMLDivElement | null>;
  setCanvasZoom: React.Dispatch<React.SetStateAction<number>>;
  setNodeSelection: (nodeIds: string[], primaryNodeId?: string) => void;
  setStatus: (message: string) => void;
  setWorkflowGraphViewMode: React.Dispatch<React.SetStateAction<WorkflowGraphViewMode>>;
  updateNodeConfigById: (nodeId: string, key: string, value: unknown) => void;
  workflowGraphViewMode: WorkflowGraphViewMode;
};

export function useWorkflowRagActions(params: Params) {
  const {
    appendWorkspaceEvent,
    applyGraphChange,
    clampCanvasZoom,
    canvasZoom,
    graphNodes,
    graphCanvasRef,
    setCanvasZoom,
    setNodeSelection,
    setStatus,
    setWorkflowGraphViewMode,
    updateNodeConfigById,
    workflowGraphViewMode,
  } = params;

  const onAddCrawlerNode = useCallback(() => {
    const nodeId = makeNodeId("turn");
    const center = getCanvasViewportCenterLogical({ canvasZoom, graphCanvasRef });
    const maxX = graphNodes.reduce((max, node) => Math.max(max, Number(node.position?.x ?? 0)), 40);
    const maxY = graphNodes.reduce((max, node) => Math.max(max, Number(node.position?.y ?? 0)), 40);
    const nextNode: GraphNode = {
      id: nodeId,
      type: "turn",
      position: {
        x: center ? Math.round(center.x - NODE_WIDTH / 2) : maxX + 300,
        y: center ? Math.round(center.y - NODE_HEIGHT / 2) : Math.max(40, maxY),
      },
      config: {
        ...defaultNodeConfig("turn"),
        executor: "web_grok",
        role: "DATA NODE AGENT",
        promptTemplate:
          "최신/실시간 웹 자료를 조사해 핵심 근거를 구조화하고, 바로 개발 의사결정에 쓸 수 있게 요약해줘.",
        qualityProfile: "research_evidence",
        artifactType: "EvidenceArtifact",
        sourceKind: "data_research",
      },
    };
    applyGraphChange((prev) => ({
      ...prev,
      nodes: [...prev.nodes, nextNode],
    }));
    setNodeSelection([nodeId], nodeId);
    appendWorkspaceEvent({
      source: "workflow",
      message: "데이터 노드 추가",
      actor: "user",
      level: "info",
    });
    setStatus("그래프에 데이터 노드를 추가했습니다.");
    setCanvasZoom((prev) => clampCanvasZoom(Math.min(prev, 0.88)));
  }, [appendWorkspaceEvent, applyGraphChange, canvasZoom, clampCanvasZoom, graphCanvasRef, graphNodes, setCanvasZoom, setNodeSelection, setStatus]);

  const buildViaFlowNode = useCallback((
    nodeId: string,
    viaNodeType: ViaNodeType,
    sameTypeCount: number,
    layoutMode: "default" | "compact" = "default",
    sourceTypeHint = "",
    templateLabel = "",
  ): GraphNode => {
    const basePosition = VIA_NODE_BASE_POSITION_BY_TYPE[viaNodeType] ?? { x: 300, y: 120 };
    const position =
      layoutMode === "compact"
        ? {
            x: Math.round(basePosition.x * 0.62 + 32 + sameTypeCount * 16),
            y: Math.round(basePosition.y * 0.62 + 28 + sameTypeCount * 30),
          }
        : {
            x: basePosition.x + sameTypeCount * 24,
            y: basePosition.y + sameTypeCount * 48,
          };
    return {
      id: nodeId,
      type: "turn",
      position,
      config: {
        ...defaultNodeConfig("turn"),
        executor: "via_flow",
        role: `${viaNodeLabel(viaNodeType)} NODE`,
        promptTemplate: `VIA ${viaNodeType} 단계 실행`,
        qualityProfile: "research_evidence",
        artifactType: "EvidenceArtifact",
        sourceKind: "data_pipeline",
        viaFlowId: "1",
        viaNodeType,
        viaNodeLabel: viaNodeLabel(viaNodeType),
        viaSourceTypeHint: sourceTypeHint,
        viaTemplateLabel: templateLabel || undefined,
        viaCustomKeywords: "",
        viaCustomCountries: "",
        viaCustomSites: "",
        viaCustomMaxItems: 24,
      },
    };
  }, []);

  const onAddViaFlowNode = useCallback((viaNodeType: ViaNodeType) => {
    const nodeId = makeNodeId("turn");
    const sourceTypeHint = viaNodeType.startsWith("source.") ? viaNodeType : "";
    const center = getCanvasViewportCenterLogical({ canvasZoom, graphCanvasRef });
    applyGraphChange((prev) => {
      const sameTypeCount = countViaNodesByType(prev.nodes, viaNodeType);
      const nextNode = buildViaFlowNode(nodeId, viaNodeType, sameTypeCount, "default", sourceTypeHint);
      if (center) {
        nextNode.position = {
          x: Math.round(center.x - NODE_WIDTH / 2),
          y: Math.round(center.y - NODE_HEIGHT / 2),
        };
      }
      const nextNodes = [...prev.nodes, nextNode];
      const nextEdges = connectViaDefaultEdges({
        nodes: nextNodes,
        edges: prev.edges,
        insertedNodeId: nodeId,
        insertedNodeType: viaNodeType,
      });
      return {
        ...prev,
        nodes: nextNodes,
        edges: nextEdges,
      };
    });
    setNodeSelection([nodeId], nodeId);
    appendWorkspaceEvent({
      source: "workflow",
      message: `${viaNodeLabel(viaNodeType)} 노드 추가`,
      actor: "user",
      level: "info",
    });
    setStatus(`RAG 그래프에 ${viaNodeLabel(viaNodeType)} 노드를 추가했습니다.`);
  }, [appendWorkspaceEvent, applyGraphChange, buildViaFlowNode, canvasZoom, graphCanvasRef, setNodeSelection, setStatus]);

  const onApplyRagTemplate = useCallback((templateIdRaw: string) => {
    const templateId = String(templateIdRaw ?? "").trim() as RagTemplateId;
    const templateNodeTypes = RAG_TEMPLATE_NODE_TYPES[templateId];
    if (!templateNodeTypes) {
      return;
    }
    const templateLabel =
      RAG_TEMPLATE_OPTIONS.find((option) => option.value === templateId)?.label ?? templateId;
    const templateSourceTypeHint = templateNodeTypes.find((type) => type.startsWith("source.")) ?? "";
    const insertedNodeIds: string[] = [];
    applyGraphChange((prev) => {
      const inserted = insertMissingViaTemplateNodes({
        nodes: prev.nodes,
        edges: prev.edges,
        templateNodeTypes,
        createNode: (nodeType, sameTypeCount) =>
          buildViaFlowNode(
            makeNodeId("turn"),
            nodeType,
            sameTypeCount,
            "compact",
            templateSourceTypeHint,
            templateLabel,
          ),
      });
      insertedNodeIds.push(...inserted.insertedNodeIds);
      return { ...prev, nodes: inserted.nodes, edges: inserted.edges };
    });

    if (insertedNodeIds.length > 0) {
      const focusNodeId = insertedNodeIds[insertedNodeIds.length - 1];
      setNodeSelection([focusNodeId], focusNodeId);
      appendWorkspaceEvent({ source: "workflow", message: `RAG 템플릿 적용: ${templateId}`, actor: "user", level: "info" });
      setStatus(`RAG 템플릿을 적용했습니다. 노드 ${insertedNodeIds.length}개를 추가했습니다.`);
      return;
    }

    setStatus("선택한 템플릿의 노드는 이미 모두 추가되어 있습니다.");
  }, [appendWorkspaceEvent, applyGraphChange, buildViaFlowNode, setNodeSelection, setStatus]);

  const onSelectRagModeNode = useCallback((nodeId: string) => {
    const normalizedNodeId = String(nodeId ?? "").trim();
    if (!normalizedNodeId) {
      return;
    }
    setNodeSelection([normalizedNodeId], normalizedNodeId);
  }, [setNodeSelection]);

  const onUpdateRagModeFlowId = useCallback((nodeId: string, nextFlowId: string) => {
    const normalizedNodeId = String(nodeId ?? "").trim();
    if (!normalizedNodeId) {
      return;
    }
    const numericOnly = String(nextFlowId ?? "").replace(/[^\d]/g, "");
    updateNodeConfigById(normalizedNodeId, "viaFlowId", numericOnly);
  }, [updateNodeConfigById]);

  const onUpdateRagSourceOptions = useCallback((
    nodeId: string,
    patch: {
      viaCustomKeywords?: string;
      viaCustomCountries?: string;
      viaCustomSites?: string;
      viaCustomMaxItems?: number;
    },
  ) => {
    const normalizedNodeId = String(nodeId ?? "").trim();
    if (!normalizedNodeId) {
      return;
    }
    if (typeof patch.viaCustomKeywords === "string") {
      updateNodeConfigById(normalizedNodeId, "viaCustomKeywords", patch.viaCustomKeywords);
    }
    if (typeof patch.viaCustomCountries === "string") {
      updateNodeConfigById(normalizedNodeId, "viaCustomCountries", patch.viaCustomCountries);
    }
    if (typeof patch.viaCustomSites === "string") {
      updateNodeConfigById(normalizedNodeId, "viaCustomSites", patch.viaCustomSites);
    }
    if (typeof patch.viaCustomMaxItems === "number" && Number.isFinite(patch.viaCustomMaxItems)) {
      updateNodeConfigById(normalizedNodeId, "viaCustomMaxItems", Math.max(1, Math.floor(patch.viaCustomMaxItems)));
    }
  }, [updateNodeConfigById]);

  const onSetGraphViewMode = useCallback((nextMode: WorkflowGraphViewMode) => {
    if (nextMode === workflowGraphViewMode) {
      return;
    }
    setWorkflowGraphViewMode(nextMode);
    appendWorkspaceEvent({
      source: "workflow",
      message: nextMode === "rag" ? "RAG 모드 전환" : "DAG 모드 전환",
      actor: "user",
      level: "info",
    });
    setStatus(
      nextMode === "rag"
        ? "RAG 모드로 전환했습니다. RAG 전용 그래프와 메뉴를 표시합니다."
        : "DAG 모드로 전환했습니다.",
    );
  }, [appendWorkspaceEvent, setStatus, setWorkflowGraphViewMode, workflowGraphViewMode]);

  return {
    onAddCrawlerNode,
    onAddViaFlowNode,
    onApplyRagTemplate,
    onSelectRagModeNode,
    onSetGraphViewMode,
    onUpdateRagModeFlowId,
    onUpdateRagSourceOptions,
  };
}
