import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "../../shared/tauri";
import { buildFeedShareText } from "../main";
import { hideFeedRunId } from "../main/runtime/feedHiddenRuns";
import type { FeedViewPost, RunGroupKind, RunRecord } from "../main";
import type { PresetKind } from "../../features/workflow/domain";

type ActiveFeedRunMeta = {
  runId: string;
  question: string;
  startedAt: string;
  groupName: string;
  groupKind: RunGroupKind;
  presetKind?: PresetKind;
} | null;

type UseFeedRunActionsParams = {
  cwd: string;
  setError: (value: string) => void;
  setStatus: (value: string) => void;
  setFeedShareMenuPostId: Dispatch<SetStateAction<string | null>>;
  setFeedPosts: Dispatch<SetStateAction<FeedViewPost[]>>;
  setFeedInspectorPostId: Dispatch<SetStateAction<string>>;
  setFeedGroupExpandedByRunId: Dispatch<SetStateAction<Record<string, boolean>>>;
  feedGroupRenameRunId: string | null;
  setFeedGroupRenameRunId: Dispatch<SetStateAction<string | null>>;
  feedGroupRenameDraft: string;
  setFeedGroupRenameDraft: Dispatch<SetStateAction<string>>;
  activeFeedRunMeta: ActiveFeedRunMeta;
  setActiveFeedRunMeta: Dispatch<SetStateAction<ActiveFeedRunMeta>>;
  feedRunCacheRef: MutableRefObject<Record<string, RunRecord>>;
  ensureFeedRunRecord: (sourceFile: string) => Promise<RunRecord | null>;
  persistRunRecordFile: (name: string, runRecord: RunRecord) => Promise<void>;
};

export function useFeedRunActions(params: UseFeedRunActionsParams) {
  const {
    cwd,
    setError,
    setStatus,
    setFeedShareMenuPostId,
    setFeedPosts,
    setFeedInspectorPostId,
    setFeedGroupExpandedByRunId,
    feedGroupRenameRunId,
    setFeedGroupRenameRunId,
    feedGroupRenameDraft,
    setFeedGroupRenameDraft,
    activeFeedRunMeta,
    setActiveFeedRunMeta,
    feedRunCacheRef,
    ensureFeedRunRecord,
    persistRunRecordFile,
  } = params;

  const onShareFeedPost = useCallback(
    async (post: FeedViewPost, mode: "clipboard" | "json") => {
      setError("");
      setFeedShareMenuPostId(null);
      const run = await ensureFeedRunRecord(post.sourceFile);
      const shareText = buildFeedShareText(post, run);
      try {
        if (mode === "clipboard") {
          await navigator.clipboard.writeText(shareText);
          setStatus("공유 텍스트 복사 완료");
          return;
        }
        if (mode === "json") {
          const payload = {
            post,
            runId: run?.runId ?? null,
            sourceFile: post.sourceFile || null,
            exportedAt: new Date().toISOString(),
          };
          await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
          setStatus("공유 JSON 복사 완료");
          return;
        }
      } catch (e) {
        setError(`공유 실패: ${String(e)}`);
      }
    },
    [ensureFeedRunRecord, setError, setFeedShareMenuPostId, setStatus],
  );

  const onDeleteFeedRunGroup = useCallback(
    async (runId: string, sourceFile: string, groupName: string) => {
      setError("");
      setFeedShareMenuPostId(null);
      const target = String(sourceFile ?? "").trim();

      const resolveErrorMessage = (error: unknown): string => {
        if (error instanceof Error) {
          return error.message;
        }
        if (typeof error === "string") {
          return error;
        }
        if (error && typeof error === "object") {
          const row = error as Record<string, unknown>;
          const candidate = [row.message, row.error, row.details].find(
            (value) => typeof value === "string" && String(value).trim().length > 0,
          );
          if (typeof candidate === "string") {
            return candidate;
          }
        }
        return String(error ?? "");
      };

      const dropRunGroupFromFeed = () => {
        hideFeedRunId(runId);
        if (target) {
          delete feedRunCacheRef.current[target];
        }
        setFeedPosts((prev) => prev.filter((item) => String(item.runId ?? "").trim() !== runId));
        setFeedInspectorPostId("");
        setFeedGroupExpandedByRunId((prev) => {
          const next = { ...prev };
          delete next[runId];
          return next;
        });
        if (feedGroupRenameRunId === runId) {
          setFeedGroupRenameRunId(null);
          setFeedGroupRenameDraft("");
        }
      };

      const shouldSkipRunDelete =
        !target ||
        target.startsWith("dashboard-") ||
        target.includes("/.rail/dashboard/") ||
        target.includes("\\.rail\\dashboard\\");
      const normalizedCwd = String(cwd ?? "").trim();
      const isDashboardSnapshotTarget =
        target.includes("/.rail/dashboard/snapshots/") || target.includes("\\.rail\\dashboard\\snapshots\\");

      if (shouldSkipRunDelete) {
        if (normalizedCwd) {
          try {
            await invoke("dashboard_snapshot_delete", {
              cwd: normalizedCwd,
              runId: String(runId ?? "").trim() || null,
              path: isDashboardSnapshotTarget ? target : null,
            });
          } catch {
            // Ignore snapshot delete errors here; feed state cleanup still proceeds.
          }
        }
        dropRunGroupFromFeed();
        setStatus(`피드 세트 삭제 완료: ${groupName}`);
        return;
      }

      const existingRun = await ensureFeedRunRecord(target);
      if (!existingRun) {
        dropRunGroupFromFeed();
        setStatus(`피드 세트 정리 완료: ${groupName}`);
        return;
      }

      try {
        await invoke("run_delete", { name: target });
        dropRunGroupFromFeed();
        setStatus(`피드 세트 삭제 완료: ${groupName}`);
      } catch (error) {
        const message = resolveErrorMessage(error);
        const lower = message.toLowerCase();
        if (lower.includes("not found") || lower.includes("enoent")) {
          dropRunGroupFromFeed();
          setStatus(`피드 세트 정리 완료: ${groupName}`);
          return;
        }
        setError(`피드 세트 삭제 실패: ${message}`);
      }
    },
    [
      cwd,
      feedGroupRenameRunId,
      ensureFeedRunRecord,
      feedRunCacheRef,
      setError,
      setFeedGroupExpandedByRunId,
      setFeedGroupRenameDraft,
      setFeedGroupRenameRunId,
      setFeedInspectorPostId,
      setFeedPosts,
      setFeedShareMenuPostId,
      setStatus,
    ],
  );

  const onSubmitFeedRunGroupRename = useCallback(
    async (runId: string, sourceFile: string) => {
      const trimmed = feedGroupRenameDraft.trim();
      if (!trimmed) {
        setError("세트 이름을 입력하세요.");
        return;
      }
      const target = sourceFile.trim();
      if (!target) {
        setError("세트 원본 실행 파일을 찾을 수 없습니다.");
        return;
      }
      setError("");
      try {
        const run = await ensureFeedRunRecord(target);
        if (!run) {
          throw new Error("실행 기록을 불러오지 못했습니다.");
        }
        const nextRun: RunRecord = {
          ...run,
          workflowGroupName: trimmed,
          workflowGroupKind: "custom",
        };
        await persistRunRecordFile(target, nextRun);
        feedRunCacheRef.current[target] = nextRun;
        if (activeFeedRunMeta?.runId === runId) {
          setActiveFeedRunMeta((prev) => {
            if (!prev || prev.runId !== runId) {
              return prev;
            }
            return {
              ...prev,
              groupName: trimmed,
              groupKind: "custom",
              presetKind: undefined,
            };
          });
        }
        setFeedPosts((prev) => [...prev]);
        setFeedGroupRenameRunId(null);
        setFeedGroupRenameDraft("");
        setStatus(`피드 세트 이름 변경 완료: ${trimmed}`);
      } catch (error) {
        setError(`피드 세트 이름 변경 실패: ${String(error)}`);
      }
    },
    [
      activeFeedRunMeta?.runId,
      ensureFeedRunRecord,
      feedGroupRenameDraft,
      feedRunCacheRef,
      persistRunRecordFile,
      setActiveFeedRunMeta,
      setError,
      setFeedGroupRenameDraft,
      setFeedGroupRenameRunId,
      setFeedPosts,
      setStatus,
    ],
  );

  return {
    onShareFeedPost,
    onDeleteFeedRunGroup,
    onSubmitFeedRunGroupRename,
  };
}
