import { describe, expect, it } from "vitest";

import { batchActionsForUnityPreset } from "./presetCommands";

describe("unity automation preset commands", () => {
  it("maps Unity CI Doctor to build and both test previews", () => {
    expect(batchActionsForUnityPreset("unityCiDoctor").map((row) => row.action)).toEqual([
      "build",
      "tests_edit",
      "tests_play",
    ]);
  });

  it("returns an empty list for non-unity presets", () => {
    expect(batchActionsForUnityPreset("validation")).toEqual([]);
  });
});
