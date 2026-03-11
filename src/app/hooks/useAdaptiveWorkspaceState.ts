import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createEmptyAdaptiveWorkspaceData,
  loadAdaptiveWorkspaceData,
  saveAdaptiveWorkspaceData,
  writeAdaptiveWorkspaceDataToCache,
} from "../adaptation/storage";
import type { AdaptiveChampionRecord, AdaptiveLearningState, AdaptiveWorkspaceData } from "../adaptation/types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type UseAdaptiveWorkspaceStateParams = {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
};

export function useAdaptiveWorkspaceState(params: UseAdaptiveWorkspaceStateParams) {
  const [data, setData] = useState<AdaptiveWorkspaceData>(() => createEmptyAdaptiveWorkspaceData(params.cwd));
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadAdaptiveWorkspaceData(
        params.cwd,
        params.hasTauriRuntime ? params.invokeFn : undefined,
      );
      setData(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [params.cwd, params.hasTauriRuntime, params.invokeFn]);

  useEffect(() => {
    setData(createEmptyAdaptiveWorkspaceData(params.cwd));
    void refresh();
  }, [params.cwd, refresh]);

  const persist = useCallback(
    async (next: AdaptiveWorkspaceData) => {
      writeAdaptiveWorkspaceDataToCache(params.cwd, next);
      setData(next);
      if (!params.hasTauriRuntime || !params.cwd.trim()) {
        return next;
      }
      const saved = await saveAdaptiveWorkspaceData(params.cwd, params.invokeFn, next);
      setData(saved);
      return saved;
    },
    [params.cwd, params.hasTauriRuntime, params.invokeFn],
  );

  const setLearningState = useCallback(
    async (learningState: AdaptiveLearningState) => {
      const next: AdaptiveWorkspaceData = {
        ...data,
        profile: {
          ...data.profile,
          learningState,
          updatedAt: new Date().toISOString(),
        },
      };
      return persist(next);
    },
    [data, persist],
  );

  const resetWorkspaceLearning = useCallback(async () => {
    const next = createEmptyAdaptiveWorkspaceData(params.cwd);
    return persist(next);
  }, [params.cwd, persist]);

  const updateFromRuntime = useCallback(
    (next: AdaptiveWorkspaceData) => {
      writeAdaptiveWorkspaceDataToCache(params.cwd, next);
      setData(next);
    },
    [params.cwd],
  );

  const championByFamily = useMemo(
    () =>
      new Map<string, AdaptiveChampionRecord>(
        data.champions.map((row) => [row.family, row]),
      ),
    [data.champions],
  );

  return {
    data,
    loading,
    refresh,
    setLearningState,
    resetWorkspaceLearning,
    updateFromRuntime,
    championByFamily,
  };
}
