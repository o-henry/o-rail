import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, type SetStateAction, type WheelEvent as ReactWheelEvent } from "react";
import { useI18n } from "../../../i18n";
import type { PmPlanningMode } from "../../../features/studio/pmPlanningMode";
import type { MarqueeSelection, NodeRunState, PendingWebTurn } from "../types";
import type { GraphNode, NodeAnchorSide, NodeExecutionStatus } from "../../../features/workflow/types";
import type { TurnExecutor } from "../../../features/workflow/domain";
import type { WorkflowGraphViewMode } from "../../../features/workflow/viaGraph";
import WorkflowCanvasNodesLayer from "./WorkflowCanvasNodesLayer";
import WorkflowQuestionComposer from "./WorkflowQuestionComposer";

type EdgeLine = {
  key: string;
  edgeKey: string;
  readOnly?: boolean;
  path: string;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
};

type WorkflowCanvasPaneProps = {
  panMode: boolean;
  onCanvasKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCanvasMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCanvasMouseMove: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCanvasMouseUp: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCanvasWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  graphCanvasRef: RefObject<HTMLDivElement | null>;
  onActivateWorkspacePanels: () => void;
  boundedStageWidth: number;
  boundedStageHeight: number;
  canvasZoom: number;
  graphViewMode: WorkflowGraphViewMode;
  stageInsetX: number;
  stageInsetY: number;
  stageInsetBottom: number;
  edgeLines: EdgeLine[];
  selectedEdgeKey: string;
  selectedEdgeNodeIdSet: Set<string>;
  setNodeSelection: (nodeIds: string[], focusedNodeId?: string) => void;
  setSelectedEdgeKey: (edgeKey: string) => void;
  onEdgeDragStart: (
    event: ReactMouseEvent<SVGPathElement | SVGCircleElement>,
    edgeKey: string,
    startPoint: { x: number; y: number },
    endPoint: { x: number; y: number },
  ) => void;
  connectPreviewLine: string | null;
  canvasNodes: GraphNode[];
  graphNodes: GraphNode[];
  nodeStates: Record<string, NodeRunState>;
  selectedNodeIds: string[];
  draggingNodeIds: string[];
  isConnectingDrag: boolean;
  questionDirectInputNodeIds: Set<string>;
  onNodeAnchorDragStart: (event: ReactMouseEvent<HTMLButtonElement>, nodeId: string, side: NodeAnchorSide) => void;
  onNodeAnchorDrop: (event: ReactMouseEvent<HTMLButtonElement>, nodeId: string, side: NodeAnchorSide) => void;
  onAssignSelectedEdgeAnchor: (nodeId: string, side: NodeAnchorSide) => boolean;
  isNodeDragAllowedTarget: (target: EventTarget | null) => boolean;
  onNodeDragStart: (event: ReactMouseEvent<HTMLDivElement>, nodeId: string) => void;
  nodeAnchorSides: readonly NodeAnchorSide[];
  nodeCardSummary: (node: GraphNode) => string;
  turnModelLabel: (node: GraphNode) => string;
  turnRoleLabel: (node: GraphNode) => string;
  nodeTypeLabel: (type: GraphNode["type"]) => string;
  nodeStatusLabel: (status: NodeExecutionStatus) => string;
  deleteNode: (nodeId: string) => void;
  onOpenFeedFromNode: (nodeId: string) => void;
  onOpenWebInputForNode: (nodeId: string) => void;
  runtimeNowMs: number;
  formatNodeElapsedTime: (state: NodeRunState | undefined, nowMs: number) => string;
  openTerminalNodeId: string;
  onToggleNodeTerminal: (nodeId: string) => void;
  onSetPmPlanningMode: (nodeId: string, mode: PmPlanningMode) => void;
  expandedRoleNodeIds: string[];
  onToggleRoleInternalExpanded: (nodeId: string) => void;
  onAddRolePerspectivePass: (nodeId: string) => void;
  onAddRoleReviewPass: (nodeId: string) => void;
  marqueeSelection: MarqueeSelection | null;
  onCanvasZoomIn: () => void;
  onCanvasZoomOut: () => void;
  canvasFullscreen: boolean;
  setCanvasFullscreen: Dispatch<SetStateAction<boolean>>;
  setPanMode: Dispatch<SetStateAction<boolean>>;
  canRunGraphNow: boolean;
  onRunGraph: () => Promise<void>;
  isGraphRunning: boolean;
  onCancelGraphRun: () => Promise<void>;
  suspendedWebTurn: PendingWebTurn | null;
  pendingWebTurn: PendingWebTurn | null;
  onReopenPendingWebTurn: () => void;
  undoStackLength: number;
  redoStackLength: number;
  onUndoGraph: () => void;
  onRedoGraph: () => void;
  onClearGraph: () => void;
  canClearGraph: boolean;
  isWorkflowBusy: boolean;
  onApplyModelSelection: (selection: {
    modelValue: string;
    modelLabel: string;
    executor: TurnExecutor;
    turnModel?: string;
    reasoningLevel?: string;
  }) => void;
  agentTerminalIsland?: ReactNode;
  setWorkflowQuestion: (value: string) => void;
  workflowQuestion: string;
  questionInputRef: RefObject<HTMLTextAreaElement | null>;
};

type WorkflowConversationMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
};

export default function WorkflowCanvasPane({
  panMode,
  onCanvasKeyDown,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onCanvasWheel,
  graphCanvasRef,
  onActivateWorkspacePanels,
  boundedStageWidth,
  boundedStageHeight,
  canvasZoom,
  graphViewMode,
  stageInsetX,
  stageInsetY,
  stageInsetBottom,
  edgeLines,
  selectedEdgeKey,
  selectedEdgeNodeIdSet,
  setNodeSelection,
  setSelectedEdgeKey,
  onEdgeDragStart,
  connectPreviewLine,
  canvasNodes,
  graphNodes,
  nodeStates,
  selectedNodeIds,
  draggingNodeIds,
  isConnectingDrag,
  questionDirectInputNodeIds,
  onNodeAnchorDragStart,
  onNodeAnchorDrop,
  onAssignSelectedEdgeAnchor,
  isNodeDragAllowedTarget,
  onNodeDragStart,
  nodeAnchorSides,
  nodeCardSummary,
  turnModelLabel,
  turnRoleLabel,
  nodeTypeLabel,
  nodeStatusLabel,
  deleteNode,
  onOpenFeedFromNode,
  onOpenWebInputForNode,
  runtimeNowMs,
  formatNodeElapsedTime,
  openTerminalNodeId,
  onToggleNodeTerminal,
  onSetPmPlanningMode,
  expandedRoleNodeIds,
  onToggleRoleInternalExpanded,
  onAddRolePerspectivePass,
  onAddRoleReviewPass,
  marqueeSelection,
  onCanvasZoomIn,
  onCanvasZoomOut,
  canvasFullscreen,
  setCanvasFullscreen,
  setPanMode,
  canRunGraphNow,
  onRunGraph,
  isGraphRunning,
  onCancelGraphRun,
  suspendedWebTurn,
  pendingWebTurn,
  onReopenPendingWebTurn,
  undoStackLength,
  redoStackLength,
  onUndoGraph,
  onRedoGraph,
  onClearGraph,
  canClearGraph,
  isWorkflowBusy,
  onApplyModelSelection,
  agentTerminalIsland,
  setWorkflowQuestion,
  workflowQuestion,
  questionInputRef,
}: WorkflowCanvasPaneProps) {
  const { t } = useI18n();
  const [, setConversationByNodeId] = useState<Record<string, WorkflowConversationMessage[]>>({});
  const nodeLogCursorRef = useRef<Record<string, number>>({});

  const canvasNodeById = useMemo(() => {
    const next = new Map<string, GraphNode>();
    canvasNodes.forEach((node) => next.set(node.id, node));
    return next;
  }, [canvasNodes]);

  const selectedConversationNode = useMemo(() => {
    for (const nodeId of selectedNodeIds) {
      const node = canvasNodeById.get(nodeId);
      if (node?.type === "turn") {
        return node;
      }
    }
    return null;
  }, [canvasNodeById, selectedNodeIds]);

  const selectedConversationNodeId = selectedConversationNode?.id ?? "";

  useEffect(() => {
    setConversationByNodeId((prev) => {
      let changed = false;
      let next = prev;
      for (const [nodeId, nodeState] of Object.entries(nodeStates)) {
        const logs = nodeState.logs ?? [];
        const previousCursor = nodeLogCursorRef.current[nodeId] ?? 0;
        const normalizedCursor = logs.length < previousCursor ? 0 : previousCursor;
        if (logs.length <= normalizedCursor) {
          nodeLogCursorRef.current[nodeId] = logs.length;
          continue;
        }
        const appended: WorkflowConversationMessage[] = logs
          .slice(normalizedCursor)
          .map((log, index) => ({
            id: `${nodeId}-agent-${normalizedCursor + index}-${Date.now()}`,
            role: "agent" as const,
            text: String(log ?? "").replace(/\s+/g, " ").trim(),
          }))
          .filter((item) => item.text.length > 0);
        nodeLogCursorRef.current[nodeId] = logs.length;
        if (appended.length === 0) {
          continue;
        }
        if (next === prev) {
          next = { ...prev };
        }
        const existing = next[nodeId] ?? [];
        next[nodeId] = [...existing, ...appended].slice(-120);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [nodeStates]);

  const onSubmitConversationMessage = useCallback(
    (nodeId: string, message: string) => {
      const trimmed = String(message ?? "").trim();
      const normalizedNodeId = String(nodeId ?? "").trim();
      if (!trimmed || !normalizedNodeId) {
        return;
      }
      setConversationByNodeId((prev) => {
        const next = { ...prev };
        const existing = next[normalizedNodeId] ?? [];
        const nextMessage: WorkflowConversationMessage = {
          id: `${normalizedNodeId}-user-${Date.now()}`,
          role: "user",
          text: trimmed,
        };
        next[normalizedNodeId] = [
          ...existing,
          nextMessage,
        ].slice(-120);
        return next;
      });
    },
    [],
  );

  return (
    <section className="canvas-pane">
      <div className="canvas-main-row">
        <div className="graph-canvas-shell">
          <div
            className={`graph-canvas ${panMode ? "pan-mode" : ""}`}
            onKeyDown={onCanvasKeyDown}
            onMouseDown={(event) => {
              onActivateWorkspacePanels();
              onCanvasMouseDown(event);
            }}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onWheel={onCanvasWheel}
            ref={graphCanvasRef}
            tabIndex={-1}
          >
            <div
              className="graph-stage-shell"
              style={{
                width: Math.round(boundedStageWidth * canvasZoom + stageInsetX * 2),
                height: Math.round(boundedStageHeight * canvasZoom + stageInsetY + stageInsetBottom),
              }}
            >
              <div
                className="graph-stage"
                style={{
                  left: stageInsetX,
                  top: stageInsetY,
                  transform: `scale(${canvasZoom})`,
                  width: boundedStageWidth,
                  height: boundedStageHeight,
                }}
              >
                <svg className="edge-layer" overflow="visible">
                  <defs>
                    <marker id="edge-arrow" markerHeight="7" markerUnits="userSpaceOnUse" markerWidth="7" orient="auto" refX="6" refY="3.5">
                      <path d="M0 0 L7 3.5 L0 7 Z" fill="#70848a" />
                    </marker>
                    <marker id="edge-arrow-readonly" markerHeight="7" markerUnits="userSpaceOnUse" markerWidth="7" orient="auto" refX="6" refY="3.5">
                      <path d="M0 0 L7 3.5 L0 7 Z" fill="#c07a2f" />
                    </marker>
                  </defs>
                  {edgeLines.map((line) => (
                    <g key={line.key}>
                      {!line.readOnly && (
                        <path
                          className="edge-path-hit"
                          d={line.path}
                          fill="none"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNodeSelection([]);
                            setSelectedEdgeKey(line.edgeKey);
                          }}
                          onMouseDown={(e) => onEdgeDragStart(e, line.edgeKey, line.startPoint, line.endPoint)}
                          pointerEvents="stroke"
                          stroke="transparent"
                          strokeWidth={18}
                        />
                      )}
                      <path
                        className={`${selectedEdgeKey === line.edgeKey ? "edge-path selected" : "edge-path"} ${
                          line.readOnly ? "readonly" : ""
                        }`.trim()}
                        d={line.path}
                        fill="none"
                        markerEnd={line.readOnly ? "url(#edge-arrow-readonly)" : "url(#edge-arrow)"}
                        pointerEvents="none"
                        stroke={line.readOnly ? "#c07a2f" : selectedEdgeKey === line.edgeKey ? "#4f83ff" : "#4f6271"}
                        strokeDasharray={line.readOnly ? "7 4" : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={selectedEdgeKey === line.edgeKey ? 3 : 2}
                      />
                      {!line.readOnly && (
                        <circle
                          className="edge-arrow-handle"
                          cx={line.endPoint.x}
                          cy={line.endPoint.y}
                          fill="transparent"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNodeSelection([]);
                            setSelectedEdgeKey(line.edgeKey);
                          }}
                          onMouseDown={(e) => onEdgeDragStart(e, line.edgeKey, line.startPoint, line.endPoint)}
                          r={12}
                        />
                      )}
                    </g>
                  ))}
                  {connectPreviewLine && (
                    <path
                      d={connectPreviewLine}
                      fill="none"
                      pointerEvents="none"
                      stroke="#5b8cff"
                      strokeDasharray="5 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  )}
                </svg>

        <WorkflowCanvasNodesLayer
          canvasNodes={canvasNodes}
          graphNodes={graphNodes}
          graphViewMode={graphViewMode}
                  draggingNodeIds={draggingNodeIds}
                  formatNodeElapsedTime={formatNodeElapsedTime}
                  isConnectingDrag={isConnectingDrag}
                  isNodeDragAllowedTarget={isNodeDragAllowedTarget}
                  marqueeSelection={marqueeSelection}
                  nodeAnchorSides={nodeAnchorSides}
                  nodeCardSummary={nodeCardSummary}
                  nodeStates={nodeStates}
                  nodeStatusLabel={nodeStatusLabel}
                  nodeTypeLabel={nodeTypeLabel}
                  onAssignSelectedEdgeAnchor={onAssignSelectedEdgeAnchor}
                  onNodeAnchorDragStart={onNodeAnchorDragStart}
                  onNodeAnchorDrop={onNodeAnchorDrop}
                  onNodeDragStart={onNodeDragStart}
                  onOpenFeedFromNode={onOpenFeedFromNode}
                  onOpenWebInputForNode={onOpenWebInputForNode}
                  openTerminalNodeId={openTerminalNodeId}
                  onToggleNodeTerminal={onToggleNodeTerminal}
                  onSetPmPlanningMode={onSetPmPlanningMode}
                  expandedRoleNodeIds={expandedRoleNodeIds}
                  onToggleRoleInternalExpanded={onToggleRoleInternalExpanded}
                  onAddRolePerspectivePass={onAddRolePerspectivePass}
                  onAddRoleReviewPass={onAddRoleReviewPass}
                  questionDirectInputNodeIds={questionDirectInputNodeIds}
                  runtimeNowMs={runtimeNowMs}
                  selectedEdgeKey={selectedEdgeKey}
                  selectedEdgeNodeIdSet={selectedEdgeNodeIdSet}
                  selectedNodeIds={selectedNodeIds}
                  setNodeSelection={setNodeSelection}
                  setSelectedEdgeKey={setSelectedEdgeKey}
                  turnModelLabel={turnModelLabel}
                  turnRoleLabel={turnRoleLabel}
                  deleteNode={deleteNode}
                />
              </div>
            </div>
          </div>

          <div className="canvas-overlay">
            <div className="canvas-zoom-controls">
              <div className="canvas-zoom-group">
                <button onClick={onCanvasZoomIn} title={t("workflow.canvas.zoomIn")} type="button"><img alt="" aria-hidden="true" className="canvas-control-icon" src="/plus.svg" /></button>
                <button onClick={onCanvasZoomOut} title={t("workflow.canvas.zoomOut")} type="button"><img alt="" aria-hidden="true" className="canvas-control-icon" src="/minus.svg" /></button>
              </div>
              <button className="canvas-zoom-single" onClick={() => setCanvasFullscreen((prev) => !prev)} title={canvasFullscreen ? t("workflow.canvas.defaultView") : t("workflow.canvas.fullView")} type="button">
                <img alt="" aria-hidden="true" className="canvas-control-icon" src="/canvas-fullscreen.svg" />
              </button>
              <button aria-label={t("workflow.canvas.move")} className={`canvas-zoom-single ${panMode ? "is-active" : ""}`} onClick={() => setPanMode((prev) => !prev)} title={t("workflow.canvas.moveCanvas")} type="button">
                <img alt="" aria-hidden="true" className="canvas-control-icon" src="/scroll.svg" />
              </button>
            </div>

            <div className="canvas-runbar">
              <button aria-label={t("workflow.canvas.run")} className={`canvas-icon-btn play ${canRunGraphNow ? "is-ready" : "is-disabled"}`} disabled={!canRunGraphNow} onClick={() => void onRunGraph()} title={t("workflow.canvas.run")} type="button">
                <img alt="" aria-hidden="true" className="canvas-icon-image" src="/canvas-play.svg" />
              </button>
              <button aria-label={t("workflow.canvas.stop")} className="canvas-icon-btn stop" disabled={!isGraphRunning} onClick={() => void onCancelGraphRun()} title={t("workflow.canvas.stop")} type="button">
                <img alt="" aria-hidden="true" className="canvas-icon-image" src="/canvas-stop.svg" />
              </button>
              {suspendedWebTurn && !pendingWebTurn && isGraphRunning && (
                <button aria-label={t("workflow.canvas.reopenWebInput")} className="canvas-web-turn-reopen" onClick={onReopenPendingWebTurn} title={t("workflow.canvas.reopenWebInputWindow")} type="button">WEB</button>
              )}
              <button aria-label={t("workflow.canvas.undo")} className="canvas-icon-btn" disabled={undoStackLength === 0} onClick={onUndoGraph} title={t("workflow.canvas.undo")} type="button">
                <img alt="" aria-hidden="true" className="canvas-icon-image" src="/canvas-undo.svg" />
              </button>
              <button aria-label={t("workflow.canvas.redo")} className="canvas-icon-btn" disabled={redoStackLength === 0} onClick={onRedoGraph} title={t("workflow.canvas.redo")} type="button">
                <img alt="" aria-hidden="true" className="canvas-icon-image" src="/canvas-replay.svg" />
              </button>
              <button aria-label={t("workflow.canvas.clear")} className="canvas-icon-btn" disabled={!canClearGraph} onClick={onClearGraph} title={t("workflow.canvas.clear")} type="button">
                <img alt="" aria-hidden="true" className="canvas-icon-image canvas-icon-image-clear" src="/clear.svg" />
              </button>
            </div>
          </div>
        </div>

        {agentTerminalIsland}
      </div>

      <div className="canvas-topbar">
        <WorkflowQuestionComposer
          canRunGraphNow={canRunGraphNow}
          isWorkflowBusy={isWorkflowBusy}
          onApplyModelSelection={onApplyModelSelection}
          onRunGraph={onRunGraph}
          onSubmitMessage={(message) => {
            if (!selectedConversationNodeId) {
              return;
            }
            onSubmitConversationMessage(selectedConversationNodeId, message);
          }}
          questionInputRef={questionInputRef}
          setWorkflowQuestion={setWorkflowQuestion}
          workflowQuestion={workflowQuestion}
        />
      </div>
    </section>
  );
}
