import { describe, expect, it } from "vitest";
import { inferTaskPromptIntent, orchestrateTaskPrompt } from "./taskPromptOrchestration";

describe("taskPromptOrchestration", () => {
  it("classifies ideation prompts separately from research prompts", () => {
    expect(inferTaskPromptIntent("새 게임 아이디어를 5개만 뽑아줘")).toBe("ideation");
    expect(inferTaskPromptIntent("시장 조사와 레퍼런스를 모아줘")).toBe("research");
  });

  it("keeps game designer primary for ideation even with a lone researcher mention", () => {
    const orchestration = orchestrateTaskPrompt({
      enabledRoleIds: ["game_designer", "researcher", "unity_architect"],
      requestedRoleIds: ["researcher"],
      prompt: "아류작 피하는 새 게임 아이디어와 30초 hook을 만들어줘",
      maxParticipants: 3,
    });

    expect(orchestration.primaryRoleId).toBe("game_designer");
    expect(orchestration.participantRoleIds).toEqual(["game_designer", "researcher"]);
    expect(orchestration.candidateRoleIds).toEqual(["game_designer", "researcher", "unity_architect"]);
    expect(orchestration.rolePrompts.researcher).toContain("아이디어 자체를 대신 확정하지 말고");
  });

  it("marks fanout multi-tag prompts for adaptive orchestration", () => {
    const orchestration = orchestrateTaskPrompt({
      enabledRoleIds: ["game_designer", "researcher", "unity_architect", "qa_playtester"],
      requestedRoleIds: ["researcher", "unity_architect"],
      prompt: "fanout으로 서로 토론해서 최종 추천안을 선정해줘",
      maxParticipants: 3,
    });

    expect(orchestration.useAdaptiveOrchestrator).toBe(true);
  });

  it("turns on adaptive orchestration for untagged multi-role prompts", () => {
    const orchestration = orchestrateTaskPrompt({
      enabledRoleIds: ["researcher", "game_designer", "unity_architect", "qa_playtester"],
      requestedRoleIds: [],
      prompt: "최근 인디게임 트렌드와 참고 사례를 조사하고 정리해줘",
      maxParticipants: 3,
    });

    expect(orchestration.participantRoleIds).toEqual(["researcher", "game_designer"]);
    expect(orchestration.candidateRoleIds).toEqual(["game_designer", "researcher", "unity_architect", "qa_playtester"]);
    expect(orchestration.useAdaptiveOrchestrator).toBe(true);
  });
});
