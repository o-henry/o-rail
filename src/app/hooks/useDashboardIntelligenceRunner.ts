import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import {
  type DashboardAgentConfigMap,
  type DashboardTopicId,
  type DashboardTopicSnapshot,
  DASHBOARD_TOPIC_IDS,
  buildDashboardFallbackSnapshot,
} from "../../features/dashboard/intelligence";
import {
  loadDashboardSnapshots,
  runDashboardCrawlerOnly,
  runDashboardTopicIntelligence,
  type RunDashboardTopicResult,
} from "../main/runtime/dashboardIntelligenceRunner";
import type { DashboardTopicRunState } from "../../features/dashboard/intelligence";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type UseDashboardIntelligenceRunnerParams = {
  cwd: string;
  hasTauriRuntime: boolean;
  config: DashboardAgentConfigMap;
  setRunStateByTopic: Dispatch<SetStateAction<Record<DashboardTopicId, DashboardTopicRunState>>>;
  invokeFn: InvokeFn;
  setStatus: (message: string) => void;
  setError: (message: string) => void;
};

function updateRunState(
  setRunStateByTopic: Dispatch<SetStateAction<Record<DashboardTopicId, DashboardTopicRunState>>>,
  topic: DashboardTopicId,
  patch: Partial<DashboardTopicRunState>,
) {
  setRunStateByTopic((prev) => ({
    ...prev,
    [topic]: {
      ...prev[topic],
      ...patch,
    },
  }));
}

export function useDashboardIntelligenceRunner(params: UseDashboardIntelligenceRunnerParams) {
  const { cwd, hasTauriRuntime, config, setRunStateByTopic, invokeFn, setStatus, setError } = params;
  const [snapshotsByTopic, setSnapshotsByTopic] = useState<Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>>(
    {},
  );

  const refreshSnapshots = useCallback(async () => {
    if (!hasTauriRuntime) {
      return;
    }
    if (!String(cwd ?? "").trim()) {
      return;
    }
    try {
      const loaded = await loadDashboardSnapshots({
        cwd,
        invokeFn,
      });
      setSnapshotsByTopic(loaded);
    } catch (error) {
      setError(`대시보드 스냅샷 로드 실패: ${String(error)}`);
    }
  }, [cwd, hasTauriRuntime, invokeFn, setError]);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  const runTopic = useCallback(
    async (
      topic: DashboardTopicId,
      followupInstruction?: string,
      options?: {
        runId?: string;
        onProgress?: (stage: string, message: string) => void;
      },
    ): Promise<RunDashboardTopicResult | null> => {
      const topicConfig = config[topic];
      if (!hasTauriRuntime) {
        setError("Dashboard Intelligence는 Tauri 런타임에서만 실행할 수 있습니다.");
        return null;
      }
      updateRunState(setRunStateByTopic, topic, {
        running: true,
        lastError: undefined,
        progressStage: "init",
        progressText: "실행 준비 중",
      });
      try {
        const result = await runDashboardTopicIntelligence({
          cwd,
          topic,
          config: topicConfig,
          runId: options?.runId,
          invokeFn,
          previousSnapshot: snapshotsByTopic[topic],
          followupInstruction,
          onProgress: (stage, message) => {
            updateRunState(setRunStateByTopic, topic, {
              progressStage: stage,
              progressText: message,
            });
            setStatus(`Dashboard Intelligence(${topic}): ${message}`);
            options?.onProgress?.(stage, message);
          },
        });
        setSnapshotsByTopic((prev) => ({
          ...prev,
          [topic]: result.snapshot,
        }));
        updateRunState(setRunStateByTopic, topic, {
          running: false,
          lastRunAt: result.snapshot.generatedAt,
          lastError: undefined,
          progressStage: "done",
          progressText: "완료",
        });
        setStatus(`Dashboard Intelligence 완료: ${topic}`);
        return result;
      } catch (error) {
        updateRunState(setRunStateByTopic, topic, {
          running: false,
          lastRunAt: new Date().toISOString(),
          lastError: String(error),
          progressStage: "error",
          progressText: `실패: ${String(error)}`,
        });
        setError(`Dashboard Intelligence 실행 실패(${topic}): ${String(error)}`);
        return null;
      }
    },
    [config, cwd, hasTauriRuntime, invokeFn, setError, setRunStateByTopic, setStatus, snapshotsByTopic],
  );

  const runAll = useCallback(async () => {
    for (const topic of DASHBOARD_TOPIC_IDS) {
      // Sequential execution reduces engine contention and keeps logs readable.
      // eslint-disable-next-line no-await-in-loop
      await runTopic(topic);
    }
  }, [runTopic]);

  const runCrawlerOnly = useCallback(async (topics?: DashboardTopicId[]) => {
    if (!hasTauriRuntime) {
      setError("크롤러 실행은 Tauri 런타임에서만 가능합니다.");
      return;
    }
    const selected = Array.isArray(topics) && topics.length > 0 ? topics : [...DASHBOARD_TOPIC_IDS];
    for (const topic of selected) {
      updateRunState(setRunStateByTopic, topic, {
        running: true,
        lastError: undefined,
        progressStage: "crawler",
        progressText: "크롤러 실행 중",
      });
    }
    try {
      const result = await runDashboardCrawlerOnly({
        cwd,
        configByTopic: config,
        topics: selected,
        invokeFn,
      });
      const now = result.finishedAt || new Date().toISOString();
      const nextSnapshots: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>> = {};
      for (const topic of selected) {
        const topicResult = result.topics.find((row) => row.topic === topic);
        const fetchedCount = topicResult?.fetchedCount ?? 0;
        const savedCount = topicResult?.savedFiles?.length ?? 0;
        const errors = topicResult?.errors ?? [];
        const snapshot = {
          ...buildDashboardFallbackSnapshot(topic, config[topic].model, {
            summary: `크롤링 수집 ${fetchedCount}건 / 저장 파일 ${savedCount}개`,
            highlights: (topicResult?.savedFiles ?? []).slice(0, 5).map((path) => path.split(/[\\/]/).pop() || path),
            risks: errors.slice(0, 4),
            status: errors.length > 0 ? "degraded" : "ok",
            statusMessage: errors.length > 0 ? errors.join(" | ") : "Crawler-only snapshot",
            referenceEmpty: true,
          }),
          generatedAt: now,
        };
        nextSnapshots[topic] = snapshot;
        await invokeFn<string>("dashboard_snapshot_save", {
          cwd,
          topic,
          snapshotJson: snapshot,
        });
      }
      setSnapshotsByTopic((prev) => ({
        ...prev,
        ...nextSnapshots,
      }));
      for (const topic of selected) {
        updateRunState(setRunStateByTopic, topic, {
          running: false,
          lastRunAt: now,
          lastError: undefined,
          progressStage: "done",
          progressText: "크롤러 완료",
        });
      }
      setStatus(`Dashboard 크롤러 완료 (${result.totalFetched} sources)`);
    } catch (error) {
      for (const topic of selected) {
        updateRunState(setRunStateByTopic, topic, {
          running: false,
          lastRunAt: new Date().toISOString(),
          lastError: String(error),
          progressStage: "error",
          progressText: `실패: ${String(error)}`,
        });
      }
      setError(`Dashboard 크롤러 실행 실패: ${String(error)}`);
    }
  }, [config, cwd, hasTauriRuntime, invokeFn, setError, setRunStateByTopic, setStatus]);

  const runCrawlerOnlyForEnabledTopics = useCallback(async () => {
    await runCrawlerOnly();
  }, [runCrawlerOnly]);

  return {
    snapshotsByTopic,
    setSnapshotsByTopic,
    refreshSnapshots,
    runTopic,
    runAll,
    runCrawlerOnly,
    runCrawlerOnlyForEnabledTopics,
  };
}
