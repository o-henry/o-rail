import { FEED_REDACTION_RULE_VERSION } from "../../../features/feed/constants";
import {
  formatFeedInputSourceLabel,
  normalizeFeedInputSources,
  redactSensitiveText,
  summarizeFeedSteps,
} from "../../../features/feed/displayUtils";
import { getTurnExecutor, type TurnConfig } from "../../../features/workflow/domain";
import { turnModelLabel } from "../../../features/workflow/graph-utils";
import { extractFinalAnswer, nodeStatusLabel, nodeTypeLabel, turnRoleLabel } from "../../../features/workflow/labels";
import { getByPath, stringifyInput, toHumanReadableFeedText } from "../../../features/workflow/promptUtils";
import type { NodeExecutionStatus } from "../../../features/workflow/types";
import { t, tp } from "../../../i18n";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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
          return title ? `- ${title}: ${url}` : `- ${url}`;
        })
        .filter((row) => row.length > 0)
        .slice(0, 20)
    : [];

  if (!summary && highlights.length === 0 && risks.length === 0 && references.length === 0) {
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

function summarizeViaReadableOutput(output: unknown): string {
  const outputRecord = asRecord(output);
  if (!outputRecord) {
    return "";
  }
  const viaRecord = asRecord(outputRecord.via);
  if (!viaRecord) {
    return "";
  }
  const detailRecord = asRecord(viaRecord.detail);
  const payloadRecord = asRecord(detailRecord?.payload);
  const codexBriefing = String(payloadRecord?.codex_briefing ?? "").trim();
  if (codexBriefing) {
    const firstLine = codexBriefing
      .split("\n")
      .map((row) => row.trim())
      .find((line) => line.length > 0 && !line.startsWith("#"));
    if (firstLine) {
      return firstLine.length > 360 ? `${firstLine.slice(0, 360)}...` : firstLine;
    }
  }
  const highlights = (Array.isArray(payloadRecord?.highlights) ? payloadRecord.highlights : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (highlights.length > 0) {
    const joined = highlights.slice(0, 3).join(" · ");
    return joined.length > 360 ? `${joined.slice(0, 360)}...` : joined;
  }
  const summary = String(payloadRecord?.summary ?? "").trim();
  return summary ? (summary.length > 360 ? `${summary.slice(0, 360)}...` : summary) : "";
}

function isPlaceholderRunSummary(value: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return new Set([
    t("run.turnCompleted").trim().toLowerCase(),
    "turn completed",
    "턴 실행 완료",
    "轮次执行完成",
    "ターン実行完了",
  ]).has(normalized);
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

export function buildFeedSummary(status: string, output: unknown, error?: string, summary?: string): string {
  const trimmedSummary = (summary ?? "").trim();
  if (trimmedSummary && !isPlaceholderRunSummary(trimmedSummary)) {
    return trimmedSummary;
  }
  if (status === "draft") {
    return t("feed.summary.running");
  }
  if (status !== "done" && status !== "low_quality") {
    return error?.trim() || t("feed.summary.failed");
  }
  const viaSummary = summarizeViaReadableOutput(output);
  if (viaSummary) {
    return viaSummary;
  }
  const outputText = toHumanReadableFeedText(extractFeedOutputText(output));
  if (!outputText) {
    return t("feed.summary.noText");
  }
  return outputText.length > 360 ? `${outputText.slice(0, 360)}...` : outputText;
}

export function feedAttachmentRawKey(postId: string, kind: "markdown" | "json"): string {
  return `${postId}:${kind}`;
}

export function buildFeedPost(input: any): {
  post: any;
  rawAttachments: Record<"markdown" | "json", string>;
} {
  const config = input.node.config as TurnConfig;
  const executor = input.node.type === "turn" ? getTurnExecutor(config) : undefined;
  const isViaFlowPost = executor === "via_flow";
  const isViaFinalDocumentPost = isViaFlowPost && Boolean(input.isFinalDocument);
  const viaTemplateLabel =
    executor === "via_flow" ? String((config as Record<string, unknown>).viaTemplateLabel ?? "").trim() : "";
  const topicLabelFromInput = typeof input.topicLabel === "string" ? String(input.topicLabel).trim() : "";
  const groupNameFromInput = typeof input.groupName === "string" ? String(input.groupName).trim() : "";
  const resolvedTopicLabel = topicLabelFromInput || viaTemplateLabel || undefined;
  const resolvedGroupName = groupNameFromInput || viaTemplateLabel || undefined;
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
    ...(!isViaFinalDocumentPost && inputSources.length > 0
      ? ["", `## ${t("feed.inputSources")}`, ...inputSources.map((source) => `- ${formatFeedInputSourceLabel(source)}`)]
      : []),
    ...(!isViaFinalDocumentPost && inputContextMasked ? ["", `## ${t("feed.inputSnapshot")}`, inputContextMasked] : []),
    "",
    `## ${t("feed.share.steps")}`,
    ...steps.map((step) => `- ${step}`),
    "",
    `## ${t("feed.share.detail")}`,
    outputText || t("feed.output.empty"),
    ...(Array.isArray(input.dataIssues) && input.dataIssues.length > 0
      ? ["", "## 데이터 이슈", ...input.dataIssues.map((issue: string) => `- ${issue}`)]
      : []),
    ...(!isViaFinalDocumentPost ? ["", `## ${t("feed.logs.title")}`, logsText] : []),
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

  const markdownMasked = redactSensitiveText(markdownRaw);
  const jsonMasked = redactSensitiveText(jsonRaw);
  const postId = `${input.runId}:${input.node.id}:${input.status}`;

  return {
    post: {
      id: postId,
      runId: input.runId,
      nodeId: input.node.id,
      nodeType: input.node.type,
      topic: typeof input.topic === "string" ? input.topic : undefined,
      topicLabel: resolvedTopicLabel,
      groupName: resolvedGroupName,
      isFinalDocument: Boolean(input.isFinalDocument),
      executor,
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
          truncated: false,
          charCount: markdownRaw.length,
        },
        {
          kind: "json",
          title: tp("구조화 결과 (JSON)"),
          content: jsonMasked,
          truncated: false,
          charCount: jsonRaw.length,
        },
      ],
      redaction: {
        masked: true,
        ruleVersion: FEED_REDACTION_RULE_VERSION,
      },
      rawAttachmentRef: {
        markdownKey: feedAttachmentRawKey(postId, "markdown"),
        jsonKey: feedAttachmentRawKey(postId, "json"),
      },
    },
    rawAttachments: {
      markdown: markdownRaw,
      json: jsonRaw,
    },
  };
}

function normalizeRunFeedPosts(run: any): any[] {
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
    if (!["done", "low_quality", "failed", "cancelled"].includes(transition.status)) {
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
    posts.push(
      buildFeedPost({
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
      }).post,
    );
  }

  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return posts;
}

export function normalizeRunRecord(run: any): any {
  return {
    ...run,
    feedPosts: normalizeRunFeedPosts(run),
  };
}
