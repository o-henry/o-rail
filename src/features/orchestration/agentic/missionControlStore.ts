import type { MissionControlState } from "./missionControl";

const STORAGE_KEY_PREFIX = "rail.agentic.mission.control.v1";

function storageKeyForCwd(cwd: string): string {
  const normalized = String(cwd ?? "").trim();
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(normalized || "default")}`;
}

export function readMissionControlState(cwd: string): MissionControlState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(storageKeyForCwd(cwd));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as MissionControlState;
  } catch {
    return null;
  }
}

export function writeMissionControlState(cwd: string, state: MissionControlState | null): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = storageKeyForCwd(cwd);
  if (!state) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(state));
}
