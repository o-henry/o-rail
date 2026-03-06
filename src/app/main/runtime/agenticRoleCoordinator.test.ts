import { describe, expect, it, vi } from "vitest";
import { createAgenticQueue } from "./agenticQueue";
import { runRoleWithCoordinator } from "./agenticRoleCoordinator";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

describe("agenticRoleCoordinator", () => {
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
});
