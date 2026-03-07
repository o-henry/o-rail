export type WorkflowWorkspaceTerminalStream = "stdout" | "stderr";

export type WorkflowWorkspaceTerminalOutputEvent = {
  sessionId: string;
  stream: WorkflowWorkspaceTerminalStream;
  chunk: string;
  at: string;
};

export type WorkflowWorkspaceTerminalStateEvent = {
  sessionId: string;
  state: "starting" | "running" | "stopped" | "error" | "exited";
  exitCode?: number | null;
  message?: string;
};

export type WorkflowWorkspaceTerminalPaneStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error"
  | "exited";

export type WorkflowWorkspaceTerminalPane = {
  id: string;
  roleId?: string;
  title: string;
  subtitle: string;
  startupCommand: string;
  buffer: string;
  input: string;
  status: WorkflowWorkspaceTerminalPaneStatus;
  exitCode?: number | null;
};

export type WorkflowWorkspaceActivityTone = "role" | "graph" | "system" | "user";

export type WorkflowWorkspaceActivityEntry = {
  id: string;
  title: string;
  body: string;
  meta: string;
  tone: WorkflowWorkspaceActivityTone;
  paneId?: string;
};
