import { useEffect, useRef } from "react";
import {
  workspaceDiagnosticLogFileName,
  workspaceEventToDiagnosticLine,
  createWorkspaceDiagnosticLine,
  WORKSPACE_DIAGNOSTIC_EVENT,
  type WorkspaceDiagnosticEntry,
} from "../main/runtime/workspaceDiagnosticLog";
import {
  workspaceEventLogFileName,
  workspaceEventLogToMarkdown,
  type WorkspaceEventEntry,
} from "../main/runtime/workspaceEventLog";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type UseWorkspaceEventPersistenceParams = {
  status: string;
  error: string;
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: string;
  }) => void;
  workspaceEvents: WorkspaceEventEntry[];
  cwd: string;
  hasTauriRuntime: boolean;
  workspaceTab: string;
  invokeFn: InvokeFn;
};

export function useWorkspaceEventPersistence(params: UseWorkspaceEventPersistenceParams) {
  const workspaceEventPersistTimerRef = useRef<number | null>(null);
  const lastLoggedStatusRef = useRef("");
  const lastLoggedErrorRef = useRef("");
  const persistedDiagnosticIdsRef = useRef<Set<string>>(new Set());

  function appendDiagnosticLine(line: string) {
    const baseCwd = String(params.cwd ?? "").trim();
    if (!params.hasTauriRuntime || !baseCwd) {
      return;
    }
    const eventsDir = `${baseCwd.replace(/[\\/]+$/, "")}/.rail/dashboard/events`;
    void params.invokeFn<string>("workspace_append_log_line", {
      cwd: eventsDir,
      name: workspaceDiagnosticLogFileName(),
      line,
    }).catch(() => {
      // Ignore persistence failures to avoid blocking UI interactions.
    });
  }

  useEffect(() => {
    const next = String(params.status ?? "").trim();
    if (!next || lastLoggedStatusRef.current === next) {
      return;
    }
    lastLoggedStatusRef.current = next;
    params.appendWorkspaceEvent({
      source: "status",
      message: next,
      actor: "ai",
      level: "info",
    });
  }, [params.appendWorkspaceEvent, params.status]);

  useEffect(() => {
    const next = String(params.error ?? "").trim();
    if (!next || lastLoggedErrorRef.current === next) {
      return;
    }
    lastLoggedErrorRef.current = next;
    params.appendWorkspaceEvent({
      source: "error",
      message: next,
      actor: "system",
      level: "error",
    });
  }, [params.appendWorkspaceEvent, params.error]);

  useEffect(() => {
    if (!params.hasTauriRuntime) {
      return;
    }
    const baseCwd = String(params.cwd ?? "").trim();
    if (!baseCwd || params.workspaceEvents.length === 0) {
      return;
    }
    if (workspaceEventPersistTimerRef.current != null) {
      window.clearTimeout(workspaceEventPersistTimerRef.current);
      workspaceEventPersistTimerRef.current = null;
    }
    workspaceEventPersistTimerRef.current = window.setTimeout(() => {
      const eventsDir = `${baseCwd.replace(/[\\/]+$/, "")}/.rail/dashboard/events`;
      const fileName = workspaceEventLogFileName();
      const markdown = workspaceEventLogToMarkdown(params.workspaceEvents);
      void params.invokeFn<string>("workspace_write_markdown", {
        cwd: eventsDir,
        name: fileName,
        content: markdown,
      }).catch(() => {
        // Ignore persistence failures to avoid blocking UI interactions.
      });
    }, 450);
    return () => {
      if (workspaceEventPersistTimerRef.current != null) {
        window.clearTimeout(workspaceEventPersistTimerRef.current);
        workspaceEventPersistTimerRef.current = null;
      }
    };
  }, [params.cwd, params.hasTauriRuntime, params.invokeFn, params.workspaceEvents]);

  useEffect(() => {
    if (!params.hasTauriRuntime) {
      return;
    }
    const unseenEntries = [...params.workspaceEvents]
      .reverse()
      .filter((entry) => !persistedDiagnosticIdsRef.current.has(entry.id));
    if (unseenEntries.length === 0) {
      return;
    }
    unseenEntries.forEach((entry) => {
      persistedDiagnosticIdsRef.current.add(entry.id);
      appendDiagnosticLine(workspaceEventToDiagnosticLine(entry, params.workspaceTab));
    });
  }, [params.hasTauriRuntime, params.workspaceEvents, params.workspaceTab]);

  useEffect(() => {
    if (!params.hasTauriRuntime) {
      return;
    }
    const onDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceDiagnosticEntry>).detail;
      if (!detail || typeof detail !== "object") {
        return;
      }
      appendDiagnosticLine(createWorkspaceDiagnosticLine(detail));
    };
    window.addEventListener(WORKSPACE_DIAGNOSTIC_EVENT, onDiagnostic as EventListener);
    appendDiagnosticLine(createWorkspaceDiagnosticLine({
      at: new Date().toISOString(),
      kind: "renderer_session",
      level: "info",
      tab: params.workspaceTab,
      message: "renderer session mounted",
      payload: { visibilityState: document.visibilityState },
    }));
    const heartbeatTimer = window.setInterval(() => {
      appendDiagnosticLine(createWorkspaceDiagnosticLine({
        at: new Date().toISOString(),
        kind: "renderer_heartbeat",
        level: "info",
        tab: params.workspaceTab,
        message: "renderer heartbeat",
        payload: { visibilityState: document.visibilityState },
      }));
    }, 10_000);
    const onVisibilityChange = () => {
      appendDiagnosticLine(createWorkspaceDiagnosticLine({
        at: new Date().toISOString(),
        kind: "renderer_visibility",
        level: "info",
        tab: params.workspaceTab,
        message: `visibility changed: ${document.visibilityState}`,
      }));
    };
    const onPageHide = (event: PageTransitionEvent) => {
      appendDiagnosticLine(createWorkspaceDiagnosticLine({
        at: new Date().toISOString(),
        kind: "renderer_pagehide",
        level: "info",
        tab: params.workspaceTab,
        message: "renderer pagehide",
        payload: { persisted: event.persisted },
      }));
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener(WORKSPACE_DIAGNOSTIC_EVENT, onDiagnostic as EventListener);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      appendDiagnosticLine(createWorkspaceDiagnosticLine({
        at: new Date().toISOString(),
        kind: "renderer_session_end",
        level: "info",
        tab: params.workspaceTab,
        message: "renderer session cleanup",
      }));
    };
  }, [params.hasTauriRuntime, params.workspaceTab]);
}
