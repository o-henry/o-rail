import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import { extractKnowledgeRequestSummary } from "../../features/studio/knowledgeRequestSummary";
import { toUpperSnakeToken } from "./knowledgeEntryMapping";

export type KnowledgeRoleGroup = {
  id: string;
  roleKey: string;
  label: string;
  detail: string;
  entries: KnowledgeEntry[];
};

export type KnowledgeGroup = {
  id: string;
  runId: string;
  runIds: string[];
  taskId: string;
  promptLabel: string;
  entries: KnowledgeEntry[];
  roleGroups: KnowledgeRoleGroup[];
};

export function sortKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveGroupPromptLabel(rows: KnowledgeEntry[], fallbackTaskId: string): string {
  const summary = rows
    .map((row) => String(row.requestLabel ?? "").trim() || extractKnowledgeRequestSummary(String(row.summary ?? "")))
    .find(Boolean);
  return summary || fallbackTaskId;
}

function resolveRoleGroupKey(entry: KnowledgeEntry): string {
  return String(entry.taskAgentId ?? entry.roleId ?? "").trim() || "unknown-role";
}

function resolveRoleGroupLabel(entry: KnowledgeEntry): string {
  return String(entry.taskAgentLabel ?? entry.studioRoleLabel ?? entry.roleId ?? "").trim() || "UNKNOWN ROLE";
}

function resolveRoleGroupDetail(entry: KnowledgeEntry): string {
  return String(entry.studioRoleLabel ?? entry.roleId ?? "").trim() || "-";
}

export function groupKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeGroup[] {
  const bySession = new Map<string, KnowledgeEntry[]>();
  for (const entry of entries) {
    const taskId = toUpperSnakeToken(String(entry.taskId ?? "")) || "TASK_UNKNOWN";
    const runId = String(entry.runId ?? "").trim() || "run-unknown";
    const sessionKey = taskId !== "TASK_UNKNOWN" ? taskId : runId;
    const bucket = bySession.get(sessionKey) ?? [];
    bucket.push(entry);
    bySession.set(sessionKey, bucket);
  }
  return [...bySession.values()]
    .map((rows) => {
      const taskId =
        rows
          .map((row) => toUpperSnakeToken(String(row.taskId ?? "")))
          .find((value) => value && value !== "TASK_UNKNOWN") ?? "TASK_UNKNOWN";
      const runIds = [...new Set(rows.map((row) => String(row.runId ?? "").trim()).filter(Boolean))];
      const runId = runIds[0] ?? "run-unknown";
      const byRole = new Map<string, KnowledgeEntry[]>();
      for (const row of rows) {
        const roleKey = resolveRoleGroupKey(row);
        const roleBucket = byRole.get(roleKey) ?? [];
        roleBucket.push(row);
        byRole.set(roleKey, roleBucket);
      }
      return {
        id: `${runId}:${taskId}`,
        runId,
        runIds,
        taskId,
        entries: rows,
        promptLabel: resolveGroupPromptLabel(rows, taskId),
        roleGroups: [...byRole.entries()]
          .map(([roleKey, roleRows]) => ({
            id: `${runId}:${roleKey}`,
            roleKey,
            label: resolveRoleGroupLabel(roleRows[0]),
            detail: resolveRoleGroupDetail(roleRows[0]),
            entries: roleRows,
          }))
          .sort((left, right) => {
            const at = new Date(String(left.entries[0]?.createdAt ?? 0)).getTime();
            const bt = new Date(String(right.entries[0]?.createdAt ?? 0)).getTime();
            return bt - at;
          }),
      };
    })
    .sort((a, b) => {
      const at = new Date(String(a.entries[0]?.createdAt ?? 0)).getTime();
      const bt = new Date(String(b.entries[0]?.createdAt ?? 0)).getTime();
      return bt - at;
    });
}

export function buildKnowledgeEntryStats(entries: KnowledgeEntry[]): {
  total: number;
  artifact: number;
  web: number;
  ai: number;
} {
  return {
    total: entries.length,
    artifact: entries.filter((row) => row.sourceKind === "artifact").length,
    web: entries.filter((row) => row.sourceKind === "web").length,
    ai: entries.filter((row) => row.sourceKind === "ai").length,
  };
}

export function shouldDeleteKnowledgeRunRecord(sourceFile: string): boolean {
  const normalizedSourceFile = String(sourceFile ?? "").trim();
  if (!normalizedSourceFile) {
    return false;
  }
  const lowered = normalizedSourceFile.toLowerCase();
  return (
    !normalizedSourceFile.includes("/") &&
    !normalizedSourceFile.includes("\\") &&
    lowered.endsWith(".json") &&
    !lowered.startsWith("dashboard-")
  );
}
