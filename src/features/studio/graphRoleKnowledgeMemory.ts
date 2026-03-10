import type { StudioRoleId } from "./handoffTypes";
import { isLegacyPmStudioRole, resolveEffectiveStudioRoleId } from "./pmPlanningMode";
import {
  getRoleInstanceKnowledgeProfile,
  getRoleKnowledgeProfile,
  upsertRoleKnowledgeProfile,
} from "./roleKnowledgeStore";
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

function mergeKeyPoints(existing: string[], next: string[]): string[] {
  const merged = [...next, ...existing]
    .map((line) => cleanLine(line))
    .filter(Boolean);
  return [...new Set(merged)].slice(0, 12);
}

function mergeSources(
  existing: Array<{ url: string; status: "ok" | "error"; fetchedAt?: string }>,
  next: Array<{ url: string; status: "ok" | "error"; fetchedAt?: string }>,
) {
  const merged = new Map<string, { url: string; status: "ok" | "error"; fetchedAt?: string }>();
  for (const row of [...next, ...existing]) {
    const url = cleanLine(row.url);
    if (!url || merged.has(url)) {
      continue;
    }
    merged.set(url, {
      url,
      status: row.status === "ok" ? "ok" : "error",
      fetchedAt: cleanLine(row.fetchedAt) || undefined,
    });
  }
  return [...merged.values()].slice(0, 8);
}

export function storeGraphRoleKnowledge(params: {
  roleId: StudioRoleId;
  runId: string;
  taskId?: string;
  output: unknown;
  logs?: string[];
  roleInstanceId?: string;
  pmPlanningMode?: unknown;
}): void {
  const shouldResolvePmVariant =
    isLegacyPmStudioRole(params.roleId)
    || (params.roleId === "pm_planner" && String(params.pmPlanningMode ?? "").trim().length > 0);
  const effectiveRoleId = shouldResolvePmVariant
    ? (resolveEffectiveStudioRoleId(params.roleId, params.pmPlanningMode) ?? params.roleId)
    : params.roleId;
  const role = STUDIO_ROLE_TEMPLATES.find((row) => row.id === effectiveRoleId);
  const text = toOutputText(params.output);
  const logs = Array.isArray(params.logs) ? params.logs : [];
  const summary = toSummary(text);
  if (!summary) {
    return;
  }
  const sourceUrls = extractSourceUrls(text);
  const existing = getRoleKnowledgeProfile(effectiveRoleId);
  const mergedSummary = existing
    ? `${summary}${existing.summary && existing.summary !== summary ? `\n이전 누적 요약: ${existing.summary}` : ""}`.trim()
    : summary;
  upsertRoleKnowledgeProfile({
    roleId: effectiveRoleId,
    scope: "shared",
    roleLabel: role?.label ?? effectiveRoleId,
    goal: role?.goal ?? "역할 누적 지식",
    taskId: cleanLine(params.taskId) || role?.defaultTaskId || "TASK-001",
    runId: cleanLine(params.runId) || `graph-${Date.now()}`,
    summary: mergedSummary,
    keyPoints: mergeKeyPoints(existing?.keyPoints ?? [], extractKeyPoints(text, logs)),
    sources: mergeSources(
      existing?.sources ?? [],
      sourceUrls.map((url) => ({
        url,
        status: "ok" as const,
        fetchedAt: new Date().toISOString(),
      })),
    ),
    updatedAt: new Date().toISOString(),
    markdownPath: existing?.markdownPath,
    jsonPath: existing?.jsonPath,
  });
  const roleInstanceId = cleanLine(params.roleInstanceId);
  if (!roleInstanceId) {
    return;
  }
  const existingInstance = getRoleInstanceKnowledgeProfile(effectiveRoleId, roleInstanceId);
  upsertRoleKnowledgeProfile({
    roleId: effectiveRoleId,
    scope: "instance",
    instanceId: roleInstanceId,
    roleLabel: role?.label ?? effectiveRoleId,
    goal: role?.goal ?? "역할 누적 지식",
    taskId: cleanLine(params.taskId) || role?.defaultTaskId || "TASK-001",
    runId: cleanLine(params.runId) || `graph-${Date.now()}`,
    summary,
    keyPoints: mergeKeyPoints(existingInstance?.keyPoints ?? [], extractKeyPoints(text, logs)),
    sources: mergeSources(
      existingInstance?.sources ?? [],
      sourceUrls.map((url) => ({
        url,
        status: "ok" as const,
        fetchedAt: new Date().toISOString(),
      })),
    ),
    updatedAt: new Date().toISOString(),
    markdownPath: existingInstance?.markdownPath,
    jsonPath: existingInstance?.jsonPath,
  });
}
