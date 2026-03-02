import { useRef, useState } from "react";
import type { PresetKind } from "../../features/workflow/domain";
import type { GraphNode } from "../../features/workflow/types";
import type {
  AgentRuleDoc,
  FeedCategory,
  FeedExecutorFilter,
  FeedPeriodFilter,
  FeedStatusFilter,
  FeedTopicFilter,
  FeedViewPost,
  RunGroupKind,
} from "../main";

export function useFeedState() {
  const [feedPosts, setFeedPosts] = useState<FeedViewPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedStatusFilter, setFeedStatusFilter] = useState<FeedStatusFilter>("all");
  const [feedExecutorFilter, setFeedExecutorFilter] = useState<FeedExecutorFilter>("all");
  const [feedPeriodFilter, setFeedPeriodFilter] = useState<FeedPeriodFilter>("all");
  const [feedTopicFilter, setFeedTopicFilter] = useState<FeedTopicFilter>("all");
  const [feedKeyword, setFeedKeyword] = useState("");
  const [feedCategory, setFeedCategory] = useState<FeedCategory>("all_posts");
  const [feedFilterOpen, setFeedFilterOpen] = useState(false);
  const [feedGroupExpandedByRunId, setFeedGroupExpandedByRunId] = useState<Record<string, boolean>>({});
  const [feedGroupRenameRunId, setFeedGroupRenameRunId] = useState<string | null>(null);
  const [feedGroupRenameDraft, setFeedGroupRenameDraft] = useState("");
  const [feedExpandedByPost, setFeedExpandedByPost] = useState<Record<string, boolean>>({});
  const [feedShareMenuPostId, setFeedShareMenuPostId] = useState<string | null>(null);
  const [feedReplyDraftByPost, setFeedReplyDraftByPost] = useState<Record<string, string>>({});
  const [feedReplySubmittingByPost, setFeedReplySubmittingByPost] = useState<Record<string, boolean>>({});
  const [feedReplyFeedbackByPost, setFeedReplyFeedbackByPost] = useState<Record<string, string>>({});
  const [feedInspectorPostId, setFeedInspectorPostId] = useState("");
  const [feedInspectorSnapshotNode, setFeedInspectorSnapshotNode] = useState<GraphNode | null>(null);
  const [, setFeedInspectorRuleDocs] = useState<AgentRuleDoc[]>([]);
  const [, setFeedInspectorRuleLoading] = useState(false);
  const [pendingNodeRequests, setPendingNodeRequests] = useState<Record<string, string[]>>({});
  const [activeFeedRunMeta, setActiveFeedRunMeta] = useState<{
    runId: string;
    question: string;
    startedAt: string;
    groupName: string;
    groupKind: RunGroupKind;
    presetKind?: PresetKind;
  } | null>(null);
  const [, setLastSavedRunFile] = useState("");

  const feedRawAttachmentRef = useRef<Record<string, string>>({});
  const pendingNodeRequestsRef = useRef<Record<string, string[]>>({});
  const agentRulesCacheRef = useRef<Record<string, { loadedAt: number; docs: AgentRuleDoc[] }>>({});
  const feedReplyFeedbackClearTimerRef = useRef<Record<string, number>>({});

  return {
    feedPosts,
    setFeedPosts,
    feedLoading,
    setFeedLoading,
    feedStatusFilter,
    setFeedStatusFilter,
    feedExecutorFilter,
    setFeedExecutorFilter,
    feedPeriodFilter,
    setFeedPeriodFilter,
    feedTopicFilter,
    setFeedTopicFilter,
    feedKeyword,
    setFeedKeyword,
    feedCategory,
    setFeedCategory,
    feedFilterOpen,
    setFeedFilterOpen,
    feedGroupExpandedByRunId,
    setFeedGroupExpandedByRunId,
    feedGroupRenameRunId,
    setFeedGroupRenameRunId,
    feedGroupRenameDraft,
    setFeedGroupRenameDraft,
    feedExpandedByPost,
    setFeedExpandedByPost,
    feedShareMenuPostId,
    setFeedShareMenuPostId,
    feedReplyDraftByPost,
    setFeedReplyDraftByPost,
    feedReplySubmittingByPost,
    setFeedReplySubmittingByPost,
    feedReplyFeedbackByPost,
    setFeedReplyFeedbackByPost,
    feedInspectorPostId,
    setFeedInspectorPostId,
    feedInspectorSnapshotNode,
    setFeedInspectorSnapshotNode,
    setFeedInspectorRuleDocs,
    setFeedInspectorRuleLoading,
    pendingNodeRequests,
    setPendingNodeRequests,
    activeFeedRunMeta,
    setActiveFeedRunMeta,
    setLastSavedRunFile,
    feedRawAttachmentRef,
    pendingNodeRequestsRef,
    agentRulesCacheRef,
    feedReplyFeedbackClearTimerRef,
  };
}
