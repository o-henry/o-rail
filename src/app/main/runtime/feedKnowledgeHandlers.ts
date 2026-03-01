import { openUrl, revealItemInDir } from "../../../shared/tauri";
import type { KnowledgeFileRef } from "../../../features/workflow/types";
import type { FeedViewPost, RunRecord } from "../types";

export function createFeedKnowledgeHandlers(params: any) {
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
      for (const row of loaded) {
        if (!row) {
          continue;
        }
        nextCache[row.file] = row.run;
        const runQuestion = row.run.question;
        const posts = row.run.feedPosts ?? [];
        for (const post of posts) {
          mergedPosts.push({
            ...post,
            sourceFile: row.file,
            question: runQuestion,
          });
        }
      }
      const transientPosts = (Array.isArray(params.feedPosts) ? params.feedPosts : []).filter((post: FeedViewPost) =>
        isTransientDashboardPost(post),
      );
      const mergedById = new Map<string, FeedViewPost>();
      for (const post of mergedPosts) {
        mergedById.set(post.id, post);
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
    const filePath = String(markdownAttachment?.filePath ?? "").trim();
    if (!filePath) {
      params.setError("문서 파일 경로를 찾지 못했습니다.");
      return;
    }
    try {
      const normalizedUrl =
        filePath.startsWith("file://") ? filePath : `file://${encodeURI(filePath).replace(/#/g, "%23")}`;
      await openUrl(normalizedUrl);
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
