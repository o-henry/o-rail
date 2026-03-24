import { useEffect } from "react";
import { emitWorkspaceDiagnostic } from "../main/runtime/workspaceDiagnosticLog";

type Params = {
  enabled: boolean;
  workspaceTab: string;
};

const FRAME_STALL_THRESHOLD_MS = 250;
const FRAME_STALL_COOLDOWN_MS = 2_000;
const LONG_TASK_THRESHOLD_MS = 50;

export function useRendererPerformanceDiagnostics(params: Params) {
  const { enabled, workspaceTab } = params;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof performance === "undefined") {
      return;
    }
    let rafId = 0;
    let lastFrameAt = performance.now();
    let lastLoggedAt = 0;
    let cancelled = false;

    const tick = (now: number) => {
      const delta = now - lastFrameAt;
      lastFrameAt = now;
      if (delta >= FRAME_STALL_THRESHOLD_MS && now - lastLoggedAt >= FRAME_STALL_COOLDOWN_MS) {
        lastLoggedAt = now;
        emitWorkspaceDiagnostic({
          at: new Date().toISOString(),
          kind: "renderer_frame_stall",
          level: delta >= 1_500 ? "error" : "info",
          tab: workspaceTab,
          message: `frame stall ${Math.round(delta)}ms`,
          payload: {
            durationMs: Math.round(delta),
            visibilityState: document.visibilityState,
          },
        });
      }
      if (!cancelled) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled, workspaceTab]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
      return;
    }
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_THRESHOLD_MS) {
            continue;
          }
          emitWorkspaceDiagnostic({
            at: new Date().toISOString(),
            kind: "renderer_longtask",
            level: entry.duration >= 1_500 ? "error" : "info",
            tab: workspaceTab,
            message: `long task ${Math.round(entry.duration)}ms`,
            payload: {
              name: entry.name,
              entryType: entry.entryType,
              startTime: Math.round(entry.startTime),
              durationMs: Math.round(entry.duration),
            },
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      observer = null;
    }
    return () => {
      observer?.disconnect();
    };
  }, [enabled, workspaceTab]);
}
