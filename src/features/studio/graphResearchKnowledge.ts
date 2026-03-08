import { toStudioRoleId } from "./roleUtils";
import type { KnowledgeEntry, KnowledgeSourcePost } from "./knowledgeTypes";

type ResearchNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toFilePath(post: KnowledgeSourcePost, kind: string): string | undefined {
  const match = post.attachments.find((row) => row.kind === kind);
  const path = cleanLine(match?.filePath);
  return path || undefined;
}

function isResearchSourceKind(sourceKind: string): boolean {
  return sourceKind === "data_research" || sourceKind === "data_pipeline";
}

export function isGraphResearchNode(node: ResearchNode | null | undefined): node is ResearchNode {
  if (!node || node.type !== "turn") {
    return false;
  }
  const sourceKind = cleanLine((node.config as Record<string, unknown>)?.sourceKind).toLowerCase();
  return isResearchSourceKind(sourceKind);
}

export function toGraphResearchKnowledgeEntry(params: {
  post: KnowledgeSourcePost;
  node: ResearchNode;
}): KnowledgeEntry | null {
  if (!isGraphResearchNode(params.node)) {
    return null;
  }
  const config = params.node.config as Record<string, unknown>;
  const sourceKind = cleanLine(config.sourceKind).toLowerCase();
  const roleId = toStudioRoleId(cleanLine(config.handoffRoleId)) ?? "technical_writer";
  const summary = cleanLine(params.post.summary);
  const taskId = cleanLine(config.taskId || config.handoffTaskId || config.viaTemplateLabel || params.post.runId) || "TASK-001";
  const titleBase = cleanLine(config.role) || cleanLine(params.post.agentName) || "조사 자료";
  const titleSummary = summary ? summary.slice(0, 56) : "조사 결과";

  return {
    id: cleanLine(params.post.id),
    runId: cleanLine(params.post.runId),
    taskId,
    roleId,
    sourceKind: sourceKind === "data_research" ? "web" : "ai",
    title: `${titleBase} · ${titleSummary}`,
    summary: summary || `${titleBase} 조사 결과`,
    createdAt: cleanLine(params.post.createdAt) || new Date().toISOString(),
    markdownPath: toFilePath(params.post, "markdown"),
    jsonPath: toFilePath(params.post, "json"),
    sourceFile: cleanLine(params.post.sourceFile) || undefined,
  };
}
