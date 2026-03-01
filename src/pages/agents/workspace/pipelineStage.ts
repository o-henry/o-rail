import type { DashboardTopicId, DashboardTopicRunState } from "../../../features/dashboard/intelligence";
import type { AgentThread } from "../agentTypes";

export type ProcessStepState = "running" | "pending";
export type PipelineStepKey = "crawler" | "rag" | "codex" | "save";

export type ProcessStep = {
  id: string;
  label: string;
  state: ProcessStepState;
};

const PIPELINE_STEP_LABELS: PipelineStepKey[] = ["crawler", "rag", "codex", "save"];

function inferPipelineStageIndexFromText(message: string): number {
  const text = String(message ?? "").toLowerCase();
  if (!text) {
    return -1;
  }
  if (text.includes("크롤러") || text.includes("crawler")) {
    return 0;
  }
  if (text.includes("근거") || text.includes("snippet") || text.includes("rag")) {
    return 1;
  }
  if (text.includes("codex") || text.includes("응답") || text.includes("파싱") || text.includes("prompt")) {
    return 2;
  }
  if (text.includes("저장") || text.includes("snapshot") || text.includes("save")) {
    return 3;
  }
  return -1;
}

export function resolvePipelineStageIndex(runState: DashboardTopicRunState | null): number {
  const stage = String(runState?.progressStage ?? "").trim().toLowerCase();
  switch (stage) {
    case "init":
    case "crawler":
      return 0;
    case "crawler_done":
    case "rag":
      return 1;
    case "rag_done":
    case "prompt":
    case "codex_thread":
    case "codex_turn":
    case "parse":
    case "fallback":
    case "normalize":
      return 2;
    case "save":
    case "done":
      return 3;
    default:
      return inferPipelineStageIndexFromText(runState?.progressText ?? "");
  }
}

export function resolvePipelineStepStates(runState: DashboardTopicRunState | null): ProcessStepState[] {
  const states: ProcessStepState[] = ["pending", "pending", "pending", "pending"];
  if (!runState) {
    return states;
  }

  const stage = String(runState.progressStage ?? "").trim().toLowerCase();
  const hasError = Boolean(runState.lastError) || stage === "error";
  const hasDone = !runState.running && !hasError && (stage === "done" || Boolean(runState.lastRunAt));
  const stageIndex = resolvePipelineStageIndex(runState);

  if (hasDone) {
    return ["running", "running", "running", "running"];
  }

  if (stageIndex >= 0) {
    for (let index = 0; index < stageIndex; index += 1) {
      states[index] = "running";
    }
    states[stageIndex] = hasError ? "pending" : "running";
    return states;
  }

  if (hasError) {
    states[0] = "pending";
    return states;
  }

  if (runState.running) {
    states[0] = "running";
  }
  return states;
}

export function buildProcessSteps(
  thread: AgentThread,
  isActive: boolean,
  dataTopicId: DashboardTopicId | null,
  dataTopicRunState: DashboardTopicRunState | null,
): ProcessStep[] {
  if (dataTopicId) {
    const stepStates = resolvePipelineStepStates(dataTopicRunState);
    return PIPELINE_STEP_LABELS.map((label, index) => ({
      id: `${thread.id}-pipeline-${label}`,
      label,
      state: stepStates[index] ?? "pending",
    }));
  }

  const fallback = ["요청 해석", "근거 정리", "응답 구성"];
  const labels =
    thread.guidance
      .map((line) => String(line ?? "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 3)
      .map((line) => line.replace(/\.$/, "")) || [];
  const steps = labels.length > 0 ? labels : fallback;
  return steps.map((label, index) => ({
    id: `${thread.id}-step-${index}`,
    label,
    state: isActive && index === 0 ? "running" : "pending",
  }));
}
