const ADAPTATION_STORAGE_PREFIX = "rail.studio.adaptation.v1";

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeAdaptiveWorkspaceKey(cwd: string): string {
  const normalized = normalizeSlashes(String(cwd ?? "").trim()).replace(/\/+$/, "");
  return normalized || "default";
}

export function adaptationStorageDir(cwd: string): string {
  return `${normalizeAdaptiveWorkspaceKey(cwd)}/.rail/studio_adaptation`;
}

export function adaptationFilePath(cwd: string, name: "state.json" | "champions.json" | "comparisons.json" | "candidates.json"): string {
  return `${adaptationStorageDir(cwd)}/${name}`;
}

export function adaptationCacheKey(cwd: string, scope: "state" | "champions" | "comparisons" | "candidates"): string {
  return `${ADAPTATION_STORAGE_PREFIX}:${encodeURIComponent(normalizeAdaptiveWorkspaceKey(cwd))}:${scope}`;
}
