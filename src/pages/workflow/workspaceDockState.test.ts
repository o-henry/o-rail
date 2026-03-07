import { describe, expect, it } from "vitest";
import { buildWorkspacePaneViewport, tailGraphObserverLines } from "./workspaceDockState";

describe("workspaceDockState", () => {
  it("tails graph observer lines", () => {
    expect(tailGraphObserverLines("a\n\nb\nc\nd", 2)).toEqual(["c", "d"]);
  });

  it("prefers pane buffer over activity fallback", () => {
    expect(
      buildWorkspacePaneViewport({
        pane: {
          id: "pane-1",
          title: "기획",
          subtitle: "",
          startupCommand: "codex",
          buffer: "live output",
          input: "",
          status: "running",
        },
        activityEntries: [],
      }),
    ).toBe("live output");
  });
});
