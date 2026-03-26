export type FailureSignalEvent = {
  type?: string | null;
  message?: string | null;
};

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isFailureStatus(value: string | null | undefined): boolean {
  const normalized = normalizeStatus(value);
  return normalized === "failed" || normalized === "error";
}

export function isInFlightStatus(value: string | null | undefined): boolean {
  const normalized = normalizeStatus(value);
  return normalized === "active" || normalized === "running" || normalized === "queued" || normalized === "thinking" || normalized === "awaiting_approval";
}

export function shouldTreatEventAsFailureReason(event: FailureSignalEvent): boolean {
  const type = normalizeStatus(event.type);
  const message = String(event.message ?? "").trim();
  if (!message) {
    return false;
  }
  if (type === "stage_error" || type === "run_error") {
    return true;
  }
  return message.includes("ROLE_KB_BOOTSTRAP 실패");
}

export function shouldShowTerminalFailureBadge(params: {
  threadStatus?: string | null;
  workflowStatus?: string | null;
  workflowFailed?: boolean;
}): boolean {
  return isFailureStatus(params.threadStatus);
}
