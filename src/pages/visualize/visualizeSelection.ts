function selectedRunStorageKey(cwd: string) {
  return `rail.visualize.selected-run::${String(cwd ?? "").trim()}`;
}

export function readStoredSelectedRunId(cwd: string) {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return String(window.sessionStorage.getItem(selectedRunStorageKey(cwd)) ?? "").trim();
  } catch {
    return "";
  }
}

export function writeStoredSelectedRunId(cwd: string, runId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const key = selectedRunStorageKey(cwd);
    const normalized = String(runId ?? "").trim();
    if (normalized) {
      window.sessionStorage.setItem(key, normalized);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore storage failures
  }
}

export function dispatchVisualizeSelection(runId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("rail:visualize-run-selected", {
    detail: { runId },
  }));
}
