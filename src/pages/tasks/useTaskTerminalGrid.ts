import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen } from "../../shared/tauri";
import { getTaskAgentLabel, orderedTaskAgentPresetIds } from "./taskAgentPresets";
import type { TaskDetail, TaskRoleId } from "./taskTypes";

export type TaskTerminalPaneStatus = "idle" | "starting" | "running" | "stopped" | "error" | "exited";

export type TaskTerminalPane = {
  id: string;
  roleId: TaskRoleId;
  title: string;
  subtitle: string;
  startupCommand: string;
  buffer: string;
  input: string;
  status: TaskTerminalPaneStatus;
  exitCode?: number | null;
};

type TaskTerminalOutputEvent = {
  sessionId: string;
  stream: "stdout" | "stderr";
  chunk: string;
  at: string;
};

type TaskTerminalStateEvent = {
  sessionId: string;
  state: TaskTerminalPaneStatus;
  exitCode?: number | null;
  message?: string;
};

const AUTO_STARTABLE_STATUSES = new Set<TaskTerminalPaneStatus>(["idle", "stopped", "exited", "error"]);

function appendTerminalChunk(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length > 80_000 ? next.slice(-80_000) : next;
}

function makePane(task: TaskDetail, roleId: TaskRoleId): TaskTerminalPane {
  const role = task.record.roles.find((row) => row.id === roleId)!;
  return {
    id: `task-${task.record.taskId}-${roleId}`,
    roleId,
    title: getTaskAgentLabel(roleId),
    subtitle: role.studioRoleId,
    startupCommand: "codex",
    buffer: "",
    input: "",
    status: "idle",
    exitCode: null,
  };
}

export function taskTerminalStatusLabel(status: TaskTerminalPaneStatus, exitCode?: number | null): string {
  if (status === "running") return "RUNNING";
  if (status === "starting") return "STARTING";
  if (status === "error") return "ERROR";
  if (status === "stopped") return "STOPPED";
  if (status === "exited") return `EXITED${typeof exitCode === "number" ? ` (${exitCode})` : ""}`;
  return "IDLE";
}

export function useTaskTerminalGrid(task: TaskDetail | null) {
  const enabledRoleIds = useMemo<TaskRoleId[]>(
    () => (task ? orderedTaskAgentPresetIds(task.record.roles.filter((role) => role.enabled).map((role) => role.id)) : []),
    [task],
  );
  const basePanes = useMemo(
    () => (task ? enabledRoleIds.map((roleId) => makePane(task, roleId)) : []),
    [enabledRoleIds, task],
  );
  const terminalCwd = task?.record.worktreePath || task?.record.workspacePath || "";
  const autoStartedTaskIdRef = useRef("");

  const [panes, setPanes] = useState<TaskTerminalPane[]>(basePanes);
  const [selectedPaneId, setSelectedPaneId] = useState(basePanes[0]?.id ?? "");

  useEffect(() => {
    setPanes((current) =>
      basePanes.map((pane) => {
        const matched = current.find((row) => row.id === pane.id);
        if (!matched) {
          return pane;
        }
        return {
          ...pane,
          buffer: matched.buffer,
          input: matched.input,
          status: matched.status,
          exitCode: matched.exitCode,
        };
      }),
    );
    setSelectedPaneId((current) => (basePanes.some((pane) => pane.id === current) ? current : basePanes[0]?.id ?? ""));
  }, [basePanes]);

  useEffect(() => {
    let cancelled = false;
    let offOutput: null | (() => Promise<void>) = null;
    let offState: null | (() => Promise<void>) = null;

    void listen("workspace-terminal-output", (event) => {
      if (cancelled) return;
      const payload = event.payload as TaskTerminalOutputEvent;
      setPanes((current) =>
        current.map((pane) =>
          pane.id === payload.sessionId ? { ...pane, buffer: appendTerminalChunk(pane.buffer, payload.chunk) } : pane,
        ),
      );
    })
      .then((unlisten) => {
        offOutput = unlisten;
      })
      .catch(() => undefined);

    void listen("workspace-terminal-state", (event) => {
      if (cancelled) return;
      const payload = event.payload as TaskTerminalStateEvent;
      setPanes((current) =>
        current.map((pane) =>
          pane.id === payload.sessionId
            ? {
                ...pane,
                status: payload.state,
                exitCode: payload.exitCode ?? null,
                buffer: payload.message
                  ? appendTerminalChunk(pane.buffer, `\n[system] ${String(payload.message)}\n`)
                  : pane.buffer,
              }
            : pane,
        ),
      );
    })
      .then((unlisten) => {
        offState = unlisten;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      void offOutput?.();
      void offState?.();
    };
  }, []);

  const startPane = useCallback(
    async (paneId: string) => {
      if (!terminalCwd) return;
      const pane = panes.find((row) => row.id === paneId);
      if (!pane) return;
      setPanes((current) => current.map((row) => (row.id === paneId ? { ...row, status: "starting" } : row)));
      try {
        await invoke("workspace_terminal_start", {
          sessionId: paneId,
          cwd: terminalCwd,
          initialCommand: pane.startupCommand,
        });
      } catch (error) {
        setPanes((current) =>
          current.map((row) =>
            row.id === paneId
              ? {
                  ...row,
                  status: "error",
                  buffer: appendTerminalChunk(row.buffer, `\n[system] ${String(error ?? "failed to start session")}\n`),
                }
              : row,
          ),
        );
      }
    },
    [panes, terminalCwd],
  );

  const stopPane = useCallback(async (paneId: string) => {
    try {
      await invoke("workspace_terminal_stop", { sessionId: paneId });
    } catch (error) {
      setPanes((current) =>
        current.map((row) =>
          row.id === paneId
            ? {
                ...row,
                status: "error",
                buffer: appendTerminalChunk(row.buffer, `\n[system] ${String(error ?? "failed to stop session")}\n`),
              }
            : row,
        ),
      );
    }
  }, []);

  const sendPaneChars = useCallback(
    async (paneId: string, chars: string) => {
      if (!chars) return;
      try {
        await invoke("workspace_terminal_input", { sessionId: paneId, chars });
      } catch (error) {
        const message = String(error ?? "failed to stream terminal input");
        if (message.includes("session not found") && terminalCwd) {
          await startPane(paneId);
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          await invoke("workspace_terminal_input", { sessionId: paneId, chars });
          return;
        }
        setPanes((current) =>
          current.map((row) =>
            row.id === paneId
              ? {
                  ...row,
                  status: "error",
                  buffer: appendTerminalChunk(row.buffer, `\n[system] ${message}\n`),
                }
              : row,
          ),
        );
      }
    },
    [startPane, terminalCwd],
  );

  const sendPaneInput = useCallback(
    async (paneId: string) => {
      const pane = panes.find((row) => row.id === paneId);
      const chars = String(pane?.input ?? "").trimEnd();
      if (!pane || !chars) return;
      setPanes((current) => current.map((row) => (row.id === paneId ? { ...row, input: "" } : row)));
      await sendPaneChars(paneId, `${chars}\n`);
    },
    [panes, sendPaneChars],
  );

  const setPaneInput = useCallback((paneId: string, value: string) => {
    setPanes((current) => current.map((row) => (row.id === paneId ? { ...row, input: value } : row)));
  }, []);

  const clearPane = useCallback((paneId: string) => {
    setPanes((current) => current.map((row) => (row.id === paneId ? { ...row, buffer: "" } : row)));
  }, []);

  const startEnabledPanes = useCallback(async () => {
    await Promise.all(panes.filter((pane) => AUTO_STARTABLE_STATUSES.has(pane.status)).map((pane) => startPane(pane.id)));
  }, [panes, startPane]);

  const stopAllPanes = useCallback(async () => {
    await Promise.all(panes.map((pane) => stopPane(pane.id)));
  }, [panes, stopPane]);

  useEffect(() => {
    const taskId = task?.record.taskId ?? "";
    if (!taskId || !terminalCwd || taskId === autoStartedTaskIdRef.current) {
      return;
    }
    autoStartedTaskIdRef.current = taskId;
    const paneIds = new Set(basePanes.map((pane) => pane.id));
    setPanes((current) =>
      current.map((row) => (paneIds.has(row.id) ? { ...row, status: "starting", exitCode: null } : row)),
    );
    void Promise.all(
      basePanes.map((pane) =>
        invoke("workspace_terminal_start", {
          sessionId: pane.id,
          cwd: terminalCwd,
          initialCommand: pane.startupCommand,
        }).catch((error) => {
          setPanes((current) =>
            current.map((row) =>
              row.id === pane.id
                ? {
                    ...row,
                    status: "error",
                    buffer: appendTerminalChunk(row.buffer, `\n[system] ${String(error ?? "failed to auto start session")}\n`),
                  }
                : row,
            ),
          );
        }),
      ),
    );
  }, [basePanes, task?.record.taskId, terminalCwd]);

  const selectedPane = panes.find((pane) => pane.id === selectedPaneId) ?? panes[0] ?? null;

  return {
    panes,
    selectedPaneId,
    selectedPane,
    terminalCwd,
    setSelectedPaneId,
    startPane,
    stopPane,
    sendPaneChars,
    sendPaneInput,
    setPaneInput,
    clearPane,
    startEnabledPanes,
    stopAllPanes,
  };
}
