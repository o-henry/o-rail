import type { GraphNode } from "../../../features/workflow/types";

export function computeCanvasStageSize(params: {
  viewportWidth: number;
  viewportHeight: number;
  canvasNodes: GraphNode[];
  nodeWidth: number;
  nodeHeight: number;
  stageGrowMargin: number;
  stageGrowLimit: number;
  maxStageWidth: number;
  maxStageHeight: number;
  expandToFitAllNodes?: boolean;
}): { width: number; height: number } {
  const stagePadding = params.canvasNodes.length > 0 ? params.stageGrowMargin : 0;
  const maxNodeRight = params.canvasNodes.reduce(
    (max, node) => Math.max(max, Number(node.position?.x ?? 0) + params.nodeWidth),
    0,
  );
  const maxNodeBottom = params.canvasNodes.reduce(
    (max, node) => Math.max(max, Number(node.position?.y ?? 0) + params.nodeHeight),
    0,
  );
  const fitWidth = Math.max(params.viewportWidth, maxNodeRight + stagePadding);
  const fitHeight = Math.max(params.viewportHeight, maxNodeBottom + stagePadding);

  const softMaxWidth = params.viewportWidth + params.stageGrowLimit;
  const softMaxHeight = params.viewportHeight + params.stageGrowLimit;
  const stageWidth = params.expandToFitAllNodes
    ? fitWidth
    : Math.max(params.viewportWidth, Math.min(softMaxWidth, fitWidth));
  const stageHeight = params.expandToFitAllNodes
    ? fitHeight
    : Math.max(params.viewportHeight, Math.min(softMaxHeight, fitHeight));

  return {
    width: Math.min(stageWidth, params.maxStageWidth),
    height: Math.min(stageHeight, params.maxStageHeight),
  };
}
