import type { TaskTerminalPane } from "../tasks/taskTerminalTypes";

export function reorderShellTerminalPanes(
  panes: TaskTerminalPane[],
  draggedPaneId: string,
  targetPaneId: string,
): TaskTerminalPane[] {
  if (!draggedPaneId || !targetPaneId || draggedPaneId === targetPaneId) {
    return panes;
  }
  const sourceIndex = panes.findIndex((pane) => pane.id === draggedPaneId);
  const targetIndex = panes.findIndex((pane) => pane.id === targetPaneId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return panes;
  }
  const next = [...panes];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) {
    return panes;
  }
  next.splice(targetIndex, 0, moved);
  return next;
}

export function renameShellTerminalPaneTitle(
  panes: TaskTerminalPane[],
  paneId: string,
  nextTitle: string,
): TaskTerminalPane[] {
  const normalizedPaneId = String(paneId ?? "").trim();
  const normalizedTitle = String(nextTitle ?? "").trim();
  if (!normalizedPaneId || !normalizedTitle) {
    return panes;
  }
  return panes.map((pane) => (
    pane.id === normalizedPaneId
      ? { ...pane, title: normalizedTitle }
      : pane
  ));
}

export function createShellTerminalPane(input: {
  threadId: string;
  cwd: string;
  index: number;
}): TaskTerminalPane {
  const threadId = String(input.threadId ?? "").trim();
  const cwd = String(input.cwd ?? "").trim();
  const index = Math.max(1, input.index);
  const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `tasks-shell-terminal:${threadId}:${index}:${instanceId}`,
    title: `TERMINAL ${index}`,
    subtitle: cwd,
    startupCommand: "",
    buffer: "",
    input: "",
    status: "idle",
    exitCode: null,
  };
}
