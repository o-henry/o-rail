import { useCallback } from "react";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import { STUDIO_ROLE_PROMPTS, toStudioRoleId } from "../../../features/studio/roleUtils";
import { persistKnowledgeIndexToWorkspace, readKnowledgeEntries, upsertKnowledgeEntry } from "../../../features/studio/knowledgeIndex";
import { extractKnowledgeRequestSummary } from "../../../features/studio/knowledgeRequestSummary";
import { resolveTaskAgentMetadata } from "../../../features/studio/taskAgentMetadata";

type Params = {
  cwd: string;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  missionControl: { onRoleRunCompleted: (payload: any) => void };
  setWorkflowRoleRuntimeStateByRole: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  workflowHandoffPanel: { createAutoHandoff: (input: any) => void };
};

export function shouldForwardRoleRunToMissionControl(sourceTab: unknown): boolean {
  const normalized = String(sourceTab ?? "").trim();
  return normalized === "agents" || normalized === "workflow" || normalized === "workbench";
}

export function buildKnowledgeEntriesFromRoleRunCompletion(params: {
  cwd: string;
  payload: {
    roleId?: string;
    runId?: string;
    taskId?: string;
    prompt?: string;
    requestPrompt?: string;
    handoffRequest?: string;
    artifactPaths?: unknown[];
    internal?: boolean;
  };
}) {
  const hasWebAiResponseArtifacts = [...new Set((params.payload.artifactPaths ?? []).map((row: unknown) => String(row ?? "").trim()).filter(Boolean))]
    .some((artifactPath) => {
      const fileName = artifactPath.split(/[\\/]/).filter(Boolean).pop() ?? artifactPath;
      return (
        fileName === "shared_web_perspective.md"
        || (fileName.startsWith("web_") && fileName.endsWith("_response.md"))
      );
    });
  const roleId = toStudioRoleId(String(params.payload.roleId ?? ""));
  const normalizedTaskId = String(params.payload.taskId ?? "").trim() || "TASK-001";
  const knowledgeRoleId: StudioRoleId = roleId ?? "technical_writer";
  const roleLabel = roleId
    ? STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label ?? params.payload.roleId
    : params.payload.roleId;
  const taskAgentMetadata = resolveTaskAgentMetadata(String(params.payload.roleId ?? ""), Boolean(params.payload.internal));
  const requestPrompt = String(params.payload.requestPrompt ?? "").trim();
  const promptSummary = String(params.payload.prompt ?? params.payload.handoffRequest ?? "").trim();
  const requestSummary = extractKnowledgeRequestSummary(requestPrompt || promptSummary) || requestPrompt || promptSummary;
  const dedupedArtifactPaths = [
    ...new Set((params.payload.artifactPaths ?? []).map((row: unknown) => String(row ?? "").trim()).filter(Boolean)),
  ];
  return dedupedArtifactPaths.map((artifactPath, index) => {
    const fileName = artifactPath.split(/[\\/]/).filter(Boolean).pop() ?? artifactPath;
    const sourceKind =
      fileName === "shared_web_perspective.md"
      || (fileName.startsWith("web_") && fileName.endsWith("_response.md"))
      || (fileName === "response.json" && hasWebAiResponseArtifacts)
        ? "ai"
        : "artifact";
    return {
      id: `${params.payload.runId}:${index}:${fileName}`,
      runId: String(params.payload.runId ?? "").trim(),
      taskId: normalizedTaskId,
      roleId: knowledgeRoleId,
      workspacePath: params.cwd,
      taskAgentId: taskAgentMetadata.taskAgentId,
      taskAgentLabel: taskAgentMetadata.taskAgentLabel,
      studioRoleLabel: taskAgentMetadata.studioRoleLabel,
      orchestratorAgentId: taskAgentMetadata.orchestratorAgentId,
      orchestratorAgentLabel: taskAgentMetadata.orchestratorAgentLabel,
      sourceKind: sourceKind as "artifact" | "ai",
      title: `${roleLabel} · ${normalizedTaskId} · ${fileName}`,
      requestLabel: requestSummary || undefined,
      summary: requestSummary || `${roleLabel} 역할 실행 산출물`,
      createdAt: new Date().toISOString(),
      markdownPath: /\.(md|markdown)$/i.test(artifactPath) ? artifactPath : undefined,
      jsonPath: /\.json$/i.test(artifactPath) ? artifactPath : undefined,
    };
  });
}

export function useRoleRunCompletionBridge(params: Params) {
  const { cwd, invokeFn, missionControl, setWorkflowRoleRuntimeStateByRole, workflowHandoffPanel } = params;

  return useCallback((payload: any) => {
    if (shouldForwardRoleRunToMissionControl(payload.sourceTab)) {
      missionControl.onRoleRunCompleted(payload);
    }
    const roleId = toStudioRoleId(payload.roleId);
    if (roleId) {
      setWorkflowRoleRuntimeStateByRole((prev) => ({
        ...prev,
        [roleId]: {
          status: payload.runStatus === "done" ? "DONE" : "VERIFY",
          taskId: payload.taskId,
          runId: payload.runId,
          message: payload.runStatus === "done" ? "RUN_DONE" : "RUN_ERROR",
        },
      }));
    }
    for (const entry of buildKnowledgeEntriesFromRoleRunCompletion({ cwd, payload })) {
      upsertKnowledgeEntry(entry);
    }
    void persistKnowledgeIndexToWorkspace({
      cwd,
      invokeFn,
      rows: readKnowledgeEntries(),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("rail:knowledge-index-updated", {
        detail: {
          cwd,
          runId: payload.runId,
        },
      }));
    }
    const targetRole = toStudioRoleId(payload.handoffToRole ?? "");
    const requestText =
      String(payload.handoffRequest ?? payload.prompt ?? "").trim() ||
      (roleId ? STUDIO_ROLE_PROMPTS[roleId] : "");
    if (payload.sourceTab === "tasks") {
      void invokeFn("task_record_role_result", {
        cwd,
        taskId: payload.taskId,
        studioRoleId: payload.roleId,
        runId: payload.runId,
        runStatus: payload.runStatus,
        artifactPaths: Array.isArray(payload.artifactPaths) ? payload.artifactPaths : [],
      })
        .then((updated) => {
          if (updated) {
            window.dispatchEvent(new CustomEvent("rail:task-updated", { detail: { taskId: payload.taskId } }));
          }
        })
        .catch(() => {});
    }
    if (payload.sourceTab === "tasks-thread") {
      void invokeFn("thread_record_role_result", {
        cwd,
        threadId: payload.taskId,
        studioRoleId: payload.roleId,
        runId: payload.runId,
        runStatus: payload.runStatus,
        artifactPaths: Array.isArray(payload.artifactPaths) ? payload.artifactPaths : [],
        summary: payload.summary ?? payload.envelope?.record?.summary ?? null,
        internal: Boolean(payload.internal),
        promptMode: payload.promptMode ?? null,
        intent: payload.intent ?? null,
      })
        .then((updated) => {
          if (updated) {
            window.dispatchEvent(new CustomEvent("rail:thread-updated", { detail: { threadId: payload.taskId } }));
          }
        })
        .catch(() => {});
    }
    if (payload.runStatus === "done" && payload.sourceTab === "workflow" && roleId && targetRole && requestText) {
      workflowHandoffPanel.createAutoHandoff({
        runId: payload.runId,
        fromRole: roleId,
        toRole: targetRole,
        taskId: payload.taskId,
        request: requestText,
        artifactPaths: payload.artifactPaths,
      });
    }
  }, [cwd, invokeFn, missionControl, setWorkflowRoleRuntimeStateByRole, workflowHandoffPanel]);
}
