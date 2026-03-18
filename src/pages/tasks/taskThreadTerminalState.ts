import type { TaskTerminalPane } from "./taskTerminalTypes";
import type { ThreadDetail } from "./threadTypes";

export function buildTasksThreadTerminalSessionId(threadId: string): string {
  const normalized = String(threadId ?? "").trim();
  return normalized ? `tasks-thread-terminal:${normalized}` : "";
}

export function resolveTasksThreadTerminalCwd(detail: ThreadDetail | null): string {
  if (!detail) {
    return "";
  }
  return String(detail.task.worktreePath || detail.task.workspacePath || detail.task.projectPath || detail.thread.cwd || "").trim();
}

export function createTasksThreadTerminalPane(detail: ThreadDetail | null): TaskTerminalPane | null {
  if (!detail) {
    return null;
  }
  const sessionId = buildTasksThreadTerminalSessionId(detail.thread.threadId);
  if (!sessionId) {
    return null;
  }
  return {
    id: sessionId,
    title: "THREAD TERMINAL",
    subtitle: resolveTasksThreadTerminalCwd(detail),
    startupCommand: "",
    buffer: "",
    input: "",
    status: "idle",
    exitCode: null,
  };
}
