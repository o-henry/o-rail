import type { KnowledgeEntry } from "./knowledgeTypes";
import {
  mergeKnowledgeEntryRows,
  normalizeKnowledgeEntries,
  readKnowledgeEntries,
  writeKnowledgeEntries,
} from "./knowledgeIndex";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type WorkspaceKnowledgeCacheRecord = {
  cachedAt: number;
  rows: KnowledgeEntry[];
};

const WORKSPACE_KNOWLEDGE_CACHE_STORAGE_KEY = "rail.studio.workspaceKnowledgeHydration.v1";
const WORKSPACE_KNOWLEDGE_CACHE_TTL_MS = 60_000;
const workspaceKnowledgeCache = new Map<string, WorkspaceKnowledgeCacheRecord>();

function normalizeCwd(cwd: string): string {
  return String(cwd ?? "").trim().replace(/[\\/]+$/, "");
}

function mergeAndPersist(rows: KnowledgeEntry[]): KnowledgeEntry[] {
  const merged = mergeKnowledgeEntryRows(rows);
  writeKnowledgeEntries(merged);
  return merged;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function normalizeWorkspaceRows(cwd: string, rows: KnowledgeEntry[]): KnowledgeEntry[] {
  return rows.map((row) => ({
    ...row,
    workspacePath: String(row.workspacePath ?? "").trim() || cwd,
  }));
}

function readWorkspaceHydrationCache(): Record<string, WorkspaceKnowledgeCacheRecord> {
  if (!canUseLocalStorage()) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KNOWLEDGE_CACHE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, WorkspaceKnowledgeCacheRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeWorkspaceHydrationCache(cache: Record<string, WorkspaceKnowledgeCacheRecord>): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(WORKSPACE_KNOWLEDGE_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
}

function readCachedWorkspaceRows(cwd: string): KnowledgeEntry[] | null {
  const memory = workspaceKnowledgeCache.get(cwd);
  if (memory && Date.now() - memory.cachedAt < WORKSPACE_KNOWLEDGE_CACHE_TTL_MS) {
    return memory.rows;
  }
  const persisted = readWorkspaceHydrationCache()[cwd];
  if (!persisted || Date.now() - Number(persisted.cachedAt ?? 0) >= WORKSPACE_KNOWLEDGE_CACHE_TTL_MS) {
    return null;
  }
  const rows = normalizeWorkspaceRows(cwd, normalizeKnowledgeEntries(persisted.rows));
  workspaceKnowledgeCache.set(cwd, {
    cachedAt: Number(persisted.cachedAt ?? Date.now()),
    rows,
  });
  return rows;
}

function cacheWorkspaceRows(cwd: string, rows: KnowledgeEntry[]): void {
  const normalized = normalizeWorkspaceRows(cwd, rows);
  const record: WorkspaceKnowledgeCacheRecord = {
    cachedAt: Date.now(),
    rows: normalized,
  };
  workspaceKnowledgeCache.set(cwd, record);
  const persisted = readWorkspaceHydrationCache();
  persisted[cwd] = record;
  writeWorkspaceHydrationCache(persisted);
}

async function refreshWorkspaceArtifactRows(params: {
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<KnowledgeEntry[]> {
  const raw = await params.invokeFn<unknown[]>("knowledge_scan_workspace_artifacts", { cwd: params.cwd });
  const workspaceRows = normalizeWorkspaceRows(params.cwd, normalizeKnowledgeEntries(raw));
  if (workspaceRows.length === 0) {
    return readKnowledgeEntries();
  }
  cacheWorkspaceRows(params.cwd, workspaceRows);
  return mergeAndPersist([...readKnowledgeEntries(), ...workspaceRows]);
}

export function clearWorkspaceKnowledgeHydrationCacheForTest(): void {
  workspaceKnowledgeCache.clear();
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(WORKSPACE_KNOWLEDGE_CACHE_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export async function hydrateKnowledgeEntriesFromWorkspaceArtifacts(params: {
  cwd: string;
  invokeFn: InvokeFn;
  onUpdate?: (rows: KnowledgeEntry[]) => void;
  revalidateInBackground?: boolean;
}): Promise<KnowledgeEntry[]> {
  const cwd = normalizeCwd(params.cwd);
  if (!cwd) {
    return readKnowledgeEntries();
  }
  const cachedRows = readCachedWorkspaceRows(cwd);
  if (cachedRows) {
    const merged = mergeAndPersist([...readKnowledgeEntries(), ...cachedRows]);
    if (params.revalidateInBackground !== false) {
      void refreshWorkspaceArtifactRows({ cwd, invokeFn: params.invokeFn })
        .then((rows) => {
          params.onUpdate?.(rows);
        })
        .catch(() => undefined);
    }
    return merged;
  }
  try {
    const rows = await refreshWorkspaceArtifactRows({ cwd, invokeFn: params.invokeFn });
    params.onUpdate?.(rows);
    return rows;
  } catch {
    return readKnowledgeEntries();
  }
}

export async function hydrateKnowledgeEntriesFromWorkspaceSources(params: {
  cwd: string;
  invokeFn: InvokeFn;
  onUpdate?: (rows: KnowledgeEntry[]) => void;
  revalidateInBackground?: boolean;
}): Promise<KnowledgeEntry[]> {
  const cwd = normalizeCwd(params.cwd);
  if (!cwd) {
    return readKnowledgeEntries();
  }
  let merged = readKnowledgeEntries();
  try {
    const raw = await params.invokeFn<string>("workspace_read_text", {
      cwd,
      path: ".rail/studio_index/knowledge/index.json",
    });
    merged = mergeAndPersist([
      ...merged,
      ...normalizeWorkspaceRows(cwd, normalizeKnowledgeEntries(JSON.parse(String(raw ?? "[]")) as unknown)),
    ]);
  } catch {
    // ignore workspace index hydrate failures
  }
  return hydrateKnowledgeEntriesFromWorkspaceArtifacts({
    cwd,
    invokeFn: params.invokeFn,
    onUpdate: params.onUpdate,
    revalidateInBackground: params.revalidateInBackground,
  });
}
