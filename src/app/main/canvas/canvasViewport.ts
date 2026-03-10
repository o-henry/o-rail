import type { RefObject } from "react";
import { GRAPH_STAGE_INSET_X, GRAPH_STAGE_INSET_Y } from "../../main";

export function getCanvasViewportCenterLogical(params: {
  canvasZoom: number;
  graphCanvasRef: RefObject<HTMLDivElement | null>;
}): { x: number; y: number } | null {
  const canvas = params.graphCanvasRef.current;
  if (!canvas) {
    return null;
  }
  return {
    x: (canvas.scrollLeft + canvas.clientWidth / 2 - GRAPH_STAGE_INSET_X) / params.canvasZoom,
    y: (canvas.scrollTop + canvas.clientHeight / 2 - GRAPH_STAGE_INSET_Y) / params.canvasZoom,
  };
}
