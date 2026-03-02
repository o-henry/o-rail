import type { CodeChangeApproval, CodeChangeApprovalStatus } from "./approvalTypes";

const APPROVAL_QUEUE_STORAGE_KEY = "rail.studio.approval.queue.v1";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeApproval(raw: unknown): CodeChangeApproval | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const roleId = String(row.roleId ?? "").trim();
  const taskId = String(row.taskId ?? "").trim();
  const title = String(row.title ?? "").trim();
  if (!id || !roleId || !taskId || !title) {
    return null;
  }
  const statusRaw = String(row.status ?? "").trim();
  const status: CodeChangeApprovalStatus =
    statusRaw === "approved" || statusRaw === "rejected" ? statusRaw : "pending";
  return {
    id,
    runId: String(row.runId ?? "").trim() || undefined,
    roleId: roleId as CodeChangeApproval["roleId"],
    taskId,
    title,
    summary: String(row.summary ?? "").trim(),
    patchPreview: String(row.patchPreview ?? "").trim(),
    status,
    rejectReason: String(row.rejectReason ?? "").trim() || undefined,
    createdAt: String(row.createdAt ?? "").trim() || nowIso(),
    updatedAt: String(row.updatedAt ?? "").trim() || nowIso(),
  };
}

export function readCodeChangeApprovals(): CodeChangeApproval[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(APPROVAL_QUEUE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((row) => normalizeApproval(row)).filter((row): row is CodeChangeApproval => row !== null);
  } catch {
    return [];
  }
}

export function writeCodeChangeApprovals(rows: CodeChangeApproval[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(APPROVAL_QUEUE_STORAGE_KEY, JSON.stringify(rows));
}

export function upsertCodeChangeApproval(
  row: Omit<CodeChangeApproval, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string },
): CodeChangeApproval[] {
  const current = readCodeChangeApprovals();
  const now = nowIso();
  const nextItem: CodeChangeApproval = {
    ...row,
    createdAt: String(row.createdAt ?? "").trim() || now,
    updatedAt: String(row.updatedAt ?? "").trim() || now,
  };
  const next = current.some((item) => item.id === row.id)
    ? current.map((item) => (item.id === row.id ? nextItem : item))
    : [...current, nextItem];
  writeCodeChangeApprovals(next);
  return next;
}

