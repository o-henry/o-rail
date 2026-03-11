type ActivityRunRecord = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  graphSnapshot: {
    nodes: Array<{
      id: string;
      type: string;
      config?: Record<string, unknown>;
    }>;
  };
  knowledgeTrace?: Array<{
    nodeId: string;
    fileName: string;
  }>;
  internalMemoryTrace?: Array<{
    nodeId: string;
  }>;
  runMemory?: Record<string, {
    nodeId: string;
    responsibility?: string;
    decisionSummary?: string;
    updatedAt?: string;
  }>;
};

export type UserMemoryActivityRow = {
  key: string;
  runId: string;
  nodeId: string;
  nodeLabel: string;
  ragSources: string[];
  rememberedSummary?: string;
  reusedMemoryCount: number;
  updatedAt: string;
};

function normalizeText(input: unknown): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function resolveNodeLabel(run: ActivityRunRecord, nodeId: string): string {
  const node = run.graphSnapshot.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return nodeId;
  }
  const config = (node.config ?? {}) as Record<string, unknown>;
  return (
    normalizeText(config.role)
    || normalizeText(config.handoffRoleId)
    || normalizeText(config.internalNodeKind)
    || node.type
  );
}

export function summarizeUserMemoryActivity(runs: ActivityRunRecord[]): UserMemoryActivityRow[] {
  const rows: UserMemoryActivityRow[] = [];
  for (const run of runs) {
    const knowledgeByNodeId = new Map<string, Set<string>>();
    for (const trace of run.knowledgeTrace ?? []) {
      const bucket = knowledgeByNodeId.get(trace.nodeId) ?? new Set<string>();
      bucket.add(normalizeText(trace.fileName));
      knowledgeByNodeId.set(trace.nodeId, bucket);
    }
    const reusedByNodeId = new Map<string, number>();
    for (const trace of run.internalMemoryTrace ?? []) {
      reusedByNodeId.set(trace.nodeId, (reusedByNodeId.get(trace.nodeId) ?? 0) + 1);
    }
    for (const memory of Object.values(run.runMemory ?? {})) {
      const nodeId = normalizeText(memory.nodeId);
      if (!nodeId) {
        continue;
      }
      rows.push({
        key: `${run.runId}:${nodeId}`,
        runId: run.runId,
        nodeId,
        nodeLabel: resolveNodeLabel(run, nodeId),
        ragSources: [...(knowledgeByNodeId.get(nodeId) ?? new Set<string>())].filter(Boolean).slice(0, 4),
        rememberedSummary: normalizeText(memory.decisionSummary || memory.responsibility || ""),
        reusedMemoryCount: reusedByNodeId.get(nodeId) ?? 0,
        updatedAt: normalizeText(memory.updatedAt || run.finishedAt || run.startedAt),
      });
    }
  }

  return rows
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12);
}
