import type { DashboardTopicId, DashboardTopicRunState } from "../../../features/dashboard/intelligence";
import type { AgentThread } from "../agentTypes";

export type ProcessStepState = "running" | "pending" | "done" | "error";
export type PipelineStepKey = "crawler" | "rag" | "codex" | "save";
export type AgentPipelineStatus = "running" | "pending" | "done" | "error";

export type ProcessStep = {
  id: string;
  label: string;
  state: ProcessStepState;
};

const PIPELINE_STEP_LABELS: Record<PipelineStepKey, Record<ProcessStepState, string>> = {
  crawler: {
    pending: "allowlist 소스 수집 대기",
    running: "allowlist 소스(RSS/API/HTML) 수집 후 raw 파일 저장 중",
    done: "allowlist 소스 수집 완료, raw 문서 저장 완료",
    error: "allowlist 소스 수집 실패, 원문 확보 중단",
  },
  rag: {
    pending: "raw 문서 근거 스니펫 추출 대기",
    running: "knowledge_probe/retrieve로 근거 스니펫 추출·정규화 중",
    done: "근거 스니펫 추출 완료, 프롬프트 입력 준비 완료",
    error: "근거 스니펫 추출 실패, 분석 단계 중단",
  },
  codex: {
    pending: "Codex 요약/리스크/이벤트 생성 대기",
    running: "Codex가 근거 기반 요약·리스크·이벤트를 생성 중",
    done: "Codex 응답 파싱 완료, 스냅샷 생성 준비 완료",
    error: "Codex 응답 생성 실패 또는 파싱 실패",
  },
  save: {
    pending: "스냅샷 저장 대기",
    running: "RUNID 기준 스냅샷/아티팩트 파일 저장 중",
    done: "스냅샷 저장 완료, 실행 메타 갱신 완료",
    error: "스냅샷 저장 실패",
  },
};

function resolveThreadPipelineScopes(thread: AgentThread): PipelineStepKey[] {
  const id = String(thread.id ?? "").toLowerCase();
  const name = String(thread.name ?? "").toLowerCase();
  if (id.endsWith("-crawler") || name.includes("crawler")) {
    return ["crawler"];
  }
  if (id.endsWith("-rag") || name.includes("rag")) {
    return ["rag"];
  }
  if (id.endsWith("-synth") || name.includes("synth")) {
    return ["codex", "save"];
  }
  return ["crawler", "rag", "codex", "save"];
}

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
    return ["done", "done", "done", "done"];
  }

  if (stageIndex >= 0) {
    for (let index = 0; index < stageIndex; index += 1) {
      states[index] = "done";
    }
    states[stageIndex] = hasError ? "error" : "running";
    return states;
  }

  if (hasError) {
    states[0] = "error";
    return states;
  }

  if (runState.running) {
    states[0] = "running";
  }
  return states;
}

function aggregateAgentPipelineStatus(states: ProcessStepState[]): AgentPipelineStatus {
  if (states.some((state) => state === "running")) {
    return "running";
  }
  if (states.some((state) => state === "error")) {
    return "error";
  }
  if (states.length > 0 && states.every((state) => state === "done")) {
    return "done";
  }
  return "pending";
}

export function resolveAgentPipelineStatus(
  thread: AgentThread,
  dataTopicId: DashboardTopicId | null,
  dataTopicRunState: DashboardTopicRunState | null,
): AgentPipelineStatus {
  if (!dataTopicId) {
    return "pending";
  }
  const scopes = resolveThreadPipelineScopes(thread);
  const pipelineStates = resolvePipelineStepStates(dataTopicRunState);
  const scopedStates = scopes.map((scope) => {
    const index = scope === "crawler" ? 0 : scope === "rag" ? 1 : scope === "codex" ? 2 : 3;
    return pipelineStates[index] ?? "pending";
  });
  return aggregateAgentPipelineStatus(scopedStates);
}

export function buildProcessSteps(
  thread: AgentThread,
  _isSelected: boolean,
  dataTopicId: DashboardTopicId | null,
  dataTopicRunState: DashboardTopicRunState | null,
): ProcessStep[] {
  if (dataTopicId) {
    const scopes = resolveThreadPipelineScopes(thread);
    const stepStates = resolvePipelineStepStates(dataTopicRunState);
    return scopes.map((scope) => {
      const index = scope === "crawler" ? 0 : scope === "rag" ? 1 : scope === "codex" ? 2 : 3;
      const state = stepStates[index] ?? "pending";
      return {
        id: `${thread.id}-pipeline-${scope}`,
        label: PIPELINE_STEP_LABELS[scope][state],
        state,
      };
    });
  }

  const fallback = ["요청 해석", "근거 정리", "응답 구성"];
  const labels = thread.guidance
    .map((line) => String(line ?? "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .map((line) => line.replace(/\.$/, ""));
  const steps = labels.length > 0 ? labels : fallback;
  return steps.map((label, index) => ({
    id: `${thread.id}-step-${index}`,
    label,
    state: "pending",
  }));
}

export function formatAgentRuntimeText(
  runState: DashboardTopicRunState | null,
  agentStatus: AgentPipelineStatus,
): string {
  if (agentStatus === "error") {
    return "실패";
  }
  if (agentStatus === "done") {
    return "완료";
  }
  if (agentStatus === "running") {
    const base = String(runState?.progressText ?? "").trim();
    return base.length > 0 ? base : "작업중";
  }
  return "대기";
}
