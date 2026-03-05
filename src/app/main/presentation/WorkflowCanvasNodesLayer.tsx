import type { MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../../../i18n";
import type { GraphNode, NodeAnchorSide, NodeExecutionStatus } from "../../../features/workflow/types";
import type { MarqueeSelection, NodeRunState } from "../types";
import type { WorkflowGraphViewMode } from "../../../features/workflow/viaGraph";
import { viaNodeIconSrc, viaNodeIconText, viaNodeLabel } from "../../../features/workflow/viaCatalog";

type WorkflowCanvasNodesLayerProps = {
  canvasNodes: GraphNode[];
  graphViewMode: WorkflowGraphViewMode;
  nodeStates: Record<string, NodeRunState>;
  selectedNodeIds: string[];
  draggingNodeIds: string[];
  isConnectingDrag: boolean;
  selectedEdgeNodeIdSet: Set<string>;
  questionDirectInputNodeIds: Set<string>;
  setNodeSelection: (nodeIds: string[], focusedNodeId?: string) => void;
  setSelectedEdgeKey: (edgeKey: string) => void;
  isNodeDragAllowedTarget: (target: EventTarget | null) => boolean;
  onNodeDragStart: (event: ReactMouseEvent<HTMLDivElement>, nodeId: string) => void;
  nodeAnchorSides: readonly NodeAnchorSide[];
  onNodeAnchorDragStart: (event: ReactMouseEvent<HTMLButtonElement>, nodeId: string, side: NodeAnchorSide) => void;
  onNodeAnchorDrop: (event: ReactMouseEvent<HTMLButtonElement>, nodeId: string, side: NodeAnchorSide) => void;
  selectedEdgeKey: string;
  onAssignSelectedEdgeAnchor: (nodeId: string, side: NodeAnchorSide) => boolean;
  nodeCardSummary: (node: GraphNode) => string;
  turnModelLabel: (node: GraphNode) => string;
  turnRoleLabel: (node: GraphNode) => string;
  nodeTypeLabel: (type: GraphNode["type"]) => string;
  deleteNode: (nodeId: string) => void;
  nodeStatusLabel: (status: NodeExecutionStatus) => string;
  formatNodeElapsedTime: (state: NodeRunState | undefined, nowMs: number) => string;
  runtimeNowMs: number;
  onOpenFeedFromNode: (nodeId: string) => void;
  onOpenWebInputForNode: (nodeId: string) => void;
  marqueeSelection: MarqueeSelection | null;
};

export default function WorkflowCanvasNodesLayer({
  canvasNodes,
  graphViewMode,
  nodeStates,
  selectedNodeIds,
  draggingNodeIds,
  isConnectingDrag,
  selectedEdgeNodeIdSet,
  questionDirectInputNodeIds,
  setNodeSelection,
  setSelectedEdgeKey,
  isNodeDragAllowedTarget,
  onNodeDragStart,
  nodeAnchorSides,
  onNodeAnchorDragStart,
  onNodeAnchorDrop,
  selectedEdgeKey,
  onAssignSelectedEdgeAnchor,
  nodeCardSummary,
  turnModelLabel,
  turnRoleLabel,
  nodeTypeLabel,
  deleteNode,
  nodeStatusLabel,
  formatNodeElapsedTime,
  runtimeNowMs,
  onOpenFeedFromNode,
  onOpenWebInputForNode,
  marqueeSelection,
}: WorkflowCanvasNodesLayerProps) {
  const { t } = useI18n();

  return (
    <>
      {canvasNodes.map((node) => {
        const runState = nodeStates[node.id];
        const nodeStatus = runState?.status ?? "idle";
        const nodeSummary = nodeCardSummary(node);
        const isNodeSelected = selectedNodeIds.includes(node.id);
        const isNodeDragging = draggingNodeIds.includes(node.id);
        const showNodeAnchors = isNodeSelected || isConnectingDrag || selectedEdgeNodeIdSet.has(node.id);
        const receivesQuestionDirectly = questionDirectInputNodeIds.has(node.id);
        const isWebTurnNode = node.type === "turn" && String(node.config?.executor ?? "").startsWith("web_");
        const sourceKind = String((node.config as Record<string, unknown>)?.sourceKind ?? "").trim().toLowerCase();
        const viaNodeType = String((node.config as Record<string, unknown>)?.viaNodeType ?? "").trim();
        const ragNodeLabel = viaNodeLabel(viaNodeType);
        const ragNodeTypeLabel = ragNodeLabel.replace(/\s*\(미\/일\/중\/한\)\s*/g, "").trim();
        const ragNodeIconText = viaNodeIconText(viaNodeType);
        const ragNodeIconSrc = viaNodeIconSrc(viaNodeType);
        const handoffRoleId = String((node.config as Record<string, unknown>)?.handoffRoleId ?? "")
          .trim()
          .toLowerCase();
        const handoffRoleToken = handoffRoleId.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const handoffRoleClass = handoffRoleToken ? `handoff-role-${handoffRoleToken}` : "";
        const isDataPipelineNode =
          node.type === "turn" && sourceKind === "data_pipeline";
        const isDataResearchNode = node.type === "turn" && sourceKind === "data_research";
        const isRagModeNode = graphViewMode === "rag";
        const isRagNodeRunning = isRagModeNode && nodeStatus === "running";
        const activeRagNodeIconSrc = isRagNodeRunning ? "/rag-node-icons/loader.svg" : ragNodeIconSrc;
        return (
          <div
            className={`graph-node node-${node.type} ${isRagModeNode ? "is-rag-mode-node" : ""} ${isDataPipelineNode ? "is-data-pipeline-node" : ""} ${isDataResearchNode ? "is-data-research-node" : ""} ${handoffRoleClass} ${isNodeSelected ? "selected" : ""} ${isNodeDragging ? "is-dragging" : ""}`.trim()}
            data-node-id={node.id}
            key={node.id}
            onClick={(event) => {
              if (event.shiftKey) {
                const toggled = selectedNodeIds.includes(node.id)
                  ? selectedNodeIds.filter((id) => id !== node.id)
                  : [...selectedNodeIds, node.id];
                setNodeSelection(toggled, node.id);
              } else {
                setNodeSelection([node.id], node.id);
              }
              setSelectedEdgeKey("");
            }}
            onMouseDown={(event) => {
              if (!isNodeDragAllowedTarget(event.target)) return;
              if (event.button !== 0 || isConnectingDrag) return;
              onNodeDragStart(event, node.id);
            }}
            style={{
              left: node.position.x,
              top: node.position.y,
              transition: isNodeDragging
                ? "none"
                : "left 220ms cubic-bezier(0.22, 1, 0.36, 1), top 220ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {isRagModeNode ? (
              <>
                <div className="rag-node-shell">
                  <div className={`rag-node-icon${isRagNodeRunning ? " is-loading" : ""}`}>
                    {activeRagNodeIconSrc ? (
                      <img alt="" aria-hidden="true" src={activeRagNodeIconSrc} />
                    ) : (
                      ragNodeIconText
                    )}
                  </div>
                </div>
                <span className="rag-node-type">{ragNodeTypeLabel || viaNodeType || turnRoleLabel(node)}</span>
              </>
            ) : (
              <>
                <div className="node-head">
                  <div className="node-head-main">
                    {node.type === "turn" ? (
                      <>
                        <div className="node-head-title-row">
                          <strong>{turnModelLabel(node)}</strong>
                        </div>
                        <span className="node-head-subtitle">{turnRoleLabel(node)}</span>
                      </>
                    ) : (
                      <div className="node-head-title-row">
                        <strong className={node.type === "gate" ? "gate-node-title" : undefined}>{nodeTypeLabel(node.type)}</strong>
                      </div>
                    )}
                  </div>
                  <div className="node-head-actions">
                    {isDataPipelineNode ? <span className="node-type-badge data node-head-action-badge">DATA</span> : null}
                    {isDataResearchNode ? <span className="node-type-badge research node-head-action-badge">RAG</span> : null}
                    <button className="node-head-delete-button" onClick={() => deleteNode(node.id)} type="button">
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
                <div className="node-body">
                  {nodeSummary ? <div className="node-summary-row"><div>{nodeSummary}</div></div> : null}
                  <div className="node-runtime-meta">
                    <div>
                      {t("workflow.node.completion")}: {" "}
                      {nodeStatus === "done"
                        ? t("label.status.done")
                        : nodeStatus === "low_quality"
                          ? t("label.status.low_quality")
                          : nodeStatus === "failed"
                            ? t("label.status.failed")
                            : nodeStatus === "cancelled"
                              ? t("label.status.cancelled")
                              : t("label.status.idle")}
                    </div>
                    <div>{t("workflow.node.elapsed")}: {formatNodeElapsedTime(runState, runtimeNowMs)}</div>
                  </div>
                  <button className="node-feed-link" onClick={() => onOpenFeedFromNode(node.id)} type="button">{t("workflow.node.outputInFeed")}</button>
                </div>
                <div className="node-wait-slot">
                  <span className={`status-pill status-${nodeStatus}`}>{nodeStatusLabel(nodeStatus)}</span>
                  <div className="node-wait-actions">
                    {receivesQuestionDirectly && (
                      <span className="node-input-chip">
                        <span className="node-input-chip-text">{t("workflow.node.inputDirect")}</span>
                      </span>
                    )}
                    {isWebTurnNode && (
                      <button
                        className="node-manual-web-input-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenWebInputForNode(node.id);
                        }}
                        title={t("workflow.node.manualWebInput")}
                        type="button"
                      >
                        {t("workflow.node.manualWebInput")}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
            {showNodeAnchors && (
              <div className="node-anchors">
                {nodeAnchorSides.map((side) => (
                  <button
                    aria-label={`${t("workflow.node.connection")} ${side}`}
                    className={`node-anchor node-anchor-${side}`}
                    key={`${node.id}-${side}`}
                    onMouseDown={(e) => {
                      if (!isConnectingDrag && selectedEdgeKey) {
                        const applied = onAssignSelectedEdgeAnchor(node.id, side);
                        if (applied) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                      }
                      onNodeAnchorDragStart(e, node.id, side);
                    }}
                    onMouseUp={(e) => onNodeAnchorDrop(e, node.id, side)}
                    type="button"
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {marqueeSelection && (
        <div
          className="marquee-selection"
          style={{
            left: Math.min(marqueeSelection.start.x, marqueeSelection.current.x),
            top: Math.min(marqueeSelection.start.y, marqueeSelection.current.y),
            width: Math.abs(marqueeSelection.current.x - marqueeSelection.start.x),
            height: Math.abs(marqueeSelection.current.y - marqueeSelection.start.y),
          }}
        />
      )}
    </>
  );
}
