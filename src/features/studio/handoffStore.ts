import type { HandoffRecord, HandoffStatus, StudioRoleId } from "./handoffTypes";

const HANDOFF_STORAGE_KEY = "rail.studio.handoffs.v1";

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeHandoffStatus(raw: unknown): HandoffStatus {
  return raw === "accepted" || raw === "rejected" || raw === "completed" ? raw : "requested";
}

function normalizeRole(raw: unknown, fallback: StudioRoleId): StudioRoleId {
  const text = String(raw ?? "").trim();
  if (
    text === "pm_planner" ||
    text === "pm_creative_director" ||
    text === "pm_feasibility_critic" ||
    text === "client_programmer" ||
    text === "system_programmer" ||
    text === "tooling_engineer" ||
    text === "art_pipeline" ||
    text === "qa_engineer" ||
    text === "build_release" ||
    text === "technical_writer"
  ) {
    return text;
  }
  return fallback;
}

function normalizeRecord(raw: unknown): HandoffRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const taskId = String(row.taskId ?? "").trim();
  const request = String(row.request ?? "").trim();
  if (!id || !taskId || !request) {
    return null;
  }
  const createdAt = String(row.createdAt ?? "").trim() || nowIso();
  const updatedAt = String(row.updatedAt ?? "").trim() || createdAt;
  return {
    id,
    runId: String(row.runId ?? "").trim() || undefined,
    fromRole: normalizeRole(row.fromRole, "pm_planner"),
    toRole: normalizeRole(row.toRole, "client_programmer"),
    taskId,
    request,
    artifactPaths: Array.isArray(row.artifactPaths)
      ? row.artifactPaths.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [],
    status: sanitizeHandoffStatus(row.status),
    rejectReason: String(row.rejectReason ?? "").trim() || undefined,
    createdAt,
    updatedAt,
  };
}

export function readHandoffRecords(): HandoffRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(HANDOFF_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((row) => normalizeRecord(row)).filter((row): row is HandoffRecord => row !== null);
  } catch {
    return [];
  }
}

export function writeHandoffRecords(rows: HandoffRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(rows));
}

export function upsertHandoffRecord(input: Omit<HandoffRecord, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
}): HandoffRecord[] {
  const current = readHandoffRecords();
  const createdAt = String(input.createdAt ?? "").trim() || nowIso();
  const nextRecord: HandoffRecord = {
    ...input,
    createdAt,
    updatedAt: String(input.updatedAt ?? "").trim() || nowIso(),
  };
  const next = current.some((row) => row.id === input.id)
    ? current.map((row) => (row.id === input.id ? nextRecord : row))
    : [...current, nextRecord];
  writeHandoffRecords(next);
  return next;
}

export async function persistHandoffRecordsToWorkspace(params: {
  cwd: string;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  rows: HandoffRecord[];
}): Promise<string | null> {
  const cwd = String(params.cwd ?? "").trim().replace(/[\\/]+$/, "");
  if (!cwd) {
    return null;
  }
  try {
    const payload = `${JSON.stringify(params.rows, null, 2)}\n`;
    const path = await params.invokeFn<string>("workspace_write_text", {
      cwd: `${cwd}/.rail/studio_index/handoffs`,
      name: "handoffs.json",
      content: payload,
    });
    return path;
  } catch {
    return null;
  }
}
