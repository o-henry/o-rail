import { describe, expect, it } from "vitest";
import { formatTaskThreadContextSummary } from "./taskThreadContextSummary";

describe("taskThreadContextSummary", () => {
  it("formats a bounded summary from thread detail", () => {
    const summary = formatTaskThreadContextSummary({
      task: {
        goal: "플레이어 이동 버그를 해결한다",
        workspacePath: "/tmp/mockking",
      },
      workflow: {
        currentStageId: "implement",
      },
      approvals: [{}],
      changedFiles: ["Assets/Scripts/PlayerController.cs", "Assets/Scenes/Test.unity"],
      artifacts: {
        brief: "이동 버그와 충돌 가능성 정리",
      },
      messages: [
        { role: "user", content: "캐릭터가 점프 후 멈춘다" },
        { role: "assistant", agentLabel: "UNITY IMPLEMENTER", content: "PlayerController를 먼저 확인하겠다." },
      ],
    }, 400);

    expect(summary).toContain("/tmp/mockking");
    expect(summary).toContain("현재 단계");
    expect(summary).toContain("PlayerController.cs");
    expect(summary.length).toBeLessThanOrEqual(400);
  });
});
