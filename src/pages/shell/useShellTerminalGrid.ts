import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "../../shared/tauri";
import { resolveTasksThreadTerminalCwd } from "../tasks/taskThreadTerminalState";
import type { TaskTerminalPane, TaskTerminalPaneStatus } from "../tasks/taskTerminalTypes";
import type { ThreadDetail } from "../tasks/threadTypes";
import {
  createShellTerminalPane,
  renameShellTerminalPaneTitle,
  reorderShellTerminalPanes,
} from "./shellTerminalGridState";

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

function appendTerminalChunk(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length > 80_000 ? next.slice(-80_000) : next;
}

export function useShellTerminalGrid(params: {
  thread: ThreadDetail | null;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
}) {
  const threadId = String(params.thread?.thread.threadId ?? "").trim();
  const cwd = useMemo(() => resolveTasksThreadTerminalCwd(params.thread), [params.thread]);
  const [panes, setPanes] = useState<TaskTerminalPane[]>([]);
  const [selectedPaneId, setSelectedPaneId] = useState("");
  const [draggedPaneId, setDraggedPaneId] = useState("");
  const paneCounterRef = useRef(0);

  useEffect(() => {
    setPanes([]);
    setSelectedPaneId("");
    setDraggedPaneId("");
    paneCounterRef.current = 0;
  }, [threadId]);

  useEffect(() => {
    if (!params.hasTauriRuntime) {
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
      setPanes((current) =>
        current.map((pane) =>
          pane.id === payload.sessionId ? { ...pane, buffer: appendTerminalChunk(pane.buffer, payload.chunk) } : pane,
        ),
      );
    }).then((unlisten) => {
      offOutput = unlisten;
    }).catch(() => undefined);

    void listen("workspace-terminal-state", (event) => {
      if (cancelled) {
        return;
      }
      const payload = event.payload as WorkspaceTerminalStateEvent;
      setPanes((current) =>
        current.map((pane) =>
          pane.id === payload.sessionId
            ? {
                ...pane,
                status: payload.state,
                exitCode: payload.exitCode ?? null,
                buffer: payload.state === "error" && payload.message
                  ? appendTerminalChunk(pane.buffer, `\n[system] ${String(payload.message)}\n`)
                  : pane.buffer,
              }
            : pane,
        ),
      );
    }).then((unlisten) => {
      offState = unlisten;
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      void offOutput?.();
      void offState?.();
    };
  }, [params.hasTauriRuntime]);

  const startPane = useCallback(async (pane: TaskTerminalPane) => {
    if (!params.hasTauriRuntime || !cwd) {
      return;
    }
    setPanes((current) =>
      current.map((row) => (row.id === pane.id ? { ...row, status: "starting", exitCode: null } : row)),
    );
    try {
      await params.invokeFn<void>("workspace_terminal_start", {
        sessionId: pane.id,
        cwd,
        initialCommand: pane.startupCommand || null,
      });
    } catch (error) {
      setPanes((current) =>
        current.map((row) =>
          row.id === pane.id
            ? {
                ...row,
                status: "error",
                buffer: appendTerminalChunk(row.buffer, `\n[system] ${String(error ?? "failed to start terminal")}\n`),
              }
            : row,
        ),
      );
    }
  }, [cwd, params]);

  const addPane = useCallback(async () => {
    if (!threadId || !cwd) {
      return;
    }
    paneCounterRef.current += 1;
    const pane = createShellTerminalPane({
      threadId,
      cwd,
      index: paneCounterRef.current,
    });
    setPanes((current) => [...current, pane]);
    setSelectedPaneId(pane.id);
    await startPane(pane);
  }, [cwd, startPane, threadId]);

  const sendChars = useCallback(async (paneId: string, chars: string) => {
    if (!params.hasTauriRuntime || !chars) {
      return;
    }
    try {
      await params.invokeFn<void>("workspace_terminal_input", { sessionId: paneId, chars });
    } catch (error) {
      const message = String(error ?? "failed to stream terminal input");
      setPanes((current) =>
        current.map((pane) =>
          pane.id === paneId
            ? { ...pane, status: "error", buffer: appendTerminalChunk(pane.buffer, `\n[system] ${message}\n`) }
            : pane,
        ),
      );
    }
  }, [params]);

  const interruptPane = useCallback(async (paneId: string) => {
    if (!params.hasTauriRuntime) {
      return;
    }
    try {
      await params.invokeFn<void>("workspace_terminal_stop", { sessionId: paneId });
    } catch (error) {
      setPanes((current) =>
        current.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                status: "error",
                buffer: appendTerminalChunk(pane.buffer, `\n[system] ${String(error ?? "failed to interrupt terminal")}\n`),
              }
            : pane,
        ),
      );
    }
  }, [params]);

  const clearPane = useCallback((paneId: string) => {
    setPanes((current) => current.map((pane) => (pane.id === paneId ? { ...pane, buffer: "" } : pane)));
  }, []);

  const renamePane = useCallback((paneId: string, nextTitle: string) => {
    setPanes((current) => renameShellTerminalPaneTitle(current, paneId, nextTitle));
  }, []);

  const closePane = useCallback(async (paneId: string) => {
    if (params.hasTauriRuntime) {
      try {
        await params.invokeFn<void>("workspace_terminal_close", { sessionId: paneId });
      } catch (error) {
        setPanes((current) =>
          current.map((pane) =>
            pane.id === paneId
              ? {
                  ...pane,
                  status: "error",
                  buffer: appendTerminalChunk(pane.buffer, `\n[system] ${String(error ?? "failed to close terminal")}\n`),
                }
              : pane,
          ),
        );
      }
    }
    setPanes((current) => current.filter((pane) => pane.id !== paneId));
    setSelectedPaneId((current) => (current === paneId ? "" : current));
  }, [params]);

  const reorderPanes = useCallback((targetPaneId: string) => {
    if (!draggedPaneId || !targetPaneId || draggedPaneId === targetPaneId) {
      return;
    }
    setPanes((current) => reorderShellTerminalPanes(current, draggedPaneId, targetPaneId));
    setDraggedPaneId("");
  }, [draggedPaneId]);

  useEffect(() => {
    if (panes.length === 0) {
      setSelectedPaneId("");
      return;
    }
    setSelectedPaneId((current) => (panes.some((pane) => pane.id === current) ? current : panes[0]!.id));
  }, [panes]);

  return {
    panes,
    cwd,
    selectedPaneId,
    draggedPaneId,
    isUnsupported: !params.hasTauriRuntime,
    setSelectedPaneId,
    setDraggedPaneId,
    addPane,
    sendChars,
    interruptPane,
    clearPane,
    renamePane,
    closePane,
    reorderPanes,
  };
}
