import { useCallback } from "react";
import { buildFeedPost, feedAttachmentRawKey } from "../../mainAppRuntimeHelpers";

type Params = {
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
  }) => void;
  cwd: string;
  dashboardSnapshotsByTopic: Record<string, any>;
  feedPosts: any[];
  feedRawAttachmentRef: React.MutableRefObject<Record<string, string>>;
  hasTauriRuntime: boolean;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  setError: (message: string) => void;
  setFeedCategory: React.Dispatch<React.SetStateAction<any>>;
  setFeedExecutorFilter: React.Dispatch<React.SetStateAction<any>>;
  setFeedExpandedByPost: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setFeedFilterOpen: (value: boolean) => void;
  setFeedGroupExpandedByRunId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setFeedInspectorPostId: (value: string) => void;
  setFeedKeyword: React.Dispatch<React.SetStateAction<string>>;
  setFeedPeriodFilter: React.Dispatch<React.SetStateAction<any>>;
  setFeedPosts: React.Dispatch<React.SetStateAction<any[]>>;
  setFeedStatusFilter: React.Dispatch<React.SetStateAction<any>>;
  setFeedTopicFilter: React.Dispatch<React.SetStateAction<string>>;
  setStatus: (message: string) => void;
  setWorkspaceTab: React.Dispatch<React.SetStateAction<any>>;
  t: (key: string) => string;
};

export function useBriefingDocumentActions(params: Params) {
  const {
    appendWorkspaceEvent,
    cwd,
    dashboardSnapshotsByTopic,
    feedPosts,
    feedRawAttachmentRef,
    hasTauriRuntime,
    invokeFn,
    setError,
    setFeedCategory,
    setFeedExecutorFilter,
    setFeedExpandedByPost,
    setFeedFilterOpen,
    setFeedGroupExpandedByRunId,
    setFeedInspectorPostId,
    setFeedKeyword,
    setFeedPeriodFilter,
    setFeedPosts,
    setFeedStatusFilter,
    setFeedTopicFilter,
    setStatus,
    setWorkspaceTab,
    t,
  } = params;

  return useCallback(
    async (runId: string, postId?: string) => {
      const resolvedRunId = String(runId ?? "").trim();
      if (!resolvedRunId) {
        setStatus("열 수 있는 브리핑 실행 기록이 없습니다.");
        return;
      }
      const resolvedPostId = String(postId ?? "").trim();
      const existingRunPosts = feedPosts.filter((post) => String(post.runId ?? "").trim() === resolvedRunId);
      let fallbackPostId = resolvedPostId;
      let hasOpenablePost = existingRunPosts.length > 0;
      if (existingRunPosts.length === 0) {
        const snapshot = Object.values(dashboardSnapshotsByTopic)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .find((row) => String(row.runId ?? "").trim() === resolvedRunId);
        if (snapshot) {
          const topicLabel = t(`dashboard.widget.${snapshot.topic}.title`);
          const syntheticNodeId = `dashboard-${snapshot.topic}`;
          const syntheticPostId = `${resolvedRunId}:${syntheticNodeId}:${snapshot.status === "degraded" ? "low_quality" : "done"}`;
          const alreadyExists = feedPosts.some((post) => post.id === syntheticPostId);
          if (!alreadyExists) {
            const built = buildFeedPost({
              runId: resolvedRunId,
              node: {
                id: syntheticNodeId,
                type: "turn",
                config: {
                  executor: "codex",
                  model: snapshot.model,
                  role: "DASHBOARD BRIEFING",
                },
              },
              isFinalDocument: true,
              status: snapshot.status === "degraded" ? "low_quality" : "done",
              createdAt: String(snapshot.generatedAt ?? new Date().toISOString()),
              topic: snapshot.topic,
              topicLabel,
              groupName: topicLabel,
              agentName: topicLabel,
              roleLabel: `${String(snapshot.model ?? "").toUpperCase()} · DASHBOARD BRIEFING`,
              summary: String(snapshot.summary ?? "").trim() || `${topicLabel} 브리핑 생성`,
              logs: [
                `${topicLabel} 브리핑 생성`,
                ...(Array.isArray(snapshot.highlights) ? snapshot.highlights.slice(0, 8) : []),
              ],
              output: snapshot,
            });
            let markdownFilePath = "";
            let jsonFilePath = "";
            const normalizedCwd = String(cwd ?? "").trim();
            if (hasTauriRuntime && normalizedCwd) {
              try {
                const runDir = `${normalizedCwd.replace(/[\\/]+$/, "")}/.rail/runs/${resolvedRunId}`;
                const topicToken = String(snapshot.topic ?? "dashboard")
                  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
                  .replace(/[^a-zA-Z0-9]+/g, "_")
                  .replace(/_+/g, "_")
                  .replace(/^_|_$/g, "")
                  .toLowerCase();
                const stamp = String(snapshot.generatedAt ?? new Date().toISOString())
                  .replace(/[-:.TZ]/g, "")
                  .slice(0, 14) || String(Date.now());
                const fileBase = `dashboard_${topicToken}_${stamp}`;
                markdownFilePath = await invokeFn<string>("workspace_write_text", {
                  cwd: runDir,
                  name: `${fileBase}.md`,
                  content: built.rawAttachments.markdown,
                });
                jsonFilePath = await invokeFn<string>("workspace_write_text", {
                  cwd: runDir,
                  name: `${fileBase}.json`,
                  content: built.rawAttachments.json,
                });
              } catch {
                // Ignore file persistence failures here; feed can still render in-memory content.
              }
            }
            built.post.inputSources = (snapshot.references ?? []).slice(0, 10).map((reference: any) => ({
              kind: "node",
              nodeId: syntheticNodeId,
              agentName: String(reference.source ?? "").trim() || "REFERENCE",
              roleLabel: "SOURCE",
              summary: [reference.title, reference.url].filter((part) => String(part ?? "").trim().length > 0).join(" · "),
            }));
            built.post.steps = [
              ...(Array.isArray(snapshot.highlights) ? snapshot.highlights.slice(0, 6) : []),
              ...(Array.isArray(snapshot.risks) ? snapshot.risks.slice(0, 3).map((risk: string) => `리스크: ${risk}`) : []),
            ].filter((line) => String(line ?? "").trim().length > 0);
            const syntheticPost = {
              ...built.post,
              id: syntheticPostId,
              topic: snapshot.topic,
              topicLabel,
              groupName: topicLabel,
              sourceFile: jsonFilePath || `dashboard-${snapshot.topic}-${resolvedRunId}.json`,
              question: `${topicLabel} 데이터 파이프라인 실행 결과`,
              attachments: Array.isArray(built.post.attachments)
                ? built.post.attachments.map((attachment: any) => {
                    if (attachment?.kind === "markdown" && markdownFilePath) {
                      return { ...attachment, filePath: markdownFilePath };
                    }
                    if (attachment?.kind === "json" && jsonFilePath) {
                      return { ...attachment, filePath: jsonFilePath };
                    }
                    return attachment;
                  })
                : built.post.attachments,
            };
            feedRawAttachmentRef.current[feedAttachmentRawKey(syntheticPost.id, "markdown")] = built.rawAttachments.markdown;
            feedRawAttachmentRef.current[feedAttachmentRawKey(syntheticPost.id, "json")] = built.rawAttachments.json;
            setFeedPosts((prev) => {
              if (prev.some((row) => row.id === syntheticPost.id)) {
                return prev;
              }
              return [syntheticPost, ...prev];
            });
            fallbackPostId = syntheticPost.id;
            hasOpenablePost = true;
          }
        }
      }
      if (!hasOpenablePost && !fallbackPostId) {
        setError("해당 실행의 브리핑 문서를 찾지 못했습니다. 실행 완료 후 다시 시도해 주세요.");
        setStatus("브리핑 문서 없음");
        return;
      }
      setFeedCategory("all_posts");
      setFeedStatusFilter("all");
      setFeedExecutorFilter("all");
      setFeedPeriodFilter("all");
      setFeedTopicFilter("all");
      setFeedKeyword(resolvedRunId);
      setFeedFilterOpen(true);
      setFeedGroupExpandedByRunId((prev) => ({
        ...prev,
        [resolvedRunId]: true,
      }));
      if (fallbackPostId) {
        setFeedInspectorPostId(fallbackPostId);
        setFeedExpandedByPost((prev) => ({
          ...prev,
          [fallbackPostId]: true,
        }));
      }
      setWorkspaceTab("feed");
      setStatus(`피드에서 브리핑 문서를 여는 중: ${resolvedRunId}`);
      appendWorkspaceEvent({
        source: "intelligence",
        actor: "user",
        level: "info",
        runId: resolvedRunId,
        message: resolvedPostId ? `브리핑 문서 열기: ${resolvedPostId}` : "브리핑 전체 문서 열기",
      });
    },
    [
      appendWorkspaceEvent,
      cwd,
      dashboardSnapshotsByTopic,
      feedPosts,
      feedRawAttachmentRef,
      hasTauriRuntime,
      invokeFn,
      setError,
      setFeedCategory,
      setFeedExecutorFilter,
      setFeedExpandedByPost,
      setFeedFilterOpen,
      setFeedGroupExpandedByRunId,
      setFeedInspectorPostId,
      setFeedKeyword,
      setFeedPeriodFilter,
      setFeedPosts,
      setFeedStatusFilter,
      setFeedTopicFilter,
      setStatus,
      setWorkspaceTab,
      t,
    ],
  );
}
