import { extractFinalAnswer } from "../../../features/workflow/labels";
import { stringifyInput, tryParseJsonText } from "../../../features/workflow/promptUtils";
import { tp } from "../../../i18n";
import type {
  ConfidenceBand,
  EvidenceCitation,
  EvidenceClaim,
  EvidenceConflict,
  EvidenceEnvelope,
  EvidenceNormalizationStatus,
  FinalSynthesisPacket,
  NodeResponsibilityMemory,
} from "../types";

function uniqueStrings(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const trimmed = String(row ?? "").trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function confidenceToBand(score: number): ConfidenceBand {
  if (score >= 0.75) {
    return "high";
  }
  if (score >= 0.5) {
    return "medium";
  }
  return "low";
}

function extractUrlCitations(text: string): EvidenceCitation[] {
  const matches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return uniqueStrings(matches).map((url) => ({ url, source: url }));
}

function extractDateHint(text: string): string | undefined {
  return (
    text.match(/\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/)?.[0] ??
    text.match(/\b\d{4}년\s*\d{1,2}월\s*\d{1,2}일\b/)?.[0] ??
    undefined
  );
}

function inferClaimsFromText(text: string): EvidenceClaim[] {
  const lines = text
    .split(/\n+/)
    .map((row) => row.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 24);
  const claims: EvidenceClaim[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const numberMatch = line.match(/(-?\d+(?:\.\d+)?)/);
    const metricMatch = line.match(/^([^:：]{2,48})[:：]/);
    claims.push({
      id: `text-${index + 1}`,
      text: line,
      metricKey: metricMatch ? metricMatch[1].trim().toLowerCase() : undefined,
      numericValue: numberMatch ? Number(numberMatch[1]) : undefined,
      asOf: extractDateHint(line),
    });
  }
  return claims;
}

function inferClaimsFromObject(input: Record<string, unknown>): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  let index = 0;
  for (const [key, value] of Object.entries(input)) {
    if (index >= 32 || value == null) {
      continue;
    }
    if (typeof value === "number") {
      index += 1;
      claims.push({
        id: `kv-${index}`,
        text: `${key}: ${value}`,
        metricKey: key.toLowerCase(),
        numericValue: value,
      });
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      index += 1;
      const numberMatch = trimmed.match(/(-?\d+(?:\.\d+)?)/);
      claims.push({
        id: `kv-${index}`,
        text: `${key}: ${trimmed}`,
        metricKey: key.toLowerCase(),
        numericValue: numberMatch ? Number(numberMatch[1]) : undefined,
        asOf: extractDateHint(trimmed),
      });
      continue;
    }
    if (!Array.isArray(value)) {
      continue;
    }
    const entries = value
      .map((row) => (typeof row === "string" ? row.trim() : ""))
      .filter(Boolean)
      .slice(0, 6);
    for (const entry of entries) {
      index += 1;
      claims.push({
        id: `kv-${index}`,
        text: `${key}: ${entry}`,
        metricKey: key.toLowerCase(),
        asOf: extractDateHint(entry),
      });
    }
  }
  return claims;
}

function extractEnvelopeText(output: unknown): string {
  const fromFinal = extractFinalAnswer(output).trim();
  if (fromFinal) {
    return fromFinal;
  }
  if (typeof output === "string") {
    return output.trim();
  }
  return stringifyInput(output).trim();
}

export function normalizeEvidenceEnvelope(input: {
  nodeId: string;
  roleLabel?: string;
  provider?: string;
  output: unknown;
  fallbackCapturedAt?: string;
  rawRef?: string;
}): EvidenceEnvelope {
  const rawText = extractEnvelopeText(input.output);
  const outputRow =
    input.output && typeof input.output === "object" && !Array.isArray(input.output)
      ? (input.output as Record<string, unknown>)
      : null;
  const metaRow =
    outputRow?.meta && typeof outputRow.meta === "object" && !Array.isArray(outputRow.meta)
      ? (outputRow.meta as Record<string, unknown>)
      : null;
  const provider = String(
    input.provider ??
      outputRow?.provider ??
      metaRow?.provider ??
      (metaRow?.sourceType ? String(metaRow.sourceType) : "") ??
      "unknown",
  ).trim() || "unknown";
  const capturedAt = String(
    outputRow?.timestamp ??
      metaRow?.capturedAt ??
      input.fallbackCapturedAt ??
      new Date().toISOString(),
  );

  const citationsFromMeta: EvidenceCitation[] = Array.isArray(metaRow?.citations)
    ? metaRow.citations
        .map((row) => String(row ?? "").trim())
        .filter(Boolean)
        .map((source) => ({ source }))
    : [];
  const citations: EvidenceCitation[] = [...citationsFromMeta, ...extractUrlCitations(rawText)];
  const uniqueCitationKey = new Set<string>();
  const normalizedCitations: EvidenceCitation[] = [];
  for (const row of citations) {
    const key = `${row.url ?? ""}|${row.source ?? ""}|${row.title ?? ""}`.trim();
    if (!key || uniqueCitationKey.has(key)) {
      continue;
    }
    uniqueCitationKey.add(key);
    normalizedCitations.push(row);
  }

  const parsedJson = rawText ? tryParseJsonText(rawText) : null;
  let claims: EvidenceClaim[] = [];
  let verificationStatus: EvidenceNormalizationStatus = "unparsed";
  const dataIssues: string[] = [];

  if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
    claims = inferClaimsFromObject(parsedJson as Record<string, unknown>);
    verificationStatus = claims.length > 0 ? "verified" : "partially_verified";
  } else if (outputRow?.artifact && typeof outputRow.artifact === "object") {
    const artifactPayload =
      outputRow.artifact &&
      typeof outputRow.artifact === "object" &&
      !Array.isArray(outputRow.artifact) &&
      (outputRow.artifact as Record<string, unknown>).payload &&
      typeof (outputRow.artifact as Record<string, unknown>).payload === "object"
        ? ((outputRow.artifact as Record<string, unknown>).payload as Record<string, unknown>)
        : null;
    if (artifactPayload) {
      claims = inferClaimsFromObject(artifactPayload);
      verificationStatus = claims.length > 0 ? "verified" : "partially_verified";
    }
  }

  if (claims.length === 0 && rawText) {
    claims = inferClaimsFromText(rawText);
    verificationStatus = claims.length > 0 ? "partially_verified" : "unparsed";
  }

  if (claims.length === 0) {
    dataIssues.push(tp("핵심 주장 파싱 실패"));
  }
  if (normalizedCitations.length === 0) {
    dataIssues.push(tp("출처/인용 누락"));
  }

  const needsVerification = Boolean(metaRow?.needsVerification);
  if (needsVerification) {
    dataIssues.push(tp("추가 검증 필요"));
    if (verificationStatus === "verified") {
      verificationStatus = "partially_verified";
    }
  }

  let confidence = verificationStatus === "verified" ? 0.78 : verificationStatus === "partially_verified" ? 0.58 : 0.38;
  if (normalizedCitations.length > 0) {
    confidence += 0.12;
  } else {
    confidence = Math.min(confidence, 0.55);
  }
  if (needsVerification) {
    confidence -= 0.12;
  }
  if (dataIssues.length >= 2) {
    confidence -= 0.08;
  }
  confidence = clamp01(confidence);

  return {
    nodeId: input.nodeId,
    provider,
    roleLabel: input.roleLabel,
    capturedAt,
    verificationStatus,
    confidence,
    confidenceBand: confidenceToBand(confidence),
    dataIssues: uniqueStrings(dataIssues),
    citations: normalizedCitations.slice(0, 12),
    claims: claims.slice(0, 32),
    rawText: rawText || "",
    rawRef: input.rawRef,
  };
}

export function buildConflictLedger(evidencePackets: EvidenceEnvelope[]): EvidenceConflict[] {
  const metricRows = new Map<string, Array<{ nodeId: string; claimId: string; value: number }>>();
  for (const packet of evidencePackets) {
    for (const claim of packet.claims) {
      if (!claim.metricKey || typeof claim.numericValue !== "number" || !Number.isFinite(claim.numericValue)) {
        continue;
      }
      const metricKey = claim.metricKey.trim().toLowerCase();
      if (!metricKey) {
        continue;
      }
      const rows = metricRows.get(metricKey) ?? [];
      rows.push({
        nodeId: packet.nodeId,
        claimId: claim.id,
        value: claim.numericValue,
      });
      metricRows.set(metricKey, rows);
    }
  }

  const conflicts: EvidenceConflict[] = [];
  for (const [metricKey, rows] of metricRows.entries()) {
    if (rows.length < 2) {
      continue;
    }
    const uniqueRoundedValues = uniqueStrings(rows.map((row) => String(Math.round(row.value * 1000) / 1000)));
    if (uniqueRoundedValues.length < 2) {
      continue;
    }
    conflicts.push({
      metricKey,
      values: rows,
      note: tp("동일 지표에 상충 수치가 존재합니다."),
    });
  }
  return conflicts;
}

export function updateRunMemoryByEnvelope(
  prev: Record<string, NodeResponsibilityMemory>,
  input: {
    nodeId: string;
    roleLabel: string;
    summary?: string;
    envelope?: EvidenceEnvelope;
  },
): Record<string, NodeResponsibilityMemory> {
  const current = prev[input.nodeId];
  const unresolved = input.envelope?.dataIssues ?? [];
  const nextRequests = unresolved.length > 0 ? [tp("충돌/누락 근거 재검증"), tp("근거 날짜 명시 보강")] : [];
  return {
    ...prev,
    [input.nodeId]: {
      nodeId: input.nodeId,
      roleLabel: input.roleLabel,
      responsibility: input.roleLabel,
      decisionSummary: input.summary ? String(input.summary) : current?.decisionSummary,
      openIssues: uniqueStrings([...(current?.openIssues ?? []), ...unresolved]).slice(0, 8),
      nextRequests: uniqueStrings([...(current?.nextRequests ?? []), ...nextRequests]).slice(0, 8),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function buildFinalSynthesisPacket(input: {
  question: string;
  evidencePackets: EvidenceEnvelope[];
  conflicts: EvidenceConflict[];
  runMemory: Record<string, NodeResponsibilityMemory>;
}): FinalSynthesisPacket {
  return {
    question: input.question,
    evidencePackets: input.evidencePackets,
    unresolvedConflicts: input.conflicts,
    runMemory: Object.values(input.runMemory),
  };
}

export function computeFinalConfidence(evidencePackets: EvidenceEnvelope[], conflicts: EvidenceConflict[]): {
  score: number;
  band: ConfidenceBand;
  rationale: string;
} {
  if (evidencePackets.length === 0) {
    return { score: 0.35, band: "low", rationale: tp("사용 가능한 증거 패킷이 부족합니다.") };
  }
  const avg = evidencePackets.reduce((sum, row) => sum + row.confidence, 0) / evidencePackets.length;
  const parsedCount = evidencePackets.filter((row) => row.verificationStatus !== "unparsed").length;
  let score = avg;
  if (parsedCount < evidencePackets.length) {
    score -= 0.08;
  }
  if (conflicts.length > 0) {
    score -= Math.min(0.18, conflicts.length * 0.04);
  }
  score = clamp01(score);
  return {
    score,
    band: confidenceToBand(score),
    rationale:
      conflicts.length > 0
        ? tp("충돌 지표가 있어 최종 신뢰도를 하향 조정했습니다.")
        : tp("증거 패킷 평균 신뢰도로 계산했습니다."),
  };
}
