export type CoordinationMode = "quick" | "fanout" | "team";

export type ExecutionIntent = "simple" | "research" | "multi_step" | "review_heavy";

export type CoordinationStatus =
  | "planning"
  | "running"
  | "blocked"
  | "waiting_review"
  | "needs_resume"
  | "completed"
  | "cancelled";

export type BackgroundDelegationCategory = "explore" | "research" | "review";

export type BackgroundDelegationTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BackgroundDelegationTask = {
  id: string;
  category: BackgroundDelegationCategory;
  title: string;
  status: BackgroundDelegationTaskStatus;
  summary: string;
  updatedAt: string;
};

export type BackgroundDelegationResult = {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  updatedAt: string;
};

export type TeamWorkerLaneStatus = "queued" | "active" | "blocked" | "review" | "done" | "failed" | "cancelled";

export type TeamWorkerLane = {
  id: string;
  title: string;
  status: TeamWorkerLaneStatus;
  summary: string;
  updatedAt: string;
};

export type TeamRuntimeSession = {
  id: string;
  status: CoordinationStatus;
  lanes: TeamWorkerLane[];
  nextAction: string;
  blockedReason?: string | null;
  resumeHint?: string | null;
  updatedAt: string;
};

export type ExecutionPlanStepStatus = "pending" | "active" | "done";

export type ExecutionPlanStep = {
  id: string;
  title: string;
  status: ExecutionPlanStepStatus;
};

export type ExecutionPlanRecord = {
  id: string;
  summary: string;
  requiresApproval: boolean;
  approvedAt?: string | null;
  steps: ExecutionPlanStep[];
};

export type RuntimeLedgerEventKind =
  | "session_created"
  | "mode_selected"
  | "plan_ready"
  | "plan_approved"
  | "run_started"
  | "run_waiting_review"
  | "run_blocked"
  | "run_completed"
  | "run_cancelled"
  | "resume_requested"
  | "review_reopened";

export type RuntimeLedgerEvent = {
  id: string;
  threadId: string;
  kind: RuntimeLedgerEventKind;
  summary: string;
  at: string;
};

export type SessionResumePointer = {
  threadId: string;
  label: string;
  reason: string;
  nextAction: string;
};

export type SessionIndexEntry = {
  threadId: string;
  title: string;
  mode: CoordinationMode;
  intent: ExecutionIntent;
  status: CoordinationStatus;
  nextAction: string;
  updatedAt: string;
};

export type GuidanceOverlaySectionKind = "role" | "policy" | "checklist";

export type GuidanceOverlaySection = {
  id: string;
  title: string;
  body: string;
  kind: GuidanceOverlaySectionKind;
};

export type AgenticCoordinationState = {
  threadId: string;
  prompt: string;
  requestedRoleIds: string[];
  recommendedMode: CoordinationMode;
  mode: CoordinationMode;
  intent: ExecutionIntent;
  status: CoordinationStatus;
  nextAction: string;
  blockedReason?: string | null;
  plan: ExecutionPlanRecord | null;
  delegateTasks: BackgroundDelegationTask[];
  delegateResults: BackgroundDelegationResult[];
  teamSession: TeamRuntimeSession | null;
  resumePointer?: SessionResumePointer | null;
  guidance: GuidanceOverlaySection[];
  updatedAt: string;
};
