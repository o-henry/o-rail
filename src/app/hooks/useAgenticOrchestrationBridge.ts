import { useCallback, useEffect, type MutableRefObject } from "react";
import type { DashboardTopicId } from "../../features/dashboard/intelligence";
import type { AgenticAction, AgenticActionSubscriber } from "../../features/orchestration/agentic/actionBus";
import type { PresetKind } from "../../features/workflow/domain";
import type { WorkspaceTab } from "../mainAppGraphHelpers";
import { runGraphWithCoordinator, runTopicWithCoordinator } from "../main/runtime/agenticCoordinator";
import type { AgenticQueue } from "../main/runtime/agenticQueue";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type AppendWorkspaceEvent = (params: {
  source: string;
  message: string;
  actor?: "user" | "ai" | "system";
  level?: "info" | "error";
  runId?: string;
  topic?: string;
}) => void;

type RunDashboardTopic = (
  topic: DashboardTopicId,
  followupInstruction?: string,
  options?: {
    runId?: string;
    onProgress?: (stage: string, message: string) => void;
  },
) => Promise<unknown>;

export function useAgenticOrchestrationBridge(params: {
  cwd: string;
  selectedGraphFileName?: string;
  graphFileName: string;
  queue: AgenticQueue;
  invokeFn: InvokeFn;
  appendWorkspaceEvent: AppendWorkspaceEvent;
  triggerBatchByUserEvent: () => void;
  runGraphCore: (skipWebConnectPreflight?: boolean) => Promise<void>;
  graphRunOverrideIdRef: MutableRefObject<string | null>;
  publishAction: (action: AgenticAction) => void;
  subscribeAction: (handler: AgenticActionSubscriber) => () => void;
  loginCompleted: boolean;
  setError: (message: string) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  workspaceTab: WorkspaceTab;
  runDashboardTopic: RunDashboardTopic;
  refreshDashboardSnapshots: () => Promise<void>;
  onSelectWorkspaceTab: (tab: WorkspaceTab) => void;
  setNodeSelection: (nodeIds: string[], selectedNodeId?: string) => void;
  setStatus: (message: string) => void;
  applyPreset: (presetKind: PresetKind) => void;
}) {
  const {
    cwd,
    selectedGraphFileName,
    graphFileName,
    queue,
    invokeFn,
    appendWorkspaceEvent,
    triggerBatchByUserEvent,
    runGraphCore,
    graphRunOverrideIdRef,
    publishAction,
    subscribeAction,
    loginCompleted,
    setError,
    setWorkspaceTab,
    workspaceTab,
    runDashboardTopic,
    refreshDashboardSnapshots,
    onSelectWorkspaceTab,
    setNodeSelection,
    setStatus,
    applyPreset,
  } = params;

  const runGraphWithAgenticCoordinator = useCallback(
    async (skipWebConnectPreflight = false) => {
      await runGraphWithCoordinator({
        cwd,
        sourceTab: "workflow",
        graphId: selectedGraphFileName || graphFileName || "default",
        queue,
        invokeFn,
        execute: async ({ runId }) => {
          graphRunOverrideIdRef.current = runId;
          try {
            triggerBatchByUserEvent();
            await runGraphCore(skipWebConnectPreflight);
          } finally {
            graphRunOverrideIdRef.current = null;
          }
        },
        appendWorkspaceEvent,
      });
    },
    [appendWorkspaceEvent, cwd, graphFileName, graphRunOverrideIdRef, invokeFn, queue, runGraphCore, selectedGraphFileName, triggerBatchByUserEvent],
  );

  const onRunGraph = useCallback(
    async (skipWebConnectPreflight = false) => {
      if (skipWebConnectPreflight) {
        await runGraphWithAgenticCoordinator(true);
        return;
      }
      publishAction({
        type: "run_graph",
        payload: {
          graphId: selectedGraphFileName || graphFileName || "default",
        },
      });
    },
    [graphFileName, publishAction, runGraphWithAgenticCoordinator, selectedGraphFileName],
  );

  const runDashboardTopicDirect = useCallback(
    async (topic: DashboardTopicId, followupInstruction?: string, setId?: string) => {
      if (!loginCompleted) {
        setError("Codex 로그인이 필요합니다. 설정에서 먼저 로그인해 주세요.");
        setWorkspaceTab("settings");
        return;
      }
      await runTopicWithCoordinator({
        cwd,
        topic,
        sourceTab: workspaceTab === "workflow" ? "workflow" : "agents",
        followupInstruction,
        setId,
        queue,
        invokeFn,
        execute: async ({ runId, onProgress }) => {
          const result = await runDashboardTopic(topic, followupInstruction, {
            runId,
            onProgress,
          });
          await refreshDashboardSnapshots();
          if (!result) {
            throw new Error("토픽 스냅샷 생성 실패");
          }
          return result as { snapshotPath?: string; rawPaths?: string[]; warnings?: string[] } | null;
        },
        appendWorkspaceEvent,
      });
    },
    [appendWorkspaceEvent, cwd, invokeFn, loginCompleted, queue, refreshDashboardSnapshots, runDashboardTopic, setError, setWorkspaceTab, workspaceTab],
  );

  useEffect(() => {
    return subscribeAction((action) => {
      if (action.type === "run_topic") {
        void runDashboardTopicDirect(
          action.payload.topic as DashboardTopicId,
          action.payload.followupInstruction,
          action.payload.setId,
        );
        return;
      }
      if (action.type === "run_graph") {
        void runGraphWithAgenticCoordinator(false);
        return;
      }
      if (action.type === "open_graph") {
        onSelectWorkspaceTab("workflow");
        const focusNodeId = String(action.payload?.focusNodeId ?? "").trim();
        if (focusNodeId) {
          setNodeSelection([focusNodeId], focusNodeId);
        }
        return;
      }
      if (action.type === "focus_node") {
        onSelectWorkspaceTab("workflow");
        const nodeId = String(action.payload.nodeId ?? "").trim();
        if (nodeId) {
          setNodeSelection([nodeId], nodeId);
        }
        return;
      }
      if (action.type === "open_run") {
        onSelectWorkspaceTab("dashboard");
        setStatus(`run 열기: ${action.payload.runId}`);
        return;
      }
      if (action.type === "apply_template" && action.payload.presetKind) {
        applyPreset(action.payload.presetKind as PresetKind);
      }
    });
  }, [applyPreset, onSelectWorkspaceTab, runDashboardTopicDirect, runGraphWithAgenticCoordinator, setNodeSelection, setStatus, subscribeAction]);

  return {
    onRunGraph,
    runDashboardTopicDirect,
  };
}
