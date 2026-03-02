import { describe, expect, it, vi } from "vitest";
import { createFeedKnowledgeHandlers } from "./feedKnowledgeHandlers";
import { openPath } from "../../../shared/tauri";

vi.mock("../../../shared/tauri", () => ({
  openPath: vi.fn(async () => undefined),
  revealItemInDir: vi.fn(async () => undefined),
}));

describe("feedKnowledgeHandlers.refreshFeedTimeline", () => {
  it("keeps transient dashboard posts when feed timeline refreshes", async () => {
    const transientPost = {
      id: "topic-20260301:dashboard-marketSummary:done",
      runId: "topic-20260301",
      nodeId: "dashboard-marketSummary",
      sourceFile: "dashboard-marketSummary-topic-20260301.json",
      createdAt: "2026-03-01T10:00:00.000Z",
    } as any;
    const loadedPost = {
      id: "run-20260301:turn-1:done",
      runId: "run-20260301",
      nodeId: "turn-1",
      sourceFile: "run-20260301.json",
      createdAt: "2026-03-01T09:00:00.000Z",
    } as any;

    const setFeedLoading = vi.fn();
    const setFeedPosts = vi.fn();
    const invokeFn = vi.fn(async (command: string, payload?: { name?: string }) => {
      if (command === "run_list") {
        return ["run-20260301.json"];
      }
      if (command === "dashboard_snapshot_list") {
        return [];
      }
      if (command === "run_load" && payload?.name === "run-20260301.json") {
        return {
          runId: "run-20260301",
          question: "sample",
          feedPosts: [loadedPost],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const handlers = createFeedKnowledgeHandlers({
      hasTauriRuntime: true,
      invokeFn,
      setGraphFiles: vi.fn(),
      setFeedPosts,
      setFeedLoading,
      setStatus: vi.fn(),
      setError: vi.fn(),
      toOpenRunsFolderErrorMessage: vi.fn(),
      feedRunCacheRef: { current: {} },
      normalizeRunRecordFn: (run: any) => run,
      feedPosts: [transientPost],
      cwd: "/tmp",
      buildFeedPostFn: vi.fn(),
    });

    await handlers.refreshFeedTimeline();

    expect(setFeedLoading).toHaveBeenCalledWith(true);
    expect(setFeedLoading).toHaveBeenLastCalledWith(false);
    expect(setFeedPosts).toHaveBeenCalledTimes(1);
    const merged = setFeedPosts.mock.calls[0][0] as any[];
    expect(merged.some((post) => post.id === transientPost.id)).toBe(true);
    expect(merged.some((post) => post.id === loadedPost.id)).toBe(true);
  });

  it("includes dashboard snapshot posts even when run record has no feedPosts", async () => {
    const setFeedPosts = vi.fn();
    const invokeFn = vi.fn(async (command: string, payload?: { name?: string; cwd?: string }) => {
      if (command === "run_list") {
        return [];
      }
      if (command === "dashboard_snapshot_list" && payload?.cwd === "/tmp") {
        return [
          {
            topic: "globalHeadlines",
            runId: "topic-20260302-demo",
            model: "gpt-5.2-codex",
            generatedAt: "2026-03-02T00:00:00.000Z",
            summary: "요약",
            highlights: ["포인트 1"],
            risks: [],
            status: "ok",
            path: "/tmp/.rail/dashboard/snapshots/globalHeadlines/abc.json",
          },
        ];
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const buildFeedPostFn = vi.fn((input: any) => ({
      post: {
        id: `${input.runId}:${input.node.id}:${input.status}`,
        runId: input.runId,
        nodeId: input.node.id,
        nodeType: "turn",
        executor: "codex",
        agentName: "GPT-5.2-Codex",
        roleLabel: "DASHBOARD BRIEFING",
        status: input.status,
        createdAt: input.createdAt,
        summary: input.summary,
        steps: [],
        evidence: {},
        attachments: [],
        redaction: { masked: true, ruleVersion: "test" },
      },
      rawAttachments: { markdown: "", json: "" },
    }));

    const handlers = createFeedKnowledgeHandlers({
      hasTauriRuntime: true,
      invokeFn,
      setGraphFiles: vi.fn(),
      setFeedPosts,
      setFeedLoading: vi.fn(),
      setStatus: vi.fn(),
      setError: vi.fn(),
      toOpenRunsFolderErrorMessage: vi.fn(),
      feedRunCacheRef: { current: {} },
      normalizeRunRecordFn: (run: any) => run,
      feedPosts: [],
      cwd: "/tmp",
      t: (key: string) => key,
      buildFeedPostFn,
    });

    await handlers.refreshFeedTimeline();

    const merged = setFeedPosts.mock.calls[0][0] as any[];
    expect(merged.some((post) => post.runId === "topic-20260302-demo")).toBe(true);
    expect(buildFeedPostFn).toHaveBeenCalledTimes(1);
  });
});

describe("feedKnowledgeHandlers.onOpenFeedMarkdownFile", () => {
  it("materializes markdown file when attachment filePath is missing", async () => {
    const setError = vi.fn();
    const setStatus = vi.fn();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "workspace_write_text") {
        return "/tmp/.rail/runs/topic-20260302/feed_topic-20260302_dashboard-marketSummary-done.md";
      }
      if (command === "dashboard_snapshot_list") {
        return [];
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const handlers = createFeedKnowledgeHandlers({
      hasTauriRuntime: true,
      invokeFn,
      setGraphFiles: vi.fn(),
      setFeedPosts: vi.fn(),
      setFeedLoading: vi.fn(),
      setStatus,
      setError,
      toOpenRunsFolderErrorMessage: vi.fn(),
      feedRunCacheRef: { current: {} },
      normalizeRunRecordFn: (run: any) => run,
      feedPosts: [],
      cwd: "/tmp",
      feedRawAttachmentRef: { current: {} },
      feedAttachmentRawKeyFn: (postId: string, kind: "markdown" | "json") => `${postId}:${kind}`,
    });

    await handlers.onOpenFeedMarkdownFile({
      id: "topic-20260302:dashboard-marketSummary:done",
      runId: "topic-20260302",
      attachments: [
        {
          kind: "markdown",
          content: "# 문서\n\n내용",
        },
      ],
      rawAttachmentRef: {
        markdownKey: "topic-20260302:dashboard-marketSummary:done:markdown",
      },
    } as any);

    expect(invokeFn).toHaveBeenCalledWith(
      "workspace_write_text",
      expect.objectContaining({
        cwd: "/tmp/.rail/runs/topic-20260302",
      }),
    );
    expect(openPath).toHaveBeenCalledWith(
      "/tmp/.rail/runs/topic-20260302/feed_topic-20260302_dashboard-marketSummary-done.md",
    );
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining("문서 파일 경로"));
  });
});
