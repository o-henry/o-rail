const FEED_HIDDEN_RUN_IDS_STORAGE_KEY = "RAIL_FEED_HIDDEN_RUN_IDS_V1";

let memoryHiddenRunIds = new Set<string>();

function normalizeRunId(value: unknown): string {
  return String(value ?? "").trim();
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function readHiddenFeedRunIds(): Set<string> {
  if (!canUseLocalStorage()) {
    return new Set(memoryHiddenRunIds);
  }
  try {
    const raw = window.localStorage.getItem(FEED_HIDDEN_RUN_IDS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const normalized = parsed
      .map((row) => normalizeRunId(row))
      .filter((row) => row.length > 0);
    return new Set(normalized);
  } catch {
    return new Set();
  }
}

export function writeHiddenFeedRunIds(ids: Set<string>): void {
  const normalized = Array.from(ids)
    .map((row) => normalizeRunId(row))
    .filter((row) => row.length > 0);
  memoryHiddenRunIds = new Set(normalized);
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(FEED_HIDDEN_RUN_IDS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage failures
  }
}

export function hideFeedRunId(runId: string): void {
  const normalized = normalizeRunId(runId);
  if (!normalized) {
    return;
  }
  const next = readHiddenFeedRunIds();
  next.add(normalized);
  writeHiddenFeedRunIds(next);
}

export function isFeedRunIdHidden(runId: string): boolean {
  const normalized = normalizeRunId(runId);
  if (!normalized) {
    return false;
  }
  return readHiddenFeedRunIds().has(normalized);
}

export function clearHiddenFeedRunIdsForTest(): void {
  memoryHiddenRunIds = new Set();
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(FEED_HIDDEN_RUN_IDS_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}
