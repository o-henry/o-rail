import { describe, expect, it, vi } from "vitest";
import { exportRunFeedMarkdownFiles } from "./runHistoryUtils";

describe("exportRunFeedMarkdownFiles", () => {
  it("keeps existing markdown attachment filePath", async () => {
    const runRecord = {
      runId: "run-abc",
      graphSnapshot: {
        nodes: [
          {
            id: "turn-1",
            type: "turn",
            config: { cwd: "/tmp/workspace" },
          },
        ],
        edges: [],
      },
      feedPosts: [
        {
          id: "run-abc:turn-1:done",
          nodeId: "turn-1",
          status: "done",
          createdAt: new Date().toISOString(),
          roleLabel: "TEST",
          attachments: [
            {
              kind: "markdown",
              title: "Markdown",
              content: "# hello",
              truncated: false,
              charCount: 7,
              filePath: "/tmp/existing.md",
            },
          ],
        },
      ],
    } as any;

    const invokeFn = vi.fn(async () => "/tmp/newly-written.md") as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;

    await exportRunFeedMarkdownFiles({
      runRecord,
      cwd: "/tmp/workspace",
      invokeFn,
      feedRawAttachment: {},
      setError: vi.fn(),
    });

    expect(invokeFn).toHaveBeenCalledTimes(1);
    expect(runRecord.feedPosts[0].attachments[0].filePath).toBe("/tmp/existing.md");
  });
});
