export type WorkspaceEventActor = "user" | "ai" | "system";
export type WorkspaceEventLevel = "info" | "error";

export type WorkspaceEventEntry = {
  id: string;
  at: string;
  source: string;
  actor: WorkspaceEventActor;
  level: WorkspaceEventLevel;
  message: string;
  runId?: string;
  topic?: string;
};

export function createWorkspaceEventEntry(input: {
  source: string;
  message: string;
  actor?: WorkspaceEventActor;
  level?: WorkspaceEventLevel;
  runId?: string;
  topic?: string;
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
    runId: String(input.runId ?? "").trim() || undefined,
    topic: String(input.topic ?? "").trim() || undefined,
  };
}

export function workspaceEventLogFileName(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_workspace-events.md`;
}

function escapeMarkdownTableCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

export function workspaceEventLogToMarkdown(entries: WorkspaceEventEntry[]): string {
  const header = [
    "# Workspace Event Log",
    "",
    "| time | source | actor | level | runId | topic | message |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = entries.map((entry) => {
    const date = new Date(entry.at);
    const timeText = Number.isNaN(date.getTime()) ? entry.at : date.toLocaleString();
    return `| ${escapeMarkdownTableCell(timeText)} | ${escapeMarkdownTableCell(entry.source)} | ${escapeMarkdownTableCell(entry.actor)} | ${escapeMarkdownTableCell(entry.level)} | ${escapeMarkdownTableCell(entry.runId ?? "")} | ${escapeMarkdownTableCell(entry.topic ?? "")} | ${escapeMarkdownTableCell(entry.message)} |`;
  });
  return [...header, ...rows].join("\n");
}
