export type WorkflowWorkspaceEvent = {
  id: string;
  source: string;
  message: string;
  level?: string;
};

export type WorkflowWorkspaceNodeState = {
  status: string;
  logs?: string[];
};
