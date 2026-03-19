import type { AdaptiveChampionRecord, AdaptiveComparisonRecord, AdaptiveRecipeSnapshot, AdaptiveWorkspaceData, AdaptiveWorkspaceProfile } from "./types";
import { adaptationCacheKey, adaptationFilePath, normalizeAdaptiveWorkspaceKey } from "./workspace";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function nowIso(): string {
  return new Date().toISOString();
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function readCache<T>(cwd: string, scope: "state" | "champions" | "comparisons" | "candidates"): T | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(adaptationCacheKey(cwd, scope));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(cwd: string, scope: "state" | "champions" | "comparisons" | "candidates", value: unknown) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(adaptationCacheKey(cwd, scope), JSON.stringify(value));
}

export function createEmptyAdaptiveWorkspaceData(cwd: string): AdaptiveWorkspaceData {
  const workspace = normalizeAdaptiveWorkspaceKey(cwd);
  return {
    profile: {
      version: 1,
      workspace,
      learningState: "active",
      updatedAt: nowIso(),
    },
    champions: [],
    comparisons: [],
    candidates: [],
  };
}

function trimCandidates(rows: AdaptiveRecipeSnapshot[]): AdaptiveRecipeSnapshot[] {
  const ordered = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const kept: AdaptiveRecipeSnapshot[] = [];
  const familyCount = new Map<string, number>();
  const seenIds = new Set<string>();
  for (const row of ordered) {
    if (seenIds.has(row.id)) {
      continue;
    }
    const familyTotal = familyCount.get(row.family) ?? 0;
    if (kept.length >= 200 || familyTotal >= 50) {
      continue;
    }
    seenIds.add(row.id);
    familyCount.set(row.family, familyTotal + 1);
    kept.push(row);
  }
  return kept;
}

function trimComparisons(rows: AdaptiveComparisonRecord[]): AdaptiveComparisonRecord[] {
  return [...rows]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 200);
}

function normalizeProfile(cwd: string, raw: unknown): AdaptiveWorkspaceProfile {
  const fallback = createEmptyAdaptiveWorkspaceData(cwd).profile;
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const row = raw as Partial<AdaptiveWorkspaceProfile>;
  return {
    version: 1,
    workspace: normalizeAdaptiveWorkspaceKey(String(row.workspace ?? cwd)),
    learningState: row.learningState === "frozen" ? "frozen" : "active",
    updatedAt: String(row.updatedAt ?? fallback.updatedAt),
  };
}

async function readWorkspaceFile<T>(cwd: string, invokeFn: InvokeFn, scope: "state" | "champions" | "comparisons" | "candidates"): Promise<T | null> {
  const fileName = scope === "state" ? "state.json" : `${scope}.json`;
  try {
    const raw = await invokeFn<string>("workspace_read_text", {
      cwd,
      path: adaptationFilePath(cwd, fileName as "state.json" | "champions.json" | "comparisons.json" | "candidates.json"),
    });
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function loadAdaptiveWorkspaceData(cwd: string, invokeFn?: InvokeFn): Promise<AdaptiveWorkspaceData> {
  const fallback = createEmptyAdaptiveWorkspaceData(cwd);
  const cachedProfile = readCache<AdaptiveWorkspaceProfile>(cwd, "state");
  const cachedChampions = readCache<AdaptiveChampionRecord[]>(cwd, "champions");
  const cachedComparisons = readCache<AdaptiveComparisonRecord[]>(cwd, "comparisons");
  const cachedCandidates = readCache<AdaptiveRecipeSnapshot[]>(cwd, "candidates");
  const cached: AdaptiveWorkspaceData = {
    profile: normalizeProfile(cwd, cachedProfile ?? fallback.profile),
    champions: Array.isArray(cachedChampions) ? cachedChampions : fallback.champions,
    comparisons: Array.isArray(cachedComparisons) ? trimComparisons(cachedComparisons) : fallback.comparisons,
    candidates: Array.isArray(cachedCandidates) ? trimCandidates(cachedCandidates) : fallback.candidates,
  };
  if (!invokeFn) {
    return cached;
  }
  const [stateRow, champions, comparisons, candidates] = await Promise.all([
    readWorkspaceFile<AdaptiveWorkspaceProfile>(cwd, invokeFn, "state"),
    readWorkspaceFile<AdaptiveChampionRecord[]>(cwd, invokeFn, "champions"),
    readWorkspaceFile<AdaptiveComparisonRecord[]>(cwd, invokeFn, "comparisons"),
    readWorkspaceFile<AdaptiveRecipeSnapshot[]>(cwd, invokeFn, "candidates"),
  ]);
  const next: AdaptiveWorkspaceData = {
    profile: normalizeProfile(cwd, stateRow ?? cached.profile),
    champions: Array.isArray(champions) ? champions : cached.champions,
    comparisons: Array.isArray(comparisons) ? trimComparisons(comparisons) : cached.comparisons,
    candidates: Array.isArray(candidates) ? trimCandidates(candidates) : cached.candidates,
  };
  writeAdaptiveWorkspaceDataToCache(cwd, next);
  return next;
}

export function writeAdaptiveWorkspaceDataToCache(cwd: string, data: AdaptiveWorkspaceData) {
  writeCache(cwd, "state", data.profile);
  writeCache(cwd, "champions", data.champions);
  writeCache(cwd, "comparisons", trimComparisons(data.comparisons));
  writeCache(cwd, "candidates", trimCandidates(data.candidates));
}

export async function saveAdaptiveWorkspaceData(cwd: string, invokeFn: InvokeFn, data: AdaptiveWorkspaceData): Promise<AdaptiveWorkspaceData> {
  const next: AdaptiveWorkspaceData = {
    profile: {
      ...data.profile,
      workspace: normalizeAdaptiveWorkspaceKey(cwd),
      updatedAt: nowIso(),
    },
    champions: data.champions,
    comparisons: trimComparisons(data.comparisons),
    candidates: trimCandidates(data.candidates),
  };
  const baseCwd = adaptationFilePath(cwd, "state.json").replace(/\/state\.json$/, "");
  await Promise.all([
    invokeFn<string>("workspace_write_text", {
      cwd: baseCwd,
      name: "state.json",
      content: `${JSON.stringify(next.profile, null, 2)}\n`,
    }),
    invokeFn<string>("workspace_write_text", {
      cwd: baseCwd,
      name: "champions.json",
      content: `${JSON.stringify(next.champions, null, 2)}\n`,
    }),
    invokeFn<string>("workspace_write_text", {
      cwd: baseCwd,
      name: "comparisons.json",
      content: `${JSON.stringify(next.comparisons, null, 2)}\n`,
    }),
    invokeFn<string>("workspace_write_text", {
      cwd: baseCwd,
      name: "candidates.json",
      content: `${JSON.stringify(next.candidates, null, 2)}\n`,
    }),
  ]);
  writeAdaptiveWorkspaceDataToCache(cwd, next);
  return next;
}
