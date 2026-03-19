import { useEffect, useMemo, useState } from "react";
import {
  persistKnowledgeIndexToWorkspace,
  readKnowledgeEntries,
  removeKnowledgeEntriesByRunId,
  removeKnowledgeEntry,
  upsertKnowledgeEntry,
} from "../../features/studio/knowledgeIndex";
import type { KnowledgeEntry, KnowledgeSourcePost } from "../../features/studio/knowledgeTypes";
import { invoke, revealItemInDir } from "../../shared/tauri";
import {
  isHiddenKnowledgeEntry,
  toKnowledgeEntry,
  toReadableJsonInfo,
} from "./knowledgeEntryMapping";
import {
  buildKnowledgeEntryStats,
  groupKnowledgeEntries,
  shouldDeleteKnowledgeRunRecord,
  sortKnowledgeEntries,
  type KnowledgeGroup,
} from "./knowledgeBaseUtils";

type UseKnowledgeBaseStateParams = {
  cwd: string;
  posts: KnowledgeSourcePost[];
};

type DeleteFileFn = (path: string) => Promise<void>;

async function deleteIfExists(
  action: DeleteFileFn,
  target: string,
  failureLabel: string,
): Promise<string | null> {
  const normalized = String(target ?? "").trim();
  if (!normalized) {
    return null;
  }
  try {
    await action(normalized);
    return null;
  } catch (error) {
    const message = String(error ?? "").toLowerCase();
    if (message.includes("not found") || message.includes("enoent")) {
      return null;
    }
    return `${failureLabel}: ${String(error)}`;
  }
}

export function useKnowledgeBaseState({ cwd, posts }: UseKnowledgeBaseStateParams) {
  const [selectedId, setSelectedId] = useState("");
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() =>
    readKnowledgeEntries().filter((row) => !isHiddenKnowledgeEntry(row)),
  );
  const [collapsedByGroup, setCollapsedByGroup] = useState<Record<string, boolean>>({});
  const [markdownContent, setMarkdownContent] = useState("");
  const [jsonContent, setJsonContent] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    let next = readKnowledgeEntries().filter((row) => !isHiddenKnowledgeEntry(row));
    for (const post of posts) {
      const row = toKnowledgeEntry(post);
      if (!row) {
        continue;
      }
      next = upsertKnowledgeEntry(row).filter((entry) => !isHiddenKnowledgeEntry(entry));
    }
    setEntries(next);
    void persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows: next });
  }, [cwd, posts]);

  const filtered = useMemo(() => sortKnowledgeEntries(entries), [entries]);
  const grouped = useMemo<KnowledgeGroup[]>(() => groupKnowledgeEntries(filtered), [filtered]);
  const selected = filtered.find((row) => row.id === selectedId) ?? filtered[0] ?? null;
  const entryStats = useMemo(() => buildKnowledgeEntryStats(entries), [entries]);
  const jsonReadable = useMemo(() => toReadableJsonInfo(jsonContent), [jsonContent]);

  useEffect(() => {
    if (!selected && selectedId) {
      setSelectedId("");
    }
  }, [selected, selectedId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ entryId?: string }>).detail;
      const entryId = String(detail?.entryId ?? "").trim();
      if (!entryId) {
        return;
      }
      setSelectedId(entryId);
    };
    window.addEventListener("rail:open-knowledge-entry", handler as EventListener);
    return () => window.removeEventListener("rail:open-knowledge-entry", handler as EventListener);
  }, []);

  useEffect(() => {
    if (grouped.length === 0) {
      setCollapsedByGroup({});
      return;
    }
    setCollapsedByGroup((prev) => {
      const next: Record<string, boolean> = {};
      for (const group of grouped) {
        next[group.id] = prev[group.id] ?? false;
      }
      return next;
    });
  }, [grouped]);

  useEffect(() => {
    let cancelled = false;
    const selectedMarkdownPath = String(selected?.markdownPath ?? "").trim();
    const selectedJsonPath = String(selected?.jsonPath ?? "").trim();
    if (!selected || (!selectedMarkdownPath && !selectedJsonPath)) {
      setMarkdownContent("");
      setJsonContent("");
      setDetailError("");
      setDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setDetailLoading(true);
    setDetailError("");
    void (async () => {
      const errors: string[] = [];
      try {
        if (selectedMarkdownPath) {
          try {
            const markdownText = await invoke<string>("workspace_read_text", {
              cwd,
              path: selectedMarkdownPath,
            });
            if (cancelled) {
              return;
            }
            setMarkdownContent(String(markdownText ?? ""));
          } catch (error) {
            errors.push(`Markdown 읽기 실패: ${String(error)}`);
            setMarkdownContent("");
          }
        } else {
          setMarkdownContent("");
        }

        if (selectedJsonPath) {
          try {
            const jsonText = await invoke<string>("workspace_read_text", {
              cwd,
              path: selectedJsonPath,
            });
            if (cancelled) {
              return;
            }
            setJsonContent(String(jsonText ?? ""));
          } catch (error) {
            errors.push(`JSON 읽기 실패: ${String(error)}`);
            setJsonContent("");
          }
        } else {
          setJsonContent("");
        }

        if (errors.length > 0) {
          setDetailError(errors.join(" / "));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.jsonPath, selected?.markdownPath]);

  const persistRows = (rows: KnowledgeEntry[]) => {
    setEntries(rows);
    void persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows });
  };

  const onDeleteSelected = () => {
    if (!selected) {
      return;
    }
    void (async () => {
      const deleteErrors: string[] = [];
      const sourceFile = String(selected.sourceFile ?? "").trim();
      if (shouldDeleteKnowledgeRunRecord(sourceFile)) {
        const error = await deleteIfExists(
          async (name) => invoke("run_delete", { name }),
          sourceFile,
          "실행 파일 삭제 실패",
        );
        if (error) {
          deleteErrors.push(error);
        }
      } else if (sourceFile.includes("/") || sourceFile.includes("\\")) {
        const error = await deleteIfExists(
          async (path) => invoke("workspace_delete_file", { cwd, path }),
          sourceFile,
          "원본 실행 파일 삭제 실패",
        );
        if (error) {
          deleteErrors.push(error);
        }
      }

      for (const filePath of [String(selected.markdownPath ?? "").trim(), String(selected.jsonPath ?? "").trim()]) {
        const error = await deleteIfExists(
          async (path) => invoke("workspace_delete_file", { cwd, path }),
          filePath,
          "산출물 삭제 실패",
        );
        if (error) {
          deleteErrors.push(error);
        }
      }

      const next = removeKnowledgeEntry(selected.id);
      persistRows(next);
      setSelectedId("");
      if (deleteErrors.length > 0) {
        setDetailError(deleteErrors.join(" / "));
      }
    })();
  };

  const onDeleteGroup = (runId: string, taskId: string) => {
    const normalizedRunId = String(runId ?? "").trim();
    if (!normalizedRunId) {
      return;
    }
    const shouldDelete = window.confirm(`'${taskId} · ${normalizedRunId}' 그룹을 삭제할까요?`);
    if (!shouldDelete) {
      return;
    }
    void (async () => {
      const targetGroup = grouped.find((group) => String(group.runId ?? "").trim() === normalizedRunId) ?? null;
      const targetEntries = Array.isArray(targetGroup?.entries) ? targetGroup.entries : [];
      const deleteErrors: string[] = [];

      const sourceFiles = Array.from(
        new Set(
          targetEntries
            .map((row) => String(row.sourceFile ?? "").trim())
            .filter((row) => row.length > 0),
        ),
      );
      for (const sourceFile of sourceFiles) {
        if (shouldDeleteKnowledgeRunRecord(sourceFile)) {
          const error = await deleteIfExists(
            async (name) => invoke("run_delete", { name }),
            sourceFile,
            "실행 파일 삭제 실패",
          );
          if (error) {
            deleteErrors.push(error);
          }
          continue;
        }
        if (sourceFile.includes("/") || sourceFile.includes("\\")) {
            const error = await deleteIfExists(
              async (path) => invoke("workspace_delete_file", { cwd, path }),
              sourceFile,
              "원본 실행 파일 삭제 실패",
            );
          if (error) {
            deleteErrors.push(error);
          }
        }
      }

      const artifactPaths = Array.from(
        new Set(
          targetEntries
            .flatMap((row) => [String(row.markdownPath ?? "").trim(), String(row.jsonPath ?? "").trim()])
            .filter((row) => row.length > 0),
        ),
      );
      for (const filePath of artifactPaths) {
        const error = await deleteIfExists(
          async (path) => invoke("workspace_delete_file", { cwd, path }),
          filePath,
          "산출물 삭제 실패",
        );
        if (error) {
          deleteErrors.push(error);
        }
      }

      const next = removeKnowledgeEntriesByRunId(normalizedRunId);
      persistRows(next);
      if (selected && String(selected.runId ?? "").trim() === normalizedRunId) {
        setSelectedId("");
      }
      if (deleteErrors.length > 0) {
        setDetailError(deleteErrors.join(" / "));
      }
    })();
  };

  const onRevealPath = async (path: string) => {
    const normalized = String(path ?? "").trim();
    if (!normalized) {
      return;
    }
    try {
      await revealItemInDir(normalized);
    } catch (error) {
      setDetailError(`Finder 열기 실패: ${String(error)}`);
    }
  };

  const onToggleGroup = (groupId: string) => {
    setCollapsedByGroup((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  return {
    collapsedByGroup,
    detailError,
    detailLoading,
    entryStats,
    filtered,
    grouped,
    jsonContent,
    jsonReadable,
    markdownContent,
    onDeleteGroup,
    onDeleteSelected,
    onRevealPath,
    onToggleGroup,
    selected,
    selectedId,
    setSelectedId,
  };
}
