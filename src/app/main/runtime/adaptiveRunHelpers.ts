import type { AdaptiveEvaluationInput } from "../../adaptation/types";
import { buildAdaptiveRecipeSnapshot } from "../../adaptation/recipe";
import type { PresetKind } from "../../../features/workflow/domain";
import type { GraphData } from "../../../features/workflow/types";
import type { RunRecord } from "../types";

function countFailedTransitions(run: RunRecord): number {
  return run.transitions.filter((row) => row.status === "failed").length;
}

export function buildAdaptiveRecipeSnapshotForRun(params: {
  cwd: string;
  graph: GraphData;
  workflowPresetKind?: PresetKind;
  presetHint?: PresetKind;
}) {
  return buildAdaptiveRecipeSnapshot({
    cwd: params.cwd,
    graph: params.graph,
    workflowPresetKind: params.workflowPresetKind,
    presetHint: params.presetHint,
  });
}

export function buildAdaptiveEvaluationInput(run: RunRecord): AdaptiveEvaluationInput {
  const evidenceCount = Object.values(run.normalizedEvidenceByNodeId ?? {}).flat().length;
  const runMemoryCount = Object.keys(run.runMemory ?? {}).length;
  const artifactTypeCount = run.graphSnapshot.nodes.reduce((count, node) => {
    const artifactType = String((node.config as Record<string, unknown>)?.artifactType ?? "").trim();
    return artifactType ? count + 1 : count;
  }, 0);
  return {
    question: String(run.question ?? ""),
    finalAnswer: String(run.finalAnswer ?? ""),
    evidenceCount,
    knowledgeTraceCount: run.knowledgeTrace?.length ?? 0,
    internalMemoryTraceCount: run.internalMemoryTrace?.length ?? 0,
    runMemoryCount,
    qualityPassRate: run.qualitySummary?.passRate ?? 0,
    qualityAvgScore: run.qualitySummary?.avgScore ?? 0,
    totalNodeCount: run.graphSnapshot.nodes.length,
    failedNodeCount: countFailedTransitions(run),
    userMemory: [],
    artifactTypeCount,
  };
}
