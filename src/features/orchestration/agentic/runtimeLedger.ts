import type { AgenticCoordinationState, RuntimeLedgerEvent, SessionIndexEntry } from "./coordinationTypes";

function normalizePath(input: string): string {
  return String(input ?? "").trim().replace(/[\\/]+$/, "");
}

export function buildRuntimeSessionIndexPath(cwd: string) {
  return `${normalizePath(cwd)}/.rail/runtime/tasks/index.json`;
}

export function buildRuntimeLedgerPaths(cwd: string, threadId: string) {
  const root = `${normalizePath(cwd)}/.rail/runtime/tasks/${encodeURIComponent(String(threadId ?? "").trim() || "thread")}`;
  return {
    root,
    statePath: `${root}/coordination.json`,
    ledgerPath: `${root}/ledger.json`,
    indexPath: buildRuntimeSessionIndexPath(cwd),
  };
}

export function appendRuntimeLedger(events: RuntimeLedgerEvent[], event: RuntimeLedgerEvent): RuntimeLedgerEvent[] {
  const existing = events.filter((entry) => entry.id !== event.id);
  return [...existing, event].sort((left, right) => left.at.localeCompare(right.at));
}

export function upsertSessionIndex(entries: SessionIndexEntry[], entry: SessionIndexEntry): SessionIndexEntry[] {
  const next = [...entries.filter((item) => item.threadId !== entry.threadId), entry];
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function searchSessionIndex(entries: SessionIndexEntry[], query: string): SessionIndexEntry[] {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) {
    return [...entries];
  }
  return entries.filter((entry) => {
    const haystack = [
      entry.title,
      entry.threadId,
      entry.mode,
      entry.intent,
      entry.status,
      entry.nextAction,
    ].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
}

export function serializeCoordinationState(state: AgenticCoordinationState) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function serializeRuntimeLedger(events: RuntimeLedgerEvent[]) {
  return `${JSON.stringify(events, null, 2)}\n`;
}

export function serializeSessionIndex(entries: SessionIndexEntry[]) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}
