import { describe, expect, it } from "vitest";
import { workspaceEventLogToMarkdown, type WorkspaceEventEntry } from "./workspaceEventLog";

describe("workspaceEventLogToMarkdown", () => {
  it("escapes markdown table metacharacters including backslash", () => {
    const entries: WorkspaceEventEntry[] = [
      {
        id: "evt-1",
        at: "2026-03-02T00:00:00.000Z",
        source: "data\\pipeline",
        actor: "system",
        level: "info",
        runId: "topic|abc",
        topic: "global\\headlines",
        message: "line1\\line2 | cell",
      },
    ];

    const markdown = workspaceEventLogToMarkdown(entries);
    expect(markdown).toContain("data\\\\pipeline");
    expect(markdown).toContain("topic\\|abc");
    expect(markdown).toContain("global\\\\headlines");
    expect(markdown).toContain("line1\\\\line2 \\| cell");
  });
});
