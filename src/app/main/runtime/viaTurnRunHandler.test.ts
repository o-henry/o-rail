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
    const text = String((result.output as any)?.text ?? "");

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("via");
    expect((result.output as any)?.via?.runId).toBe("run-1");
    expect((result.output as any)?.via?.artifacts?.length).toBe(1);
    expect(text).toContain("RAG 실행 결과");
    expect(text).not.toContain("VIA flow 1 run");
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

  it("passes source_type hint and prioritizes source-specific evidence in Korean summary text", async () => {
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
    expect(text).toContain("핵심 근거:");
    expect(text).toContain("market-title");
    expect(text).not.toContain("news-title");
  });

  it("renders full codex briefing without line clamp or ellipsis truncation", async () => {
    const longParagraph = `이 문단은 길이 제한 없이 그대로 보여야 합니다. ${"핵심정보 ".repeat(60)}`.trim();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "via_run_flow") {
        return {
          run_id: "run-4",
          status: "done",
          warnings: [],
          detail: {
            run_id: "run-4",
            status: "done",
            steps: [],
            payload: {
              codex_briefing: `## 시장/트렌드 핵심\n${longParagraph}\n\n## 후속 체크\n- 체크포인트 A`,
            },
          },
          artifacts: [{ node_id: "export.rag", format: "md", path: "/tmp/export.md" }],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const params = buildBaseParams({ invokeFn });
    const result = await runViaFlowTurn(params as any);
    const text = String((result.output as any)?.text ?? "");

    expect(result.ok).toBe(true);
    expect(text).toContain("상세 브리핑:");
    expect(text).toContain("## 시장/트렌드 핵심");
    expect(text).toContain(longParagraph);
    expect(text).not.toContain("핵심정보 핵심정보 핵심정보…");
  });

  it("shows codex token usage when available in payload", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "via_run_flow") {
        return {
          run_id: "run-5",
          status: "done",
          warnings: [],
          detail: {
            run_id: "run-5",
            status: "done",
            steps: [],
            payload: {
              codex_usage: {
                prompt_tokens: 1500,
                completion_tokens: 900,
                total_tokens: 2400,
              },
            },
          },
          artifacts: [{ node_id: "export.rag", format: "md", path: "/tmp/export.md" }],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const params = buildBaseParams({ invokeFn });
    const result = await runViaFlowTurn(params as any);
    const text = String((result.output as any)?.text ?? "");

    expect(result.ok).toBe(true);
    expect(text).toContain("Codex 토큰: 입력 1500 / 출력 900 / 합계 2400");
  });

  it("passes dynamic source options to via_run_flow", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "via_run_flow") {
        expect(args?.sourceType).toBe("source.news");
        expect(args?.sourceOptions).toEqual({
          keywords: ["unity", "indie game"],
          countries: ["KR", "US"],
          sites: ["reddit.com", "https://store.steampowered.com"],
          maxItems: 55,
        });
        return {
          run_id: "run-6",
          status: "done",
          warnings: [],
          detail: { run_id: "run-6", status: "done", steps: [] },
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
        viaSourceTypeHint: "source.news",
        viaCustomKeywords: "unity, indie game",
        viaCustomCountries: "kr,us",
        viaCustomSites: "reddit.com\nhttps://store.steampowered.com",
        viaCustomMaxItems: 55,
      },
    });

    const result = await runViaFlowTurn(params as any);
    expect(result.ok).toBe(true);
  });
});
