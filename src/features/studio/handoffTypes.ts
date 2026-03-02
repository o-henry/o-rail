export type StudioRoleId =
  | "pm_planner"
  | "client_programmer"
  | "system_programmer"
  | "tooling_engineer"
  | "art_pipeline"
  | "qa_engineer"
  | "build_release"
  | "technical_writer";

export type StudioTaskId = string;

export type HandoffStatus = "requested" | "accepted" | "rejected" | "completed";

export type HandoffRecord = {
  id: string;
  runId?: string;
  fromRole: StudioRoleId;
  toRole: StudioRoleId;
  taskId: StudioTaskId;
  request: string;
  artifactPaths: string[];
  status: HandoffStatus;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
};

