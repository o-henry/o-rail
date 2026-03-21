import { describe, expect, it } from "vitest";
import { resolveVisualizeRailMode } from "./visualizeRailMode";

describe("resolveVisualizeRailMode", () => {
  it("prefers the chart assistant rail over the history rail", () => {
    expect(resolveVisualizeRailMode({ historyOpen: true, chartAssistantOpen: true })).toBe("assistant");
  });

  it("uses history mode when only the history rail is open", () => {
    expect(resolveVisualizeRailMode({ historyOpen: true, chartAssistantOpen: false })).toBe("history");
  });

  it("closes the rail when neither mode is active", () => {
    expect(resolveVisualizeRailMode({ historyOpen: false, chartAssistantOpen: false })).toBe("closed");
  });
});
