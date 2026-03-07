export type WorkspaceTerminalStream = "stdout" | "stderr";

export type WorkspaceTerminalOutputEvent = {
  sessionId: string;
  stream: WorkspaceTerminalStream;
  chunk: string;
  at: string;
};

export type WorkspaceTerminalStateEvent = {
  sessionId: string;
  state: "starting" | "running" | "stopped" | "error" | "exited";
  exitCode?: number | null;
  message?: string;
};

export type WorkspaceTerminalPaneStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error"
  | "exited";

export type WorkspaceTerminalPane = {
  id: string;
  title: string;
  subtitle: string;
  startupCommand: string;
  buffer: string;
  input: string;
  status: WorkspaceTerminalPaneStatus;
  exitCode?: number | null;
};

export type WorkspaceActivityTone = "role" | "graph" | "system" | "user";

export type WorkspaceActivityEntry = {
  id: string;
  title: string;
  body: string;
  meta: string;
  tone: WorkspaceActivityTone;
  paneId?: string;
};
