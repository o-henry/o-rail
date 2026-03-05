import type { KnowledgeEntry } from "./knowledgeTypes";

const KNOWLEDGE_INDEX_STORAGE_KEY = "rail.studio.knowledge.index.v1";
const KNOWLEDGE_HIDDEN_RUN_IDS_STORAGE_KEY = "rail.studio.knowledge.hiddenRuns.v1";
const KNOWLEDGE_HIDDEN_ENTRY_IDS_STORAGE_KEY = "rail.studio.knowledge.hiddenEntries.v1";

let memoryHiddenRunIds = new Set<string>();
let memoryHiddenEntryIds = new Set<string>();

function normalizeToken(value: unknown): string {
  return String(value ?? "").trim();
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readHiddenTokens(storageKey: string, memorySet: Set<string>): Set<string> {
  if (!canUseLocalStorage()) {
    return new Set(memorySet);
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.map((row) => normalizeToken(row)).filter((row) => row.length > 0));
  } catch {
    return new Set();
  }
}

function writeHiddenTokens(storageKey: string, memorySet: Set<string>, next: Set<string>): void {
  const normalized = new Set(Array.from(next).map((row) => normalizeToken(row)).filter((row) => row.length > 0));
  memorySet.clear();
  for (const token of normalized) {
    memorySet.add(token);
  }
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(normalized)));
  } catch {
    // ignore storage failures
  }
}

function normalizeEntry(raw: unknown): KnowledgeEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const runId = String(row.runId ?? "").trim();
  const taskId = String(row.taskId ?? "").trim();
  const roleId = String(row.roleId ?? "").trim();
  const sourceKindRaw = String(row.sourceKind ?? "artifact").trim().toLowerCase();
  const sourceKind =
    sourceKindRaw === "web" || sourceKindRaw === "ai" || sourceKindRaw === "artifact"
      ? sourceKindRaw
      : "artifact";
  const sourceUrl = String(row.sourceUrl ?? "").trim() || undefined;
  const title = String(row.title ?? "").trim();
  if (!id || !runId || !taskId || !roleId || !title) {
    return null;
  }
  return {
    id,
    runId,
    taskId,
    roleId: roleId as KnowledgeEntry["roleId"],
    sourceKind,
    sourceUrl,
    title,
    summary: String(row.summary ?? "").trim(),
    createdAt: String(row.createdAt ?? "").trim() || new Date().toISOString(),
    markdownPath: String(row.markdownPath ?? "").trim() || undefined,
    jsonPath: String(row.jsonPath ?? "").trim() || undefined,
    sourceFile: String(row.sourceFile ?? "").trim() || undefined,
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
  if (isKnowledgeRunIdHidden(entry.runId) || isKnowledgeEntryIdHidden(entry.id)) {
    return readKnowledgeEntries();
  }
  const current = readKnowledgeEntries();
  const next = current.some((row) => row.id === entry.id)
    ? current.map((row) => (row.id === entry.id ? entry : row))
    : [...current, entry];
  writeKnowledgeEntries(next);
  return next;
}

export function removeKnowledgeEntry(entryId: string): KnowledgeEntry[] {
  const targetId = String(entryId ?? "").trim();
  if (!targetId) {
    return readKnowledgeEntries();
  }
  hideKnowledgeEntryId(targetId);
  const current = readKnowledgeEntries();
  const next = current.filter((row) => row.id !== targetId);
  writeKnowledgeEntries(next);
  return next;
}

export function removeKnowledgeEntriesByRunId(runId: string): KnowledgeEntry[] {
  const targetRunId = String(runId ?? "").trim();
  if (!targetRunId) {
    return readKnowledgeEntries();
  }
  hideKnowledgeRunId(targetRunId);
  const current = readKnowledgeEntries();
  const next = current.filter((row) => String(row.runId ?? "").trim() !== targetRunId);
  writeKnowledgeEntries(next);
  return next;
}

export function readHiddenKnowledgeRunIds(): Set<string> {
  return readHiddenTokens(KNOWLEDGE_HIDDEN_RUN_IDS_STORAGE_KEY, memoryHiddenRunIds);
}

export function writeHiddenKnowledgeRunIds(ids: Set<string>): void {
  writeHiddenTokens(KNOWLEDGE_HIDDEN_RUN_IDS_STORAGE_KEY, memoryHiddenRunIds, ids);
}

export function hideKnowledgeRunId(runId: string): void {
  const normalized = normalizeToken(runId);
  if (!normalized) {
    return;
  }
  const next = readHiddenKnowledgeRunIds();
  next.add(normalized);
  writeHiddenKnowledgeRunIds(next);
}

export function isKnowledgeRunIdHidden(runId: string): boolean {
  const normalized = normalizeToken(runId);
  if (!normalized) {
    return false;
  }
  return readHiddenKnowledgeRunIds().has(normalized);
}

export function readHiddenKnowledgeEntryIds(): Set<string> {
  return readHiddenTokens(KNOWLEDGE_HIDDEN_ENTRY_IDS_STORAGE_KEY, memoryHiddenEntryIds);
}

export function writeHiddenKnowledgeEntryIds(ids: Set<string>): void {
  writeHiddenTokens(KNOWLEDGE_HIDDEN_ENTRY_IDS_STORAGE_KEY, memoryHiddenEntryIds, ids);
}

export function hideKnowledgeEntryId(entryId: string): void {
  const normalized = normalizeToken(entryId);
  if (!normalized) {
    return;
  }
  const next = readHiddenKnowledgeEntryIds();
  next.add(normalized);
  writeHiddenKnowledgeEntryIds(next);
}

export function isKnowledgeEntryIdHidden(entryId: string): boolean {
  const normalized = normalizeToken(entryId);
  if (!normalized) {
    return false;
  }
  return readHiddenKnowledgeEntryIds().has(normalized);
}

export function clearHiddenKnowledgeIdsForTest(): void {
  memoryHiddenRunIds = new Set();
  memoryHiddenEntryIds = new Set();
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(KNOWLEDGE_HIDDEN_RUN_IDS_STORAGE_KEY);
    window.localStorage.removeItem(KNOWLEDGE_HIDDEN_ENTRY_IDS_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
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
