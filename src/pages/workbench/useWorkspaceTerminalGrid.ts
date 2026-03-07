import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import { invoke, listen } from "../../shared/tauri";
import type { GraphNode } from "../../features/workflow/types";
import type { WorkbenchNodeState, WorkbenchWorkspaceEvent } from "./workbenchRuntimeTypes";
import { appendTerminalChunk, buildGraphObserverText } from "./workspaceTerminalState";
import type {
  WorkspaceActivityEntry,
  WorkspaceTerminalOutputEvent,
  WorkspaceTerminalPane,
  WorkspaceTerminalPaneStatus,
  WorkspaceTerminalStateEvent,
} from "./workspaceTerminalTypes";

const TERMINAL_ROLE_IDS = ["pm_planner", "client_programmer", "system_programmer", "qa_engineer"] as const;

function createPane(id: string, title: string, subtitle: string): WorkspaceTerminalPane {
  return {
    id,
    title,
    subtitle,
    startupCommand: "codex",
    buffer: "",
    input: "",
    status: "idle",
    exitCode: null,
  };
}

function statusMessage(status: WorkspaceTerminalPaneStatus, exitCode?: number | null): string {
  if (status === "running") {
    return "running";
  }
  if (status === "starting") {
    return "starting";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "exited") {
    return `exited${typeof exitCode === "number" ? ` (${exitCode})` : ""}`;
  }
  if (status === "stopped") {
    return "stopped";
  }
  return "idle";
}

function createActivityEntry(input: {
  title: string;
  body: string;
  meta: string;
  tone: WorkspaceActivityEntry["tone"];
  paneId?: string;
}): WorkspaceActivityEntry {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    body: input.body,
    meta: input.meta,
    tone: input.tone,
    paneId: input.paneId,
  };
}

export function useWorkspaceTerminalGrid(params: {
  cwd: string;
  graphFileName: string;
  graphNodes: GraphNode[];
  nodeStates: Record<string, WorkbenchNodeState>;
  workspaceEvents: WorkbenchWorkspaceEvent[];
}) {
  const rolePanes = useMemo(
    () =>
      TERMINAL_ROLE_IDS.map((roleId) => {
        const role = STUDIO_ROLE_TEMPLATES.find((item) => item.id === roleId);
        return createPane(`workspace-${roleId}`, role?.label ?? roleId, role?.goal ?? "Codex CLI");
      }),
    [],
  );

  const [panes, setPanes] = useState<WorkspaceTerminalPane[]>(rolePanes);
  const [selectedPaneId, setSelectedPaneId] = useState<string>(rolePanes[0]?.id ?? "");
  const [activityEntries, setActivityEntries] = useState<WorkspaceActivityEntry[]>([]);
  const seenWorkspaceEventIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        buffer: pane.buffer,
      })),
    );
  }, []);

  const appendActivity = useCallback((entry: WorkspaceActivityEntry) => {
    setActivityEntries((current) => [entry, ...current].slice(0, 120));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let offOutput: null | (() => Promise<void>) = null;
    let offState: null | (() => Promise<void>) = null;

    void listen("workspace-terminal-output", (event) => {
      if (cancelled) {
        return;
      }
      const payload = event.payload as WorkspaceTerminalOutputEvent;
      const pane = rolePanes.find((row) => row.id === payload.sessionId);
      setPanes((current) =>
        current.map((pane) => (
          pane.id === payload.sessionId
            ? { ...pane, buffer: appendTerminalChunk(pane.buffer, payload.chunk) }
            : pane
        )),
      );
      const body = String(payload.chunk ?? "").trim();
      if (body) {
        appendActivity(
          createActivityEntry({
            title: pane?.title ?? payload.sessionId,
            body,
            meta: payload.stream,
            tone: "role",
            paneId: payload.sessionId,
          }),
        );
      }
    }).then((unlisten) => {
      offOutput = unlisten;
    }).catch(() => undefined);

    void listen("workspace-terminal-state", (event) => {
      if (cancelled) {
        return;
      }
      const payload = event.payload as WorkspaceTerminalStateEvent;
      const pane = rolePanes.find((row) => row.id === payload.sessionId);
      setPanes((current) =>
        current.map((pane) => (
          pane.id === payload.sessionId
            ? {
                ...pane,
                status: payload.state,
                exitCode: payload.exitCode ?? null,
                buffer: payload.message
                  ? appendTerminalChunk(pane.buffer, `\n[system] ${payload.message}\n`)
                  : pane.buffer,
              }
            : pane
        )),
      );
      appendActivity(
        createActivityEntry({
          title: pane?.title ?? payload.sessionId,
          body: payload.message ?? statusMessage(payload.state, payload.exitCode ?? null),
          meta: payload.state,
          tone: payload.state === "error" ? "system" : "role",
          paneId: payload.sessionId,
        }),
      );
    }).then((unlisten) => {
      offState = unlisten;
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      void offOutput?.();
      void offState?.();
    };
  }, []);

  useEffect(() => {
    const nextEntries = params.workspaceEvents.filter((event) => !seenWorkspaceEventIdsRef.current.has(event.id));
    if (nextEntries.length === 0) {
      return;
    }
    for (const event of nextEntries) {
      seenWorkspaceEventIdsRef.current.add(event.id);
    }
    setActivityEntries((current) => [
      ...nextEntries
        .slice()
        .reverse()
        .map((event) =>
          createActivityEntry({
            title: event.source.toUpperCase(),
            body: event.message,
            meta: event.level ?? "info",
            tone: "graph",
          }),
        ),
      ...current,
    ].slice(0, 120));
  }, [params.workspaceEvents]);

  const graphObserverText = useMemo(
    () =>
      buildGraphObserverText({
        graphFileName: params.graphFileName,
        graphNodes: params.graphNodes,
        nodeStates: params.nodeStates,
        workspaceEvents: params.workspaceEvents,
      }),
    [params.graphFileName, params.graphNodes, params.nodeStates, params.workspaceEvents],
  );

  const startPane = useCallback(async (paneId: string) => {
    const pane = panes.find((row) => row.id === paneId);
    if (!pane || !params.cwd) {
      return;
    }
    appendActivity(
      createActivityEntry({
        title: pane.title,
        body: "Codex CLI 세션 시작 요청",
        meta: "user action",
        tone: "user",
        paneId,
      }),
    );
    setPanes((current) => current.map((row) => row.id === paneId ? { ...row, status: "starting" } : row));
    try {
      await invoke("workspace_terminal_start", {
        sessionId: paneId,
        cwd: params.cwd,
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
  }, [appendActivity, panes, params.cwd]);

  const stopPane = useCallback(async (paneId: string) => {
    const pane = panes.find((row) => row.id === paneId);
    if (pane) {
      appendActivity(
        createActivityEntry({
          title: pane.title,
          body: "세션 중단 요청",
          meta: "user action",
          tone: "user",
          paneId,
        }),
      );
    }
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
  }, [appendActivity, panes]);

  const sendPaneInput = useCallback(async (paneId: string) => {
    const pane = panes.find((row) => row.id === paneId);
    const chars = String(pane?.input ?? "").trimEnd();
    if (!pane || !chars) {
      return;
    }
    appendActivity(
      createActivityEntry({
        title: pane.title,
        body: chars,
        meta: "추가 요구사항",
        tone: "user",
        paneId,
      }),
    );
    setPanes((current) =>
      current.map((row) =>
        row.id === paneId
          ? {
              ...row,
              input: "",
              buffer: appendTerminalChunk(row.buffer, `\n$ ${chars}\n`),
            }
          : row,
      ),
    );
    try {
      await invoke("workspace_terminal_input", {
        sessionId: paneId,
        chars: `${chars}\n`,
      });
    } catch (error) {
      setPanes((current) =>
        current.map((row) =>
          row.id === paneId
            ? {
                ...row,
                status: "error",
                buffer: appendTerminalChunk(row.buffer, `\n[system] ${String(error ?? "failed to send input")}\n`),
              }
            : row,
        ),
      );
    }
  }, [appendActivity, panes]);

  const setPaneInput = useCallback((paneId: string, value: string) => {
    setPanes((current) => current.map((row) => row.id === paneId ? { ...row, input: value } : row));
  }, []);

  const clearPane = useCallback((paneId: string) => {
    setPanes((current) => current.map((row) => row.id === paneId ? { ...row, buffer: "" } : row));
  }, []);

  const startAllPanes = useCallback(() => {
    void Promise.all(rolePanes.map((pane) => startPane(pane.id)));
  }, [rolePanes, startPane]);

  const stopAllPanes = useCallback(() => {
    void Promise.all(rolePanes.map((pane) => stopPane(pane.id)));
  }, [rolePanes, stopPane]);

  return {
    activityEntries,
    selectedPaneId,
    panes,
    graphObserverText,
    setSelectedPaneId,
    startPane,
    stopPane,
    sendPaneInput,
    setPaneInput,
    clearPane,
    startAllPanes,
    stopAllPanes,
    statusMessage,
  };
}
