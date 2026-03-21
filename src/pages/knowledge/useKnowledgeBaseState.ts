import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mergeKnowledgeEntryRows,
  persistKnowledgeIndexToWorkspace,
  readKnowledgeEntries,
  removeKnowledgeEntriesByRunId,
  removeKnowledgeEntry,
  writeKnowledgeEntries,
} from "../../features/studio/knowledgeIndex";
import { hydrateKnowledgeEntriesFromWorkspaceSources } from "../../features/studio/workspaceKnowledgeHydration";
import type { KnowledgeEntry, KnowledgeSourcePost } from "../../features/studio/knowledgeTypes";
import { invoke, revealItemInDir } from "../../shared/tauri";
import {
  isHiddenKnowledgeEntry,
  isRuntimeNoiseKnowledgeEntry,
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
import { writeStoredSelectedRunId } from "../visualize/visualizeSelection";

type UseKnowledgeBaseStateParams = {
  cwd: string;
  isActive: boolean;
  posts: KnowledgeSourcePost[];
};

type DeleteFileFn = (path: string) => Promise<void>;

export type PendingKnowledgeGroupDelete = {
  runId: string;
  taskId: string;
};

export function buildKnowledgeGroupDeleteRequest(runId: string, taskId: string): PendingKnowledgeGroupDelete | null {
  const normalizedRunId = String(runId ?? "").trim();
  if (!normalizedRunId) {
    return null;
  }
  return {
    runId: normalizedRunId,
    taskId: String(taskId ?? "").trim(),
  };
}

export function shouldHydrateKnowledgeWorkspaceData(params: {
  cwd: string;
  hydratedWorkspaceCwd: string;
  isActive: boolean;
}): boolean {
  return params.isActive
    && Boolean(String(params.cwd ?? "").trim())
    && String(params.cwd) !== String(params.hydratedWorkspaceCwd ?? "");
}

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

function normalizeWorkspacePath(value: string): string {
  return String(value ?? "").trim().replace(/[\\/]+$/, "");
}

function resolveEntryWorkspaceCwd(entry: KnowledgeEntry | null, fallbackCwd: string): string {
  const preferred = normalizeWorkspacePath(String(entry?.workspacePath ?? ""));
  if (preferred) {
    return preferred;
  }
  const fromAbsolutePath = [entry?.markdownPath, entry?.jsonPath, entry?.sourceFile]
    .map((value) => String(value ?? "").trim())
    .find((value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
  if (!fromAbsolutePath) {
    return fallbackCwd;
  }
  const marker = `${String.raw`.rail`}${String.raw`/`}`;
  const index = fromAbsolutePath.indexOf(marker);
  if (index <= 0) {
    return fallbackCwd;
  }
  return normalizeWorkspacePath(fromAbsolutePath.slice(0, index));
}

function isEntryInWorkspace(entry: KnowledgeEntry, cwd: string): boolean {
  const root = normalizeWorkspacePath(cwd);
  if (!root) {
    return true;
  }
  const preferred = normalizeWorkspacePath(String(entry.workspacePath ?? ""));
  if (preferred) {
    return preferred === root;
  }
  const candidates = [entry.sourceFile, entry.markdownPath, entry.jsonPath]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (candidates.length === 0) {
    return true;
  }
  return candidates.some((value) => value.startsWith(root));
}

function toVisibleKnowledgeRows(rows: KnowledgeEntry[], cwd: string): KnowledgeEntry[] {
  return rows.filter((row) =>
    !isHiddenKnowledgeEntry(row)
    && !isRuntimeNoiseKnowledgeEntry(row)
    && isEntryInWorkspace(row, cwd),
  );
}

export function useKnowledgeBaseState({ cwd, isActive, posts }: UseKnowledgeBaseStateParams) {
  const [selectedId, setSelectedId] = useState("");
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() =>
    toVisibleKnowledgeRows(readKnowledgeEntries(), cwd),
  );
  const [loading, setLoading] = useState(false);
  const [hydratedWorkspaceCwd, setHydratedWorkspaceCwd] = useState("");
  const [collapsedByGroup, setCollapsedByGroup] = useState<Record<string, boolean>>({});
  const [markdownContent, setMarkdownContent] = useState("");
  const [jsonContent, setJsonContent] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [pendingGroupDelete, setPendingGroupDelete] = useState<PendingKnowledgeGroupDelete | null>(null);

  const postEntries = useMemo(
    () => posts.map((post) => toKnowledgeEntry(post)).filter((row): row is KnowledgeEntry => row !== null),
    [posts],
  );

  const mergePostEntries = useCallback((rows: KnowledgeEntry[]) => {
    const merged = mergeKnowledgeEntryRows([...rows, ...postEntries]);
    writeKnowledgeEntries(merged);
    return toVisibleKnowledgeRows(merged, cwd);
  }, [cwd, postEntries]);

  useEffect(() => {
    if (!isActive) {
      setLoading(false);
      return;
    }
    const initialRows = mergePostEntries(readKnowledgeEntries());
    setEntries(initialRows);
    if (!shouldHydrateKnowledgeWorkspaceData({ cwd, hydratedWorkspaceCwd, isActive })) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await hydrateKnowledgeEntriesFromWorkspaceSources({
          cwd,
          invokeFn: invoke,
          onUpdate: (rows) => {
            if (cancelled) {
              return;
            }
            const merged = mergePostEntries(rows);
            setEntries(merged);
            void persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows: merged });
          },
        });
        if (cancelled) {
          return;
        }
        const merged = mergePostEntries(next);
        setEntries(merged);
        await persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows: merged });
        setHydratedWorkspaceCwd(cwd);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, hydratedWorkspaceCwd, isActive, mergePostEntries]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    setEntries(mergePostEntries(readKnowledgeEntries()));
  }, [isActive, mergePostEntries]);

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
    if (typeof window === "undefined") {
      return;
    }
    writeStoredSelectedRunId(cwd, String(selected?.runId ?? "").trim());
    window.dispatchEvent(new CustomEvent("rail:knowledge-selection-changed", {
      detail: {
        entryId: String(selected?.id ?? "").trim(),
        runId: String(selected?.runId ?? "").trim(),
        roleId: String(selected?.roleId ?? "").trim(),
      },
    }));
  }, [selected?.id, selected?.roleId, selected?.runId]);

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
    if (!isActive) {
      return () => {
        cancelled = true;
      };
    }
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
      const readCwd = resolveEntryWorkspaceCwd(selected, cwd);
      try {
        if (selectedMarkdownPath) {
          try {
            const markdownText = await invoke<string>("workspace_read_text", {
              cwd: readCwd,
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
              cwd: readCwd,
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
  }, [isActive, selected?.id, selected?.jsonPath, selected?.markdownPath]);

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

  const executeDeleteGroup = (runId: string) => {
    const normalizedRunId = String(runId ?? "").trim();
    if (!normalizedRunId) {
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

  const onDeleteGroup = (runId: string, taskId: string) => {
    setPendingGroupDelete(buildKnowledgeGroupDeleteRequest(runId, taskId));
  };

  const onConfirmDeleteGroup = () => {
    if (!pendingGroupDelete) {
      return;
    }
    const current = pendingGroupDelete;
    setPendingGroupDelete(null);
    executeDeleteGroup(current.runId);
  };

  const onCancelDeleteGroup = () => {
    setPendingGroupDelete(null);
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
    loading,
    markdownContent,
    pendingGroupDelete,
    onCancelDeleteGroup,
    onConfirmDeleteGroup,
    onDeleteGroup,
    onDeleteSelected,
    onRevealPath,
    onToggleGroup,
    selected,
    selectedId,
    setSelectedId,
  };
}
