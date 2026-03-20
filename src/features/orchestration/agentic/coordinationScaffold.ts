import type {
  BackgroundDelegationCategory,
  BackgroundDelegationTask,
  CoordinationMode,
  ExecutionIntent,
  ExecutionPlanRecord,
  GuidanceOverlaySection,
  TeamRuntimeSession,
  TeamWorkerLane,
} from "./coordinationTypes";

export function nextCoordinationId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildGuidance(mode: CoordinationMode): GuidanceOverlaySection[] {
  const base: GuidanceOverlaySection[] = [
    {
      id: "policy.default",
      title: "운영 원칙",
      body: "기본 UX를 유지하고, 필요한 경우에만 병렬 역할을 확장합니다.",
      kind: "policy",
    },
  ];

  if (mode === "quick") {
    return [
      ...base,
      {
        id: "check.quick",
        title: "Quick Run",
        body: "가장 직접적인 역할 1개를 우선 실행하고, 결과가 막히면 다음 액션만 남깁니다.",
        kind: "checklist",
      },
    ];
  }

  if (mode === "fanout") {
    return [
      ...base,
      {
        id: "role.fanout",
        title: "Parallel Delegates",
        body: "탐색, 리서치, 리뷰를 분리해 병렬 수집한 뒤 요약으로 합칩니다.",
        kind: "role",
      },
    ];
  }

  return [
    ...base,
    {
      id: "role.team",
      title: "Team Runtime",
      body: "계획 승인 후 실행하며, 막히면 review 또는 resume 포인터를 남깁니다.",
      kind: "role",
    },
  ];
}

export function buildPlanSummary(mode: CoordinationMode, intent: ExecutionIntent): string {
  if (mode === "team") {
    return intent === "review_heavy"
      ? "Plan review-heavy work, approve the execution order, then run and verify."
      : "Plan the multi-step task, approve the sequence, then execute and verify.";
  }
  if (mode === "fanout") {
    return "Run a lightweight parallel brief across specialists and synthesize one answer.";
  }
  return "Run the primary role directly and keep the flow lightweight.";
}

export function buildPlanSteps(mode: CoordinationMode): ExecutionPlanRecord["steps"] {
  if (mode === "team") {
    return [
      { id: "plan", title: "Plan the execution order", status: "active" },
      { id: "approve", title: "Approve the plan", status: "pending" },
      { id: "execute", title: "Execute the team run", status: "pending" },
      { id: "verify", title: "Verify and leave a resume pointer if blocked", status: "pending" },
    ];
  }
  if (mode === "fanout") {
    return [
      { id: "brief", title: "Prepare a bounded specialist brief", status: "active" },
      { id: "fanout", title: "Run delegates in parallel", status: "pending" },
      { id: "synthesize", title: "Synthesize one answer", status: "pending" },
    ];
  }
  return [
    { id: "run", title: "Run the primary role", status: "active" },
    { id: "respond", title: "Return the result", status: "pending" },
  ];
}

function buildDelegationTask(category: BackgroundDelegationCategory, title: string, updatedAt: string): BackgroundDelegationTask {
  return {
    id: nextCoordinationId(`delegate_${category}`),
    category,
    title,
    status: "queued",
    summary: "Pending",
    updatedAt,
  };
}

export function buildDelegateTasks(mode: CoordinationMode, updatedAt: string): BackgroundDelegationTask[] {
  if (mode === "quick") {
    return [];
  }
  if (mode === "fanout") {
    return [
      buildDelegationTask("explore", "Explore implementation shape", updatedAt),
      buildDelegationTask("research", "Collect evidence and references", updatedAt),
      buildDelegationTask("review", "Review risks and regressions", updatedAt),
    ];
  }
  return [
    buildDelegationTask("research", "Plan and gather execution context", updatedAt),
    buildDelegationTask("review", "Check blockers and approvals", updatedAt),
  ];
}

function buildTeamLanes(updatedAt: string): TeamWorkerLane[] {
  return [
    {
      id: "planner",
      title: "Planner",
      status: "active",
      summary: "Preparing the execution plan.",
      updatedAt,
    },
    {
      id: "implementer",
      title: "Implementer",
      status: "queued",
      summary: "Waiting for plan approval.",
      updatedAt,
    },
    {
      id: "reviewer",
      title: "Reviewer",
      status: "queued",
      summary: "Will verify the result and resume path.",
      updatedAt,
    },
  ];
}

export function buildTeamSession(updatedAt: string): TeamRuntimeSession {
  return {
    id: nextCoordinationId("team"),
    status: "blocked",
    lanes: buildTeamLanes(updatedAt),
    nextAction: "Approve the plan to start the team run.",
    blockedReason: "Waiting for explicit plan approval.",
    resumeHint: null,
    updatedAt,
  };
}
