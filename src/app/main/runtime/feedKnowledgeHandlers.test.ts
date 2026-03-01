import { describe, expect, it, vi } from "vitest";
import { createFeedKnowledgeHandlers } from "./feedKnowledgeHandlers";

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
    });

    await handlers.refreshFeedTimeline();

    expect(setFeedLoading).toHaveBeenCalledWith(true);
    expect(setFeedLoading).toHaveBeenLastCalledWith(false);
    expect(setFeedPosts).toHaveBeenCalledTimes(1);
    const merged = setFeedPosts.mock.calls[0][0] as any[];
    expect(merged.some((post) => post.id === transientPost.id)).toBe(true);
    expect(merged.some((post) => post.id === loadedPost.id)).toBe(true);
  });
});
