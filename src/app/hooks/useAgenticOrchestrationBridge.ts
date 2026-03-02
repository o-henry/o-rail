import { useCallback, useEffect, type MutableRefObject } from "react";
import type { DashboardTopicId } from "../../features/dashboard/intelligence";
import type { AgenticAction, AgenticActionSubscriber } from "../../features/orchestration/agentic/actionBus";
import type { PresetKind } from "../../features/workflow/domain";
import type { WorkspaceTab } from "../mainAppGraphHelpers";
import { runGraphWithCoordinator, runRoleWithCoordinator, runTopicWithCoordinator } from "../main/runtime/agenticCoordinator";
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

function presetForRole(roleId: string): PresetKind {
  const normalized = String(roleId ?? "").toLowerCase();
  if (normalized.includes("qa")) {
    return "validation";
  }
  if (normalized.includes("build") || normalized.includes("release")) {
    return "fullstack";
  }
  if (normalized.includes("art")) {
    return "creative";
  }
  if (normalized.includes("planner") || normalized.includes("pm")) {
    return "research";
  }
  if (normalized.includes("tooling") || normalized.includes("system")) {
    return "expert";
  }
  return "development";
}

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
    [appendWorkspaceEvent, cwd, invokeFn, queue, refreshDashboardSnapshots, runDashboardTopic, workspaceTab],
  );

  const runRoleDirect = useCallback(
    async (params: { roleId: string; taskId: string; prompt?: string }) => {
      await runRoleWithCoordinator({
        cwd,
        sourceTab: "agents",
        roleId: params.roleId,
        taskId: params.taskId,
        prompt: params.prompt,
        queue,
        invokeFn,
        execute: async () => {
          if (params.prompt) {
            setStatus(`역할 요청: ${params.prompt.slice(0, 72)}`);
          }
          await runGraphWithAgenticCoordinator(false);
        },
        appendWorkspaceEvent,
      });
    },
    [appendWorkspaceEvent, cwd, invokeFn, queue, runGraphWithAgenticCoordinator, setStatus],
  );

  useEffect(() => {
    return subscribeAction((action) => {
      if (action.type === "run_topic") {
        const topic = action.payload.topic as DashboardTopicId;
        const normalizedSetId = String(action.payload.setId ?? "").trim() || `data-${topic}`;
        void runDashboardTopicDirect(
          topic,
          action.payload.followupInstruction,
          normalizedSetId,
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
      if (action.type === "open_handoff") {
        onSelectWorkspaceTab("handoff");
        const handoffId = String(action.payload?.handoffId ?? "").trim();
        if (handoffId) {
          setStatus(`핸드오프 열기: ${handoffId}`);
        }
        return;
      }
      if (action.type === "open_knowledge_doc") {
        onSelectWorkspaceTab("knowledge");
        setStatus(`지식 문서 열기: ${action.payload.entryId}`);
        return;
      }
      if (action.type === "inject_context_sources") {
        const count = Array.isArray(action.payload.sourceIds) ? action.payload.sourceIds.length : 0;
        setStatus(`컨텍스트 소스 주입 요청: ${count}건`);
        return;
      }
      if (action.type === "run_role") {
        onSelectWorkspaceTab("agents");
        setStatus(`역할 실행 요청: ${action.payload.roleId} (${action.payload.taskId})`);
        applyPreset(presetForRole(action.payload.roleId));
        void runRoleDirect(action.payload);
        return;
      }
      if (action.type === "request_handoff") {
        onSelectWorkspaceTab("handoff");
        setStatus(`핸드오프 요청: ${action.payload.handoffId}`);
        return;
      }
      if (action.type === "consume_handoff") {
        onSelectWorkspaceTab("agents");
        setStatus(`핸드오프 컨텍스트 적용: ${action.payload.handoffId}`);
        return;
      }
      if (action.type === "request_code_approval") {
        setStatus(`코드 변경 승인 요청: ${action.payload.approvalId}`);
        return;
      }
      if (action.type === "resolve_code_approval") {
        setStatus(`코드 변경 승인 처리: ${action.payload.approvalId} (${action.payload.decision})`);
        return;
      }
      if (action.type === "apply_template" && action.payload.presetKind) {
        applyPreset(action.payload.presetKind as PresetKind);
      }
    });
  }, [applyPreset, onSelectWorkspaceTab, runDashboardTopicDirect, runGraphWithAgenticCoordinator, runRoleDirect, setNodeSelection, setStatus, subscribeAction]);

  return {
    onRunGraph,
    runDashboardTopicDirect,
  };
}
