import type {
  AgenticCoordinationState,
  CoordinationMode,
  ExecutionIntent,
  ExecutionPlanRecord,
} from "./coordinationTypes";
import { buildDelegateTasks, buildGuidance, buildPlanSteps, buildPlanSummary, buildTeamSession, nextCoordinationId } from "./coordinationScaffold";
export {
  approveCoordinationPlan,
  blockCoordinationRun,
  cancelCoordinationRun,
  completeCoordinationRun,
  completeDelegateTask,
  createRuntimeLedgerEvent,
  deriveSessionIndexEntry,
  markCoordinationWaitingReview,
  readyCoordinationForExecution,
  reopenCoordinationRun,
  startCoordinationRun,
} from "./coordinationTransitions";

function includesAny(input: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(input));
}


export function inferExecutionIntent(prompt: string): ExecutionIntent {
  const normalized = String(prompt ?? "").trim().toLowerCase();
  if (!normalized) {
    return "simple";
  }
  if (includesAny(normalized, [/\b(compare|source|citation|research|investigate|evidence|docs?|reference)\b/, /(비교|리서치|조사|근거|레퍼런스|문서|출처)/])) {
    return "research";
  }
  if (includesAny(normalized, [/\b(review|audit|approve|approval|risk|regression|verify|test plan)\b/, /(리뷰|감사|승인|검토|리스크|회귀|검증|테스트)/])) {
    return "review_heavy";
  }
  if (includesAny(normalized, [/\b(then|after|before|step|plan|coordinate|multiple|handoff|team)\b/, /(단계|순서|계획|조율|여러|핸드오프|팀)/])) {
    return "multi_step";
  }
  return "simple";
}

export function recommendCoordinationMode(intent: ExecutionIntent): CoordinationMode {
  if (intent === "research") {
    return "fanout";
  }
  if (intent === "multi_step" || intent === "review_heavy") {
    return "team";
  }
  return "quick";
}

export function createCoordinationState(params: {
  threadId: string;
  prompt: string;
  requestedRoleIds?: string[];
  overrideMode?: CoordinationMode | null;
  at?: string;
}): AgenticCoordinationState {
  const updatedAt = params.at ?? new Date().toISOString();
  const intent = inferExecutionIntent(params.prompt);
  const recommendedMode = recommendCoordinationMode(intent);
  const mode = params.overrideMode ?? recommendedMode;
  const plan: ExecutionPlanRecord = {
    id: nextCoordinationId("plan"),
    summary: buildPlanSummary(mode, intent),
    requiresApproval: mode === "team",
    approvedAt: null,
    steps: buildPlanSteps(mode),
  };

  return {
    threadId: params.threadId,
    prompt: String(params.prompt ?? "").trim(),
    requestedRoleIds: [...new Set((params.requestedRoleIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))],
    assignedRoleIds: [...new Set((params.requestedRoleIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))],
    recommendedMode,
    mode,
    intent,
    status: mode === "team" ? "blocked" : "planning",
    nextAction:
      mode === "team"
        ? "Review the plan, then approve the team run."
        : mode === "fanout"
          ? "Run the delegate brief and collect specialist results."
          : "Run the primary role directly.",
    blockedReason: mode === "team" ? "Waiting for plan approval." : null,
    plan,
    delegateTasks: buildDelegateTasks(mode, updatedAt),
    delegateResults: [],
    teamSession: mode === "team" ? buildTeamSession(updatedAt) : null,
    resumePointer: null,
    guidance: buildGuidance(mode),
    updatedAt,
  };
}
