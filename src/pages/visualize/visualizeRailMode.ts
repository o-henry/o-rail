export type VisualizeRailMode = "closed" | "history" | "assistant";

export function resolveVisualizeRailMode(params: {
  historyOpen: boolean;
  chartAssistantOpen: boolean;
}): VisualizeRailMode {
  if (params.chartAssistantOpen) {
    return "assistant";
  }
  if (params.historyOpen) {
    return "history";
  }
  return "closed";
}
