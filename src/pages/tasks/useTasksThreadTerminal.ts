import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "../../shared/tauri";
import { createTasksThreadTerminalPane, resolveTasksThreadTerminalCwd } from "./taskThreadTerminalState";
import type { TaskTerminalPane, TaskTerminalPaneStatus } from "./taskTerminalTypes";
import type { ThreadDetail } from "./threadTypes";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type WorkspaceTerminalOutputEvent = {
  sessionId: string;
  stream: "stdout" | "stderr";
  chunk: string;
  at: string;
};

type WorkspaceTerminalStateEvent = {
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

export function useTasksThreadTerminal(params: {
  thread: ThreadDetail | null;
  enabled: boolean;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
}) {
  const initialPane = useMemo(() => createTasksThreadTerminalPane(params.thread), [params.thread]);
  const cwd = useMemo(() => resolveTasksThreadTerminalCwd(params.thread), [params.thread]);
  const [pane, setPane] = useState<TaskTerminalPane | null>(initialPane);
  const autoStartedSessionIdRef = useRef("");

  useEffect(() => {
    setPane((current) => {
      if (!initialPane) {
        return null;
      }
      if (!current || current.id !== initialPane.id) {
        return initialPane;
      }
      return {
        ...initialPane,
        buffer: current.buffer,
        input: current.input,
        status: current.status,
        exitCode: current.exitCode,
      };
    });
  }, [initialPane]);

  useEffect(() => {
    if (!params.hasTauriRuntime || !pane?.id) {
      return;
    }
    let cancelled = false;
    let offOutput: null | (() => Promise<void>) = null;
    let offState: null | (() => Promise<void>) = null;

    void listen("workspace-terminal-output", (event) => {
      if (cancelled) {
        return;
      }
      const payload = event.payload as WorkspaceTerminalOutputEvent;
      if (payload.sessionId !== pane.id) {
        return;
      }
      setPane((current) =>
        current && current.id === payload.sessionId
          ? { ...current, buffer: appendTerminalChunk(current.buffer, payload.chunk) }
          : current,
      );
    }).then((unlisten) => {
      offOutput = unlisten;
    }).catch(() => undefined);

    void listen("workspace-terminal-state", (event) => {
      if (cancelled) {
        return;
      }
      const payload = event.payload as WorkspaceTerminalStateEvent;
      if (payload.sessionId !== pane.id) {
        return;
      }
      setPane((current) =>
        current && current.id === payload.sessionId
          ? {
              ...current,
              status: payload.state,
              exitCode: payload.exitCode ?? null,
              buffer: payload.message
                ? appendTerminalChunk(current.buffer, `\n[system] ${String(payload.message)}\n`)
                : current.buffer,
            }
          : current,
      );
    }).then((unlisten) => {
      offState = unlisten;
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      void offOutput?.();
      void offState?.();
    };
  }, [pane?.id, params.hasTauriRuntime]);

  const start = useCallback(async () => {
    if (!params.hasTauriRuntime || !pane || !cwd) {
      return;
    }
    setPane((current) => (current ? { ...current, status: "starting", exitCode: null } : current));
    try {
      await params.invokeFn<void>("workspace_terminal_start", {
        sessionId: pane.id,
        cwd,
        initialCommand: pane.startupCommand || null,
      });
    } catch (error) {
      setPane((current) =>
        current
          ? {
              ...current,
              status: "error",
              buffer: appendTerminalChunk(current.buffer, `\n[system] ${String(error ?? "failed to start terminal")}\n`),
            }
          : current,
      );
    }
  }, [cwd, pane, params]);

  const sendChars = useCallback(
    async (chars: string) => {
      if (!params.hasTauriRuntime || !pane || !chars) {
        return;
      }
      try {
        await params.invokeFn<void>("workspace_terminal_input", {
          sessionId: pane.id,
          chars,
        });
      } catch (error) {
        const message = String(error ?? "failed to stream terminal input");
        if (message.includes("session not found") && cwd) {
          await start();
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          await params.invokeFn<void>("workspace_terminal_input", {
            sessionId: pane.id,
            chars,
          });
          return;
        }
        setPane((current) =>
          current
            ? {
                ...current,
                status: "error",
                buffer: appendTerminalChunk(current.buffer, `\n[system] ${message}\n`),
              }
            : current,
        );
      }
    },
    [cwd, pane, params, start],
  );

  const interrupt = useCallback(async () => {
    if (!params.hasTauriRuntime || !pane) {
      return;
    }
    try {
      await params.invokeFn<void>("workspace_terminal_stop", { sessionId: pane.id });
    } catch (error) {
      setPane((current) =>
        current
          ? {
              ...current,
              status: "error",
              buffer: appendTerminalChunk(current.buffer, `\n[system] ${String(error ?? "failed to interrupt terminal")}\n`),
            }
          : current,
      );
    }
  }, [pane, params]);

  const clear = useCallback(() => {
    setPane((current) => (current ? { ...current, buffer: "" } : current));
  }, []);

  useEffect(() => {
    if (!params.enabled || !pane?.id || !params.hasTauriRuntime || !cwd) {
      return;
    }
    if (autoStartedSessionIdRef.current === pane.id && !AUTO_STARTABLE_STATUSES.has(pane.status)) {
      return;
    }
    autoStartedSessionIdRef.current = pane.id;
    void start();
  }, [cwd, pane?.id, pane?.status, params.enabled, params.hasTauriRuntime, start]);

  return {
    pane,
    cwd,
    isUnsupported: params.enabled && !params.hasTauriRuntime,
    start,
    sendChars,
    interrupt,
    clear,
  };
}
