import { describe, expect, it } from "vitest";
import type { GraphNode } from "../../../features/workflow/types";
import { computeCanvasStageSize } from "./canvasStageSize";

describe("computeCanvasStageSize", () => {
  const canvasNodes: GraphNode[] = [
    { id: "role", type: "turn", position: { x: 1600, y: 1400 }, config: {} },
  ];

  it("keeps the soft grow limit for normal canvas mode", () => {
    expect(
      computeCanvasStageSize({
        viewportWidth: 900,
        viewportHeight: 700,
        canvasNodes,
        nodeWidth: 240,
        nodeHeight: 136,
        stageGrowMargin: 120,
        stageGrowLimit: 720,
        maxStageWidth: 4200,
        maxStageHeight: 3200,
        expandToFitAllNodes: false,
      }),
    ).toEqual({ width: 1620, height: 1420 });
  });

  it("fits all visible nodes when expanded internal nodes are open", () => {
    expect(
      computeCanvasStageSize({
        viewportWidth: 900,
        viewportHeight: 700,
        canvasNodes,
        nodeWidth: 240,
        nodeHeight: 136,
        stageGrowMargin: 120,
        stageGrowLimit: 720,
        maxStageWidth: 4200,
        maxStageHeight: 3200,
        expandToFitAllNodes: true,
      }),
    ).toEqual({ width: 1960, height: 1656 });
  });
});
