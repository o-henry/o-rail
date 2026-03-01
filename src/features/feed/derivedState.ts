import { getTurnExecutor, type TurnConfig, type TurnExecutor } from "../workflow/domain";
import { inferQualityProfile, type QualityProfileId } from "../workflow/domain";
import { nodeSelectionLabel, nodeTypeLabel, turnRoleLabel } from "../workflow/labels";
import { clipTextByChars, redactSensitiveText, summarizeFeedSteps } from "./displayUtils";
import { FEED_REDACTION_RULE_VERSION } from "./constants";
import { QUALITY_DEFAULT_THRESHOLD, normalizeQualityThreshold } from "../workflow/quality";
import { t } from "../../i18n";

type FeedCategory = "all_posts" | "completed_posts" | "web_posts" | "error_posts";

export function computeFeedDerivedState(params: {
  activeFeedRunMeta: any;
  graph: any;
  nodeStates: Record<string, any>;
  feedPosts: any[];
  feedStatusFilter: string;
  feedExecutorFilter: string;
  feedPeriodFilter: string;
  feedKeyword: string;
  feedCategory: FeedCategory;
  feedRunCache: Record<string, any>;
  feedInspectorPostId: string;
  feedInspectorSnapshotNode: any;
  cwd: string;
  nodeTypeLabelFn?: (type: any) => string;
  turnRoleLabelFn?: (node: any) => string;
  turnModelLabelFn?: (node: any) => string;
  formatUsageFn?: (usage: unknown) => string;
}): {
  liveFeedPosts: any[];
  currentFeedPosts: any[];
  feedCategoryPosts: Record<FeedCategory, any[]>;
  groupedFeedRuns: any[];
  feedInspectorPost: any | null;
  feedInspectorPostKey: string;
  feedInspectorPostNodeId: string;
  feedInspectorPostSourceFile: string;
  feedInspectorGraphNode: any | null;
  feedInspectorNode: any | null;
  feedInspectorTurnNode: any | null;
  feedInspectorTurnConfig: TurnConfig | null;
  feedInspectorTurnExecutor: TurnExecutor;
  feedInspectorQualityProfile: QualityProfileId;
  feedInspectorQualityThresholdOption: string;
  feedInspectorPromptTemplate: string;
  feedInspectorRuleCwd: string;
  feedInspectorEditable: boolean;
  feedInspectorEditableNodeId: string;
} {
  const {
    activeFeedRunMeta,
    graph,
    nodeStates,
    feedPosts,
    feedStatusFilter,
    feedExecutorFilter,
    feedPeriodFilter,
    feedKeyword,
    feedCategory,
    feedRunCache,
    feedInspectorPostId,
    feedInspectorSnapshotNode,
    cwd,
    nodeTypeLabelFn = nodeTypeLabel,
    turnRoleLabelFn = turnRoleLabel,
    turnModelLabelFn = nodeSelectionLabel,
  } = params;

  const liveFeedPosts: any[] = (() => {
    if (!activeFeedRunMeta) {
      return [];
    }
    const buildLiveInputSources = (targetNodeId: string): any[] => {
      const incomingEdges = graph.edges.filter((edge: any) => edge.to.nodeId === targetNodeId);
      if (incomingEdges.length === 0) {
        return [
          {
            kind: "question",
            agentName: t("feed.source.userQuestion"),
            summary: activeFeedRunMeta.question?.trim() || undefined,
          },
        ];
      }
      const seen = new Set<string>();
      const rows: any[] = [];
      for (const edge of incomingEdges) {
        const sourceNodeId = edge.from.nodeId;
        if (!sourceNodeId || seen.has(sourceNodeId)) {
          continue;
        }
        seen.add(sourceNodeId);
        const sourceNode = graph.nodes.find((row: any) => row.id === sourceNodeId);
        const sourceRunState = nodeStates[sourceNodeId];
        const sourceSummary =
          sourceRunState?.logs?.[sourceRunState.logs.length - 1] ||
          (sourceRunState?.status === "done"
            ? t("feed.status.done")
            : sourceRunState?.status === "failed"
              ? t("feed.status.failed")
              : undefined);
        rows.push({
          kind: "node",
          nodeId: sourceNodeId,
          agentName: sourceNode ? nodeSelectionLabel(sourceNode) : sourceNodeId,
          roleLabel:
            sourceNode?.type === "turn"
              ? turnRoleLabelFn(sourceNode)
              : sourceNode
                ? nodeTypeLabelFn(sourceNode.type)
                : undefined,
          summary: sourceSummary,
        });
      }
      return rows;
    };
    const now = Date.now();
    const posts: any[] = [];
    for (const node of graph.nodes) {
      const runState = nodeStates[node.id];
      if (!runState) {
        continue;
      }
      if (!["queued", "running", "waiting_user"].includes(runState.status)) {
        continue;
      }

      const logs = Array.isArray(runState.logs) ? runState.logs.slice(-60) : [];
      const lastLog = logs[logs.length - 1] ?? "";
      const roleLabel = node.type === "turn" ? turnRoleLabelFn(node) : nodeTypeLabelFn(node.type);
      const agentName =
        node.type === "turn"
          ? turnModelLabelFn(node)
          : node.type === "transform"
            ? t("label.node.transform")
            : t("label.node.gate");
      const summary =
        runState.status === "queued"
          ? t("feed.live.waitingQueue")
          : runState.status === "running"
            ? (lastLog || t("feed.agent.working"))
            : t("feed.live.waitingInput");
      const liveText = logs.join("\n").trim() || summary;
      const clip = clipTextByChars(liveText);
      const masked = redactSensitiveText(clip.text);
      const startedAtMs = runState.startedAt ? new Date(runState.startedAt).getTime() : Number.NaN;
      const durationMs = Number.isNaN(startedAtMs) ? undefined : Math.max(0, now - startedAtMs);
      const executor = node.type === "turn" ? getTurnExecutor(node.config as TurnConfig) : undefined;

      posts.push({
        id: `${activeFeedRunMeta.runId}:${node.id}:draft`,
        runId: activeFeedRunMeta.runId,
        nodeId: node.id,
        nodeType: node.type,
        executor,
        agentName,
        roleLabel,
        status: "draft",
        createdAt: runState.startedAt ?? activeFeedRunMeta.startedAt,
        summary,
        steps: summarizeFeedSteps(logs),
        inputSources: buildLiveInputSources(node.id),
        evidence: {
          durationMs,
          usage: runState.usage,
          qualityScore: runState.qualityReport?.score,
          qualityDecision: runState.qualityReport?.decision,
        },
        attachments: [
          {
            kind: "markdown",
            title: t("feed.liveLogs"),
            content: masked,
            truncated: clip.truncated,
            charCount: clip.charCount,
          },
        ],
        redaction: {
          masked: true,
          ruleVersion: FEED_REDACTION_RULE_VERSION,
        },
        sourceFile: `run-${activeFeedRunMeta.runId}.json`,
        question: activeFeedRunMeta.question,
      });
    }
    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return posts;
  })();

  const liveFeedNodeKeys = new Set(liveFeedPosts.map((post) => `${post.runId}:${post.nodeId}`));
  const mergedFeedPosts = [
    ...liveFeedPosts,
    ...feedPosts.filter((post) => !liveFeedNodeKeys.has(`${post.runId}:${post.nodeId}`)),
  ];

  const filteredFeedPosts = mergedFeedPosts
    .filter((post) => {
      if (feedStatusFilter !== "all" && post.status !== feedStatusFilter) {
        return false;
      }
      if (feedExecutorFilter !== "all") {
        const normalizedExecutor =
          post.executor === "codex"
            ? "codex"
            : post.executor === "ollama"
              ? "ollama"
              : post.executor
                ? "web"
                : "";
        if (normalizedExecutor !== feedExecutorFilter) {
          return false;
        }
      }
      if (feedPeriodFilter !== "all") {
        const createdAtMs = new Date(post.createdAt).getTime();
        const now = Date.now();
        if (Number.isNaN(createdAtMs)) {
          return false;
        }
        if (feedPeriodFilter === "today" && now - createdAtMs > 24 * 60 * 60 * 1000) {
          return false;
        }
        if (feedPeriodFilter === "7d" && now - createdAtMs > 7 * 24 * 60 * 60 * 1000) {
          return false;
        }
      }
      const keyword = feedKeyword.trim().toLowerCase();
      if (!keyword) {
        return true;
      }
      const sourceText = (Array.isArray(post.inputSources) ? post.inputSources : [])
        .map((source: any) => `${source.agentName} ${source.roleLabel ?? ""} ${source.summary ?? ""}`)
        .join(" ");
      const haystack = `${post.runId ?? ""} ${post.question ?? ""} ${post.agentName} ${post.roleLabel} ${post.summary} ${
        post.inputContext?.preview ?? ""
      } ${sourceText}`.toLowerCase();
      return haystack.includes(keyword);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const feedCategoryPosts: Record<FeedCategory, any[]> = {
    all_posts: filteredFeedPosts,
    completed_posts: filteredFeedPosts.filter((post) => post.status === "done" || post.status === "low_quality"),
    web_posts: filteredFeedPosts.filter((post) =>
      String(post.executor ?? "").toLowerCase().startsWith("web_"),
    ),
    error_posts: filteredFeedPosts.filter(
      (post) => post.status === "failed" || post.status === "cancelled",
    ),
  };
  const currentFeedPosts = feedCategoryPosts[feedCategory] ?? filteredFeedPosts;

  const groupedFeedRuns = (() => {
    const groups = new Map<string, any>();
    for (const post of currentFeedPosts) {
      const existing = groups.get(post.runId);
      if (existing) {
        existing.posts.push(post);
        if (new Date(post.createdAt).getTime() > new Date(existing.latestAt).getTime()) {
          existing.latestAt = post.createdAt;
        }
        if (post.status === "draft") {
          existing.isLive = true;
        }
        continue;
      }
      const isLive = activeFeedRunMeta?.runId === post.runId;
      const runRecord = feedRunCache[post.sourceFile] ?? null;
      const meta = isLive
        ? {
            name: activeFeedRunMeta?.groupName ?? t("group.custom"),
            kind: activeFeedRunMeta?.groupKind ?? "custom",
            presetKind: activeFeedRunMeta?.presetKind,
          }
        : runRecord?.workflowGroupName
          ? {
              name: runRecord.workflowGroupName,
              kind: runRecord.workflowGroupKind ?? "custom",
              presetKind: runRecord.workflowPresetKind,
            }
          : runRecord?.workflowPresetKind
            ? {
                name: runRecord.workflowPresetKind,
                kind: "template",
                presetKind: runRecord.workflowPresetKind,
              }
            : {
                name: t("group.custom"),
                kind: "custom",
              };
      groups.set(post.runId, {
        runId: post.runId,
        sourceFile: post.sourceFile,
        name: meta.name,
        kind: meta.kind,
        presetKind: meta.presetKind,
        latestAt: post.createdAt,
        isLive: post.status === "draft",
        posts: [post],
      });
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        posts: group.posts.sort(
          (a: any, b: any) => new Date(String(b?.createdAt ?? "")).getTime() - new Date(String(a?.createdAt ?? "")).getTime(),
        ),
      }))
      .sort(
        (a, b) =>
          new Date(String(b?.latestAt ?? "")).getTime() - new Date(String(a?.latestAt ?? "")).getTime(),
      );
  })();

  const feedInspectorPost =
    currentFeedPosts.find((post) => post.id === feedInspectorPostId) ?? currentFeedPosts[0] ?? null;
  const feedInspectorPostKey = feedInspectorPost?.id ?? "";
  const feedInspectorPostNodeId = feedInspectorPost?.nodeId ?? "";
  const feedInspectorPostSourceFile = feedInspectorPost?.sourceFile ?? "";
  const feedInspectorGraphNode = feedInspectorPost
    ? graph.nodes.find((node: any) => node.id === feedInspectorPost.nodeId) ?? null
    : null;
  const feedInspectorNode = feedInspectorGraphNode ?? feedInspectorSnapshotNode;
  const feedInspectorTurnNode =
    feedInspectorNode?.type === "turn" ? feedInspectorNode : null;
  const feedInspectorTurnConfig: TurnConfig | null =
    feedInspectorTurnNode?.type === "turn" ? (feedInspectorTurnNode.config as TurnConfig) : null;
  const feedInspectorTurnExecutor: TurnExecutor =
    feedInspectorTurnConfig ? getTurnExecutor(feedInspectorTurnConfig) : "codex";
  const feedInspectorQualityProfile: QualityProfileId =
    feedInspectorTurnNode && feedInspectorTurnConfig
      ? inferQualityProfile(feedInspectorTurnNode, feedInspectorTurnConfig)
      : "generic";
  const feedInspectorQualityThresholdOption = String(
    normalizeQualityThreshold(feedInspectorTurnConfig?.qualityThreshold ?? QUALITY_DEFAULT_THRESHOLD),
  );
  const feedInspectorPromptTemplate = String(feedInspectorTurnConfig?.promptTemplate ?? "{{input}}");
  const feedInspectorRuleCwd = String(feedInspectorTurnConfig?.cwd ?? cwd);
  const feedInspectorEditable =
    feedInspectorGraphNode !== null &&
    feedInspectorGraphNode.type === "turn" &&
    feedInspectorTurnNode !== null &&
    feedInspectorTurnNode.type === "turn";
  const feedInspectorEditableNodeId =
    feedInspectorEditable && feedInspectorTurnNode ? feedInspectorTurnNode.id : "";

  return {
    liveFeedPosts,
    currentFeedPosts,
    feedCategoryPosts,
    groupedFeedRuns,
    feedInspectorPost,
    feedInspectorPostKey,
    feedInspectorPostNodeId,
    feedInspectorPostSourceFile,
    feedInspectorGraphNode,
    feedInspectorNode,
    feedInspectorTurnNode,
    feedInspectorTurnConfig,
    feedInspectorTurnExecutor,
    feedInspectorQualityProfile,
    feedInspectorQualityThresholdOption,
    feedInspectorPromptTemplate,
    feedInspectorRuleCwd,
    feedInspectorEditable,
    feedInspectorEditableNodeId,
  };
}
