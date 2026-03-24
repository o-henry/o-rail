import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceDiagnosticLine,
  emitWorkspaceDiagnostic,
  WORKSPACE_DIAGNOSTIC_EVENT,
  workspaceDiagnosticLogFileName,
  workspaceEventToDiagnosticLine,
} from "./workspaceDiagnosticLog";

describe("workspaceDiagnosticLog", () => {
  it("builds a daily diagnostics file name", () => {
    expect(workspaceDiagnosticLogFileName(new Date("2026-03-24T10:11:12.000Z"))).toBe("20260324_app-diagnostics.jsonl");
  });

  it("serializes workspace events into diagnostic lines", () => {
    const line = workspaceEventToDiagnosticLine({
      id: "evt-1",
      at: "2026-03-24T10:11:12.000Z",
      source: "tasks",
      actor: "system",
      level: "error",
      message: "메인 UI 정지 감지",
      runId: "run-1",
      topic: "stall",
    }, "tasks");
    expect(JSON.parse(line)).toEqual({
      at: "2026-03-24T10:11:12.000Z",
      kind: "workspace_event",
      level: "error",
      tab: "tasks",
      source: "tasks",
      actor: "system",
      runId: "run-1",
      topic: "stall",
      message: "메인 UI 정지 감지",
    });
  });

  it("serializes arbitrary diagnostic entries", () => {
    const line = createWorkspaceDiagnosticLine({
      at: "2026-03-24T10:11:12.000Z",
      kind: "renderer_heartbeat",
      level: "info",
      tab: "tasks",
      message: "heartbeat",
      payload: { visibilityState: "visible" },
    });
    expect(JSON.parse(line)).toEqual({
      at: "2026-03-24T10:11:12.000Z",
      kind: "renderer_heartbeat",
      level: "info",
      tab: "tasks",
      message: "heartbeat",
      payload: { visibilityState: "visible" },
    });
  });

  it("dispatches diagnostic events to the window when available", () => {
    const originalWindow = globalThis.window;
    const dispatchEvent = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dispatchEvent,
      },
    });

    emitWorkspaceDiagnostic({
      at: "2026-03-24T10:11:12.000Z",
      kind: "renderer_longtask",
      level: "error",
      tab: "tasks",
      message: "long task 1234ms",
    });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent;
    expect(event.type).toBe(WORKSPACE_DIAGNOSTIC_EVENT);
    expect(event.detail).toMatchObject({
      kind: "renderer_longtask",
      message: "long task 1234ms",
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });
});
