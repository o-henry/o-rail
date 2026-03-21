import type { ThreadDetail } from "./threadTypes";

export type BrowserStore = {
  order: string[];
  details: Record<string, ThreadDetail>;
};

export type TasksActiveThreadSnapshot = {
  threadId: string;
  cwd: string;
};

const BROWSER_STORE_KEY = "rail.tasks.browser-state.v4";
const TASKS_PROJECT_PATH_KEY = "rail.tasks.project-path.v1";
const TASKS_PROJECT_LIST_KEY = "rail.tasks.project-list.v1";
const TASKS_HIDDEN_PROJECT_LIST_KEY = "rail.tasks.hidden-project-list.v1";
const TASKS_ACTIVE_THREAD_KEY = "rail.tasks.active-thread.v1";

function readSessionStorageValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const sessionValue = window.sessionStorage.getItem(key);
    if (sessionValue != null) {
      return sessionValue;
    }
    const legacyValue = window.localStorage.getItem(key);
    if (legacyValue != null) {
      window.sessionStorage.setItem(key, legacyValue);
      window.localStorage.removeItem(key);
      return legacyValue;
    }
  } catch {
    // ignore storage failures
  }
  return null;
}

function writeSessionStorageValue(key: string, value: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value == null) {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, value);
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

function emptyBrowserStore(): BrowserStore {
  return { order: [], details: {} };
}

export function cloneStore(store: BrowserStore): BrowserStore {
  return JSON.parse(JSON.stringify(store)) as BrowserStore;
}

export function loadBrowserStore(): BrowserStore {
  if (typeof window === "undefined") {
    return emptyBrowserStore();
  }
  try {
    const raw = readSessionStorageValue(BROWSER_STORE_KEY);
    if (!raw) {
      return emptyBrowserStore();
    }
    const parsed = JSON.parse(raw) as BrowserStore;
    if (!parsed || !Array.isArray(parsed.order) || typeof parsed.details !== "object") {
      return emptyBrowserStore();
    }
    return parsed;
  } catch {
    return emptyBrowserStore();
  }
}

export function persistBrowserStore(store: BrowserStore) {
  if (typeof window === "undefined") {
    return;
  }
  writeSessionStorageValue(BROWSER_STORE_KEY, JSON.stringify(store));
}

export function loadTasksProjectPath(defaultValue: string): string {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  try {
    const raw = readSessionStorageValue(TASKS_PROJECT_PATH_KEY);
    const value = String(raw ?? "").trim();
    return value || defaultValue;
  } catch {
    return defaultValue;
  }
}

export function persistTasksProjectPath(path: string) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    writeSessionStorageValue(TASKS_PROJECT_PATH_KEY, null);
    return;
  }
  writeSessionStorageValue(TASKS_PROJECT_PATH_KEY, normalized);
}

export function loadTasksProjectList(defaultValue: string): string[] {
  if (typeof window === "undefined") {
    return defaultValue.trim() ? [defaultValue.trim()] : [];
  }
  try {
    const raw = readSessionStorageValue(TASKS_PROJECT_LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const values = Array.isArray(parsed) ? parsed : [];
    const normalized = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (defaultValue.trim() && !normalized.includes(defaultValue.trim())) {
      normalized.push(defaultValue.trim());
    }
    return normalized;
  } catch {
    return defaultValue.trim() ? [defaultValue.trim()] : [];
  }
}

export function persistTasksProjectList(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = [...new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean))];
  writeSessionStorageValue(TASKS_PROJECT_LIST_KEY, JSON.stringify(normalized));
}

export function loadHiddenTasksProjectList(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = readSessionStorageValue(TASKS_HIDDEN_PROJECT_LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function persistHiddenTasksProjectList(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = [...new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean))];
  writeSessionStorageValue(TASKS_HIDDEN_PROJECT_LIST_KEY, JSON.stringify(normalized));
}

export function loadTasksActiveThreadSnapshot(): TasksActiveThreadSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = readSessionStorageValue(TASKS_ACTIVE_THREAD_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const threadId = String(parsed.threadId ?? "").trim();
    const cwd = String(parsed.cwd ?? "").trim();
    if (!threadId || !cwd) {
      return null;
    }
    return { threadId, cwd };
  } catch {
    return null;
  }
}

export function persistTasksActiveThreadSnapshot(snapshot: TasksActiveThreadSnapshot | null) {
  if (typeof window === "undefined") {
    return;
  }
  const threadId = String(snapshot?.threadId ?? "").trim();
  const cwd = String(snapshot?.cwd ?? "").trim();
  if (!threadId || !cwd) {
    writeSessionStorageValue(TASKS_ACTIVE_THREAD_KEY, null);
    return;
  }
  writeSessionStorageValue(
    TASKS_ACTIVE_THREAD_KEY,
    JSON.stringify({
      threadId,
      cwd,
    }),
  );
}
