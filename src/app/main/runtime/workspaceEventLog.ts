export type WorkspaceEventActor = "user" | "ai" | "system";
export type WorkspaceEventLevel = "info" | "error";

export type WorkspaceEventEntry = {
  id: string;
  at: string;
  source: string;
  actor: WorkspaceEventActor;
  level: WorkspaceEventLevel;
  message: string;
};

export function createWorkspaceEventEntry(input: {
  source: string;
  message: string;
  actor?: WorkspaceEventActor;
  level?: WorkspaceEventLevel;
}): WorkspaceEventEntry {
  const source = String(input.source ?? "").trim() || "system";
  const message = String(input.message ?? "").trim();
  const actor = input.actor ?? "system";
  const level = input.level ?? "info";
  const at = new Date().toISOString();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    at,
    source,
    actor,
    level,
    message,
  };
}

export function workspaceEventLogFileName(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_workspace-events.md`;
}

export function workspaceEventLogToMarkdown(entries: WorkspaceEventEntry[]): string {
  const header = [
    "# Workspace Event Log",
    "",
    "| time | source | actor | level | message |",
    "| --- | --- | --- | --- | --- |",
  ];
  const rows = entries.map((entry) => {
    const date = new Date(entry.at);
    const timeText = Number.isNaN(date.getTime()) ? entry.at : date.toLocaleString();
    const message = entry.message.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
    return `| ${timeText} | ${entry.source} | ${entry.actor} | ${entry.level} | ${message} |`;
  });
  return [...header, ...rows].join("\n");
}
