import { useEffect, useMemo, useState } from "react";
import type { FeedCategory, FeedStatusFilter } from "../main";
import type { WorkspaceTab } from "../mainAppGraphHelpers";

type QuickPanelPost = {
  id: string;
  summary: string;
  agentName: string;
  status: string;
  createdAt: string;
};

type UseWorkspaceQuickPanelParams = {
  workspaceTab: WorkspaceTab;
  setWorkspaceTab: (next: WorkspaceTab) => void;
  feedPosts: QuickPanelPost[];
  formatRelativeFeedTime: (input: string) => string;
  setFeedCategory: (next: FeedCategory) => void;
  setFeedStatusFilter: (next: FeedStatusFilter) => void;
  setFeedKeyword: (next: string) => void;
  setWorkflowQuestion: (next: string) => void;
  setStatus: (message: string) => void;
  canvasFullscreen: boolean;
};

export function useWorkspaceQuickPanel(params: UseWorkspaceQuickPanelParams) {
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);
  const [quickPanelQuery, setQuickPanelQuery] = useState("");

  const quickPanelWorkspaceLabel = useMemo(() => {
    const byTab: Record<WorkspaceTab, string> = {
      workbench: "그래프",
      dashboard: "작업 홈",
      intelligence: "대시보드 인텔리전스",
      agents: "에이전트 채팅",
      workflow: "워크플로우",
      feed: "요점 정리",
      handoff: "그래프 핸드오프",
      knowledge: "데이터베이스",
      adaptation: "개선",
      settings: "설정",
      bridge: "설정",
    };
    return byTab[params.workspaceTab] ?? "워크스페이스";
  }, [params.workspaceTab]);

  const quickPanelRecentPosts = useMemo(
    () =>
      [...params.feedPosts]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, 5)
        .map((post) => ({
          id: post.id,
          title: post.summary.trim().slice(0, 90) || `[${post.agentName}] ${post.status}`,
          meta: `${post.agentName} · ${params.formatRelativeFeedTime(post.createdAt)}`,
        })),
    [params.feedPosts, params.formatRelativeFeedTime],
  );

  const onToggleQuickPanel = () => {
    setQuickPanelOpen((prev) => !prev);
  };

  const onCloseQuickPanel = () => {
    setQuickPanelOpen(false);
  };

  const onOpenQuickPanelFeed = () => {
    params.setWorkspaceTab("feed");
    params.setFeedCategory("all_posts");
    params.setFeedStatusFilter("all");
    params.setFeedKeyword("");
    setQuickPanelOpen(false);
  };

  const onOpenQuickPanelAgents = () => {
    params.setWorkspaceTab("workflow");
    setQuickPanelOpen(false);
  };

  const onSubmitQuickPanelQuery = () => {
    const next = quickPanelQuery.trim();
    if (!next) {
      params.setWorkspaceTab("workflow");
      setQuickPanelOpen(false);
      return;
    }
    params.setWorkflowQuestion(next);
    params.setWorkspaceTab("workflow");
    params.setStatus("우측 패널 입력이 워크플로우에 반영되었습니다.");
    setQuickPanelQuery("");
    setQuickPanelOpen(false);
  };

  useEffect(() => {
    const onQuickPanelHotkey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "k") {
        event.preventDefault();
        setQuickPanelOpen((prev) => !prev);
        return;
      }
      if (event.key === "Escape") {
        setQuickPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onQuickPanelHotkey);
    return () => window.removeEventListener("keydown", onQuickPanelHotkey);
  }, []);

  useEffect(() => {
    if (params.canvasFullscreen) {
      setQuickPanelOpen(false);
    }
  }, [params.canvasFullscreen]);

  return {
    quickPanelOpen,
    quickPanelQuery,
    setQuickPanelQuery,
    quickPanelWorkspaceLabel,
    quickPanelRecentPosts,
    onToggleQuickPanel,
    onCloseQuickPanel,
    onOpenQuickPanelFeed,
    onOpenQuickPanelAgents,
    onSubmitQuickPanelQuery,
  };
}
