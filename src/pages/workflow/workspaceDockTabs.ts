import type { WorkflowWorkspaceTerminalPane } from "./workflowWorkspaceTerminalTypes";

export type WorkflowWorkspaceTabModel = {
  activePaneId: string;
  pairStartIndex: number;
  visiblePaneIds: string[];
};

export function buildWorkspaceTabModel(panes: WorkflowWorkspaceTerminalPane[], activePaneId: string): WorkflowWorkspaceTabModel {
  if (panes.length === 0) {
    return {
      activePaneId: "",
      pairStartIndex: 0,
      visiblePaneIds: [],
    };
  }

  const activeIndex = Math.max(
    0,
    panes.findIndex((pane) => pane.id === activePaneId),
  );
  const normalizedIndex = activeIndex === -1 ? 0 : activeIndex;
  const pairStartIndex = Math.floor(normalizedIndex / 2) * 2;
  const visiblePaneIds = panes
    .slice(pairStartIndex, pairStartIndex + 2)
    .map((pane) => pane.id);

  return {
    activePaneId: panes[normalizedIndex]?.id ?? panes[0].id,
    pairStartIndex,
    visiblePaneIds,
  };
}
