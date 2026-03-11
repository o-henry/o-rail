import { canGenerateShadowCandidates } from "./families";
import { hashAdaptiveText } from "./graphShape";
import type { AdaptiveRecipeSnapshot } from "./types";

function shiftBudget(value: AdaptiveRecipeSnapshot["turnNodes"][number]["contextBudget"]): "tight" | "balanced" | "wide" {
  if (value === "tight") {
    return "balanced";
  }
  if (value === "balanced") {
    return "wide";
  }
  return "wide";
}

export function buildAdaptiveDiff(
  candidate: AdaptiveRecipeSnapshot,
  champion: AdaptiveRecipeSnapshot | null,
): { graph: string[]; prompt: string[]; tuning: string[] } {
  if (!champion) {
    return {
      graph: ["초기 기준선 생성"],
      prompt: ["현재 레시피를 첫 기준선으로 기록"],
      tuning: ["현재 실행 튜닝을 기준선으로 기록"],
    };
  }
  return {
    graph:
      candidate.graphShapeHash !== champion.graphShapeHash
        ? [candidate.graphSummary, `vs ${champion.graphSummary}`]
        : ["그래프 구조 동일"],
    prompt:
      candidate.promptPackHash !== champion.promptPackHash
        ? [candidate.promptSummary, `vs ${champion.promptSummary}`]
        : ["프롬프트 패킹 동일"],
    tuning:
      candidate.tuningBundleHash !== champion.tuningBundleHash
        ? [candidate.tuningSummary, `vs ${champion.tuningSummary}`]
        : ["실행 튜닝 동일"],
  };
}

export function buildAdaptiveShadowCandidates(snapshot: AdaptiveRecipeSnapshot): AdaptiveRecipeSnapshot[] {
  if (!canGenerateShadowCandidates(snapshot.family)) {
    return [];
  }

  const promptTuningCandidate: AdaptiveRecipeSnapshot = {
    ...snapshot,
    id: hashAdaptiveText(`${snapshot.id}:shadow:prompt-tuning`),
    candidateKind: "prompt_tuning_shadow",
    promptVariantId: "focus-tighten",
    tuningVariantId: "delta:+0.08/step/+600",
    promptPackHash: hashAdaptiveText(`${snapshot.promptPackHash}:focus-tighten`),
    tuningBundleHash: hashAdaptiveText(`${snapshot.tuningBundleHash}:delta`),
    promptSummary: `${snapshot.promptSummary} + focus tighten`,
    tuningSummary: `${snapshot.tuningSummary} + temp 0.08 / context one step / max chars +600`,
    createdAt: snapshot.createdAt,
    turnNodes: snapshot.turnNodes.map((node) => ({
      ...node,
      temperature:
        typeof node.temperature === "number" ? Math.min(1, Math.round((node.temperature + 0.08) * 100) / 100) : node.temperature,
      contextBudget: shiftBudget(node.contextBudget),
      maxInputChars:
        typeof node.maxInputChars === "number" ? Math.min(20_000, node.maxInputChars + 600) : node.maxInputChars,
    })),
    graphTemplate: undefined,
    templateRoleNodeId: undefined,
  };

  const topologyVariantId = snapshot.family.startsWith("role:") ? "strict-review-pass" : "final-guardrail-pass";
  const topologyCandidate: AdaptiveRecipeSnapshot = {
    ...snapshot,
    id: hashAdaptiveText(`${snapshot.id}:shadow:topology`),
    candidateKind: "topology_shadow",
    topologyVariantId,
    graphShapeHash: hashAdaptiveText(`${snapshot.graphShapeHash}:${topologyVariantId}`),
    graphSummary: `${snapshot.graphSummary} + ${topologyVariantId}`,
    createdAt: snapshot.createdAt,
    graphTemplate: undefined,
    templateRoleNodeId: undefined,
  };

  return [promptTuningCandidate, topologyCandidate];
}
