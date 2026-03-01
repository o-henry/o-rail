import { useEffect, useRef } from "react";
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
  }) => void;
  workspaceEvents: WorkspaceEventEntry[];
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
};

export function useWorkspaceEventPersistence(params: UseWorkspaceEventPersistenceParams) {
  const workspaceEventPersistTimerRef = useRef<number | null>(null);
  const lastLoggedStatusRef = useRef("");
  const lastLoggedErrorRef = useRef("");

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
  }, [params]);

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
  }, [params]);

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
  }, [params]);
}
