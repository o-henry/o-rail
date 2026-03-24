import { useEffect } from "react";
import type { WorkspaceTab } from "../mainAppGraphHelpers";
import { emitWorkspaceDiagnostic } from "../main/runtime/workspaceDiagnosticLog";

type Params = {
  enabled: boolean;
  workspaceTab: WorkspaceTab;
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: string;
  }) => void;
};

const CHECK_INTERVAL_MS = 500;
const STALL_THRESHOLD_MS = 1600;
const LOG_COOLDOWN_MS = 12000;

export function useMainThreadStallMonitor(params: Params) {
  const { appendWorkspaceEvent, enabled, workspaceTab } = params;
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }
    let lastTick = performance.now();
    let lastLoggedAt = 0;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const drift = now - lastTick - CHECK_INTERVAL_MS;
      lastTick = now;
      if (drift < STALL_THRESHOLD_MS || now - lastLoggedAt < LOG_COOLDOWN_MS) {
        return;
      }
      lastLoggedAt = now;
      emitWorkspaceDiagnostic({
        at: new Date().toISOString(),
        kind: "renderer_interval_stall",
        level: "error",
        tab: workspaceTab,
        message: `interval stall ${Math.round(drift)}ms`,
        payload: {
          driftMs: Math.round(drift),
          visibilityState: document.visibilityState,
        },
      });
      appendWorkspaceEvent({
        source: "app-performance",
        actor: "system",
        level: "error",
        message: `메인 UI 정지 감지: 약 ${Math.round(drift)}ms (${workspaceTab} 탭)`,
      });
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [appendWorkspaceEvent, enabled, workspaceTab]);
}
