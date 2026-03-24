import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgenticQueue } from "./agenticQueue";
import { runRoleWithCoordinator } from "./agenticRoleCoordinator";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

describe("agenticRoleCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("respects a caller-provided run id for explicit child runs", async () => {
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;

    const result = await runRoleWithCoordinator({
      runId: "implementer-123",
      cwd: "/tmp/workspace",
      sourceTab: "agents",
      roleId: "client_programmer",
      taskId: "CLIENT-001",
      queue,
      invokeFn,
      execute: async () => undefined,
    });

    expect(result.runId).toBe("implementer-123");
    expect(result.envelope.record.runId).toBe("implementer-123");
    expect(invokeFn).toHaveBeenCalledWith(
      "workspace_write_text",
      expect.objectContaining({
        cwd: "/tmp/workspace/.rail/studio_runs/implementer-123",
        name: "run.json",
      }),
    );
  });

  it("sanitizes a caller-provided run id before persistence", async () => {
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;

    const result = await runRoleWithCoordinator({
      runId: "../unsafe/run-id",
      cwd: "/tmp/workspace",
      sourceTab: "workflow",
      roleId: "client_programmer",
      taskId: "CLIENT-002",
      queue,
      invokeFn,
      execute: async () => undefined,
    });

    expect(result.runId).toBe("unsafe-run-id");
    expect(result.envelope.record.runId).toBe("unsafe-run-id");
    expect(invokeFn).toHaveBeenCalledWith(
      "workspace_write_text",
      expect.objectContaining({
        cwd: "/tmp/workspace/.rail/studio_runs/unsafe-run-id",
        name: "run.json",
      }),
    );
  });

  it("uses a caller-provided queue key override", async () => {
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;

    const result = await runRoleWithCoordinator({
      cwd: "/tmp/workspace",
      sourceTab: "tasks-thread",
      roleId: "client_programmer",
      taskId: "THREAD-001",
      queueKeyOverride: "role:client_programmer:thread:THREAD-001",
      queue,
      invokeFn,
      execute: async () => undefined,
    });

    expect(result.envelope.record.queueKey).toBe("role:client_programmer:thread:THREAD-001");
  });

  it("fails the run when execute hangs past the watchdog timeout", async () => {
    vi.useFakeTimers();
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;

    const runPromise = runRoleWithCoordinator({
      cwd: "/tmp/workspace",
      sourceTab: "tasks-thread",
      roleId: "research_analyst",
      taskId: "THREAD-HANG",
      queue,
      invokeFn,
      execute: async () => new Promise<never>(() => {}),
    });

    await vi.advanceTimersByTimeAsync(900001);
    const result = await runPromise;

    expect(result.envelope.record.status).toBe("error");
    expect(result.envelope.stages.find((stage) => stage.stage === "codex")?.status).toBe("error");
    expect(result.events.some((event) => event.type === "run_error")).toBe(true);
  });

  it("keeps non-research roles on the shorter watchdog timeout", async () => {
    vi.useFakeTimers();
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;

    const runPromise = runRoleWithCoordinator({
      cwd: "/tmp/workspace",
      sourceTab: "tasks-thread",
      roleId: "client_programmer",
      taskId: "THREAD-HANG-IMPLEMENTER",
      queue,
      invokeFn,
      execute: async () => new Promise<never>(() => {}),
    });

    await vi.advanceTimersByTimeAsync(300001);
    const result = await runPromise;

    expect(result.envelope.record.status).toBe("error");
    expect(result.events.some((event) => String(event.message ?? "").includes("300000ms"))).toBe(true);
  });

  it("extends the watchdog while execute reports progress", async () => {
    vi.useFakeTimers();
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;

    const runPromise = runRoleWithCoordinator({
      cwd: "/tmp/workspace",
      sourceTab: "tasks-thread",
      roleId: "client_programmer",
      taskId: "THREAD-PROGRESS",
      queue,
      invokeFn,
      execute: async ({ onProgress }) => {
        onProgress?.("첫 진행 신호");
        await new Promise((resolve) => setTimeout(resolve, 250_000));
        onProgress?.("두 번째 진행 신호");
        await new Promise((resolve) => setTimeout(resolve, 250_000));
      },
    });

    await vi.advanceTimersByTimeAsync(550_000);
    const result = await runPromise;

    expect(result.envelope.record.status).toBe("done");
    expect(result.events.some((event) => String(event.message ?? "").includes("첫 진행 신호"))).toBe(true);
    expect(result.events.some((event) => String(event.message ?? "").includes("두 번째 진행 신호"))).toBe(true);
  });
});
