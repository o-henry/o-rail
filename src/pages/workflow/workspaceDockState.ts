import type { WorkflowWorkspaceActivityEntry, WorkflowWorkspaceTerminalPane } from "./workflowWorkspaceTerminalTypes";

export function tailGraphObserverLines(text: string, limit = 5): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit);
}

export function buildWorkspacePaneViewport(input: {
  pane: WorkflowWorkspaceTerminalPane;
  activityEntries: WorkflowWorkspaceActivityEntry[];
}): string {
  const buffer = input.pane.buffer.trim();
  if (buffer) {
    return buffer;
  }

  const relatedEntries = input.activityEntries
    .filter((entry) => entry.paneId === input.pane.id)
    .slice(0, 6)
    .reverse();

  if (relatedEntries.length > 0) {
    return relatedEntries.map((entry) => `[${entry.meta}] ${entry.body}`).join("\n\n");
  }

  return `${input.pane.title} Codex 세션 대기 중...\n그래프에서 연결된 역할을 실행하면 이 창에 실시간 출력이 쌓입니다.`;
}
