import { resolveAdaptiveFamilyBucket } from "./families";
import type {
  AdaptiveEvaluationInput,
  AdaptiveFamilyKey,
  AdaptiveRubricDimension,
  AdaptiveRubricScore,
} from "./types";

const FLOOR_DIMENSIONS: AdaptiveRubricDimension[] = ["goalFit", "feasibility", "groundedness"];

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

function lexicalDiversity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return 0;
  }
  return new Set(tokens).size / tokens.length;
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

  const headingCount = countMatches(answer, /^#{1,3}\s/mg) + countMatches(answer, /^\d+\.\s/mg);
  const overlap = overlapRatio(input.question, answer);
  const actionSignals = countActionSignals(answer);
  const constraintMentions =
    countConstraintSignals(answer) +
    input.userMemory.filter((row) => row && answer.toLowerCase().includes(row.toLowerCase().slice(0, 16))).length;
  const evidenceSignal = countMatches(answer, /(근거|evidence|source|출처|검증|불확실성|assumption)/gi);
  const diversity = lexicalDiversity(answer);
  const qualityPass = Math.max(0, Math.min(1, input.qualityPassRate));
  const qualityAvg = Math.max(0, Math.min(1, input.qualityAvgScore / 100));
  const failPenalty = input.failedNodeCount * 0.9;

  return {
    goalFit: clampScore(4 + overlap * 3.6 + Math.min(1.4, headingCount * 0.3) + (answer.length > 180 ? 0.7 : 0) - failPenalty),
    feasibility: clampScore(
      4 +
        qualityPass * 3 +
        qualityAvg * 1.7 +
        Math.min(1.2, actionSignals * 0.35) +
        Math.min(0.8, input.runMemoryCount * 0.18) -
        failPenalty,
    ),
    constraintFit: clampScore(
      (input.userMemory.length > 0 ? 4.8 : 6.6) +
        Math.min(3.2, constraintMentions * 0.55) +
        Math.min(0.8, headingCount * 0.18),
    ),
    groundedness: clampScore(
      3.4 +
        Math.min(2.4, input.evidenceCount * 0.4) +
        Math.min(1.6, input.knowledgeTraceCount * 0.35) +
        Math.min(0.9, input.internalMemoryTraceCount * 0.22) +
        Math.min(1.3, evidenceSignal * 0.18) +
        qualityPass * 0.8 -
        input.failedNodeCount * 0.3,
    ),
    differentiation: clampScore(
      3 +
        diversity * 2.6 +
        Math.min(1.4, headingCount * 0.22) +
        Math.min(1.4, countMatches(answer, /(대안|차별|아이디어|실험|옵션|변형|시나리오|novel|idea)/gi) * 0.25),
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
