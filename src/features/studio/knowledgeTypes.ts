import type { StudioRoleId, StudioTaskId } from "./handoffTypes";

export type KnowledgeSourceKind = "artifact" | "web" | "ai";

export type KnowledgeEntry = {
  id: string;
  runId: string;
  taskId: StudioTaskId;
  roleId: StudioRoleId;
  sourceKind: KnowledgeSourceKind;
  sourceUrl?: string;
  title: string;
  summary: string;
  createdAt: string;
  markdownPath?: string;
  jsonPath?: string;
  sourceFile?: string;
};

export type KnowledgeSourcePost = {
  id: string;
  runId: string;
  topic?: string | null;
  topicLabel?: string | null;
  groupName?: string | null;
  summary: string;
  createdAt: string;
  agentName: string;
  attachments: Array<{
    kind: string;
    filePath?: string;
  }>;
  sourceFile?: string;
};
