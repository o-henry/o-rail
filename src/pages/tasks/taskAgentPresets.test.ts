import { describe, expect, it } from "vitest";
import {
  UNITY_TASK_TEAM_PRESETS,
  getDefaultRunPresetIds,
  getDefaultTaskAgentPresetIds,
  parseTaskAgentTags,
  resolveTaskAgentPresetId,
} from "./taskAgentPresets";

describe("taskAgentPresets", () => {
  it("maps legacy role aliases onto Unity presets", () => {
    expect(resolveTaskAgentPresetId("explorer")).toBe("game_designer");
    expect(resolveTaskAgentPresetId("reviewer")).toBe("unity_architect");
    expect(resolveTaskAgentPresetId("worker")).toBe("unity_implementer");
    expect(resolveTaskAgentPresetId("qa")).toBe("qa_playtester");
  });

  it("parses Unity tag aliases and removes duplicates", () => {
    expect(parseTaskAgentTags("@designer @worker @playtest @worker @unknown")).toEqual([
      "game_designer",
      "unity_implementer",
      "qa_playtester",
    ]);
  });

  it("defaults new threads to the full Unity squad and keeps requested run roles in preset order", () => {
    expect(getDefaultTaskAgentPresetIds("full-squad")).toEqual(UNITY_TASK_TEAM_PRESETS["full-squad"]);
    expect(
      getDefaultRunPresetIds(
        UNITY_TASK_TEAM_PRESETS["full-squad"],
        ["worker", "reviewer"],
      ),
    ).toEqual(["unity_architect", "unity_implementer"]);
    expect(getDefaultRunPresetIds(["unity_implementer", "qa_playtester"], [])).toEqual(["unity_implementer"]);
  });
});
