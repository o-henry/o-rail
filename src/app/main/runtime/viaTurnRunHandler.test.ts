import { describe, expect, it, vi } from "vitest";
import { runViaFlowTurn } from "./viaTurnRunHandler";

function buildBaseParams(overrides: Record<string, unknown> = {}) {
  const invokeFn = vi.fn(async (command: string) => {
    if (command === "via_run_flow") {
      return {
        run_id: "run-1",
        status: "done",
        warnings: [],
        detail: { run_id: "run-1", status: "done", steps: [] },
        artifacts: [{ node_id: "export.rag", format: "md", path: "/tmp/export.md" }],
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  return {
    node: {
      id: "turn-1",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        executor: "via_flow",
        viaFlowId: "1",
      },
    },
    config: {
      executor: "via_flow",
      viaFlowId: "1",
    },
    cwd: "/tmp/workspace",
    invokeFn,
    pauseRequestedRef: { current: false },
    cancelRequestedRef: { current: false },
    pauseErrorToken: "__PAUSE__",
    addNodeLog: vi.fn(),
    t: (key: string) => key,
    executor: "via_flow" as const,
    knowledgeTrace: [],
    memoryTrace: [],
    ...overrides,
  };
}

describe("runViaFlowTurn", () => {
  it("returns done output when run response is immediately terminal", async () => {
    const params = buildBaseParams();

    const result = await runViaFlowTurn(params as any);

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("via");
    expect((result.output as any)?.via?.runId).toBe("run-1");
    expect((result.output as any)?.via?.artifacts?.length).toBe(1);
  });

  it("polls run and artifacts when initial response is non-terminal", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "via_run_flow") {
        return {
          run_id: "run-2",
          status: "running",
          warnings: [],
          detail: { run_id: "run-2", status: "running", steps: [] },
          artifacts: [],
        };
      }
      if (command === "via_get_run") {
        return {
          run_id: "run-2",
          status: "done",
          warnings: [],
          detail: { run_id: "run-2", status: "done", steps: [] },
        };
      }
      if (command === "via_list_artifacts") {
        return {
          run_id: "run-2",
          artifacts: [{ node_id: "export.rag", format: "json", path: "/tmp/export.json" }],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const params = buildBaseParams({ invokeFn });
    const result = await runViaFlowTurn(params as any);

    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenCalledWith("via_get_run", expect.any(Object));
    expect(invokeFn).toHaveBeenCalledWith("via_list_artifacts", expect.any(Object));
    expect((result.output as any)?.via?.status).toBe("done");
    expect((result.output as any)?.via?.artifacts?.length).toBe(1);
  });

  it("fails fast when flow_id is missing", async () => {
    const params = buildBaseParams({
      config: { executor: "via_flow", viaFlowId: "" },
    });

    const result = await runViaFlowTurn(params as any);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("flow_id");
  });

  it("passes source_type hint and prioritizes source-specific top items in output text", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "via_run_flow") {
        expect(args?.sourceType).toBe("source.market");
        return {
          run_id: "run-3",
          status: "done",
          warnings: [],
          detail: {
            run_id: "run-3",
            status: "done",
            steps: [],
            payload: {
              items: [
                {
                  source_type: "source.news",
                  source_name: "Naver News",
                  country: "KR",
                  title: "news-title",
                  url: "https://example.com/news",
                  summary: "news-summary",
                },
                {
                  source_type: "source.market",
                  source_name: "Yahoo S&P500",
                  country: "US",
                  title: "market-title",
                  url: "https://example.com/market",
                  summary: "market-summary",
                },
              ],
            },
          },
          artifacts: [{ node_id: "export.rag", format: "md", path: "/tmp/export.md" }],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const params = buildBaseParams({
      invokeFn,
      config: {
        executor: "via_flow",
        viaFlowId: "1",
        viaSourceTypeHint: "source.market",
      },
    });

    const result = await runViaFlowTurn(params as any);
    const text = String((result.output as any)?.text ?? "");

    expect(result.ok).toBe(true);
    expect(text).toContain("top_items:");
    expect(text).toContain("market-title");
    expect(text).not.toContain("news-title");
  });
});
