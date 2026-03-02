import { describe, expect, it, vi } from "vitest";
import {
  persistAgenticRunEnvelope,
  persistAgenticRunEvents,
  serializeRunEventsNdjson,
} from "./agenticRunStore";
import { createAgenticRunEnvelope } from "../../../features/orchestration/agentic/runContract";

describe("agenticRunStore", () => {
  it("persists studio role runs under .rail/studio_runs", async () => {
    const invokeFn = vi.fn(async () => "/tmp/.rail/studio_runs/role-1/run.json");
    const envelope = createAgenticRunEnvelope({
      runId: "role-1",
      runKind: "studio_role",
      sourceTab: "agents",
      queueKey: "role:system",
      roleId: "role-system_programmer",
      taskId: "SYSTEM-001",
    });
    await persistAgenticRunEnvelope({
      cwd: "/tmp/workspace",
      invokeFn,
      envelope,
    });
    expect(invokeFn).toHaveBeenCalledWith("workspace_write_text", expect.objectContaining({
      cwd: "/tmp/workspace/.rail/studio_runs/role-1",
      name: "run.json",
    }));
  });

  it("persists graph events under .rail/runs", async () => {
    const invokeFn = vi.fn(async () => "/tmp/.rail/runs/graph-1/events.ndjson");
    await persistAgenticRunEvents({
      cwd: "/tmp/workspace",
      invokeFn,
      runId: "graph-1",
      runKind: "graph",
      events: [
        {
          at: new Date().toISOString(),
          runId: "graph-1",
          queueKey: "graph:default",
          sourceTab: "workflow",
          type: "run_started",
        },
      ],
    });
    expect(invokeFn).toHaveBeenCalledWith("workspace_write_text", expect.objectContaining({
      cwd: "/tmp/workspace/.rail/runs/graph-1",
      name: "events.ndjson",
    }));
  });

  it("serializes events to ndjson", () => {
    const output = serializeRunEventsNdjson([
      {
        at: "2026-03-02T00:00:00.000Z",
        runId: "run-1",
        queueKey: "topic:marketSummary",
        sourceTab: "agents",
        type: "run_started",
      },
      {
        at: "2026-03-02T00:00:01.000Z",
        runId: "run-1",
        queueKey: "topic:marketSummary",
        sourceTab: "agents",
        type: "run_done",
      },
    ]);
    expect(output.split("\n")).toHaveLength(2);
  });
});

