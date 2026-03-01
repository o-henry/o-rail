import { describe, expect, it, vi } from "vitest";
import { createAgenticQueue } from "./agenticQueue";
import { runGraphWithCoordinator, runTopicWithCoordinator } from "./agenticCoordinator";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("agenticCoordinator", () => {
  it("persists topic run envelope and events", async () => {
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async (command: string) => {
      if (command === "workspace_write_text") {
        return "/tmp/write";
      }
      if (command === "run_directory") {
        return "/tmp/runs";
      }
      return null;
    }) as unknown) as InvokeFn;

    const result = await runTopicWithCoordinator({
      cwd: "/tmp/workspace",
      topic: "marketSummary",
      sourceTab: "agents",
      queue,
      invokeFn,
      execute: async ({ onProgress }) => {
        onProgress?.("crawler", "크롤러 시작");
        onProgress?.("crawler_done", "크롤러 완료");
        onProgress?.("rag", "근거 추출");
        onProgress?.("rag_done", "근거 완료");
        onProgress?.("codex_turn", "요약 생성");
        onProgress?.("save", "저장 중");
        onProgress?.("done", "완료");
        return {
          snapshotPath: "/tmp/workspace/.rail/dashboard/snapshots/marketSummary/snapshot.json",
          rawPaths: ["/tmp/workspace/.rail/dashboard/raw/marketSummary/a.json"],
          warnings: [],
        };
      },
    });

    expect(result.envelope.record.status).toBe("done");
    expect(result.envelope.artifacts.some((row) => row.kind === "snapshot")).toBe(true);
    expect(result.events.some((event) => event.type === "run_started")).toBe(true);
    expect(result.events.some((event) => event.type === "run_done")).toBe(true);
    expect(invokeFn).toHaveBeenCalledWith(
      "workspace_write_text",
      expect.objectContaining({
        name: "run.json",
      }),
    );
  });

  it("serializes same topic runs by queue key", async () => {
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async () => "/tmp/write") as unknown) as InvokeFn;
    const order: string[] = [];

    const first = runTopicWithCoordinator({
      cwd: "/tmp/workspace",
      topic: "marketSummary",
      sourceTab: "agents",
      queue,
      invokeFn,
      execute: async () => {
        order.push("first:start");
        await sleep(25);
        order.push("first:end");
        return null;
      },
    });

    const second = runTopicWithCoordinator({
      cwd: "/tmp/workspace",
      topic: "marketSummary",
      sourceTab: "agents",
      queue,
      invokeFn,
      execute: async () => {
        order.push("second:start");
        await sleep(5);
        order.push("second:end");
        return null;
      },
    });

    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("runs graph flow and records graph artifact path", async () => {
    const queue = createAgenticQueue();
    const invokeFn = (vi.fn(async (command: string) => {
      if (command === "run_directory") {
        return "/tmp/runs";
      }
      return "/tmp/write";
    }) as unknown) as InvokeFn;

    const result = await runGraphWithCoordinator({
      cwd: "/tmp/workspace",
      sourceTab: "workflow",
      graphId: "default",
      queue,
      invokeFn,
      execute: async () => {
        await sleep(5);
      },
    });

    expect(result.envelope.record.status).toBe("done");
    expect(result.envelope.artifacts.some((row) => row.kind === "graph")).toBe(true);
  });
});
