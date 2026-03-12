import { resolveAdaptiveFamilyBucket } from "./families";
import type {
  AdaptiveEvaluationInput,
  AdaptiveFamilyKey,
  AdaptiveRubricDimension,
  AdaptiveRubricScore,
} from "./types";

const FLOOR_DIMENSIONS: AdaptiveRubricDimension[] = ["goalFit", "feasibility", "groundedness"];
const RUBRIC_DIMENSIONS: AdaptiveRubricDimension[] = [
  "goalFit",
  "feasibility",
  "constraintFit",
  "groundedness",
  "differentiation",
];

const FAMILY_WEIGHTS: Record<
  ReturnType<typeof resolveAdaptiveFamilyBucket>,
  AdaptiveRubricScore
> = {
  creative: {
    goalFit: 0.25,
    feasibility: 0.2,
    constraintFit: 0.15,
    groundedness: 0.1,
    differentiation: 0.3,
  },
  research: {
    goalFit: 0.25,
    feasibility: 0.2,
    constraintFit: 0.15,
    groundedness: 0.3,
    differentiation: 0.1,
  },
  development: {
    goalFit: 0.2,
    feasibility: 0.3,
    constraintFit: 0.2,
    groundedness: 0.2,
    differentiation: 0.1,
  },
  validation: {
    goalFit: 0.2,
    feasibility: 0.3,
    constraintFit: 0.2,
    groundedness: 0.2,
    differentiation: 0.1,
  },
  fullstack: {
    goalFit: 0.2,
    feasibility: 0.3,
    constraintFit: 0.2,
    groundedness: 0.2,
    differentiation: 0.1,
  },
  unityGame: {
    goalFit: 0.2,
    feasibility: 0.3,
    constraintFit: 0.2,
    groundedness: 0.2,
    differentiation: 0.1,
  },
};

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(10, value)) * 10) / 10;
}

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .match(/[a-z0-9가-힣]{2,}/g)?.filter(Boolean) ?? [];
}

function overlapRatio(question: string, answer: string): number {
  const questionTokens = [...new Set(tokenize(question))];
  if (questionTokens.length === 0) {
    return 0;
  }
  const answerTokens = new Set(tokenize(answer));
  const hitCount = questionTokens.filter((token) => answerTokens.has(token)).length;
  return hitCount / questionTokens.length;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countActionSignals(text: string): number {
  return ["단계", "체크리스트", "테스트", "다음", "리스크", "검증", "실행", "measure", "risk", "test"]
    .filter((token) => text.toLowerCase().includes(token.toLowerCase()))
    .length;
}

function countConstraintSignals(text: string): number {
  return ["제약", "범위", "비용", "budget", "scope", "limit", "선호", "priority", "중요"].filter((token) =>
    text.toLowerCase().includes(token.toLowerCase()),
  ).length;
}

function countGroundingSignals(text: string): number {
  return countMatches(
    text,
    /(근거|출처|source|evidence|citation|reference|confidence|신뢰도|검증|추가 근거 필요|needs more evidence|unsupported)/gi,
  );
}

function countNovelSignals(text: string): number {
  return countMatches(
    text,
    /(대안|차별|아이디어|실험|옵션|변형|시나리오|novel|idea|variant|alternative)/gi,
  );
}

function countUserMemoryMatches(text: string, userMemory: string[]): number {
  const lower = text.toLowerCase();
  return userMemory.filter((row) => {
    const trimmed = row.trim().toLowerCase();
    return trimmed.length >= 6 && lower.includes(trimmed.slice(0, 16));
  }).length;
}

export function scoreAdaptiveRun(input: AdaptiveEvaluationInput): AdaptiveRubricScore {
  const answer = input.finalAnswer.trim();
  if (!answer) {
    return {
      goalFit: 0,
      feasibility: 0,
      constraintFit: 0,
      groundedness: 0,
      differentiation: 0,
    };
  }

  const overlap = overlapRatio(input.question, answer);
  const actionSignals = countActionSignals(answer);
  const constraintMentions = countConstraintSignals(answer);
  const userMemoryMatches = countUserMemoryMatches(answer, input.userMemory);
  const groundingSignals = countGroundingSignals(answer);
  const noveltySignals = countNovelSignals(answer);
  const qualityPass = Math.max(0, Math.min(1, input.qualityPassRate));
  const qualityAvg = Math.max(0, Math.min(1, input.qualityAvgScore / 100));
  const failPenalty = input.failedNodeCount * 1.1;
  const artifactSignal = Math.min(1, input.artifactTypeCount * 0.2);

  return {
    goalFit: clampScore(
      4.1 +
        overlap * 4.1 +
        qualityPass * 0.6 +
        (answer.length >= 160 ? 0.6 : 0) -
        failPenalty,
    ),
    feasibility: clampScore(
      3.8 +
        qualityPass * 2.8 +
        qualityAvg * 2 +
        Math.min(1.6, actionSignals * 0.4) +
        Math.min(0.8, input.runMemoryCount * 0.16) +
        artifactSignal * 0.4 -
        failPenalty,
    ),
    constraintFit: clampScore(
      (input.userMemory.length > 0 ? 4.6 : 6.2) +
        Math.min(2.8, constraintMentions * 0.6) +
        Math.min(2.2, userMemoryMatches * 0.55),
    ),
    groundedness: clampScore(
      3.2 +
        Math.min(2.4, input.evidenceCount * 0.4) +
        Math.min(1.6, input.knowledgeTraceCount * 0.35) +
        Math.min(0.9, input.internalMemoryTraceCount * 0.22) +
        Math.min(1.8, groundingSignals * 0.22) +
        qualityPass * 1 -
        input.failedNodeCount * 0.4,
    ),
    differentiation: clampScore(
      3.2 +
        Math.min(2.6, noveltySignals * 0.32) +
        Math.min(1.4, countMatches(answer, /(keep|revise|drop|가설|실험|prototype|검증)/gi) * 0.18) +
        (answer.length >= 220 ? 0.4 : 0),
    ),
  };
}

export function weightedAdaptiveScore(family: AdaptiveFamilyKey, score: AdaptiveRubricScore): number {
  const weights = FAMILY_WEIGHTS[resolveAdaptiveFamilyBucket(family)];
  const total =
    score.goalFit * weights.goalFit +
    score.feasibility * weights.feasibility +
    score.constraintFit * weights.constraintFit +
    score.groundedness * weights.groundedness +
    score.differentiation * weights.differentiation;
  return Math.round(total * 100) / 100;
}

export function adaptiveFloorFailures(score: AdaptiveRubricScore): AdaptiveRubricDimension[] {
  return FLOOR_DIMENSIONS.filter((key) => score[key] < 6);
}

export type AdaptivePairwiseReview = {
  winner: "candidate" | "champion" | "tie";
  weightedDelta: number;
  candidateAdvantages: AdaptiveRubricDimension[];
  championAdvantages: AdaptiveRubricDimension[];
  rationale: string[];
};

export function compareAdaptiveScores(
  family: AdaptiveFamilyKey,
  candidate: AdaptiveRubricScore,
  champion: AdaptiveRubricScore,
): AdaptivePairwiseReview {
  const candidateWeighted = weightedAdaptiveScore(family, candidate);
  const championWeighted = weightedAdaptiveScore(family, champion);
  const weightedDelta = Math.round((candidateWeighted - championWeighted) * 100) / 100;
  const candidateAdvantages = RUBRIC_DIMENSIONS.filter(
    (dimension) => candidate[dimension] - champion[dimension] >= 0.4,
  );
  const championAdvantages = RUBRIC_DIMENSIONS.filter(
    (dimension) => champion[dimension] - candidate[dimension] >= 0.4,
  );
  const criticalRegression = FLOOR_DIMENSIONS.some(
    (dimension) => champion[dimension] - candidate[dimension] > 0.25,
  );
  const rationale: string[] = [];
  if (candidateAdvantages.length > 0) {
    rationale.push(`candidate 우세: ${candidateAdvantages.join(", ")}`);
  }
  if (championAdvantages.length > 0) {
    rationale.push(`champion 우세: ${championAdvantages.join(", ")}`);
  }
  if (criticalRegression) {
    rationale.push("candidate가 핵심 안정성 축에서 후퇴");
  }
  let winner: AdaptivePairwiseReview["winner"] = "tie";
  if (
    weightedDelta >= 0.6 &&
    !criticalRegression &&
    candidateAdvantages.length >= championAdvantages.length
  ) {
    winner = "candidate";
  } else if (
    weightedDelta <= -0.4 ||
    championAdvantages.length > candidateAdvantages.length ||
    criticalRegression
  ) {
    winner = "champion";
  }
  return {
    winner,
    weightedDelta,
    candidateAdvantages,
    championAdvantages,
    rationale,
  };
}
