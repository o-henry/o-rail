import { describe, expect, it } from "vitest";
import {
  UNITY_TASK_TEAM_PRESETS,
  buildTaskAgentPrompt,
  getDefaultRunPresetIds,
  getTaskAgentWorkflowStageLabels,
  getDefaultTaskAgentPresetIds,
  parseCoordinationModeTag,
  parseTaskAgentTags,
  resolveTaskAgentPresetId,
  stripCoordinationModeTags,
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
    expect(resolveTaskAgentPresetId("refactor")).toBe("unity_refactor_specialist");
    expect(resolveTaskAgentPresetId("csharp")).toBe("unity_implementer");
    expect(resolveTaskAgentPresetId("debug")).toBe("unity_implementer");
    expect(resolveTaskAgentPresetId("build")).toBe("release_steward");
  });

  it("parses Unity tag aliases and removes duplicates", () => {
    expect(parseTaskAgentTags("@designer @researcher @refactor @csharp @playtest @debug @unknown @codemap")).toEqual([
      "game_designer",
      "researcher",
      "unity_refactor_specialist",
      "unity_implementer",
      "qa_playtester",
      "unity_architect",
    ]);
  });

  it("supports hidden coordination mode tags without leaking them into the prompt", () => {
    expect(parseCoordinationModeTag("please investigate this @fanout")).toBe("fanout");
    expect(parseCoordinationModeTag("@team fix and verify this flow")).toBe("team");
    expect(stripCoordinationModeTags("please investigate this @fanout")).toBe("please investigate this");
    expect(stripCoordinationModeTags("@team fix and verify this flow")).toBe("fix and verify this flow");
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
    expect(getTaskAgentWorkflowStageLabels("unity_refactor_specialist")).toEqual(["설계", "구현", "통합"]);
  });

  it("adds constrained creativity guidance only for design-facing task agents", () => {
    const gameDesignerPrompt = buildTaskAgentPrompt("game_designer", "새 전투 시스템을 정리해줘");
    const levelDesignerPrompt = buildTaskAgentPrompt("level_designer", "보스 구간 레벨 흐름을 설계해줘");
    const technicalArtistPrompt = buildTaskAgentPrompt("technical_artist", "새 VFX 통합 리스크를 검토해줘");
    const researcherPrompt = buildTaskAgentPrompt("researcher", "시장 조사해줘");

    expect(gameDesignerPrompt).toContain("안전안/대담안/혼합안");
    expect(levelDesignerPrompt).toContain("안전안/대담안/혼합안");
    expect(technicalArtistPrompt).toContain("최대 2안");
    expect(researcherPrompt).not.toContain("안전안/대담안/혼합안");
  });
});
