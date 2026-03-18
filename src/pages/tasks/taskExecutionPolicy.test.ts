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
});
