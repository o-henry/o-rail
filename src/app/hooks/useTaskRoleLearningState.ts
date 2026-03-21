import { useCallback, useEffect, useState } from "react";
import {
  loadTaskRoleLearningData,
  readTaskRoleLearningData,
  summarizeTaskRoleLearningByRole,
  type TaskRoleLearningData,
} from "../adaptation/taskRoleLearning";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type UseTaskRoleLearningStateParams = {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
};

export function useTaskRoleLearningState(params: UseTaskRoleLearningStateParams) {
  const [data, setData] = useState<TaskRoleLearningData>(() => readTaskRoleLearningData(params.cwd));
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadTaskRoleLearningData(
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
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd?: string }>).detail;
      const nextCwd = String(detail?.cwd ?? "").trim();
      if (!nextCwd || nextCwd === String(params.cwd ?? "").trim()) {
        void refresh();
      }
    };
    window.addEventListener("rail:task-learning-updated", handler as EventListener);
    return () => window.removeEventListener("rail:task-learning-updated", handler as EventListener);
  }, [params.cwd, refresh]);

  return {
    data,
    loading,
    refresh,
    roleSummaries: summarizeTaskRoleLearningByRole(params.cwd),
  };
}
