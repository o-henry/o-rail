import type { StudioRoleId } from "./handoffTypes";
import { upsertRoleKnowledgeProfile } from "./roleKnowledgeStore";
import { STUDIO_ROLE_TEMPLATES } from "./roleTemplates";

function cleanLine(input: unknown): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function toOutputText(output: unknown): string {
  if (typeof output === "string") {
    return cleanLine(output);
  }
  if (output && typeof output === "object") {
    try {
      const serialized = JSON.stringify(output, null, 2);
      return cleanLine(serialized);
    } catch {
      return cleanLine(output);
    }
  }
  return cleanLine(output);
}

function toSummary(text: string): string {
  if (!text) {
    return "";
  }
  return text.length <= 280 ? text : `${text.slice(0, 279)}…`;
}

function extractKeyPoints(text: string, logs: string[]): string[] {
  const bulletLines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean);
  if (bulletLines.length > 0) {
    return bulletLines.slice(0, 6);
  }
  const sentenceLines = text
    .split(/(?<=[.!?])\s+/)
    .map((line) => cleanLine(line))
    .filter(Boolean);
  if (sentenceLines.length > 0) {
    return sentenceLines.slice(0, 6);
  }
  return logs.map((line) => cleanLine(line)).filter(Boolean).slice(-4);
}

function extractSourceUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)"'<>]+/g) ?? [];
  return [...new Set(matches.map((value) => value.trim()))].slice(0, 6);
}

export function storeGraphRoleKnowledge(params: {
  roleId: StudioRoleId;
  runId: string;
  taskId?: string;
  output: unknown;
  logs?: string[];
}): void {
  const role = STUDIO_ROLE_TEMPLATES.find((row) => row.id === params.roleId);
  const text = toOutputText(params.output);
  const logs = Array.isArray(params.logs) ? params.logs : [];
  const summary = toSummary(text);
  if (!summary) {
    return;
  }
  const sourceUrls = extractSourceUrls(text);
  upsertRoleKnowledgeProfile({
    roleId: params.roleId,
    roleLabel: role?.label ?? params.roleId,
    goal: role?.goal ?? "역할 누적 지식",
    taskId: cleanLine(params.taskId) || role?.defaultTaskId || "TASK-001",
    runId: cleanLine(params.runId) || `graph-${Date.now()}`,
    summary,
    keyPoints: extractKeyPoints(text, logs),
    sources: sourceUrls.map((url) => ({
      url,
      status: "ok",
      fetchedAt: new Date().toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  });
}
