import { openPath, revealItemInDir } from "../../../shared/tauri";
import type { KnowledgeFileRef } from "../../../features/workflow/types";
import { isFeedRunIdHidden, readHiddenFeedRunIds } from "./feedHiddenRuns";
import type { FeedViewPost, RunRecord } from "../types";

export function createFeedKnowledgeHandlers(params: any) {
  function toDashboardFeedStatus(rawStatus: unknown): "done" | "low_quality" {
    return String(rawStatus ?? "").trim().toLowerCase() === "degraded" ? "low_quality" : "done";
  }

  function toDashboardTopicTitle(topic: string): string {
    const normalized = String(topic ?? "").trim();
    if (!normalized) {
      return "대시보드";
    }
    const key = `dashboard.widget.${normalized}.title`;
    const translated = typeof params.t === "function" ? String(params.t(key) ?? "").trim() : "";
    if (!translated || translated === key) {
      return normalized.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    }
    return translated;
  }

  async function loadDashboardFailedRunPosts(existingPostIds: Set<string>): Promise<FeedViewPost[]> {
    const normalizedCwd = String(params.cwd ?? "").trim();
    if (!normalizedCwd || typeof params.buildFeedPostFn !== "function") {
      return [];
    }
    let rows: unknown[] = [];
    try {
      rows = (await params.invokeFn("dashboard_agentic_run_list", { cwd: normalizedCwd, limit: 300 })) as unknown[];
    } catch {
      return [];
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }
    const posts: FeedViewPost[] = [];
    for (const item of rows) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const row = item as Record<string, unknown>;
      const status = String(row.status ?? "").trim().toLowerCase();
      const topic = String(row.topic ?? "").trim();
      const runId = String(row.runId ?? "").trim();
      if (status !== "error" || !topic || !runId) {
        continue;
      }
      if (isFeedRunIdHidden(runId)) {
        continue;
      }
      const nodeId = `dashboard-${topic}`;
      const postId = `${runId}:${nodeId}:failed`;
      if (existingPostIds.has(postId)) {
        continue;
      }
      const topicTitle = toDashboardTopicTitle(topic);
      const errorStage = String(row.errorStage ?? "").trim();
      const errorMessage = String(row.errorMessage ?? "").trim() || "실행 중 오류가 발생했습니다.";
      const built = params.buildFeedPostFn({
        runId,
        node: {
          id: nodeId,
          type: "turn",
          config: {
            executor: "codex",
            model: "gpt-5.2-codex",
            role: "DASHBOARD BRIEFING",
          },
        },
        isFinalDocument: false,
        status: "failed",
        createdAt: String(row.updatedAt ?? "").trim() || new Date().toISOString(),
        topic,
        topicLabel: topicTitle,
        groupName: topicTitle,
        agentName: topicTitle,
        roleLabel: "DASHBOARD BRIEFING",
        summary: `실행 실패: ${errorMessage}`,
        logs: [
          `${topicTitle} 파이프라인 실행 실패`,
          ...(errorStage ? [`실패 단계: ${errorStage}`] : []),
          errorMessage,
        ],
        output: {
          runId,
          topic,
          status: "failed",
          errorStage,
          errorMessage,
        },
        error: errorMessage,
      });
      posts.push({
        ...built.post,
        id: postId,
        sourceFile: `agentic-run-${runId}.json`,
        question: `${topicTitle} 데이터 파이프라인 실행 결과`,
      });
      existingPostIds.add(postId);
    }
    return posts;
  }

  async function loadDashboardSnapshotPosts(): Promise<FeedViewPost[]> {
    const normalizedCwd = String(params.cwd ?? "").trim();
    if (!normalizedCwd || typeof params.buildFeedPostFn !== "function") {
      return [];
    }
    let rows: unknown[] = [];
    try {
      rows = (await params.invokeFn("dashboard_snapshot_list", { cwd: normalizedCwd })) as unknown[];
    } catch {
      return [];
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const posts: FeedViewPost[] = [];
    for (const item of rows) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const row = item as Record<string, unknown>;
      const topic = String(row.topic ?? "").trim();
      const runId = String(row.runId ?? "").trim();
      if (!topic || !runId) {
        continue;
      }
      if (isFeedRunIdHidden(runId)) {
        continue;
      }
      const model = String(row.model ?? "").trim() || "gpt-5.2-codex";
      const createdAt = String(row.generatedAt ?? "").trim() || new Date().toISOString();
      const topicTitle = toDashboardTopicTitle(topic);
      const summary = String(row.summary ?? "").trim() || `${topicTitle} 브리핑 생성`;
      const highlights = Array.isArray(row.highlights)
        ? row.highlights.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 8)
        : [];
      const risks = Array.isArray(row.risks)
        ? row.risks.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 4)
        : [];
      const status = toDashboardFeedStatus(row.status);
      const nodeId = `dashboard-${topic}`;
      const postId = `${runId}:${nodeId}:${status}`;

      const built = params.buildFeedPostFn({
        runId,
        node: {
          id: nodeId,
          type: "turn",
          config: {
            executor: "codex",
            model,
            role: "DASHBOARD BRIEFING",
          },
        },
        isFinalDocument: true,
        status,
        createdAt,
        topic,
        topicLabel: topicTitle,
        groupName: topicTitle,
        agentName: topicTitle,
        roleLabel: `${model.toUpperCase()} · DASHBOARD BRIEFING`,
        summary,
        logs: [`${topicTitle} 브리핑 생성`, ...highlights, ...risks.map((risk) => `리스크: ${risk}`)],
        output: row,
      });
      const sourcePath = String(row.path ?? "").trim();
      posts.push({
        ...built.post,
        id: postId,
        sourceFile: sourcePath || `dashboard-${topic}-${runId}.json`,
        question: `${topicTitle} 데이터 파이프라인 실행 결과`,
      });
    }
    return posts;
  }

  function isTransientDashboardPost(post: FeedViewPost): boolean {
    const sourceFile = String(post?.sourceFile ?? "").trim().toLowerCase();
    if (sourceFile.startsWith("dashboard-")) {
      return true;
    }
    const postId = String(post?.id ?? "").trim().toLowerCase();
    return postId.includes(":dashboard-");
  }

  async function refreshGraphFiles() {
    if (!params.hasTauriRuntime) {
      params.setGraphFiles([]);
      return;
    }
    try {
      const files = (await params.invokeFn("graph_list")) as string[];
      params.setGraphFiles(files);
    } catch (e) {
      params.setError(String(e));
    }
  }

  async function refreshFeedTimeline() {
    if (!params.hasTauriRuntime) {
      params.setFeedPosts([]);
      params.setFeedLoading(false);
      return;
    }
    params.setFeedLoading(true);
    try {
      const files = (await params.invokeFn("run_list")) as string[];
      const sorted = [...files].sort((a, b) => b.localeCompare(a)).slice(0, 120);
      const loaded = await Promise.all(
        sorted.map(async (file) => {
          try {
            const rawRun = (await params.invokeFn("run_load", { name: file })) as RunRecord;
            return { file, run: params.normalizeRunRecordFn(rawRun) };
          } catch {
            return null;
          }
        }),
      );
      const nextCache: Record<string, RunRecord> = {};
      const mergedPosts: FeedViewPost[] = [];
      const hiddenRunIds = readHiddenFeedRunIds();
      for (const row of loaded) {
        if (!row) {
          continue;
        }
        nextCache[row.file] = row.run;
        const runQuestion = row.run.question;
        const normalizedRunId = String(row.run.runId ?? "").trim();
        if (normalizedRunId && hiddenRunIds.has(normalizedRunId)) {
          continue;
        }
        const posts = row.run.feedPosts ?? [];
        for (const post of posts) {
          mergedPosts.push({
            ...post,
            sourceFile: row.file,
            question: runQuestion,
          });
        }
      }
      const snapshotPosts = await loadDashboardSnapshotPosts();
      const transientPosts: FeedViewPost[] = (
        Array.isArray(params.feedPosts) ? (params.feedPosts as FeedViewPost[]) : []
      ).filter((post) => isTransientDashboardPost(post));
      const existingIds = new Set<string>([
        ...mergedPosts.map((post) => post.id),
        ...snapshotPosts.map((post) => post.id),
        ...transientPosts.map((post) => post.id),
      ]);
      const failedDashboardPosts = await loadDashboardFailedRunPosts(existingIds);
      const mergedById = new Map<string, FeedViewPost>();
      for (const post of mergedPosts) {
        mergedById.set(post.id, post);
      }
      for (const post of snapshotPosts) {
        if (!mergedById.has(post.id)) {
          mergedById.set(post.id, post);
        }
      }
      for (const post of failedDashboardPosts) {
        if (!mergedById.has(post.id)) {
          mergedById.set(post.id, post);
        }
      }
      for (const post of transientPosts) {
        if (!mergedById.has(post.id)) {
          mergedById.set(post.id, post);
        }
      }
      const nextPosts = [...mergedById.values()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      params.feedRunCacheRef.current = nextCache;
      params.setFeedPosts(nextPosts);
    } catch (e) {
      params.setError(`피드 로드 실패: ${String(e)}`);
    } finally {
      params.setFeedLoading(false);
    }
  }

  async function onOpenRunsFolder() {
    params.setError("");
    try {
      const runsDir = (await params.invokeFn("run_directory")) as string;
      await revealItemInDir(runsDir);
      params.setStatus("실행 기록 폴더 열림");
    } catch (e) {
      params.setError(params.toOpenRunsFolderErrorMessage(e));
    }
  }

  async function onOpenFeedMarkdownFile(post: FeedViewPost) {
    params.setError("");
    const attachments = Array.isArray(post.attachments) ? post.attachments : [];
    const markdownAttachment = attachments.find((attachment) => attachment.kind === "markdown");
    let filePath = String(markdownAttachment?.filePath ?? "").trim();
    let materializedFilePath = "";
    if (!filePath) {
      const markdownRawKey = String(
        post?.rawAttachmentRef?.markdownKey ??
          params.feedAttachmentRawKeyFn?.(String(post?.id ?? "").trim(), "markdown") ??
          "",
      ).trim();
      const rawMarkdown =
        markdownRawKey && params.feedRawAttachmentRef?.current
          ? String(params.feedRawAttachmentRef.current[markdownRawKey] ?? "").trim()
          : "";
      const fallbackMarkdown = rawMarkdown || String(markdownAttachment?.content ?? "").trim();
      const normalizedCwd = String(params.cwd ?? "").trim();
      if (!fallbackMarkdown || !normalizedCwd || !params.hasTauriRuntime) {
        params.setError("문서 파일 경로를 찾지 못했습니다.");
        return;
      }
      const normalizedRunId = String(post?.runId ?? "").trim() || "feed";
      const normalizedPostId =
        String(post?.id ?? "post")
          .trim()
          .replace(/[^a-zA-Z0-9._-]+/g, "_")
          .slice(0, 64) || "post";
      try {
        const runDir = `${normalizedCwd.replace(/[\\/]+$/, "")}/.rail/runs/${normalizedRunId}`;
        filePath = await params.invokeFn("workspace_write_text", {
          cwd: runDir,
          name: `feed_${normalizedPostId}.md`,
          content: fallbackMarkdown,
        });
        materializedFilePath = String(filePath ?? "").trim();
      } catch (error) {
        params.setError(`문서 파일 생성 실패: ${String(error)}`);
        return;
      }
    }
    if (materializedFilePath) {
      params.setFeedPosts((prev: FeedViewPost[]) =>
        (Array.isArray(prev) ? prev : []).map((row) => {
          if (row.id !== post.id) {
            return row;
          }
          const attachments = Array.isArray(row.attachments) ? row.attachments : [];
          const nextAttachments = attachments.map((attachment) =>
            attachment.kind === "markdown" ? { ...attachment, filePath: materializedFilePath } : attachment,
          );
          return { ...row, attachments: nextAttachments };
        }),
      );
    }
    try {
      await openPath(filePath);
      params.setStatus("문서 파일 열림");
    } catch (error) {
      try {
        await revealItemInDir(filePath);
        params.setStatus("문서 파일 위치 열림");
      } catch {
        params.setError(`문서 파일 열기 실패: ${String(error)}`);
      }
    }
  }

  async function ensureFeedRunRecord(sourceFile: string): Promise<RunRecord | null> {
    return params.ensureFeedRunRecordFromCacheFn({
      sourceFile,
      feedRunCacheRef: params.feedRunCacheRef,
      invokeFn: params.invokeFn,
      normalizeRunRecordFn: params.normalizeRunRecordFn,
    });
  }

  async function onSubmitFeedAgentRequest(post: FeedViewPost) {
    await params.submitFeedAgentRequestAction({
      post,
      graphNodes: params.graph.nodes,
      isGraphRunning: params.isGraphRunning,
      workflowQuestion: params.workflowQuestion,
      cwd: params.cwd,
      nodeStates: params.nodeStates,
      feedReplyDraftByPost: params.feedReplyDraftByPost,
      feedReplySubmittingByPost: params.feedReplySubmittingByPost,
      feedRunCacheRef: params.feedRunCacheRef,
      feedRawAttachmentRef: params.feedRawAttachmentRef,
      feedReplyFeedbackClearTimerRef: params.feedReplyFeedbackClearTimerRef,
      setFeedReplySubmittingByPost: params.setFeedReplySubmittingByPost,
      setFeedReplyFeedbackByPost: params.setFeedReplyFeedbackByPost,
      setFeedReplyDraftByPost: params.setFeedReplyDraftByPost,
      setFeedPosts: params.setFeedPosts,
      setError: params.setError,
      setStatus: params.setStatus,
      setNodeStatus: params.setNodeStatus,
      setNodeRuntimeFields: params.setNodeRuntimeFields,
      addNodeLog: params.addNodeLog,
      enqueueNodeRequest: params.enqueueNodeRequest,
      persistRunRecordFile: params.persistRunRecordFile,
      invokeFn: params.invokeFn,
      executeTurnNode: params.executeTurnNode,
      validateSimpleSchemaFn: params.validateSimpleSchemaFn,
      turnOutputSchemaEnabled: params.turnOutputSchemaEnabled,
      turnOutputSchemaMaxRetry: params.turnOutputSchemaMaxRetry,
      graphSchemaVersion: params.graphSchemaVersion,
      defaultKnowledgeConfig: params.defaultKnowledgeConfig,
      buildFeedPostFn: params.buildFeedPostFn,
      feedAttachmentRawKeyFn: params.feedAttachmentRawKeyFn,
      exportRunFeedMarkdownFilesFn: params.exportRunFeedMarkdownFilesFn,
      normalizeRunRecordFn: params.normalizeRunRecordFn,
      cancelFeedReplyFeedbackClearTimerFn: params.cancelFeedReplyFeedbackClearTimerFn,
      scheduleFeedReplyFeedbackAutoClearFn: params.scheduleFeedReplyFeedbackAutoClearFn,
      turnModelLabelFn: params.turnModelLabelFn,
      t: params.t,
    });
  }

  async function attachKnowledgeFiles(paths: string[]) {
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    if (uniquePaths.length === 0) {
      params.setError("선택한 파일 경로를 읽지 못했습니다. 다시 선택해주세요.");
      return;
    }

    params.setError("");
    try {
      const probed = (await params.invokeFn("knowledge_probe", { paths: uniquePaths })) as KnowledgeFileRef[];
      params.applyGraphChange((prev: any) => {
        const existingByPath = new Map(
          (prev.knowledge?.files ?? []).map((row: any) => [row.path, row] as const),
        );
        for (const row of probed) {
          const existing = existingByPath.get(row.path) as any;
          existingByPath.set(row.path, {
            ...row,
            enabled: existing ? existing.enabled : row.enabled,
          });
        }
        return {
          ...prev,
          knowledge: {
            ...(prev.knowledge ?? params.defaultKnowledgeConfig()),
            files: Array.from(existingByPath.values()),
          },
        };
      });
      params.setStatus(`첨부 자료 ${uniquePaths.length}개 추가됨`);
    } catch (error) {
      params.setError(`첨부 자료 추가 실패: ${String(error)}`);
    }
  }

  async function onOpenKnowledgeFilePicker() {
    try {
      const selectedPaths = (await params.invokeFn("dialog_pick_knowledge_files")) as string[];
      if (selectedPaths.length === 0) {
        return;
      }
      await attachKnowledgeFiles(selectedPaths);
    } catch (error) {
      params.setError(`첨부 파일 선택 실패: ${String(error)}`);
    }
  }

  function onRemoveKnowledgeFile(fileId: string) {
    params.applyGraphChange((prev: any) => ({
      ...prev,
      knowledge: {
        ...(prev.knowledge ?? params.defaultKnowledgeConfig()),
        files: (prev.knowledge?.files ?? []).filter((row: any) => row.id !== fileId),
      },
    }));
  }

  function onToggleKnowledgeFileEnabled(fileId: string) {
    params.applyGraphChange((prev: any) => ({
      ...prev,
      knowledge: {
        ...(prev.knowledge ?? params.defaultKnowledgeConfig()),
        files: (prev.knowledge?.files ?? []).map((row: any) =>
          row.id === fileId ? { ...row, enabled: !row.enabled } : row,
        ),
      },
    }));
  }

  return {
    refreshGraphFiles,
    refreshFeedTimeline,
    onOpenRunsFolder,
    onOpenFeedMarkdownFile,
    ensureFeedRunRecord,
    onSubmitFeedAgentRequest,
    attachKnowledgeFiles,
    onOpenKnowledgeFilePicker,
    onRemoveKnowledgeFile,
    onToggleKnowledgeFileEnabled,
  };
}
