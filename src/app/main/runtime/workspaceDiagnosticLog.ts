import type { WorkspaceEventEntry } from "./workspaceEventLog";

export type WorkspaceDiagnosticEntry = {
  at: string;
  kind: string;
  level: "info" | "error";
  tab?: string;
  source?: string;
  actor?: string;
  runId?: string;
  topic?: string;
  message: string;
  payload?: Record<string, unknown>;
};

export const WORKSPACE_DIAGNOSTIC_EVENT = "rail:diagnostic";

export function workspaceDiagnosticLogFileName(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_app-diagnostics.jsonl`;
}

export function createWorkspaceDiagnosticLine(entry: WorkspaceDiagnosticEntry): string {
  return JSON.stringify(entry);
}

export function workspaceEventToDiagnosticLine(entry: WorkspaceEventEntry, tab: string): string {
  return createWorkspaceDiagnosticLine({
    at: entry.at,
    kind: "workspace_event",
    level: entry.level,
    tab,
    source: entry.source,
    actor: entry.actor,
    runId: entry.runId,
    topic: entry.topic,
    message: entry.message,
  });
}

export function emitWorkspaceDiagnostic(entry: WorkspaceDiagnosticEntry) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<WorkspaceDiagnosticEntry>(WORKSPACE_DIAGNOSTIC_EVENT, {
    detail: entry,
  }));
}
