import { useCallback } from "react";
import type { AgentQuickActionRequest } from "../../../pages/agents/agentTypes";
import { DEFAULT_TURN_MODEL, type TurnExecutor } from "../../../features/workflow/domain";
import type { GraphNode } from "../../../features/workflow/types";
import { DEFAULT_TURN_REASONING_LEVEL, normalizeTurnReasoningLevel } from "../../../features/workflow/reasoningLevels";

type Params = {
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
  }) => void;
  graphNodes: GraphNode[];
  selectedNodeIds: string[];
  setStatus: (message: string) => void;
  setWorkflowQuestion: (value: string) => void;
  setWorkspaceTab: (tab: "workflow") => void;
  updateNodeConfigById: (nodeId: string, key: string, value: unknown) => void;
};

export function useTurnModelSelectionActions(params: Params) {
  const {
    appendWorkspaceEvent,
    graphNodes,
    selectedNodeIds,
    setStatus,
    setWorkflowQuestion,
    setWorkspaceTab,
    updateNodeConfigById,
  } = params;

  const applyTurnExecutionFromModelSelection = useCallback(
    (selection: {
      executor: TurnExecutor;
      turnModel?: string;
      reasoningLevel?: string;
      modelLabel: string;
      sourceLabel: string;
    }) => {
      const selectedTurnNodeIds = graphNodes
        .filter((node) => node.type === "turn" && selectedNodeIds.includes(node.id))
        .map((node) => node.id);
      const fallbackTurnNodeId = graphNodes.find((node) => node.type === "turn")?.id;
      const targetTurnNodeIds = selectedTurnNodeIds.length > 0 ? selectedTurnNodeIds : fallbackTurnNodeId ? [fallbackTurnNodeId] : [];

      if (targetTurnNodeIds.length === 0) {
        setStatus(`${selection.sourceLabel}: 적용할 턴 노드가 없습니다.`);
        return;
      }

      for (const nodeId of targetTurnNodeIds) {
        updateNodeConfigById(nodeId, "executor", selection.executor);
        if (selection.executor === "codex") {
          updateNodeConfigById(nodeId, "model", selection.turnModel ?? DEFAULT_TURN_MODEL);
          updateNodeConfigById(
            nodeId,
            "reasoningLevel",
            normalizeTurnReasoningLevel(selection.reasoningLevel ?? DEFAULT_TURN_REASONING_LEVEL),
          );
        } else {
          updateNodeConfigById(nodeId, "webResultMode", "bridgeAssisted");
        }
      }

      const targetLabel = targetTurnNodeIds.length > 1 ? `${targetTurnNodeIds.length}개 턴` : targetTurnNodeIds[0];
      setStatus(`${selection.sourceLabel}: ${targetLabel} 실행 모델을 ${selection.modelLabel}로 설정했습니다.`);
    },
    [graphNodes, selectedNodeIds, setStatus, updateNodeConfigById],
  );

  const onAgentQuickAction = useCallback((request: AgentQuickActionRequest) => {
    const ragSourceCount = request.selectedDataSourceIds?.length ?? 0;
    appendWorkspaceEvent({
      source: "agents",
      message:
        ragSourceCount > 0
          ? `에이전트 요청 전송: ${request.modelLabel} (RAG ${ragSourceCount}개)`
          : `에이전트 요청 전송: ${request.modelLabel}`,
      actor: "user",
      level: "info",
    });
    applyTurnExecutionFromModelSelection({
      executor: request.executor,
      turnModel: request.turnModel,
      reasoningLevel: DEFAULT_TURN_REASONING_LEVEL,
      modelLabel: request.modelLabel,
      sourceLabel: "에이전트",
    });
    setWorkflowQuestion(request.prompt);
    setWorkspaceTab("workflow");
  }, [appendWorkspaceEvent, applyTurnExecutionFromModelSelection, setWorkflowQuestion, setWorkspaceTab]);

  return {
    applyTurnExecutionFromModelSelection,
    onAgentQuickAction,
  };
}
