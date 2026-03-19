import { describe, expect, it } from "vitest";
import {
  UNITY_TASK_TEAM_PRESETS,
  getDefaultRunPresetIds,
  getTaskAgentWorkflowStageLabels,
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
    expect(resolveTaskAgentPresetId("researcher")).toBe("researcher");
    expect(resolveTaskAgentPresetId("scraper")).toBe("researcher");
    expect(resolveTaskAgentPresetId("codemap")).toBe("unity_architect");
    expect(resolveTaskAgentPresetId("csharp")).toBe("unity_implementer");
    expect(resolveTaskAgentPresetId("debug")).toBe("unity_implementer");
    expect(resolveTaskAgentPresetId("build")).toBe("release_steward");
  });

  it("parses Unity tag aliases and removes duplicates", () => {
    expect(parseTaskAgentTags("@designer @researcher @csharp @playtest @debug @unknown @codemap")).toEqual([
      "game_designer",
      "researcher",
      "unity_implementer",
      "qa_playtester",
      "unity_architect",
    ]);
  });

  it("defaults new threads to the full Unity squad and keeps requested run roles in preset order", () => {
    expect(getDefaultTaskAgentPresetIds("full-squad")).toEqual(UNITY_TASK_TEAM_PRESETS["full-squad"]);
    expect(UNITY_TASK_TEAM_PRESETS["full-squad"]).toContain("researcher");
    expect(
      getDefaultRunPresetIds(
        UNITY_TASK_TEAM_PRESETS["full-squad"],
        ["worker", "reviewer"],
      ),
    ).toEqual(["unity_architect", "unity_implementer"]);
    expect(getDefaultRunPresetIds(["unity_implementer", "qa_playtester"], [])).toEqual(["unity_implementer"]);
  });

  it("exposes workflow stage labels for each agent preset", () => {
    expect(getTaskAgentWorkflowStageLabels("game_designer")).toEqual(["요청 정리", "설계"]);
    expect(getTaskAgentWorkflowStageLabels("researcher")).toEqual(["요청 정리"]);
    expect(getTaskAgentWorkflowStageLabels("unity_implementer")).toEqual(["구현"]);
  });
});
