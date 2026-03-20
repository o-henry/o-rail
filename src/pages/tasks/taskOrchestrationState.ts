import type { AgenticCoordinationState, CoordinationMode, SessionIndexEntry } from "../../features/orchestration/agentic/coordinationTypes";
import { createCoordinationState, deriveSessionIndexEntry } from "../../features/orchestration/agentic/coordination";
import { searchSessionIndex } from "../../features/orchestration/agentic/runtimeLedger";
import type { ThreadDetail, ThreadRoleId } from "./threadTypes";
import { getTaskAgentLabel } from "./taskAgentPresets";

const TASKS_ORCHESTRATION_CACHE_KEY = "rail.tasks.orchestration.v1";

export type TasksOrchestrationCache = Record<string, AgenticCoordinationState>;

export type ComposerCoordinationPreview = {
  intent: AgenticCoordinationState["intent"];
  recommendedMode: CoordinationMode;
  selectedMode: CoordinationMode;
  summary: string;
  prompt: string;
};

export function readTasksOrchestrationCache(): TasksOrchestrationCache {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.sessionStorage.getItem(TASKS_ORCHESTRATION_CACHE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, AgenticCoordinationState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeTasksOrchestrationCache(cache: TasksOrchestrationCache) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(TASKS_ORCHESTRATION_CACHE_KEY, JSON.stringify(cache));
}

function rolePlanSummary(roleIds: ThreadRoleId[]): string {
  const labels = roleIds.map((roleId) => getTaskAgentLabel(roleId));
  if (labels.length === 0) {
    return "";
  }
  if (labels.length === 1) {
    return `Primary role: ${labels[0]}`;
  }
  return `Roles: ${labels.join(", ")}`;
}

export function deriveComposerCoordinationPreview(params: {
  prompt: string;
  overrideMode?: CoordinationMode | null;
  roleIds: ThreadRoleId[];
}): ComposerCoordinationPreview | null {
  const prompt = String(params.prompt ?? "").trim();
  if (!prompt) {
    return null;
  }
  const preview = createCoordinationState({
    threadId: "draft",
    prompt,
    overrideMode: params.overrideMode,
  });
  const roleSummary = rolePlanSummary(params.roleIds);
  return {
    intent: preview.intent,
    recommendedMode: preview.recommendedMode,
    selectedMode: preview.mode,
    prompt,
    summary: [preview.plan?.summary, roleSummary].filter(Boolean).join(" · "),
  };
}

export function withTaskCoordination(detail: ThreadDetail, coordination: AgenticCoordinationState | null | undefined): ThreadDetail {
  return {
    ...detail,
    orchestration: coordination ?? null,
  };
}

export function buildTasksSessionIndex(cache: TasksOrchestrationCache, details: ThreadDetail[]): SessionIndexEntry[] {
  return Object.values(cache)
    .map((state) => {
      const matchingDetail = details.find((detail) => detail.thread.threadId === state.threadId);
      const title = matchingDetail?.thread.title || matchingDetail?.task.goal || state.prompt;
      return deriveSessionIndexEntry(state, title);
    });
}

export function queryTasksSessionIndex(entries: SessionIndexEntry[], query: string): SessionIndexEntry[] {
  return searchSessionIndex(entries, query).slice(0, 8);
}
