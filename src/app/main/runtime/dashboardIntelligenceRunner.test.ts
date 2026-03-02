import { describe, expect, it, vi } from "vitest";
import { createDefaultDashboardTopicConfig } from "../../../features/dashboard/intelligence";
import { loadDashboardSnapshots, runDashboardTopicIntelligence } from "./dashboardIntelligenceRunner";

describe("dashboard intelligence runner", () => {
  it("runs crawl + rag + codex and saves snapshot", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 2,
            topics: [],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            text: JSON.stringify({
              summary: "hello snapshot",
              highlights: ["h1"],
              risks: [],
              events: [],
              references: [{ url: "https://example.com", title: "Example", source: "example.com" }],
              generatedAt: "2026-02-28T00:00:00.000Z",
              topic: "globalHeadlines",
              model: "gpt-5.2-codex",
            }),
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    const result = await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "globalHeadlines",
      config: createDefaultDashboardTopicConfig("globalHeadlines"),
      invokeFn: invoke,
    });

    expect(result.snapshot.summary).toBe("hello snapshot");
    expect(result.snapshot.references).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith("dashboard_snapshot_save", expect.any(Object));
  });

  it("fails when codex call fails", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 1,
            topics: [{ topic: "riskAlertBoard", fetchedCount: 1, savedFiles: ["/tmp/a.md"], errors: [] }],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start_blocking":
          throw new Error("unknown command");
        case "turn_start":
          throw new Error("boom");
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          return { snippets: [], warnings: [] };
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await expect(
      runDashboardTopicIntelligence({
        cwd: "/tmp",
        topic: "riskAlertBoard",
        config: createDefaultDashboardTopicConfig("riskAlertBoard"),
        invokeFn: invoke,
      }),
    ).rejects.toThrow("요약 모델 실행 중 오류가 발생했습니다");
  });

  it("retries retrieval with relaxed query when topic query returns no snippets", async () => {
    const retrieveCalls: Array<Record<string, unknown>> = [];
    const invokeMock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return { startedAt: "1", finishedAt: "2", totalFetched: 1, totalFiles: 2, topics: [] };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          retrieveCalls.push(args ?? {});
          if (retrieveCalls.length === 1) {
            return { snippets: [], warnings: ["no lexical match"] };
          }
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "fallback snippet", score: 0.1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return { text: "" };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await expect(
      runDashboardTopicIntelligence({
        cwd: "/tmp",
        topic: "globalHeadlines",
        config: createDefaultDashboardTopicConfig("globalHeadlines"),
        invokeFn: invoke,
      }),
    ).rejects.toThrow("요약 모델이 빈 응답을 반환했습니다");
    expect(retrieveCalls).toHaveLength(2);
    expect(retrieveCalls[1]?.query).toBe("");
  });

  it("fails before codex when crawler fetched nothing and snippets are empty", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 0,
            totalFiles: 0,
            topics: [{ topic: "globalHeadlines", fetchedCount: 0, savedFiles: [], errors: ["https://reuters.com: http status 403"] }],
          };
        case "dashboard_raw_list":
          return [];
        case "thread_start":
          return { threadId: "t1" };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          return { snippets: [], warnings: [] };
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await expect(
      runDashboardTopicIntelligence({
        cwd: "/tmp",
        topic: "globalHeadlines",
        config: createDefaultDashboardTopicConfig("globalHeadlines"),
        invokeFn: invoke,
      }),
    ).rejects.toThrow("수집 성공 건수가 0건");
    expect(invokeMock.mock.calls.some((row) => row[0] === "turn_start")).toBe(false);
  });

  it("fails when thread preflight fails", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return { startedAt: "1", finishedAt: "2", totalFetched: 1, totalFiles: 2, topics: [] };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          throw new Error("engine unavailable");
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await expect(
      runDashboardTopicIntelligence({
        cwd: "/tmp",
        topic: "marketSummary",
        config: createDefaultDashboardTopicConfig("marketSummary"),
        invokeFn: invoke,
      }),
    ).rejects.toThrow("요약 모델 실행 중 오류가 발생했습니다");
    expect(invokeMock.mock.calls.some((row) => row[0] === "dashboard_crawl_run")).toBe(true);
    expect(invokeMock.mock.calls.some((row) => row[0] === "dashboard_snapshot_save")).toBe(false);
  });

  it("fails when codex authentication is required", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return { startedAt: "1", finishedAt: "2", totalFetched: 1, totalFiles: 2, topics: [] };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          throw new Error("login required");
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          return { snippets: [], warnings: [] };
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await expect(
      runDashboardTopicIntelligence({
        cwd: "/tmp",
        topic: "marketSummary",
        config: createDefaultDashboardTopicConfig("marketSummary"),
        invokeFn: invoke,
      }),
    ).rejects.toThrow("Codex 로그인이 필요합니다");
    expect(invokeMock.mock.calls.some((row) => row[0] === "dashboard_crawl_run")).toBe(true);
    expect(invokeMock.mock.calls.some((row) => row[0] === "dashboard_snapshot_save")).toBe(false);
  });

  it("injects follow-up instruction into codex prompt", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return { startedAt: "1", finishedAt: "2", totalFetched: 1, totalFiles: 1, topics: [] };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            text: JSON.stringify({
              summary: "ok",
              highlights: [],
              risks: [],
              events: [],
              references: [],
              generatedAt: "2026-02-28T00:00:00.000Z",
              topic: "marketSummary",
              model: "gpt-5.2-codex",
            }),
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "marketSummary",
      config: createDefaultDashboardTopicConfig("marketSummary"),
      invokeFn: invoke,
      followupInstruction: "변동성 항목을 더 강조해줘",
    });

    const turnStartCall = invokeMock.mock.calls.find((row) => row[0] === "turn_start");
    const turnStartArgs = (turnStartCall?.[1] ?? {}) as { text?: string };
    expect(turnStartArgs.text ?? "").toContain("[Additional User Request]");
    expect(turnStartArgs.text ?? "").toContain("변동성 항목을 더 강조해줘");
  });

  it("emits progress updates while running topic intelligence", async () => {
    const stages: string[] = [];
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 1,
            topics: [{ topic: "marketSummary", fetchedCount: 1, savedFiles: ["/tmp/a.md"], errors: [] }],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            text: JSON.stringify({
              summary: "ok",
              highlights: [],
              risks: [],
              events: [],
              references: [],
              generatedAt: "2026-02-28T00:00:00.000Z",
              topic: "marketSummary",
              model: "gpt-5.2-codex",
            }),
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "marketSummary",
      config: createDefaultDashboardTopicConfig("marketSummary"),
      invokeFn: invoke,
      onProgress: (stage) => {
        stages.push(stage);
      },
    });

    expect(stages).toEqual(
      expect.arrayContaining(["crawler", "crawler_done", "rag", "rag_done", "codex_turn", "save", "done"]),
    );
  });

  it("parses codex response text from nested output_text payload", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 1,
            topics: [{ topic: "globalHeadlines", fetchedCount: 1, savedFiles: ["/tmp/a.md"], errors: [] }],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            response: {
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      output_text: JSON.stringify({
                        summary: "nested payload summary",
                        highlights: ["h1"],
                        risks: [],
                        events: [],
                        references: [],
                        generatedAt: "2026-02-28T00:00:00.000Z",
                        topic: "globalHeadlines",
                        model: "gpt-5.2-codex",
                      }),
                    },
                  ],
                },
              ],
            },
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    const result = await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "globalHeadlines",
      config: createDefaultDashboardTopicConfig("globalHeadlines"),
      invokeFn: invoke,
    });

    expect(result.snapshot.summary).toBe("nested payload summary");
    expect(result.snapshot.status).toBe("ok");
  });

  it("ignores opaque direct text and uses nested structured response", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 1,
            topics: [{ topic: "globalHeadlines", fetchedCount: 1, savedFiles: ["/tmp/a.md"], errors: [] }],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            text: "019cada1-0cc3-7821-87a4-68ae573257c7",
            response: {
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      output_text: JSON.stringify({
                        summary: "nested global summary",
                        highlights: ["h1"],
                        risks: [],
                        events: [],
                        references: [],
                        generatedAt: "2026-02-28T00:00:00.000Z",
                        topic: "globalHeadlines",
                        model: "gpt-5.2-codex",
                      }),
                    },
                  ],
                },
              ],
            },
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    const result = await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "globalHeadlines",
      config: createDefaultDashboardTopicConfig("globalHeadlines"),
      invokeFn: invoke,
    });

    expect(result.snapshot.summary).toBe("nested global summary");
    expect(result.snapshot.status).toBe("ok");
  });

  it("uses freeform codex response when json schema parsing fails", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 1,
            topics: [{ topic: "globalHeadlines", fetchedCount: 1, savedFiles: ["/tmp/a.md"], errors: [] }],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            text: "Global markets remain unstable after geopolitical escalation. Energy prices rose sharply while air traffic and logistics risks expanded.",
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    const result = await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "globalHeadlines",
      config: createDefaultDashboardTopicConfig("globalHeadlines"),
      invokeFn: invoke,
    });

    expect(result.snapshot.summary.toLowerCase()).toContain("global markets remain unstable");
    expect(result.snapshot.summary).not.toContain("수집 근거 기반 자동 요약입니다");
  });

  it("parses snapshot from structured object response even when text fields are empty", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return {
            startedAt: "1",
            finishedAt: "2",
            totalFetched: 1,
            totalFiles: 1,
            topics: [{ topic: "globalHeadlines", fetchedCount: 1, savedFiles: ["/tmp/a.md"], errors: [] }],
          };
        case "dashboard_raw_list":
          return ["/tmp/a.md"];
        case "knowledge_probe":
          return [
            {
              id: "1",
              name: "a.md",
              path: "/tmp/a.md",
              ext: ".md",
              enabled: true,
              status: "ready",
            },
          ];
        case "knowledge_retrieve":
          return {
            snippets: [{ fileId: "1", fileName: "a.md", chunkIndex: 1, text: "Snippet", score: 1 }],
            warnings: [],
          };
        case "thread_start":
          return { threadId: "t1" };
        case "turn_start":
          return {
            result: {
              payload: {
                summary: "structured summary",
                highlights: ["point a", "point b"],
                risks: [],
                events: [],
                references: [{ url: "https://example.com", title: "example", source: "example" }],
              },
            },
          };
        case "dashboard_snapshot_save":
          return "/tmp/snapshot.json";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    const result = await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "globalHeadlines",
      config: createDefaultDashboardTopicConfig("globalHeadlines"),
      invokeFn: invoke,
    });

    expect(result.snapshot.summary).toBe("structured summary");
    expect(result.snapshot.status).toBe("ok");
  });

  it("loads latest snapshot per topic", async () => {
    const invokeMock = vi.fn(async () => [
      {
        topic: "globalHeadlines",
        model: "gpt-5.2-codex",
        generatedAt: "2026-02-28T10:00:00.000Z",
        summary: "new",
        highlights: [],
        risks: [],
        events: [],
        references: [],
      },
      {
        topic: "globalHeadlines",
        model: "gpt-5.2-codex",
        generatedAt: "2026-02-28T09:00:00.000Z",
        summary: "old",
        highlights: [],
        risks: [],
        events: [],
        references: [],
      },
    ]);
    const invoke = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    const snapshots = await loadDashboardSnapshots({ cwd: "/tmp", invokeFn: invoke });
    expect(snapshots.globalHeadlines?.summary).toBe("new");
  });
});
