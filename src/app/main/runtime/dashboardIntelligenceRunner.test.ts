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

  it("returns degraded snapshot when codex call fails", async () => {
    const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      switch (command) {
        case "dashboard_crawl_run":
          return { startedAt: "1", finishedAt: "2", totalFetched: 0, totalFiles: 0, topics: [] };
        case "dashboard_raw_list":
          return [];
        case "thread_start":
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

    const result = await runDashboardTopicIntelligence({
      cwd: "/tmp",
      topic: "riskAlertBoard",
      config: createDefaultDashboardTopicConfig("riskAlertBoard"),
      invokeFn: invoke,
    });

    expect(result.snapshot.status).toBe("degraded");
    expect(result.snapshot.referenceEmpty).toBe(true);
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
