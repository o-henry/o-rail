import type { TaskRoleId } from "./taskTypes";

export type TaskTerminalPaneStatus = "idle" | "starting" | "running" | "stopped" | "error" | "exited";

export type TaskTerminalPane = {
  id: string;
  title: string;
  subtitle: string;
  startupCommand: string;
  buffer: string;
  input: string;
  status: TaskTerminalPaneStatus;
  exitCode?: number | null;
  roleId?: TaskRoleId;
};
