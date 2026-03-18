import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getGraphEdgeKey } from "../../features/workflow/graph-utils";
import type { GraphData, GraphNode } from "../../features/workflow/types";
import { isEditableTarget } from "../mainAppUtils";
import type { CanvasDisplayEdge } from "../main";
import type { WorkspaceTab } from "../mainAppGraphHelpers";

type UseWorkflowShortcutsParams = {
  workspaceTab: WorkspaceTab;
  setWorkspaceTab: Dispatch<SetStateAction<WorkspaceTab>>;
  setStatus: (value: string) => void;
  canvasFullscreen: boolean;
  setCanvasFullscreen: Dispatch<SetStateAction<boolean>>;
  selectedNodeId: string;
  selectedNodeIds: string[];
  canvasNodes: GraphNode[];
  canvasNodeIdSet: Set<string>;
  canvasDisplayEdges: CanvasDisplayEdge[];
  selectedEdgeKey: string;
  setSelectedEdgeKey: Dispatch<SetStateAction<string>>;
  setNodeSelection: (nextIds: string[], primaryId?: string) => void;
  applyGraphChange: (
    updater: (prev: GraphData) => GraphData,
    options?: { autoLayout?: boolean },
  ) => void;
  deleteNodes: (nodeIds: string[]) => void;
  copySelectedNodesToClipboard: () => boolean;
  pasteNodesFromClipboard: () => boolean;
  hasUserTextSelection: () => boolean;
  setPanMode: Dispatch<SetStateAction<boolean>>;
  graph: GraphData;
};

export function useWorkflowShortcuts(params: UseWorkflowShortcutsParams) {
  const {
    workspaceTab,
    setWorkspaceTab,
    setStatus,
    canvasFullscreen,
    setCanvasFullscreen,
    selectedNodeId,
    selectedNodeIds,
    canvasNodes,
    canvasNodeIdSet,
    canvasDisplayEdges,
    selectedEdgeKey,
    setSelectedEdgeKey,
    setNodeSelection,
    applyGraphChange,
    deleteNodes,
    copySelectedNodesToClipboard,
    pasteNodesFromClipboard,
    hasUserTextSelection,
    setPanMode,
    graph,
  } = params;

  useEffect(() => {
    if (workspaceTab !== "workflow" && canvasFullscreen) {
      setCanvasFullscreen(false);
    }
  }, [canvasFullscreen, setCanvasFullscreen, workspaceTab]);

  useEffect(() => {
    const tabHotkeys: Record<string, WorkspaceTab> = {
      "1": "tasks",
      "2": "workflow",
      "3": "knowledge",
      "4": "adaptation",
      "5": "settings",
    };
    const tabStatusByKey: Record<WorkspaceTab, string> = {
      workbench: "그래프 탭으로 이동",
      dashboard: "홈 탭으로 이동",
      intelligence: "대시보드 인텔리전스 탭으로 이동",
      agents: "에이전트 탭으로 이동",
      workflow: "워크플로우 탭으로 이동",
      tasks: "TASKS 탭으로 이동",
      feed: "피드 탭으로 이동",
      handoff: "그래프 탭으로 이동",
      knowledge: "데이터베이스 탭으로 이동",
      adaptation: "개선 탭으로 이동",
      settings: "설정 탭으로 이동",
      bridge: "설정 탭으로 이동",
    };

    const onTabHotkey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const nextTab = tabHotkeys[event.key];
      if (!nextTab) {
        return;
      }

      event.preventDefault();
      setWorkspaceTab(nextTab);
      setStatus(tabStatusByKey[nextTab]);
    };

    window.addEventListener("keydown", onTabHotkey);
    return () => window.removeEventListener("keydown", onTabHotkey);
  }, [setStatus, setWorkspaceTab]);

  useEffect(() => {
    if (!canvasFullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCanvasFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasFullscreen, setCanvasFullscreen]);

  useEffect(() => {
    if (workspaceTab !== "workflow") {
      return;
    }
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const keyLower = event.key.toLowerCase();
      const isPanToggleKey = keyLower === "h" || event.key === "ㅗ" || event.code === "KeyH";
      if (!isPanToggleKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setPanMode((prev) => {
        const next = !prev;
        setStatus(next ? "캔버스 이동 모드 켜짐 (H/ㅗ)" : "캔버스 이동 모드 꺼짐 (H/ㅗ)");
        return next;
      });
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [setPanMode, setStatus, workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== "workflow") {
      return;
    }

    const onShiftAlign = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key !== "Shift") {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (!selectedNodeId) {
        return;
      }
      const current = canvasNodes.find((node) => node.id === selectedNodeId);
      if (!current) {
        return;
      }
      const others = canvasNodes.filter((node) => node.id !== selectedNodeId);
      if (others.length === 0) {
        return;
      }

      let nearest: GraphNode | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of others) {
        const dx = candidate.position.x - current.position.x;
        const dy = candidate.position.y - current.position.y;
        const distance = Math.hypot(dx, dy);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = candidate;
        }
      }

      if (!nearest) {
        return;
      }

      event.preventDefault();
      const alignByX =
        Math.abs(nearest.position.x - current.position.x) <= Math.abs(nearest.position.y - current.position.y);
      applyGraphChange((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id !== selectedNodeId) {
            return node;
          }
          return {
            ...node,
            position: {
              x: alignByX ? nearest.position.x : node.position.x,
              y: alignByX ? node.position.y : nearest.position.y,
            },
          };
        }),
      }));
      setStatus(alignByX ? "노드 X축 자동 정렬됨 (Shift)" : "노드 Y축 자동 정렬됨 (Shift)");
    };

    window.addEventListener("keydown", onShiftAlign);
    return () => window.removeEventListener("keydown", onShiftAlign);
  }, [applyGraphChange, canvasNodes, selectedNodeId, setStatus, workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== "workflow") {
      return;
    }
    const onSelectAll = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== "a") {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      const allNodeIds = canvasNodes.map((node) => node.id);
      setNodeSelection(allNodeIds, allNodeIds[0]);
      setSelectedEdgeKey("");
      setStatus(allNodeIds.length > 0 ? `노드 ${allNodeIds.length}개 선택됨` : "선택할 노드가 없습니다");
    };
    window.addEventListener("keydown", onSelectAll);
    return () => window.removeEventListener("keydown", onSelectAll);
  }, [canvasNodes, setNodeSelection, setSelectedEdgeKey, setStatus, workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== "workflow") {
      return;
    }

    const onCopyPasteNodes = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      const isCopy = key === "c" || key === "ㅊ" || event.code === "KeyC";
      const isPaste = key === "v" || key === "ㅍ" || event.code === "KeyV";

      if (isCopy) {
        if (selectedNodeIds.length === 0 && hasUserTextSelection()) {
          return;
        }
        const copied = copySelectedNodesToClipboard();
        if (copied) {
          event.preventDefault();
        }
        return;
      }
      if (isPaste) {
        const pasted = pasteNodesFromClipboard();
        if (pasted) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", onCopyPasteNodes);
    return () => window.removeEventListener("keydown", onCopyPasteNodes);
  }, [
    canvasNodeIdSet,
    copySelectedNodesToClipboard,
    graph.edges,
    graph.nodes,
    hasUserTextSelection,
    pasteNodesFromClipboard,
    selectedNodeIds,
    workspaceTab,
  ]);

  useEffect(() => {
    if (workspaceTab !== "workflow") {
      return;
    }

    const onDeleteSelection = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }

      if (selectedEdgeKey) {
        const hasEdge = canvasDisplayEdges.some(
          (row) => !row.readOnly && row.edgeKey === selectedEdgeKey,
        );
        if (!hasEdge) {
          setSelectedEdgeKey("");
          return;
        }
        event.preventDefault();
        applyGraphChange((prev) => ({
          ...prev,
          edges: prev.edges.filter((edge) => getGraphEdgeKey(edge) !== selectedEdgeKey),
        }));
        setSelectedEdgeKey("");
        setStatus("연결선 삭제됨");
        return;
      }

      if (selectedNodeIds.length > 0) {
        const targets = selectedNodeIds.filter((id) => canvasNodeIdSet.has(id));
        if (targets.length === 0) {
          setNodeSelection([]);
          return;
        }
        event.preventDefault();
        deleteNodes(targets);
        setStatus(targets.length > 1 ? "선택 노드 삭제됨" : "노드 삭제됨");
      }
    };

    window.addEventListener("keydown", onDeleteSelection);
    return () => window.removeEventListener("keydown", onDeleteSelection);
  }, [
    applyGraphChange,
    canvasDisplayEdges,
    canvasNodeIdSet,
    deleteNodes,
    selectedEdgeKey,
    selectedNodeIds,
    setNodeSelection,
    setSelectedEdgeKey,
    setStatus,
    workspaceTab,
  ]);
}
