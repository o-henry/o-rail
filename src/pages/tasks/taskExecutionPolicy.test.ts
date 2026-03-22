import { describe, expect, it } from "vitest";
import { createTaskExecutionPlan } from "./taskExecutionPolicy";

describe("taskExecutionPolicy", () => {
  it("routes untagged code work to a single implementer run", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["game_designer", "unity_implementer", "qa_playtester"],
      requestedRoleIds: [],
      prompt: "플레이어 점프 버그를 고쳐줘",
    });

    expect(plan.mode).toBe("single");
    expect(plan.participantRoleIds).toEqual(["unity_implementer"]);
    expect(plan.primaryRoleId).toBe("unity_implementer");
  });

  it("routes multi-tagged code work to implementer-led bounded discussion", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["unity_architect", "unity_implementer", "qa_playtester", "game_designer"],
      requestedRoleIds: ["unity_architect", "unity_implementer", "qa_playtester"],
      prompt: "PlayerController C# 버그를 수정하고 검증 포인트도 정리해줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.primaryRoleId).toBe("unity_implementer");
    expect(plan.synthesisRoleId).toBe("unity_implementer");
    expect(plan.participantRoleIds).toEqual([
      "unity_implementer",
      "unity_architect",
      "qa_playtester",
    ]);
    expect(plan.criticRoleId).toBe("unity_architect");
    expect(plan.maxParticipants).toBe(3);
    expect(plan.maxRounds).toBe(2);
  });

  it("routes refactor-heavy prompts to the refactor specialist when available", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["unity_refactor_specialist", "unity_architect", "unity_implementer", "qa_playtester"],
      requestedRoleIds: [],
      prompt: "PlayerController와 InventoryManager를 리팩토링해서 책임 분리와 파일 분해 계획까지 잡아줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.primaryRoleId).toBe("unity_refactor_specialist");
    expect(plan.participantRoleIds).toEqual([
      "unity_refactor_specialist",
      "unity_implementer",
      "unity_architect",
    ]);
  });

  it("caps discussion participants to three roles", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: [
        "game_designer",
        "level_designer",
        "unity_architect",
        "unity_implementer",
        "technical_artist",
      ],
      requestedRoleIds: [
        "game_designer",
        "level_designer",
        "unity_architect",
        "unity_implementer",
        "technical_artist",
      ],
      prompt: "전체 시스템 설계와 구현 방향을 같이 잡아줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.participantRoleIds).toHaveLength(3);
    expect(plan.cappedParticipantCount).toBe(true);
  });

  it("routes research and scraping requests to researcher first", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["researcher", "unity_architect", "unity_implementer"],
      requestedRoleIds: ["researcher", "unity_architect"],
      prompt: "이 기능 관련 레퍼런스를 조사하고 웹 크롤링/스크래핑 포인트까지 정리해줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.primaryRoleId).toBe("researcher");
    expect(plan.participantRoleIds).toEqual(["researcher", "unity_architect"]);
  });

  it("uses adaptive orchestration for untagged research requests", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["researcher", "game_designer", "unity_architect", "unity_implementer"],
      requestedRoleIds: [],
      prompt: "최근 3년간 인디게임 시장 변화와 참고할만한 성공 사례를 조사하고 정리해줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.primaryRoleId).toBe("researcher");
    expect(plan.participantRoleIds).toEqual(["researcher", "game_designer"]);
    expect(plan.useAdaptiveOrchestrator).toBe(true);
  });

  it("honors an explicit researcher tag even when the initial enabled roles omit it", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["game_designer", "unity_implementer", "qa_playtester"],
      requestedRoleIds: ["researcher"],
      prompt: "스팀 평가 기준으로 가장 인기 있는 장르와 대표 게임 리스트를 조사해줘",
    });

    expect(plan.mode).toBe("single");
    expect(plan.primaryRoleId).toBe("researcher");
    expect(plan.participantRoleIds).toEqual(["researcher"]);
  });

  it("treats researcher mentions as hints for ideation requests and keeps designer primary", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["game_designer", "researcher", "unity_architect", "unity_implementer"],
      requestedRoleIds: ["researcher"],
      prompt: "1인 인디용 새 게임 아이디어 5개를 만들고 30초 hook까지 붙여줘",
    });

    expect(plan.intent).toBe("ideation");
    expect(plan.primaryRoleId).toBe("game_designer");
    expect(plan.synthesisRoleId).toBe("game_designer");
    expect(plan.participantRoleIds).toEqual(["game_designer", "researcher"]);
    expect(plan.candidateRoleIds).toEqual(["game_designer", "researcher", "unity_architect", "unity_implementer"]);
    expect(plan.rolePrompts.researcher).toContain("아이디어 자체를 대신 확정하지 말고");
    expect(plan.rolePrompts.game_designer).toContain("30초 hook");
  });

  it("enables the adaptive orchestrator for fanout-style multi-role prompts", () => {
    const plan = createTaskExecutionPlan({
      enabledRoleIds: ["game_designer", "researcher", "unity_architect", "qa_playtester"],
      requestedRoleIds: ["researcher", "unity_architect", "game_designer"],
      prompt: "fanout으로 서로 토론해서 가장 좋은 게임 방향을 선정해줘",
    });

    expect(plan.mode).toBe("discussion");
    expect(plan.useAdaptiveOrchestrator).toBe(true);
  });
});
