import type { AgenticCoordinationState, SessionIndexEntry } from "../../features/orchestration/agentic/coordinationTypes";

type TasksThreadOrchestrationCardProps = {
  orchestration: AgenticCoordinationState | null;
  recentSessions: SessionIndexEntry[];
  onOpenSession: (threadId: string) => void;
  onApprovePlan: () => void;
  onRequestFollowup: () => void;
  onResume: () => void;
  onCancel: () => void;
  onVerifyReview: () => void;
};

export function TasksThreadOrchestrationCard(_props: TasksThreadOrchestrationCardProps) {
  return null;
}
