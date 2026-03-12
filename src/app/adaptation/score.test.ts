import { describe, expect, it } from "vitest";
import {
  adaptiveFloorFailures,
  compareAdaptiveScores,
  scoreAdaptiveRun,
  weightedAdaptiveScore,
} from "./score";

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

  it("prefers a candidate that improves critical axes without punishing creative differentiation", () => {
    const candidate = scoreAdaptiveRun({
      question: "1인 개발 범위의 창의적인 게임 아이디어",
      finalAnswer:
        "## 결론\n- 나는 1인 인디 게임 개발자라는 제약에 맞춰 새로운 감정 훅과 손맛이 있는 아이디어를 제안한다.\n## 실행안\n- 2주 프로토타입\n- keep/revise/drop 판단 포함\n- 범위와 예산 제약 유지\n## 핵심 근거\n- source: prototype-notes\n- 플레이 루프와 범위 제약 근거\n## 신뢰도와 한계\n- confidence: medium\n- 추가 근거 필요 항목 표기",
      evidenceCount: 6,
      knowledgeTraceCount: 4,
      internalMemoryTraceCount: 2,
      runMemoryCount: 2,
      qualityPassRate: 1,
      qualityAvgScore: 92,
      totalNodeCount: 5,
      failedNodeCount: 0,
      userMemory: ["나는 1인 인디 게임 개발자다"],
      artifactTypeCount: 1,
    });
    const champion = scoreAdaptiveRun({
      question: "1인 개발 범위의 창의적인 게임 아이디어",
      finalAnswer:
        "## 결론\n- 무난한 아이디어\n## 실행안\n- 개발 단계\n## 리스크\n- 범위",
      evidenceCount: 1,
      knowledgeTraceCount: 0,
      internalMemoryTraceCount: 0,
      runMemoryCount: 0,
      qualityPassRate: 0.7,
      qualityAvgScore: 70,
      totalNodeCount: 5,
      failedNodeCount: 0,
      userMemory: ["나는 1인 인디 게임 개발자다"],
      artifactTypeCount: 0,
    });

    const comparison = compareAdaptiveScores("preset:creative", candidate, champion);

    expect(comparison.winner).toBe("candidate");
    expect(comparison.weightedDelta).toBeGreaterThanOrEqual(0.6);
    expect(comparison.candidateAdvantages.length).toBeGreaterThan(0);
  });
});
