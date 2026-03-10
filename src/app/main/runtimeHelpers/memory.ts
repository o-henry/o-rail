import type { PresetKind } from "../../../features/workflow/domain";
import { redactSensitiveText } from "../../../features/feed/displayUtils";
import { extractFinalAnswer } from "../../../features/workflow/labels";
import type { GraphData } from "../../../features/workflow/types";
import type { InternalMemorySnippet, RunRecord } from "../types";

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function tokenizeRetrievalText(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣一-龥ぁ-んァ-ヶ_]+/)
    .map((row) => row.trim())
    .filter((row) => row.length >= 2);
}

function compactOneLine(input: string, limit = 460): string {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function toMillisSafe(input?: string): number {
  const parsed = input ? Date.parse(input) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sanitizeValueForRunSave(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValueForRunSave(entry));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = sanitizeValueForRunSave(entry);
    }
    return next;
  }
  return value;
}

export function sanitizeRunRecordForSave<T>(runRecord: T): T {
  return sanitizeValueForRunSave(runRecord) as T;
}

export function questionSignature(question?: string): string {
  return (question ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function graphSignature(graphData: GraphData): string {
  const nodeSig = graphData.nodes.map((node) => `${node.id}:${node.type}`).sort().join("|");
  const edgeSig = graphData.edges.map((edge) => `${edge.from.nodeId}->${edge.to.nodeId}`).sort().join("|");
  return `${nodeSig}::${edgeSig}`;
}

export function buildInternalMemorySnippetsFromRun(
  run: RunRecord,
  options?: { maxPerRun?: number },
): InternalMemorySnippet[] {
  const maxPerRun = Math.max(3, Math.min(32, Number(options?.maxPerRun ?? 14) || 14));
  const snippets: InternalMemorySnippet[] = [];
  const updatedAt = run.finishedAt ?? run.startedAt ?? new Date().toISOString();
  const runId = String(run.runId ?? "").trim();
  if (!runId) {
    return snippets;
  }

  const finalAnswer = compactOneLine(extractFinalAnswer(run.finalAnswer ?? ""));
  if (finalAnswer) {
    snippets.push({
      id: `run:${runId}:final`,
      runId,
      presetKind: run.workflowPresetKind,
      text: finalAnswer,
      updatedAt,
      confidenceBand: run.finalConfidence?.band,
    });
  }

  for (const memory of Object.values(run.runMemory ?? {})) {
    const text = compactOneLine([memory.decisionSummary ?? "", ...(memory.openIssues ?? []), ...(memory.nextRequests ?? [])].filter(Boolean).join(" | "));
    if (!text) {
      continue;
    }
    snippets.push({
      id: `run:${runId}:memory:${memory.nodeId}`,
      runId,
      presetKind: run.workflowPresetKind,
      nodeId: memory.nodeId,
      roleLabel: memory.roleLabel,
      text,
      updatedAt: memory.updatedAt || updatedAt,
    });
  }

  for (const [nodeId, envelopes] of Object.entries(run.normalizedEvidenceByNodeId ?? {})) {
    const latest = Array.isArray(envelopes) && envelopes.length > 0 ? envelopes[envelopes.length - 1] : null;
    if (!latest) {
      continue;
    }
    const claimText = latest.claims.slice(0, 4).map((claim) => claim.text).filter(Boolean).join(" | ");
    const issueText = (latest.dataIssues ?? []).slice(0, 2).join(" | ");
    const text = compactOneLine([claimText, issueText].filter(Boolean).join(" | "));
    if (!text) {
      continue;
    }
    snippets.push({
      id: `run:${runId}:evidence:${nodeId}`,
      runId,
      presetKind: run.workflowPresetKind,
      nodeId,
      roleLabel: latest.roleLabel,
      text,
      updatedAt: latest.capturedAt || updatedAt,
      confidenceBand: latest.confidenceBand,
    });
  }

  return snippets.sort((a, b) => toMillisSafe(b.updatedAt) - toMillisSafe(a.updatedAt)).slice(0, maxPerRun);
}

export function rankInternalMemorySnippets(input: {
  query: string;
  snippets: InternalMemorySnippet[];
  nodeId?: string;
  roleLabel?: string;
  topK?: number;
  presetKind?: PresetKind;
}): Array<{ snippet: InternalMemorySnippet; score: number; reason: string }> {
  const topK = Math.max(1, Math.min(12, Number(input.topK ?? 4) || 4));
  const queryTokens = tokenizeRetrievalText(input.query);
  if (queryTokens.length === 0 || input.snippets.length === 0) {
    return [];
  }
  const querySet = new Set(queryTokens);
  const nowMs = Date.now();
  const roleHint = String(input.roleLabel ?? "").toLowerCase();

  return input.snippets
    .map((snippet) => {
      const snippetTokens = tokenizeRetrievalText(snippet.text);
      if (snippetTokens.length === 0) {
        return null;
      }
      let overlap = 0;
      const snippetSet = new Set(snippetTokens);
      for (const token of querySet) {
        if (snippetSet.has(token)) {
          overlap += 1;
        }
      }
      let score = overlap / querySet.size;
      if (input.presetKind && snippet.presetKind && input.presetKind === snippet.presetKind) score += 0.14;
      if (input.nodeId && snippet.nodeId && input.nodeId === snippet.nodeId) score += 0.09;
      if (roleHint && snippet.roleLabel && roleHint.includes(String(snippet.roleLabel).toLowerCase())) score += 0.06;
      if (snippet.confidenceBand === "high") score += 0.05;
      else if (snippet.confidenceBand === "medium") score += 0.02;
      else if (snippet.confidenceBand === "low") score -= 0.02;
      const ageDays = Math.max(0, nowMs - toMillisSafe(snippet.updatedAt)) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 0.08 - Math.min(0.08, ageDays * 0.01));
      score = clampScore(score);
      if (score < 0.12) {
        return null;
      }
      const reasonParts = [`overlap=${overlap}/${querySet.size}`];
      if (input.presetKind && snippet.presetKind && input.presetKind === snippet.presetKind) reasonParts.push("samePreset");
      if (input.nodeId && snippet.nodeId && input.nodeId === snippet.nodeId) reasonParts.push("sameNode");
      return { snippet, score, reason: reasonParts.join(",") };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .slice(0, topK) as Array<{ snippet: InternalMemorySnippet; score: number; reason: string }>;
}
