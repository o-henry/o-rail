import { describe, expect, it } from "vitest";
import { adaptiveFloorFailures, scoreAdaptiveRun, weightedAdaptiveScore } from "./score";

describe("adaptive scoring", () => {
  it("scores grounded, structured runs above the hard floor", () => {
    const score = scoreAdaptiveRun({
      question: "1인 게임 개발자가 범위가 작은 창의적인 게임 아이디어를 원한다",
      finalAnswer:
        "## 결론\n- 1인 게임 개발자에게 맞는 범위가 작은 창의적인 게임 아이디어 제안\n## 실행안\n- 2주 프로토타입\n- 핵심 리스크와 테스트\n## 리스크\n- 범위 과다를 제한",
      evidenceCount: 4,
      knowledgeTraceCount: 3,
      internalMemoryTraceCount: 1,
      runMemoryCount: 2,
      qualityPassRate: 1,
      qualityAvgScore: 86,
      totalNodeCount: 5,
      failedNodeCount: 0,
      userMemory: ["나는 1인 인디 게임 개발자다", "현실적인 제작 범위를 중요하게 생각한다"],
      artifactTypeCount: 2,
    });

    expect(adaptiveFloorFailures(score)).toEqual([]);
    expect(weightedAdaptiveScore("preset:creative", score)).toBeGreaterThan(6);
  });
});
