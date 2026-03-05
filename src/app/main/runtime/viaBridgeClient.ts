import { asRecord, extractStringByPaths } from "../../../shared/lib/valueUtils";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type ViaArtifact = {
  nodeId: string;
  format: string;
  path: string;
  sha256?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type ViaRunPayload = {
  runId: string;
  status: string;
  warnings: string[];
  detail: unknown;
  artifacts: ViaArtifact[];
};

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((row) => String(row ?? "").trim())
    .filter((row) => row.length > 0);
}

export function normalizeViaArtifacts(input: unknown): ViaArtifact[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((row) => {
      const record = asRecord(row);
      if (!record) {
        return null;
      }
      const nodeId = String(record.node_id ?? record.nodeId ?? "").trim() || "export.rag";
      const format = String(record.format ?? "").trim().toLowerCase();
      const path = String(record.path ?? "").trim();
      if (!format || !path) {
        return null;
      }
      return {
        nodeId,
        format,
        path,
        sha256: String(record.sha256 ?? "").trim() || undefined,
        metadata: asRecord(record.metadata) ?? undefined,
        createdAt: String(record.created_at ?? record.createdAt ?? "").trim() || undefined,
      } as ViaArtifact;
    })
    .filter(Boolean) as ViaArtifact[];
}

export function normalizeViaRunPayload(input: unknown): ViaRunPayload {
  const record = asRecord(input) ?? {};
  const runId =
    extractStringByPaths(record, ["run_id", "runId", "detail.run_id", "detail.runId"]) ?? "";
  const status =
    extractStringByPaths(record, ["status", "detail.status"]) ??
    "unknown";
  const warnings = toStringArray(record.warnings);
  const detail = record.detail ?? input;
  const artifactsSource = Array.isArray(record.artifacts)
    ? record.artifacts
    : asRecord(record.artifacts)?.artifacts ?? [];
  const artifacts = normalizeViaArtifacts(artifactsSource);

  return {
    runId,
    status,
    warnings,
    detail,
    artifacts,
  };
}

export async function viaHealth(params: {
  invokeFn: InvokeFn;
  cwd: string;
}): Promise<unknown> {
  return params.invokeFn("via_health", { cwd: params.cwd });
}

export async function viaRunFlow(params: {
  invokeFn: InvokeFn;
  cwd: string;
  flowId: number;
  trigger?: string;
  sourceType?: string;
}): Promise<ViaRunPayload> {
  const raw = await params.invokeFn<unknown>("via_run_flow", {
    cwd: params.cwd,
    flowId: params.flowId,
    trigger: params.trigger,
    sourceType: params.sourceType,
  });
  return normalizeViaRunPayload(raw);
}

export async function viaGetRun(params: {
  invokeFn: InvokeFn;
  cwd: string;
  runId: string;
}): Promise<ViaRunPayload> {
  const raw = await params.invokeFn<unknown>("via_get_run", {
    cwd: params.cwd,
    runId: params.runId,
  });
  return normalizeViaRunPayload(raw);
}

export async function viaListArtifacts(params: {
  invokeFn: InvokeFn;
  cwd: string;
  runId: string;
}): Promise<ViaArtifact[]> {
  const raw = await params.invokeFn<unknown>("via_list_artifacts", {
    cwd: params.cwd,
    runId: params.runId,
  });
  const record = asRecord(raw);
  const artifacts = record ? record.artifacts : [];
  return normalizeViaArtifacts(artifacts);
}
