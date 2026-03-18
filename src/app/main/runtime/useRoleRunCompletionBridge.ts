import { useCallback } from "react";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import { STUDIO_ROLE_PROMPTS, toStudioRoleId } from "../../../features/studio/roleUtils";
import { persistKnowledgeIndexToWorkspace, readKnowledgeEntries, upsertKnowledgeEntry } from "../../../features/studio/knowledgeIndex";

type Params = {
  cwd: string;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  missionControl: { onRoleRunCompleted: (payload: any) => void };
  setWorkflowRoleRuntimeStateByRole: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  workflowHandoffPanel: { createAutoHandoff: (input: any) => void };
};

export function useRoleRunCompletionBridge(params: Params) {
  const { cwd, invokeFn, missionControl, setWorkflowRoleRuntimeStateByRole, workflowHandoffPanel } = params;

  return useCallback((payload: any) => {
    missionControl.onRoleRunCompleted(payload);
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
    const normalizedTaskId = String(payload.taskId ?? "").trim() || "TASK-001";
    const knowledgeRoleId: StudioRoleId = roleId ?? "technical_writer";
    const roleLabel = roleId
      ? STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId)?.label ?? payload.roleId
      : payload.roleId;
    const promptSummary = String(payload.prompt ?? payload.handoffRequest ?? "").trim();
    const dedupedArtifactPaths = [
      ...new Set(payload.artifactPaths.map((row: unknown) => String(row ?? "").trim()).filter(Boolean)),
    ] as string[];
    for (const [index, artifactPath] of dedupedArtifactPaths.entries()) {
      const fileName = artifactPath.split(/[\\/]/).filter(Boolean).pop() ?? artifactPath;
      upsertKnowledgeEntry({
        id: `${payload.runId}:${index}:${fileName}`,
        runId: payload.runId,
        taskId: normalizedTaskId,
        roleId: knowledgeRoleId,
        sourceKind: "artifact",
        title: `${roleLabel} · ${normalizedTaskId} · ${fileName}`,
        summary: promptSummary || `${roleLabel} 역할 실행 산출물`,
        createdAt: new Date().toISOString(),
        markdownPath: undefined,
        jsonPath: /\.json$/i.test(artifactPath) ? artifactPath : undefined,
      });
    }
    void persistKnowledgeIndexToWorkspace({
      cwd,
      invokeFn,
      rows: readKnowledgeEntries(),
    });
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
