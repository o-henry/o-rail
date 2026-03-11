import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WorkflowCanvasNodesLayer from "./WorkflowCanvasNodesLayer";

describe("WorkflowCanvasNodesLayer", () => {
  it("renders a manual web input button for web turn nodes", () => {
    const html = renderToStaticMarkup(
      <WorkflowCanvasNodesLayer
        canvasNodes={[
          {
            id: "web-turn",
            type: "turn",
            position: { x: 0, y: 0 },
            config: {
              executor: "web_gpt",
              model: "GPT-5.4",
              sourceKind: "handoff",
              handoffRoleId: "pm_planner",
            },
          },
        ]}
        deleteNode={vi.fn()}
        draggingNodeIds={[]}
        expandedRoleNodeIds={[]}
        formatNodeElapsedTime={() => "대기"}
        graphNodes={[]}
        graphViewMode={"workflow" as any}
        isConnectingDrag={false}
        isNodeDragAllowedTarget={() => false}
        marqueeSelection={null}
        nodeAnchorSides={["left", "right", "top", "bottom"]}
        nodeCardSummary={() => ""}
        nodeStates={{}}
        nodeStatusLabel={() => "대기"}
        nodeTypeLabel={() => "TURN"}
        onAddRolePerspectivePass={vi.fn()}
        onAddRoleReviewPass={vi.fn()}
        onAssignSelectedEdgeAnchor={() => false}
        onNodeAnchorDragStart={vi.fn()}
        onNodeAnchorDrop={vi.fn()}
        onNodeDragStart={vi.fn()}
        onOpenFeedFromNode={vi.fn()}
        onOpenWebInputForNode={vi.fn()}
        onSetPmPlanningMode={vi.fn()}
        onToggleNodeTerminal={vi.fn()}
        onToggleRoleInternalExpanded={vi.fn()}
        openTerminalNodeId=""
        questionDirectInputNodeIds={new Set()}
        runtimeNowMs={Date.now()}
        selectedEdgeKey=""
        selectedEdgeNodeIdSet={new Set()}
        selectedNodeIds={[]}
        setNodeSelection={vi.fn()}
        setSelectedEdgeKey={vi.fn()}
        turnModelLabel={() => "GPT-5.4"}
        turnRoleLabel={() => "WEB 노드"}
      />,
    );

    expect(html).toContain("수동입력");
  });
});
