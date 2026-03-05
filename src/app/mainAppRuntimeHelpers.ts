import { invoke } from "../shared/tauri";
import {
  getTurnExecutor,
  getWebProviderFromExecutor,
  inferQualityProfile,
  type ArtifactType,
  type PresetKind,
  type TurnConfig,
  type TurnExecutor,
  type WebProvider,
  type WebResultMode,
} from "../features/workflow/domain";
import { extractFinalAnswer, nodeStatusLabel, nodeTypeLabel, turnRoleLabel } from "../features/workflow/labels";
import {
  getByPath,
  replaceInputPlaceholder,
  stringifyInput,
  toHumanReadableFeedText,
  tryParseJsonText,
} from "../features/workflow/promptUtils";
import { formatFeedInputSourceLabel, normalizeFeedInputSources, redactSensitiveText, summarizeFeedSteps } from "../features/feed/displayUtils";
import { FEED_REDACTION_RULE_VERSION } from "../features/feed/constants";
import { graphEquals, turnModelLabel } from "../features/workflow/graph-utils";
import {
  QUALITY_DEFAULT_THRESHOLD,
  QUALITY_THRESHOLD_MAX,
  QUALITY_THRESHOLD_MIN,
  QUALITY_THRESHOLD_STEP,
  normalizeQualityScore,
  normalizeQualityThreshold,
} from "../features/workflow/quality";
import type {
  GateConfig,
  GraphData,
  GraphNode,
  KnowledgeConfig,
  NodeAnchorSide,
  NodeExecutionStatus,
  TransformConfig,
  TransformMode,
} from "../features/workflow/types";
import type {
  ConfidenceBand,
  EvidenceCitation,
  EvidenceClaim,
  EvidenceConflict,
  EvidenceEnvelope,
  EvidenceNormalizationStatus,
  FinalSynthesisPacket,
  InternalMemorySnippet,
  NodeResponsibilityMemory,
  RunRecord,
} from "./main/types";
import type { FancySelectOption } from "../components/FancySelect";
import { KNOWLEDGE_DEFAULT_MAX_CHARS, KNOWLEDGE_DEFAULT_TOP_K } from "./mainAppGraphHelpers";
import { t, tp } from "../i18n";
import type { AppLocale } from "../i18n";

export function getCodexMultiAgentModeOptions(locale?: AppLocale): ReadonlyArray<FancySelectOption> {
  return [
    { value: "off", label: t("option.multi.off", undefined, locale) },
    { value: "balanced", label: t("option.multi.balanced", undefined, locale) },
    { value: "max", label: t("option.multi.max", undefined, locale) },
  ];
}

export function getCostPresetOptions(locale?: AppLocale): FancySelectOption[] {
  return [
    { value: "conservative", label: t("option.cost.conservative", undefined, locale) },
    { value: "balanced", label: t("option.cost.balanced", undefined, locale) },
    { value: "aggressive", label: t("option.cost.aggressive", undefined, locale) },
  ];
}

export const NODE_ANCHOR_SIDES: NodeAnchorSide[] = ["top", "right", "bottom", "left"];

export function getQualityProfileOptions(locale?: AppLocale): FancySelectOption[] {
  return [
    { value: "code_implementation", label: t("option.quality.code_implementation", undefined, locale) },
    { value: "research_evidence", label: t("option.quality.research_evidence", undefined, locale) },
    { value: "design_planning", label: t("option.quality.design_planning", undefined, locale) },
    { value: "synthesis_final", label: t("option.quality.synthesis_final", undefined, locale) },
    { value: "generic", label: t("option.quality.generic", undefined, locale) },
  ];
}

export function getQualityThresholdOptions(locale?: AppLocale): FancySelectOption[] {
  return Array.from(
    { length: (QUALITY_THRESHOLD_MAX - QUALITY_THRESHOLD_MIN) / QUALITY_THRESHOLD_STEP + 1 },
    (_, index) => {
      const score = QUALITY_THRESHOLD_MIN + index * QUALITY_THRESHOLD_STEP;
      return { value: String(score), label: tp(`${score}점`, undefined, locale) };
    },
  );
}

export { normalizeQualityScore, normalizeQualityThreshold };

export function getArtifactTypeOptions(locale?: AppLocale): FancySelectOption[] {
  return [
    { value: "none", label: t("option.artifact.none", undefined, locale) },
    { value: "RequirementArtifact", label: t("option.artifact.requirement", undefined, locale) },
    { value: "DesignArtifact", label: t("option.artifact.design", undefined, locale) },
    { value: "TaskPlanArtifact", label: t("option.artifact.taskPlan", undefined, locale) },
    { value: "ChangePlanArtifact", label: t("option.artifact.changePlan", undefined, locale) },
    { value: "EvidenceArtifact", label: t("option.artifact.evidence", undefined, locale) },
  ];
}

const PRESET_TEMPLATE_META_KEYS: ReadonlyArray<{
  key: PresetKind;
  labelKey: string;
  statusLabelKey: string;
}> = [
  { key: "validation", labelKey: "preset.validation", statusLabelKey: "preset.validation" },
  { key: "development", labelKey: "preset.development", statusLabelKey: "preset.development" },
  { key: "research", labelKey: "preset.research", statusLabelKey: "preset.research" },
  { key: "expert", labelKey: "preset.expert", statusLabelKey: "preset.expert" },
  { key: "unityGame", labelKey: "preset.unityGame", statusLabelKey: "preset.unityGame" },
  { key: "fullstack", labelKey: "preset.fullstack", statusLabelKey: "preset.fullstack" },
  { key: "creative", labelKey: "preset.creative", statusLabelKey: "preset.creative" },
  { key: "newsTrend", labelKey: "preset.newsTrend", statusLabelKey: "preset.newsTrend" },
];

export function getPresetTemplateMeta(
  locale?: AppLocale,
): ReadonlyArray<{ key: PresetKind; label: string; statusLabel: string }> {
  return PRESET_TEMPLATE_META_KEYS.map((row) => ({
    key: row.key,
    label: t(row.labelKey, undefined, locale),
    statusLabel: t(row.statusLabelKey, undefined, locale),
  }));
}

export function getPresetTemplateOptions(locale?: AppLocale): FancySelectOption[] {
  return getPresetTemplateMeta(locale)
    .filter((row) => row.key !== "development")
    .map((row) => ({
      value: row.key,
      label: row.label,
    }));
}

export function presetTemplateLabel(kind: PresetKind, locale?: AppLocale): string {
  const row = getPresetTemplateMeta(locale).find((meta) => meta.key === kind);
  return row ? row.label : t("workflow.template", undefined, locale);
}

export function inferRunGroupMeta(
  currentGraph: GraphData,
  lastPreset: { kind: PresetKind; graph: GraphData } | null,
  locale?: AppLocale,
): { name: string; kind: "template" | "custom"; presetKind?: PresetKind } {
  if (lastPreset && graphEquals(lastPreset.graph, currentGraph)) {
    return {
      name: presetTemplateLabel(lastPreset.kind, locale),
      kind: "template",
      presetKind: lastPreset.kind,
    };
  }
  return {
    name: t("group.custom", undefined, locale),
    kind: "custom",
  };
}

export function isCriticalTurnNode(node: GraphNode): boolean {
  if (node.type !== "turn") {
    return false;
  }
  const config = node.config as TurnConfig;
  const signal = `${node.id} ${String(config.role ?? "")} ${String(config.promptTemplate ?? "")}`.toLowerCase();
  return /final|synth|judge|evaluat|quality|verif|검증|평가|판정|최종|합성/.test(signal);
}

export function buildFeedSummary(status: string, output: unknown, error?: string, summary?: string): string {
  const trimmedSummary = (summary ?? "").trim();
  if (trimmedSummary) {
    return trimmedSummary;
  }
  if (status === "draft") {
    return t("feed.summary.running");
  }
  if (status !== "done" && status !== "low_quality") {
    return error?.trim() || t("feed.summary.failed");
  }
  const outputText = toHumanReadableFeedText(extractFeedOutputText(output));
  if (!outputText) {
    return t("feed.summary.noText");
  }
  return outputText.length > 360 ? `${outputText.slice(0, 360)}...` : outputText;
}

function summarizeSnapshotText(input: unknown, maxLen: number): string {
  const text = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() : text;
}

function snapshotStringList(input: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((row) => summarizeSnapshotText(row, maxLen))
    .filter((row) => row.length > 0)
    .filter((row, index, arr) => arr.indexOf(row) === index)
    .slice(0, maxItems);
}

function formatDashboardSnapshotOutput(output: Record<string, unknown>): string {
  const summary = summarizeSnapshotText(output.summary, 4000);
  const highlights = snapshotStringList(output.highlights, 20, 800);
  const risks = snapshotStringList(output.risks, 20, 800);
  const references = Array.isArray(output.references)
    ? output.references
        .map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) {
            return "";
          }
          const item = row as Record<string, unknown>;
          const title = summarizeSnapshotText(item.title, 220);
          const url = summarizeSnapshotText(item.url, 1000);
          if (!url) {
            return "";
          }
          if (title) {
            return `- ${title}: ${url}`;
          }
          return `- ${url}`;
        })
        .filter((row) => row.length > 0)
        .slice(0, 20)
    : [];

  const hasSnapshotShape = Boolean(summary) || highlights.length > 0 || risks.length > 0 || references.length > 0;
  if (!hasSnapshotShape) {
    return "";
  }

  const lines: string[] = [];
  if (summary) {
    lines.push("## 실행 요약", summary);
  }
  if (highlights.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("## 핵심 포인트", ...highlights.map((item) => `- ${item}`));
  }
  if (risks.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("## 리스크", ...risks.map((item) => `- ${item}`));
  }
  if (references.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("## 참고 링크", ...references);
  }
  return lines.join("\n").trim();
}

function extractFeedOutputText(output: unknown): string {
  const direct = extractFinalAnswer(output).trim();
  if (direct) {
    return direct;
  }

  const artifactPayload = getByPath(output, "artifact.payload");
  if (typeof artifactPayload === "string") {
    return artifactPayload.trim();
  }
  if (artifactPayload && typeof artifactPayload === "object") {
    try {
      return JSON.stringify(artifactPayload, null, 2);
    } catch {
      return stringifyInput(artifactPayload).trim();
    }
  }

  if (typeof output === "string") {
    return output.trim();
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const formattedDashboardSnapshot = formatDashboardSnapshotOutput(output as Record<string, unknown>);
    if (formattedDashboardSnapshot) {
      return formattedDashboardSnapshot;
    }
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return stringifyInput(output).trim();
    }
  }
  return "";
}

function buildFinalTurnNodeIdSet(graphSnapshot: { nodes?: any[]; edges?: any[] } | null | undefined): Set<string> {
  const nodes = Array.isArray(graphSnapshot?.nodes) ? graphSnapshot.nodes : [];
  const edges = Array.isArray(graphSnapshot?.edges) ? graphSnapshot.edges : [];
  if (nodes.length === 0) {
    return new Set();
  }
  const outgoingCountByNodeId = new Map<string, number>();
  for (const edge of edges) {
    const sourceNodeId = String(edge?.from?.nodeId ?? "").trim();
    if (!sourceNodeId) {
      continue;
    }
    outgoingCountByNodeId.set(sourceNodeId, (outgoingCountByNodeId.get(sourceNodeId) ?? 0) + 1);
  }
  const finalTurnNodeIds = new Set<string>();
  for (const node of nodes) {
    const nodeId = String(node?.id ?? "").trim();
    if (!nodeId || node?.type !== "turn") {
      continue;
    }
    if ((outgoingCountByNodeId.get(nodeId) ?? 0) === 0) {
      finalTurnNodeIds.add(nodeId);
    }
  }
  return finalTurnNodeIds;
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

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

function extractUrlCitations(text: string): EvidenceCitation[] {
  const matches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return uniqueStrings(matches).map((url) => ({ url, source: url }));
}

function extractDateHint(text: string): string | undefined {
  const matched =
    text.match(/\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/)?.[0] ??
    text.match(/\b\d{4}년\s*\d{1,2}월\s*\d{1,2}일\b/)?.[0] ??
    undefined;
  return matched;
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
    if (index >= 32) {
      break;
    }
    if (value == null) {
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
    if (Array.isArray(value)) {
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
    ? metaRow?.citations
        .map((row) => String(row ?? "").trim())
        .filter(Boolean)
        .map((source) => ({ source }))
    : [];
  const citations: EvidenceCitation[] = [
    ...citationsFromMeta,
    ...extractUrlCitations(rawText),
  ];
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

export function buildFeedPost(input: any): {
  post: any;
  rawAttachments: Record<"markdown" | "json", string>;
} {
  const config = input.node.config as TurnConfig;
  const inferredRoleLabel = input.node.type === "turn" ? turnRoleLabel(input.node) : nodeTypeLabel(input.node.type);
  const roleLabel = String(input.roleLabel ?? "").trim() || inferredRoleLabel;
  const inferredAgentName =
    input.node.type === "turn"
      ? turnModelLabel(input.node)
      : input.node.type === "transform"
        ? t("label.node.transform")
        : t("label.node.gate");
  const agentName = String(input.agentName ?? "").trim() || inferredAgentName;
  const logs = input.logs ?? [];
  const steps = summarizeFeedSteps(logs);
  const summary = buildFeedSummary(input.status, input.output, input.error, input.summary);
  const inputSources = normalizeFeedInputSources(input.inputSources);
  const inputContextRaw = toHumanReadableFeedText(stringifyInput(input.inputData).trim());
  const inputContextMasked = inputContextRaw ? redactSensitiveText(inputContextRaw) : "";
  const outputText = toHumanReadableFeedText(extractFeedOutputText(input.output));
  const logsText = logs.length > 0 ? logs.join("\n") : t("feed.logs.empty");
  const markdownRaw = [
    `# ${agentName}`,
    `- ${t("feed.share.status")}: ${input.status === "low_quality" ? t("label.status.low_quality") : nodeStatusLabel(input.status as NodeExecutionStatus)}`,
    `- ${t("feed.share.role")}: ${roleLabel}`,
    ...(input.verificationStatus ? [`- 검증 상태: ${String(input.verificationStatus)}`] : []),
    ...(input.confidenceBand ? [`- 신뢰도 등급: ${String(input.confidenceBand)}`] : []),
    "",
    `## ${t("feed.share.summary")}`,
    summary || t("common.none"),
    ...(inputSources.length > 0
      ? ["", `## ${t("feed.inputSources")}`, ...inputSources.map((source) => `- ${formatFeedInputSourceLabel(source)}`)]
      : []),
    ...(inputContextMasked
      ? ["", `## ${t("feed.inputSnapshot")}`, inputContextMasked]
      : []),
    "",
    `## ${t("feed.share.steps")}`,
    ...steps.map((step) => `- ${step}`),
    "",
    `## ${t("feed.share.detail")}`,
    outputText || t("feed.output.empty"),
    ...(Array.isArray(input.dataIssues) && input.dataIssues.length > 0
      ? ["", "## 데이터 이슈", ...input.dataIssues.map((issue: string) => `- ${issue}`)]
      : []),
    "",
    `## ${t("feed.logs.title")}`,
    logsText,
    "",
    `## ${t("feed.reference.title")}`,
    `- ${t("feed.reference.autoGenerated")}`,
  ].join("\n");

  const jsonRaw = JSON.stringify(
    {
      nodeId: input.node.id,
      nodeType: input.node.type,
      status: input.status,
      summary,
      steps,
      verificationStatus: input.verificationStatus,
      confidenceBand: input.confidenceBand,
      dataIssues: Array.isArray(input.dataIssues) ? input.dataIssues : undefined,
      inputSources,
      inputContext: inputContextRaw
        ? {
            preview: inputContextMasked,
            charCount: inputContextRaw.length,
            truncated: false,
          }
        : undefined,
      output: input.output ?? null,
      logs,
      error: input.error ?? null,
      evidence: {
        durationMs: input.durationMs,
        usage: input.usage,
        qualityScore: input.qualityReport?.score,
        qualityDecision: input.qualityReport?.decision,
      },
    },
    null,
    2,
  );

  const markdownClip = {
    text: markdownRaw,
    truncated: false,
    charCount: markdownRaw.length,
  };
  const jsonClip = {
    text: jsonRaw,
    truncated: false,
    charCount: jsonRaw.length,
  };

  const markdownMasked = redactSensitiveText(markdownClip.text);
  const jsonMasked = redactSensitiveText(jsonClip.text);

  const post = {
    id: `${input.runId}:${input.node.id}:${input.status}`,
    runId: input.runId,
    nodeId: input.node.id,
    nodeType: input.node.type,
    topic: typeof input.topic === "string" ? input.topic : undefined,
    topicLabel: typeof input.topicLabel === "string" ? input.topicLabel : undefined,
    groupName: typeof input.groupName === "string" ? input.groupName : undefined,
    isFinalDocument: Boolean(input.isFinalDocument),
    executor: input.node.type === "turn" ? getTurnExecutor(config) : undefined,
    agentName,
    roleLabel,
    status: input.status,
    createdAt: input.createdAt,
    summary,
    steps,
    inputSources,
    inputContext: inputContextRaw
      ? {
          preview: inputContextMasked,
          charCount: inputContextRaw.length,
          truncated: false,
        }
      : undefined,
    evidence: {
      durationMs: input.durationMs,
      usage: input.usage,
      qualityScore: input.qualityReport?.score,
      qualityDecision: input.qualityReport?.decision,
    },
    attachments: [
      {
        kind: "markdown",
        title: tp("요약 문서 (Markdown)"),
        content: markdownMasked,
        truncated: markdownClip.truncated,
        charCount: markdownClip.charCount,
      },
      {
        kind: "json",
        title: tp("구조화 결과 (JSON)"),
        content: jsonMasked,
        truncated: jsonClip.truncated,
        charCount: jsonClip.charCount,
      },
    ],
    redaction: {
      masked: true,
      ruleVersion: FEED_REDACTION_RULE_VERSION,
    },
    rawAttachmentRef: {
      markdownKey: feedAttachmentRawKey(`${input.runId}:${input.node.id}:${input.status}`, "markdown"),
      jsonKey: feedAttachmentRawKey(`${input.runId}:${input.node.id}:${input.status}`, "json"),
    },
  };

  return {
    post,
    rawAttachments: {
      markdown: markdownClip.text,
      json: jsonClip.text,
    },
  };
}

export function normalizeRunFeedPosts(run: any): any[] {
  const finalTurnNodeIds = buildFinalTurnNodeIdSet(run?.graphSnapshot);
  if (Array.isArray(run.feedPosts)) {
    return run.feedPosts.map((post: any) => ({
      ...post,
      inputSources: normalizeFeedInputSources(post.inputSources),
      isFinalDocument:
        typeof post?.isFinalDocument === "boolean"
          ? post.isFinalDocument
          : finalTurnNodeIds.has(String(post?.nodeId ?? "")),
    }));
  }
  const nodeMap = new Map(run.graphSnapshot.nodes.map((node: any) => [node.id, node]));
  const terminalMap = new Map<string, any>();
  for (const transition of run.transitions) {
    if (
      transition.status !== "done" &&
      transition.status !== "low_quality" &&
      transition.status !== "failed" &&
      transition.status !== "cancelled"
    ) {
      continue;
    }
    const prev = terminalMap.get(transition.nodeId);
    if (!prev || new Date(transition.at).getTime() >= new Date(prev.at).getTime()) {
      terminalMap.set(transition.nodeId, transition);
    }
  }

  const posts: any[] = [];
  for (const [nodeId, transition] of terminalMap.entries()) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      continue;
    }
    const logs = run.nodeLogs?.[nodeId] ?? [];
    const metric = run.nodeMetrics?.[nodeId];
    const built = buildFeedPost({
      runId: run.runId,
      node,
      isFinalDocument: finalTurnNodeIds.has(String(nodeId)),
      status: transition.status,
      createdAt: transition.at,
      summary: transition.message,
      logs,
      output: {
        nodeId,
        status: transition.status,
        message: transition.message ?? "",
        logs: logs.slice(-10),
      },
      error: transition.status === "failed" ? transition.message : undefined,
      qualityReport: metric
        ? {
            profile: metric.profile,
            threshold: metric.threshold,
            score: metric.score,
            decision: metric.decision,
            checks: [],
            failures: [],
            warnings: [],
          }
        : undefined,
    });
    posts.push(built.post);
  }

  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return posts;
}

export function normalizeRunRecord(run: any): any {
  const feedPosts = normalizeRunFeedPosts(run);
  return {
    ...run,
    feedPosts,
  };
}

export function feedAttachmentRawKey(postId: string, kind: "markdown" | "json"): string {
  return `${postId}:${kind}`;
}

export function parseQualityCommands(input: unknown): string[] {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeArtifactOutput(
  nodeId: string,
  artifactType: ArtifactType,
  rawOutput: unknown,
): { output: unknown; warnings: string[] } {
  if (artifactType === "none") {
    return { output: rawOutput, warnings: [] };
  }

  let payload: unknown = rawOutput;
  const textCandidate = extractFinalAnswer(rawOutput).trim();
  if (typeof rawOutput === "string") {
    const text = rawOutput.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { text };
      }
    } else {
      payload = { text };
    }
  } else if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const inheritedPayload = getByPath(rawOutput, "artifact.payload");
    if (inheritedPayload !== undefined) {
      payload = inheritedPayload;
    }
    const parsedFromText = textCandidate ? tryParseJsonText(textCandidate) : null;
    if (parsedFromText != null) {
      payload = parsedFromText;
    } else if (payload === rawOutput && textCandidate) {
      payload = { text: textCandidate };
    }
  }

  const warnings: string[] = [];
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload === rawOutput &&
    ("completion" in (payload as Record<string, unknown>) ||
      "threadId" in (payload as Record<string, unknown>) ||
      "turnId" in (payload as Record<string, unknown>))
  ) {
    payload = textCandidate ? { text: textCandidate } : { text: "" };
    warnings.push(tp("아티팩트 변환: 실행 메타데이터 wrapper를 본문에서 제외했습니다."));
  }
  if (payload == null || typeof payload !== "object") {
    payload = { text: textCandidate || stringifyInput(rawOutput) };
    warnings.push(tp("아티팩트 변환: 구조화된 출력이 없어 텍스트 기반으로 보정했습니다."));
  }

  const envelope = {
    artifactType,
    version: "v1",
    authorNodeId: nodeId,
    createdAt: new Date().toISOString(),
    payload,
  };

  return {
    output: {
      artifact: envelope,
      text: textCandidate || (typeof rawOutput === "string" ? rawOutput : ""),
      raw: rawOutput,
    },
    warnings,
  };
}

export async function buildQualityReport(params: {
  node: GraphNode;
  config: TurnConfig;
  output: unknown;
  cwd: string;
}): Promise<any> {
  const { node, config, output, cwd } = params;
  const profile = inferQualityProfile(node, config);
  const threshold = normalizeQualityThreshold(config.qualityThreshold ?? QUALITY_DEFAULT_THRESHOLD);
  const checks: any[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const fullText = extractFinalAnswer(output) || (typeof output === "string" ? output : "");

  const addCheck = (input: {
    id: string;
    label: string;
    kind: string;
    required: boolean;
    passed: boolean;
    penalty: number;
    detail?: string;
  }) => {
    if (!input.passed) {
      score = Math.max(0, score - input.penalty);
      if (input.required) {
        failures.push(input.label);
      }
    }
    checks.push({
      id: input.id,
      label: input.label,
      kind: input.kind,
      required: input.required,
      passed: input.passed,
      scoreDelta: input.passed ? 0 : -input.penalty,
      detail: input.detail,
    });
  };

  addCheck({
    id: "non_empty",
    label: tp("응답 비어있지 않음"),
    kind: "structure",
    required: true,
    passed: fullText.trim().length > 0,
    penalty: 40,
  });

  addCheck({
    id: "minimum_length",
    label: tp("최소 설명 길이"),
    kind: "structure",
    required: false,
    passed: fullText.trim().length >= 120,
    penalty: 10,
    detail: tp("120자 미만이면 요약 부족으로 감점"),
  });

  if (profile === "research_evidence") {
    addCheck({
      id: "source_signal",
      label: tp("근거/출처 신호 포함"),
      kind: "evidence",
      required: true,
      passed: /(source|출처|근거|http|https|reference)/i.test(fullText),
      penalty: 20,
    });
    addCheck({
      id: "freshness_signal",
      label: tp("시점/날짜 정보 포함"),
      kind: "evidence",
      required: false,
      passed: /(20\d{2}[-./]\d{1,2}[-./]\d{1,2}|as of|updated|date|날짜|기준|timestamp|時点|日期)/i.test(fullText),
      penalty: 8,
      detail: tp("핵심 근거의 시점 정보 포함 권장"),
    });
    addCheck({
      id: "uncertainty_signal",
      label: tp("한계/불확실성 표기"),
      kind: "consistency",
      required: false,
      passed: /(한계|불확실|리스크|위험|counter|반례|제약)/i.test(fullText),
      penalty: 10,
    });
  } else if (profile === "design_planning") {
    const hits = [
      /(목표|objective|goal|目的|目标)/i,
      /(제약|constraint|boundary|制約|约束)/i,
      /(리스크|위험|risk|リスク|风险)/i,
      /(우선순위|priority|優先順位)/i,
      /(아키텍처|architecture|設計)/i,
      /(마일스톤|milestone|roadmap|ロードマップ|里程碑)/i,
    ].filter((pattern) => pattern.test(fullText)).length;
    addCheck({
      id: "design_sections",
      label: tp("설계 핵심 항목 포함"),
      kind: "structure",
      required: true,
      passed: hits >= 3,
      penalty: 20,
      detail: tp("목표/제약/리스크/우선순위 등 3개 이상 필요"),
    });
  } else if (profile === "synthesis_final") {
    const hits = [
      /(결론|요약|conclusion|summary|結論|要約|结论|摘要)/i,
      /(근거|출처|evidence|source|根拠|依据)/i,
      /(한계|리스크|불확실|risk|limit|limitation|制約|风险)/i,
      /(다음 단계|체크포인트|next step|next action|action items|次のステップ|下一步)/i,
    ].filter((pattern) => pattern.test(fullText)).length;
    addCheck({
      id: "final_structure",
      label: tp("최종 답변 구조 충족"),
      kind: "structure",
      required: true,
      passed: hits >= 3,
      penalty: 20,
      detail: tp("결론/근거/한계/다음 단계 중 3개 이상"),
    });
    const headingCount = (fullText.match(/^##\s+/gm) ?? []).length;
    const listCount = (fullText.match(/^(?:- |\d+\.\s+)/gm) ?? []).length;
    addCheck({
      id: "readability_layout",
      label: tp("가독성 문서 레이아웃"),
      kind: "structure",
      required: false,
      passed: headingCount >= 2 || listCount >= 4,
      penalty: 8,
      detail: tp("제목(##) 2개 이상 또는 목록 4개 이상 권장"),
    });
    addCheck({
      id: "trust_signal",
      label: tp("신뢰도/근거 표기"),
      kind: "evidence",
      required: true,
      passed: /(출처|근거|source|evidence|confidence|신뢰도|as of|기준|timestamp|date)/i.test(fullText),
      penalty: 15,
      detail: tp("핵심 판단에 근거와 신뢰도 표기 필요"),
    });
    addCheck({
      id: "limit_signal",
      label: tp("한계/불확실성 명시"),
      kind: "consistency",
      required: false,
      passed: /(한계|불확실|가정|제약|limit|uncertainty|assumption|constraint|制約|风险)/i.test(fullText),
      penalty: 8,
    });
  } else if (profile === "code_implementation") {
    addCheck({
      id: "code_plan_signal",
      label: tp("코드/파일/테스트 계획 포함"),
      kind: "structure",
      required: true,
      passed: /(file|파일|test|테스트|lint|build|patch|module|class|function)/i.test(fullText),
      penalty: 20,
    });

    if (config.qualityCommandEnabled) {
      const commands = parseQualityCommands(config.qualityCommands);
      if (commands.length === 0) {
        warnings.push(tp("품질 명령 실행이 켜져 있지만 명령 목록이 비어 있습니다."));
      } else {
        try {
          const commandResults = await invoke<any[]>("quality_run_checks", {
            commands,
            cwd,
          });
          const failed = commandResults.find((row) => row.exitCode !== 0);
          addCheck({
            id: "local_commands",
            label: tp("로컬 품질 명령 통과"),
            kind: "local_command",
            required: true,
            passed: !failed,
            penalty: 30,
            detail: failed ? `${failed.name} ${tp("실패")}(exit=${failed.exitCode})` : tp("모든 명령 성공"),
          });
          for (const row of commandResults) {
            if (row.exitCode !== 0 && row.stderrTail.trim()) {
              warnings.push(`[${row.name}] ${row.stderrTail}`);
            }
          }
        } catch (error) {
          addCheck({
            id: "local_commands",
            label: tp("로컬 품질 명령 통과"),
            kind: "local_command",
            required: true,
            passed: false,
            penalty: 30,
            detail: String(error),
          });
        }
      }
    }
  }

  const normalizedScore = normalizeQualityScore(score);
  const decision: "PASS" | "REJECT" = normalizedScore >= threshold ? "PASS" : "REJECT";

  return {
    profile,
    threshold,
    score: normalizedScore,
    decision,
    checks,
    failures,
    warnings,
  };
}

export function summarizeQualityMetrics(nodeMetrics: Record<string, any>): any {
  const rows = Object.values(nodeMetrics);
  if (rows.length === 0) {
    return { avgScore: 0, passRate: 0, totalNodes: 0, passNodes: 0 };
  }
  const passNodes = rows.filter((row: any) => row.decision === "PASS").length;
  const avgScore = rows.reduce((sum: number, row: any) => sum + row.score, 0) / rows.length;
  const passRate = passNodes / rows.length;
  return {
    avgScore: Math.round(avgScore * 100) / 100,
    passRate: Math.round(passRate * 10000) / 100,
    totalNodes: rows.length,
    passNodes,
  };
}

export function defaultKnowledgeConfig(): KnowledgeConfig {
  return {
    files: [],
    topK: KNOWLEDGE_DEFAULT_TOP_K,
    maxChars: KNOWLEDGE_DEFAULT_MAX_CHARS,
  };
}

export function sanitizeValueForRunSave(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValueForRunSave(entry));
  }
  if (value && typeof value === "object") {
    const rows = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(rows)) {
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
  const nodeSig = graphData.nodes
    .map((node) => `${node.id}:${node.type}`)
    .sort()
    .join("|");
  const edgeSig = graphData.edges
    .map((edge) => `${edge.from.nodeId}->${edge.to.nodeId}`)
    .sort()
    .join("|");
  return `${nodeSig}::${edgeSig}`;
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
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function toMillisSafe(input?: string): number {
  if (!input) {
    return 0;
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
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

  const runMemoryEntries = Object.values(run.runMemory ?? {});
  for (const memory of runMemoryEntries) {
    const text = compactOneLine(
      [
        memory.decisionSummary ?? "",
        ...(memory.openIssues ?? []),
        ...(memory.nextRequests ?? []),
      ]
        .filter(Boolean)
        .join(" | "),
    );
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

  const evidenceMap = run.normalizedEvidenceByNodeId ?? {};
  for (const [nodeId, envelopes] of Object.entries(evidenceMap)) {
    const latest = Array.isArray(envelopes) && envelopes.length > 0 ? envelopes[envelopes.length - 1] : null;
    if (!latest) {
      continue;
    }
    const claimText = latest.claims
      .slice(0, 4)
      .map((claim) => claim.text)
      .filter(Boolean)
      .join(" | ");
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

  return snippets
    .sort((a, b) => toMillisSafe(b.updatedAt) - toMillisSafe(a.updatedAt))
    .slice(0, maxPerRun);
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

  const ranked = input.snippets
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
      if (input.presetKind && snippet.presetKind && input.presetKind === snippet.presetKind) {
        score += 0.14;
      }
      if (input.nodeId && snippet.nodeId && input.nodeId === snippet.nodeId) {
        score += 0.09;
      }
      if (roleHint && snippet.roleLabel && roleHint.includes(String(snippet.roleLabel).toLowerCase())) {
        score += 0.06;
      }
      if (snippet.confidenceBand === "high") {
        score += 0.05;
      } else if (snippet.confidenceBand === "medium") {
        score += 0.02;
      } else if (snippet.confidenceBand === "low") {
        score -= 0.02;
      }
      const ageMs = Math.max(0, nowMs - toMillisSafe(snippet.updatedAt));
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      score += Math.max(0, 0.08 - Math.min(0.08, ageDays * 0.01));
      score = clamp01(score);
      if (score < 0.12) {
        return null;
      }
      const reasonParts = [`overlap=${overlap}/${querySet.size}`];
      if (input.presetKind && snippet.presetKind && input.presetKind === snippet.presetKind) {
        reasonParts.push("samePreset");
      }
      if (input.nodeId && snippet.nodeId && input.nodeId === snippet.nodeId) {
        reasonParts.push("sameNode");
      }
      return { snippet, score, reason: reasonParts.join(",") };
    })
    .filter(Boolean) as Array<{ snippet: InternalMemorySnippet; score: number; reason: string }>;

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function normalizeWebEvidenceOutput(
  provider: WebProvider,
  output: unknown,
  mode: WebResultMode | "bridgeAssisted",
): unknown {
  const row =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : ({ text: stringifyInput(output) } as Record<string, unknown>);
  const timestamp = String(row.timestamp ?? new Date().toISOString());
  const text = String(row.text ?? extractFinalAnswer(row.raw ?? row.data ?? row) ?? "").trim();
  const raw = row.raw ?? row.data ?? output;
  const metaRow =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  const confidenceRaw = String(metaRow.confidence ?? "unknown").toLowerCase();
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? confidenceRaw
      : "unknown";
  const citations = Array.isArray(metaRow.citations)
    ? metaRow.citations
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0)
    : [];

  return {
    provider,
    timestamp,
    text,
    raw,
    meta: {
      sourceType: "web",
      provider,
      mode,
      sourceUrl: metaRow.url ? String(metaRow.url) : null,
      capturedAt: metaRow.capturedAt ? String(metaRow.capturedAt) : timestamp,
      confidence,
      citations,
      needsVerification: mode !== "bridgeAssisted",
    },
  };
}

export function normalizeWebTurnOutput(
  provider: WebProvider,
  mode: WebResultMode,
  rawInput: string,
): { ok: boolean; output?: unknown; error?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: tp("웹 응답 입력이 비어 있습니다.") };
  }

  if (mode === "manualPasteJson") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      return { ok: false, error: `${tp("JSON 파싱 실패")}: ${String(error)}` };
    }
    return {
      ok: true,
      output: normalizeWebEvidenceOutput(
        provider,
        {
          provider,
          timestamp: new Date().toISOString(),
          data: parsed,
          text: extractFinalAnswer(parsed),
        },
        mode,
      ),
    };
  }

  return {
    ok: true,
    output: normalizeWebEvidenceOutput(
      provider,
      {
        provider,
        timestamp: new Date().toISOString(),
        text: trimmed,
      },
      mode,
    ),
  };
}

export function executeTransformNode(node: GraphNode, input: unknown): { ok: boolean; output?: unknown; error?: string } {
  const config = node.config as TransformConfig;
  const mode = (config.mode ?? "pick") as TransformMode;

  if (mode === "pick") {
    const path = String(config.pickPath ?? "");
    return { ok: true, output: getByPath(input, path) };
  }

  if (mode === "merge") {
    const rawMerge = String(config.mergeJson ?? "{}");
    let mergeValue: unknown = {};
    try {
      mergeValue = JSON.parse(rawMerge);
    } catch (e) {
      return { ok: false, error: `${tp("merge JSON 형식 오류")}: ${String(e)}` };
    }

    if (input && typeof input === "object" && !Array.isArray(input) && mergeValue && typeof mergeValue === "object") {
      return {
        ok: true,
        output: {
          ...(input as Record<string, unknown>),
          ...(mergeValue as Record<string, unknown>),
        },
      };
    }

    return {
      ok: true,
      output: {
        input,
        merge: mergeValue,
      },
    };
  }

  const template = String(config.template ?? "{{input}}");
  const rendered = replaceInputPlaceholder(template, stringifyInput(input));
  return {
    ok: true,
    output: {
      text: rendered,
    },
  };
}

export function executeGateNode(options: {
  node: GraphNode;
  input: unknown;
  skipSet: Set<string>;
  graph: GraphData;
  simpleWorkflowUi: boolean;
  addNodeLog: (nodeId: string, message: string) => void;
  validateSimpleSchema: (schema: unknown, data: unknown) => string[];
}): { ok: boolean; output?: unknown; error?: string; message?: string } {
  const { node, input, skipSet, graph, simpleWorkflowUi, addNodeLog, validateSimpleSchema } = options;
  const config = node.config as GateConfig;
  let schemaFallbackNote = "";
  let decisionFallbackNote = "";
  const schemaRaw = String(config.schemaJson ?? "").trim();
  if (schemaRaw) {
    let parsedSchema: unknown;
    try {
      parsedSchema = JSON.parse(schemaRaw);
    } catch (e) {
      return { ok: false, error: `${tp("스키마 JSON 형식 오류")}: ${String(e)}` };
    }
    const schemaErrors = validateSimpleSchema(parsedSchema, input);
    if (schemaErrors.length > 0) {
      if (simpleWorkflowUi) {
        schemaFallbackNote = `${tp("스키마 완화 적용")} (${schemaErrors.join("; ")})`;
        addNodeLog(node.id, `[분기] ${schemaFallbackNote}`);
      } else {
        return {
          ok: false,
          error: `${tp("스키마 검증 실패")}: ${schemaErrors.join("; ")}`,
        };
      }
    }
  }

  const decisionPath = String(config.decisionPath ?? "DECISION");
  const decisionRaw =
    getByPath(input, decisionPath) ??
    (decisionPath === "DECISION" ? getByPath(input, "decision") : undefined) ??
    (decisionPath === "decision" ? getByPath(input, "DECISION") : undefined);
  let decision = String(decisionRaw ?? "").toUpperCase();
  if (decision !== "PASS" && decision !== "REJECT") {
    const text = stringifyInput(input).toUpperCase();
    const jsonMatch = text.match(/"DECISION"\s*:\s*"(PASS|REJECT)"/);
    if (jsonMatch?.[1]) {
      decision = jsonMatch[1];
      decisionFallbackNote = `${tp("JSON에서 DECISION")}=${decision} ${tp("추론")}`;
    } else if (/\bREJECT\b/.test(text)) {
      decision = "REJECT";
      decisionFallbackNote = tp("본문 키워드에서 REJECT 추론");
    } else if (/\bPASS\b/.test(text)) {
      decision = "PASS";
      decisionFallbackNote = tp("본문 키워드에서 PASS 추론");
    } else if (simpleWorkflowUi) {
      decision = "PASS";
      decisionFallbackNote = tp("DECISION 누락으로 PASS 기본값 적용");
    }
    if (decisionFallbackNote) {
      addNodeLog(node.id, `[분기] ${decisionFallbackNote}`);
    }
  }

  if (decision !== "PASS" && decision !== "REJECT") {
    return {
      ok: false,
      error: `${tp("분기 값은 PASS 또는 REJECT 여야 합니다. 입력값")}=${String(decisionRaw)}`,
    };
  }

  const children = graph.edges
    .filter((edge) => edge.from.nodeId === node.id)
    .map((edge) => edge.to.nodeId)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const allowed = new Set<string>();
  if (decision === "PASS") {
    const target = String(config.passNodeId ?? "") || children[0] || "";
    if (target) {
      allowed.add(target);
    }
  } else {
    const target = String(config.rejectNodeId ?? "") || children[1] || "";
    if (target) {
      allowed.add(target);
    }
  }

  for (const child of children) {
    if (!allowed.has(child)) {
      skipSet.add(child);
    }
  }

  return {
    ok: true,
    output: {
      decision,
      fallback: {
        schema: schemaFallbackNote || undefined,
        decision: decisionFallbackNote || undefined,
      },
    },
    message: `${tp("분기 결과")}=${decision}, ${tp("실행 대상")}=${Array.from(allowed).join(",") || tp("없음")}${
      schemaFallbackNote || decisionFallbackNote ? ` (${tp("내부 폴백 적용")})` : ""
    }`,
  };
}

export function resolveProviderByExecutor(executor: TurnExecutor): string {
  const webProvider = getWebProviderFromExecutor(executor);
  if (webProvider) {
    return webProvider;
  }
  if (executor === "via_flow") {
    return "via";
  }
  if (executor === "ollama") {
    return "ollama";
  }
  return "codex";
}

export function mergeUsageStats(
  base?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  next?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
  if (!base && !next) {
    return undefined;
  }
  return {
    inputTokens: (base?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
    outputTokens: (base?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
    totalTokens: (base?.totalTokens ?? 0) + (next?.totalTokens ?? 0),
  };
}

export function extractSchemaValidationTarget(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output;
  }
  const row = output as Record<string, unknown>;
  const artifact = row.artifact;
  if (artifact && typeof artifact === "object" && !Array.isArray(artifact)) {
    const payload = (artifact as Record<string, unknown>).payload;
    if (payload !== undefined) {
      if (typeof payload === "string") {
        return tryParseJsonText(payload) ?? { text: payload };
      }
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const payloadText = String((payload as Record<string, unknown>).text ?? "").trim();
        if (payloadText) {
          return tryParseJsonText(payloadText) ?? payload;
        }
      }
      return payload;
    }
  }
  if (row.raw !== undefined) {
    return row.raw;
  }
  if (typeof row.text === "string") {
    return tryParseJsonText(row.text) ?? { text: row.text };
  }
  return output;
}

export function buildSchemaRetryInput(
  originalInput: unknown,
  previousOutput: unknown,
  schema: unknown,
  schemaErrors: string[],
): string {
  const clip = (value: unknown, maxChars = 2800) => {
    const text = stringifyInput(value).trim();
    if (!text) {
      return tp("(없음)");
    }
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}\n...(${tp("중략")})`;
  };

  const schemaText = (() => {
    try {
      return JSON.stringify(schema, null, 2);
    } catch {
      return stringifyInput(schema);
    }
  })();

  return [
    `[${tp("원래 입력")}]`,
    clip(originalInput),
    `[${tp("이전 출력")}]`,
    clip(extractSchemaValidationTarget(previousOutput)),
    `[${tp("출력 스키마(JSON)")}]`,
    schemaText,
    `[${tp("스키마 오류 목록")}]`,
    schemaErrors.map((row, index) => `${index + 1}. ${row}`).join("\n"),
    `[${tp("재요청 지시")}]`,
    tp("위 스키마를 엄격히 만족하는 결과만 다시 생성하세요. 불필요한 설명 없이 스키마에 맞는 구조만 출력하세요."),
  ].join("\n\n");
}
