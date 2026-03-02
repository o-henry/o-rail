import type { KnowledgeEntry } from "./knowledgeTypes";

const KNOWLEDGE_INDEX_STORAGE_KEY = "rail.studio.knowledge.index.v1";

function normalizeEntry(raw: unknown): KnowledgeEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const runId = String(row.runId ?? "").trim();
  const taskId = String(row.taskId ?? "").trim();
  const roleId = String(row.roleId ?? "").trim();
  const title = String(row.title ?? "").trim();
  if (!id || !runId || !taskId || !roleId || !title) {
    return null;
  }
  return {
    id,
    runId,
    taskId,
    roleId: roleId as KnowledgeEntry["roleId"],
    title,
    summary: String(row.summary ?? "").trim(),
    createdAt: String(row.createdAt ?? "").trim() || new Date().toISOString(),
    markdownPath: String(row.markdownPath ?? "").trim() || undefined,
    jsonPath: String(row.jsonPath ?? "").trim() || undefined,
  };
}

export function readKnowledgeEntries(): KnowledgeEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(KNOWLEDGE_INDEX_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((row) => normalizeEntry(row)).filter((row): row is KnowledgeEntry => row !== null);
  } catch {
    return [];
  }
}

export function writeKnowledgeEntries(rows: KnowledgeEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(KNOWLEDGE_INDEX_STORAGE_KEY, JSON.stringify(rows));
}

export function upsertKnowledgeEntry(entry: KnowledgeEntry): KnowledgeEntry[] {
  const current = readKnowledgeEntries();
  const next = current.some((row) => row.id === entry.id)
    ? current.map((row) => (row.id === entry.id ? entry : row))
    : [...current, entry];
  writeKnowledgeEntries(next);
  return next;
}

export async function persistKnowledgeIndexToWorkspace(params: {
  cwd: string;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  rows: KnowledgeEntry[];
}): Promise<string | null> {
  const cwd = String(params.cwd ?? "").trim().replace(/[\\/]+$/, "");
  if (!cwd) {
    return null;
  }
  try {
    const payload = `${JSON.stringify(params.rows, null, 2)}\n`;
    const path = await params.invokeFn<string>("workspace_write_text", {
      cwd: `${cwd}/.rail/studio_index/knowledge`,
      name: "index.json",
      content: payload,
    });
    return path;
  } catch {
    return null;
  }
}
