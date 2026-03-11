export function computeCanvasRevealViewport(params: {
  clientWidth: number;
  clientHeight: number;
  currentZoom: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stageInsetX: number;
  stageInsetY: number;
  padding?: number;
}): { zoom: number; scrollLeft: number; scrollTop: number } {
  const padding = Math.max(0, params.padding ?? 48);
  const logicalWidth = Math.max(1, params.bounds.maxX - params.bounds.minX);
  const logicalHeight = Math.max(1, params.bounds.maxY - params.bounds.minY);
  const fitZoomX = Math.max(0.1, (params.clientWidth - padding * 2) / logicalWidth);
  const fitZoomY = Math.max(0.1, (params.clientHeight - padding * 2) / logicalHeight);
  const zoom = Math.min(params.currentZoom, fitZoomX, fitZoomY);
  const centerX = (params.bounds.minX + params.bounds.maxX) / 2;
  const centerY = (params.bounds.minY + params.bounds.maxY) / 2;

  return {
    zoom,
    scrollLeft: centerX * zoom + params.stageInsetX - params.clientWidth / 2,
    scrollTop: centerY * zoom + params.stageInsetY - params.clientHeight / 2,
  };
}
