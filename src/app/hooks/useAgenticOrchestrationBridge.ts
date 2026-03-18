import { useCallback, useEffect, type MutableRefObject } from "react";
import type { DashboardTopicId } from "../../features/dashboard/intelligence";
import type { AgenticAction, AgenticActionSubscriber } from "../../features/orchestration/agentic/actionBus";
import type { AgenticRunEnvelope } from "../../features/orchestration/agentic/runContract";
import { toStudioRoleId } from "../../features/studio/roleUtils";
import type { PresetKind } from "../../features/workflow/domain";
import type { WorkspaceTab } from "../mainAppGraphHelpers";
import { runGraphWithCoordinator, runTopicWithCoordinator } from "../main/runtime/agenticCoordinator";
import { runRoleWithCoordinator } from "../main/runtime/agenticRoleCoordinator";
import type { AgenticQueue } from "../main/runtime/agenticQueue";
import {
  bootstrapRoleKnowledgeProfile,
  injectRoleKnowledgePrompt,
  storeRoleKnowledgeProfile,
} from "../main/runtime/roleKnowledgePipeline";

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

function sanitizeToken(raw: string): string {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "role";
}

function toRoleShortToken(rawRoleId: string): string {
  const roleId = String(rawRoleId ?? "").trim();
  if (roleId === "pm_planner") {
    return "pm";
  }
  if (roleId === "pm_creative_director") {
    return "pm_idea";
  }
  if (roleId === "pm_feasibility_critic") {
    return "pm_critic";
  }
  if (roleId === "client_programmer") {
    return "client";
  }
  if (roleId === "system_programmer") {
    return "system";
  }
  if (roleId === "tooling_engineer") {
    return "tooling";
  }
  if (roleId === "art_pipeline") {
    return "art";
  }
  if (roleId === "qa_engineer") {
    return "qa";
  }
  if (roleId === "build_release") {
    return "release";
  }
  if (roleId === "technical_writer") {
    return "docs";
  }
  return sanitizeToken(roleId);
}

function toCompactTimestamp(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function buildRoleArtifactJson(params: {
  runId: string;
  roleId: string;
  taskId: string;
  prompt?: string;
  artifactPaths: string[];
}): string {
  return `${JSON.stringify(
    {
      runId: String(params.runId ?? "").trim(),
      roleId: String(params.roleId ?? "").trim(),
      taskId: String(params.taskId ?? "").trim(),
      createdAt: new Date().toISOString(),
      prompt: String(params.prompt ?? "").trim(),
      artifactPaths: params.artifactPaths,
    },
    null,
    2,
  )}\n`;
}

export function useAgenticOrchestrationBridge(params: {
  cwd: string;
  selectedGraphFileName?: string;
  graphFileName: string;
  queue: AgenticQueue;
  invokeFn: InvokeFn;
  appendWorkspaceEvent: AppendWorkspaceEvent;
  triggerBatchByUserEvent: () => void;
  runGraphCore: (skipWebConnectPreflight?: boolean, questionOverride?: string) => Promise<void>;
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
  onRoleRunCompleted?: (payload: {
    runId: string;
    roleId: string;
    taskId: string;
    prompt?: string;
    handoffToRole?: string;
    handoffRequest?: string;
    sourceTab: "agents" | "workflow" | "workbench" | "tasks" | "tasks-thread";
    artifactPaths: string[];
    runStatus: "done" | "error";
    envelope?: AgenticRunEnvelope;
  }) => void;
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
    onRoleRunCompleted,
  } = params;

  const runGraphWithAgenticCoordinator = useCallback(
    async (skipWebConnectPreflight = false, questionOverride?: string) => {
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
            await runGraphCore(skipWebConnectPreflight, questionOverride);
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
    async (params: {
      runId?: string;
      roleId: string;
      taskId: string;
      prompt?: string;
      sourceTab?: "agents" | "workflow" | "workbench" | "tasks" | "tasks-thread";
      handoffToRole?: string;
      handoffRequest?: string;
    }) => {
      const sourceTab =
        params.sourceTab === "workflow"
          ? "workflow"
          : params.sourceTab === "workbench"
            ? "workbench"
            : params.sourceTab === "tasks"
              ? "tasks"
              : params.sourceTab === "tasks-thread"
                ? "tasks-thread"
                : "agents";
      const normalizedRoleId = toStudioRoleId(params.roleId);
      const result = await runRoleWithCoordinator({
        runId: params.runId,
        cwd,
        sourceTab,
        roleId: params.roleId,
        taskId: params.taskId,
        prompt: params.prompt,
        queue,
        invokeFn,
        execute: async ({ prompt }) => {
          const promptText = String(prompt ?? "").trim();
          if (promptText) {
            setStatus(`역할 요청: ${promptText.slice(0, 72)}`);
          }
          await runGraphWithAgenticCoordinator(false, promptText || undefined);
        },
        appendWorkspaceEvent,
        roleKnowledgePipeline: normalizedRoleId
          ? {
              bootstrap: async ({ runId, taskId, prompt }) => {
                const bootstrapped = await bootstrapRoleKnowledgeProfile({
                  cwd,
                  invokeFn,
                  runId,
                  roleId: normalizedRoleId,
                  taskId,
                  userPrompt: prompt,
                });
                return {
                  message: bootstrapped.message,
                  artifactPaths: bootstrapped.artifactPaths,
                  payload: { profile: bootstrapped.profile },
                };
              },
              store: async ({ bootstrap }) => {
                const fromBootstrap = bootstrap?.payload?.profile as Parameters<typeof storeRoleKnowledgeProfile>[0]["profile"] | undefined;
                if (!fromBootstrap) {
                  return null;
                }
                const stored = await storeRoleKnowledgeProfile({
                  cwd,
                  invokeFn,
                  profile: fromBootstrap,
                });
                return {
                  message: stored.message,
                  artifactPaths: stored.artifactPaths,
                  payload: { profile: stored.profile },
                };
              },
              inject: async ({ prompt, store }) => {
                const profile = (store?.payload?.profile ?? null) as Parameters<typeof injectRoleKnowledgePrompt>[0]["profile"];
                const injected = await injectRoleKnowledgePrompt({
                  roleId: normalizedRoleId,
                  prompt,
                  profile: profile ?? null,
                });
                return {
                  prompt: injected.prompt,
                  message: injected.message,
                  payload: { usedProfile: injected.usedProfile },
                };
              },
            }
          : undefined,
      });
      const baseArtifactPaths = result.envelope.artifacts.map((row) => String(row.path ?? "").trim()).filter(Boolean);
      let roleSummaryArtifactPath = "";
      try {
        const artifactDir = `${String(cwd ?? "").trim().replace(/[\\/]+$/, "")}/.rail/studio_runs/${result.runId}/artifacts`;
        const roleToken = toRoleShortToken(params.roleId);
        const fileName = `${toCompactTimestamp()}_${roleToken}.json`;
        roleSummaryArtifactPath = await invokeFn<string>("workspace_write_text", {
          cwd: artifactDir,
          name: fileName,
          content: buildRoleArtifactJson({
            runId: result.runId,
            roleId: params.roleId,
            taskId: params.taskId,
            prompt: params.prompt,
            artifactPaths: baseArtifactPaths,
          }),
        });
      } catch {
        roleSummaryArtifactPath = "";
      }
      const artifactPaths = [
        roleSummaryArtifactPath,
        ...baseArtifactPaths,
        `.rail/studio_runs/${result.runId}/run.json`,
      ];
      const dedupedArtifactPaths = [...new Set(artifactPaths.map((row) => String(row ?? "").trim()).filter(Boolean))];
      onRoleRunCompleted?.({
        runId: result.runId,
        roleId: params.roleId,
        taskId: params.taskId,
        prompt: params.prompt,
        handoffToRole: params.handoffToRole,
        handoffRequest: params.handoffRequest,
        sourceTab,
        artifactPaths: dedupedArtifactPaths,
        runStatus: result.envelope.record.status === "done" ? "done" : "error",
        envelope: result.envelope,
      });
    },
    [appendWorkspaceEvent, cwd, invokeFn, onRoleRunCompleted, queue, runGraphWithAgenticCoordinator, setStatus],
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
        onSelectWorkspaceTab("workflow");
        setStatus(`run 열기: ${action.payload.runId}`);
        return;
      }
      if (action.type === "open_handoff") {
        onSelectWorkspaceTab("workflow");
        const handoffId = String(action.payload?.handoffId ?? "").trim();
        if (handoffId) {
          setStatus(`그래프 핸드오프 열기: ${handoffId}`);
        }
        return;
      }
      if (action.type === "open_knowledge_doc") {
        onSelectWorkspaceTab("knowledge");
        setStatus(`데이터베이스 문서 열기: ${action.payload.entryId}`);
        return;
      }
      if (action.type === "inject_context_sources") {
        const count = Array.isArray(action.payload.sourceIds) ? action.payload.sourceIds.length : 0;
        setStatus(`컨텍스트 소스 주입 요청: ${count}건`);
        return;
      }
      if (action.type === "run_role") {
        const sourceTab =
          action.payload.sourceTab === "workflow"
            ? "workflow"
            : action.payload.sourceTab === "workbench"
              ? "workbench"
              : action.payload.sourceTab === "tasks"
                ? "tasks"
                : action.payload.sourceTab === "tasks-thread"
                  ? "tasks-thread"
                  : "agents";
        if (sourceTab === "workflow" && workspaceTab !== "workflow") {
          onSelectWorkspaceTab("workflow");
        }
        if ((sourceTab === "tasks" || sourceTab === "tasks-thread") && workspaceTab !== "tasks") {
          onSelectWorkspaceTab("tasks");
        }
        setStatus(
          sourceTab === "workflow"
            ? `그래프 역할 실행 요청: ${action.payload.roleId} (${action.payload.taskId})`
            : sourceTab === "workbench"
              ? `워크스페이스 역할 실행 요청: ${action.payload.roleId} (${action.payload.taskId})`
              : sourceTab === "tasks"
                ? `TASK 역할 실행 요청: ${action.payload.roleId} (${action.payload.taskId})`
                : sourceTab === "tasks-thread"
                  ? `THREAD 역할 실행 요청: ${action.payload.roleId} (${action.payload.taskId})`
                  : `역할 실행 요청: ${action.payload.roleId} (${action.payload.taskId})`,
        );
        if (sourceTab === "agents" || sourceTab === "workbench" || sourceTab === "tasks" || sourceTab === "tasks-thread") {
          applyPreset(presetForRole(action.payload.roleId));
        }
        void runRoleDirect({ ...action.payload, sourceTab });
        return;
      }
      if (action.type === "handoff_create" || action.type === "request_handoff") {
        onSelectWorkspaceTab("workflow");
        setStatus(`그래프 핸드오프 요청: ${action.payload.handoffId}`);
        return;
      }
      if (action.type === "handoff_consume" || action.type === "consume_handoff") {
        onSelectWorkspaceTab("workflow");
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
  }, [applyPreset, onSelectWorkspaceTab, runDashboardTopicDirect, runGraphWithAgenticCoordinator, runRoleDirect, setNodeSelection, setStatus, subscribeAction, workspaceTab]);

  return {
    onRunGraph,
    runDashboardTopicDirect,
  };
}
