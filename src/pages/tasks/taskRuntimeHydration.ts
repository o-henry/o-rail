import { buildRuntimeSessionIndexPath, buildRuntimeLedgerPaths, upsertSessionIndex } from "../../features/orchestration/agentic/runtimeLedger";
import type { AgenticCoordinationState, SessionIndexEntry } from "../../features/orchestration/agentic/coordinationTypes";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function readWorkspaceJson<T>(cwd: string, path: string, invokeFn: InvokeFn): Promise<T | null> {
  try {
    const raw = await invokeFn<string>("workspace_read_text", { cwd, path });
    if (!String(raw ?? "").trim()) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadPersistedCoordinationState(cwd: string, threadId: string, invokeFn: InvokeFn): Promise<AgenticCoordinationState | null> {
  const normalizedThreadId = String(threadId ?? "").trim();
  if (!cwd || !normalizedThreadId) {
    return null;
  }
  const { statePath } = buildRuntimeLedgerPaths(cwd, normalizedThreadId);
  const parsed = await readWorkspaceJson<AgenticCoordinationState>(cwd, statePath, invokeFn);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export async function loadPersistedRuntimeSessionIndex(cwd: string, invokeFn: InvokeFn): Promise<SessionIndexEntry[]> {
  if (!cwd) {
    return [];
  }
  const parsed = await readWorkspaceJson<SessionIndexEntry[]>(cwd, buildRuntimeSessionIndexPath(cwd), invokeFn);
  return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
}

export function pickNewerCoordinationState(
  current: AgenticCoordinationState | null | undefined,
  persisted: AgenticCoordinationState | null | undefined,
): AgenticCoordinationState | null {
  if (!current) {
    return persisted ?? null;
  }
  if (!persisted) {
    return current;
  }
  return String(persisted.updatedAt ?? "").localeCompare(String(current.updatedAt ?? "")) >= 0 ? persisted : current;
}

export function mergeRuntimeSessionIndexes(current: SessionIndexEntry[], persisted: SessionIndexEntry[]): SessionIndexEntry[] {
  return [...current, ...persisted].reduce<SessionIndexEntry[]>((entries, entry) => {
    if (!entry?.threadId) {
      return entries;
    }
    return upsertSessionIndex(entries, entry);
  }, []);
}
