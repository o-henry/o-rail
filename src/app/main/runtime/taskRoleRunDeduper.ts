const RECENT_TASK_ROLE_RUNS = new Map<string, number>();

function nowMs(now?: number): number {
  return typeof now === "number" ? now : Date.now();
}

function hashPrompt(value: string): string {
  let hash = 0;
  const normalized = String(value ?? "").trim();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return String(hash >>> 0);
}

export function shouldSkipRecentTaskRoleRun(params: {
  taskId: string;
  roleId: string;
  prompt: string;
  mode?: string;
  windowMs?: number;
  now?: number;
}): boolean {
  const ttl = params.windowMs ?? 45_000;
  const timestamp = nowMs(params.now);
  for (const [key, seenAt] of RECENT_TASK_ROLE_RUNS.entries()) {
    if (timestamp - seenAt > ttl) {
      RECENT_TASK_ROLE_RUNS.delete(key);
    }
  }

  const key = [
    String(params.taskId ?? "").trim(),
    String(params.roleId ?? "").trim(),
    String(params.mode ?? "direct").trim(),
    hashPrompt(params.prompt),
  ].join(":");
  const existing = RECENT_TASK_ROLE_RUNS.get(key);
  if (typeof existing === "number" && timestamp - existing <= ttl) {
    return true;
  }
  RECENT_TASK_ROLE_RUNS.set(key, timestamp);
  return false;
}

export function resetTaskRoleRunDeduper() {
  RECENT_TASK_ROLE_RUNS.clear();
}
