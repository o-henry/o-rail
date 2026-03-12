import { extractPromptInputText } from "../../../features/workflow/promptUtils";
import type { TurnConfig } from "../../../features/workflow/domain";
import { turnRoleLabel } from "../../../features/workflow/labels";
import type { GraphEdge, GraphNode } from "../../../features/workflow/types";
import { buildConflictLedger } from "../../mainAppRuntimeHelpers";
import type {
  EvidenceConflict,
  EvidenceEnvelope,
  NodeResponsibilityMemory,
} from "../types";

export type StructuredNodeInputParent = {
  nodeId: string;
  roleLabel: string;
  artifactType: string;
  text: string;
  verificationStatus?: string;
  confidenceBand?: string;
  citations: string[];
};

export type StructuredNodeInputPacket = {
  packetType: "structured_node_input";
  stage: "multi_parent_review" | "final_synthesis";
  question: string;
  parentOutputs: StructuredNodeInputParent[];
  evidencePackets: EvidenceEnvelope[];
  unresolvedConflicts: EvidenceConflict[];
  runMemory: NodeResponsibilityMemory[];
  reviewContract: {
    mode: "multi_perspective_review";
    preserveCreativeVariance: boolean;
    requiredSections: string[];
    decisionOptions: string[];
  };
};

const MAX_PARENT_SUMMARY_LINES = 8;
const MAX_PARENT_FALLBACK_CHARS = 1800;

function compactLines(lines: string[], maxLines: number): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

function compactText(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, maxChars).trim();
}

function buildEvidenceSummaryText(evidence?: EvidenceEnvelope): string {
  if (!evidence) {
    return "";
  }

  const claimLines = evidence.claims
    .map((claim) => String(claim.text ?? "").trim())
    .filter(Boolean);
  const issueLines = evidence.dataIssues
    .map((issue) => String(issue ?? "").trim())
    .filter(Boolean)
    .map((issue) => `주의: ${issue}`);
  const citationLines = evidence.citations
    .map((citation) => String(citation.title ?? citation.source ?? citation.url ?? "").trim())
    .filter(Boolean)
    .map((citation) => `출처: ${citation}`);

  const summary = compactLines(
    [...claimLines, ...issueLines, ...citationLines],
    MAX_PARENT_SUMMARY_LINES,
  );
  if (summary) {
    return summary;
  }
  return compactText(String(evidence.rawText ?? ""), MAX_PARENT_FALLBACK_CHARS);
}

function buildParentOutputText(output: unknown, evidence?: EvidenceEnvelope): string {
  const evidenceSummary = buildEvidenceSummaryText(evidence);
  if (evidenceSummary) {
    return evidenceSummary;
  }
  return compactText(extractPromptInputText(output), MAX_PARENT_FALLBACK_CHARS);
}

function buildParentOutputSummary(params: {
  node: GraphNode;
  output: unknown;
  evidence?: EvidenceEnvelope;
}): StructuredNodeInputParent {
  const config = params.node.config as TurnConfig;
  return {
    nodeId: params.node.id,
    roleLabel: turnRoleLabel(params.node),
    artifactType: String(config.artifactType ?? "none"),
    text: buildParentOutputText(params.output, params.evidence),
    verificationStatus: params.evidence?.verificationStatus,
    confidenceBand: params.evidence?.confidenceBand,
    citations:
      params.evidence?.citations
        .map((row) => String(row.title ?? row.source ?? row.url ?? "").trim())
        .filter(Boolean)
        .slice(0, 4) ?? [],
  };
}

export function isStructuredNodeInputPacket(input: unknown): input is StructuredNodeInputPacket {
  return Boolean(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      (input as Record<string, unknown>).packetType === "structured_node_input",
  );
}

export function shouldUseStructuredNodeInputPacket(node: GraphNode, incomingCount: number): boolean {
  return node.type === "turn" && incomingCount > 1;
}

export function buildStructuredNodeInputPacket(params: {
  nodeId: string;
  stage: StructuredNodeInputPacket["stage"];
  edges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
  outputs: Record<string, unknown>;
  rootInput: string;
  normalizedEvidenceByNodeId: Record<string, EvidenceEnvelope[]>;
  runMemory: Record<string, NodeResponsibilityMemory>;
}): StructuredNodeInputPacket | null {
  const incomingEdges = params.edges.filter((edge) => edge.to.nodeId === params.nodeId);
  if (incomingEdges.length === 0) {
    return null;
  }

  const parentOutputs: StructuredNodeInputParent[] = [];
  const evidencePackets: EvidenceEnvelope[] = [];
  for (const edge of incomingEdges) {
    const sourceNodeId = edge.from.nodeId;
    if (!(sourceNodeId in params.outputs)) {
      continue;
    }
    const sourceNode = params.nodeMap.get(sourceNodeId);
    if (!sourceNode) {
      continue;
    }
    const sourcePackets = params.normalizedEvidenceByNodeId[sourceNodeId] ?? [];
    const evidence = sourcePackets.length > 0 ? sourcePackets[sourcePackets.length - 1] : undefined;
    if (evidence) {
      evidencePackets.push(evidence);
    }
    parentOutputs.push(
      buildParentOutputSummary({
        node: sourceNode,
        output: params.outputs[sourceNodeId],
        evidence,
      }),
    );
  }

  if (parentOutputs.length === 0) {
    return null;
  }

  return {
    packetType: "structured_node_input",
    stage: params.stage,
    question: params.rootInput,
    parentOutputs,
    evidencePackets,
    unresolvedConflicts: buildConflictLedger(evidencePackets),
    runMemory: Object.values(params.runMemory),
    reviewContract: {
      mode: "multi_perspective_review",
      preserveCreativeVariance: true,
      requiredSections:
        params.stage === "final_synthesis"
          ? ["결론 요약", "핵심 근거", "신뢰도와 한계", "다음 체크포인트"]
          : ["공통 장점", "치명 리스크", "수정 제안", "keep/revise/drop 판단"],
      decisionOptions: ["keep", "revise", "drop"],
    },
  };
}
