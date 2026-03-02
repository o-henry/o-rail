import type { StudioRoleId, StudioTaskId } from "./handoffTypes";

export type CodeChangeApprovalStatus = "pending" | "approved" | "rejected";

export type CodeChangeApproval = {
  id: string;
  runId?: string;
  roleId: StudioRoleId;
  taskId: StudioTaskId;
  title: string;
  summary: string;
  patchPreview: string;
  status: CodeChangeApprovalStatus;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
};

