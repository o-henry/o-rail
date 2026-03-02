import type { StudioRoleId, StudioTaskId } from "./handoffTypes";

export type KnowledgeEntry = {
  id: string;
  runId: string;
  taskId: StudioTaskId;
  roleId: StudioRoleId;
  title: string;
  summary: string;
  createdAt: string;
  markdownPath?: string;
  jsonPath?: string;
};

