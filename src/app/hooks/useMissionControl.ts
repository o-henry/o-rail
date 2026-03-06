import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyCompanionEvent,
  applyImplementerRunResult,
  applyTaskTerminalResult,
  applyUnityVerification,
  createMissionControlState,
  type MissionControlLaunchInput,
  type MissionControlState,
} from "../../features/orchestration/agentic/missionControl";
import type { AgenticRunEnvelope } from "../../features/orchestration/agentic/runContract";
import { readMissionControlState, writeMissionControlState } from "../../features/orchestration/agentic/missionControlStore";
import {
  buildMissionWorkspaceFiles,
  isAllowedTaskTerminalCommand,
  taskTerminalResultArtifactPath,
} from "../../features/orchestration/agentic/missionControlUtils";
import type { CompanionEventType, TaskTerminalResult } from "../../features/orchestration/types";
import { persistAgenticRunEnvelope } from "../main/runtime/agenticRunStore";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TaskTerminalExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

function splitFilePath(path: string): { cwd: string; name: string } | null {
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    return null;
  }
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
    return null;
  }
  return {
    cwd: normalized.slice(0, slashIndex),
    name: normalized.slice(slashIndex + 1),
  };
}

async function writeJsonFileByPath(
  invokeFn: InvokeFn,
  path: string,
  content: unknown,
): Promise<string | null> {
  const target = splitFilePath(path);
  if (!target) {
    return null;
  }
  return invokeFn<string>("workspace_write_text", {
    cwd: target.cwd,
    name: target.name,
    content: `${JSON.stringify(content, null, 2)}\n`,
  });
}

async function persistMissionState(cwd: string, invokeFn: InvokeFn, mission: MissionControlState) {
  const files = buildMissionWorkspaceFiles(mission);
  await Promise.all([
    persistAgenticRunEnvelope({ cwd, invokeFn, envelope: mission.parentEnvelope }),
    ...mission.childEnvelopes.map((envelope) => persistAgenticRunEnvelope({ cwd, invokeFn, envelope })),
    writeJsonFileByPath(invokeFn, mission.bridgePaths.plannerBriefPath, files.plannerBrief),
    writeJsonFileByPath(invokeFn, mission.bridgePaths.companionContractPath, files.companionContract),
    writeJsonFileByPath(invokeFn, mission.bridgePaths.unityContractPath, files.unityContract),
    writeJsonFileByPath(invokeFn, mission.bridgePaths.featureMemoryPath, files.featureMemory),
    writeJsonFileByPath(invokeFn, mission.bridgePaths.missionSnapshotPath, files.missionSnapshot),
    ...mission.terminalResults.map((result) =>
      writeJsonFileByPath(invokeFn, taskTerminalResultArtifactPath(mission, result.id), result),
    ),
  ]);
}

export function useMissionControl(params: {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
  appendWorkspaceEvent: (input: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: string;
  }) => void;
}) {
  const [activeMission, setActiveMission] = useState<MissionControlState | null>(() => readMissionControlState(params.cwd));
  const activeMissionRef = useRef<MissionControlState | null>(activeMission);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeMissionRef.current = activeMission;
  }, [activeMission]);

  useEffect(() => {
    setActiveMission(readMissionControlState(params.cwd));
  }, [params.cwd]);

  useEffect(() => {
    writeMissionControlState(params.cwd, activeMission);
  }, [activeMission, params.cwd]);

  useEffect(() => {
    if (!params.hasTauriRuntime || !params.cwd || !activeMission) {
      return;
    }
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    persistTimerRef.current = window.setTimeout(() => {
      void persistMissionState(params.cwd, params.invokeFn, activeMission).catch(() => {
        // Persistence failure should not block the in-memory control plane.
      });
    }, 150);
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [activeMission, params.cwd, params.hasTauriRuntime, params.invokeFn]);

  const launchMission = useCallback(
    (input: Omit<MissionControlLaunchInput, "cwd" | "sourceTab"> & { sourceTab?: MissionControlLaunchInput["sourceTab"] }) => {
      const next = createMissionControlState({
        cwd: params.cwd,
        sourceTab: input.sourceTab ?? "agents",
        roleId: input.roleId,
        roleLabel: input.roleLabel,
        taskId: input.taskId,
        prompt: input.prompt,
        allowedCommands: input.allowedCommands,
      });
      setActiveMission(next);
      params.appendWorkspaceEvent({
        source: "mission",
        message: `Mission 시작: ${next.title}`,
        actor: "ai",
        level: "info",
        runId: next.parentEnvelope.record.runId,
      });
      return {
        parentRunId: next.parentEnvelope.record.runId,
        implementerRunId:
          next.childEnvelopes.find((row) => row.record.agentRole === "implementer")?.record.runId ?? "",
      };
    },
    [params],
  );

  const onRoleRunCompleted = useCallback(
    (payload: {
      runId: string;
      runStatus: "done" | "error";
      artifactPaths: string[];
      prompt?: string;
      envelope?: AgenticRunEnvelope;
    }) => {
      setActiveMission((current) => {
        if (!current) {
          return current;
        }
        const implementer = current.childEnvelopes.find((row) => row.record.agentRole === "implementer");
        if (!implementer || implementer.record.runId !== payload.runId) {
          return current;
        }
        return applyImplementerRunResult(current, {
          runId: payload.runId,
          status: payload.runStatus,
          artifactPaths: payload.artifactPaths,
          summary: payload.prompt,
          baseEnvelope: payload.envelope,
        });
      });
      params.appendWorkspaceEvent({
        source: "mission",
        message:
          payload.runStatus === "done"
            ? `Implementer 완료: ${payload.runId}`
            : `Implementer 실패: ${payload.runId}`,
        actor: "ai",
        level: payload.runStatus === "done" ? "info" : "error",
        runId: payload.runId,
      });
    },
    [params],
  );

  const recordCompanionEvent = useCallback(
    (type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => {
      setActiveMission((current) => {
        if (!current) {
          return current;
        }
        return applyCompanionEvent(current, {
          source: "vscode",
          type,
          message: String(message ?? "").trim() || type,
        });
      });
      const currentRunId = activeMissionRef.current?.parentEnvelope.record.runId;
      params.appendWorkspaceEvent({
        source: "mission",
        message: `Companion 이벤트: ${type}`,
        actor: "system",
        level: "info",
        runId: currentRunId,
      });
    },
    [params],
  );

  const recordUnityVerification = useCallback(
    (success: boolean, message: string) => {
      setActiveMission((current) => (current ? applyUnityVerification(current, { success, message }) : current));
      const currentRunId = activeMissionRef.current?.parentEnvelope.record.runId;
      params.appendWorkspaceEvent({
        source: "mission",
        message,
        actor: "system",
        level: success ? "info" : "error",
        runId: currentRunId,
      });
    },
    [params],
  );

  const executeTaskCommand = useCallback(
    async (command: string) => {
      const current = activeMissionRef.current;
      if (!current || !isAllowedTaskTerminalCommand(current.terminalSession, command)) {
        return;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        params.appendWorkspaceEvent({
          source: "mission",
          message: "작업용 터미널은 Tauri 런타임에서만 실행할 수 있습니다.",
          actor: "system",
          level: "error",
          runId: current.parentEnvelope.record.runId,
        });
        return;
      }

      setActiveMission((prev) =>
        prev
          ? {
              ...prev,
              terminalSession: {
                ...prev.terminalSession,
                status: "running",
                lastCommand: command,
              },
            }
          : prev,
      );
      params.appendWorkspaceEvent({
        source: "mission",
        message: `작업용 터미널 실행: ${command}`,
        actor: "user",
        level: "info",
        runId: current.parentEnvelope.record.runId,
      });

      let shellResult: TaskTerminalExecResponse;
      try {
        shellResult = await params.invokeFn<TaskTerminalExecResponse>("task_terminal_exec", {
          cwd: params.cwd,
          command,
          allowedCommands: current.terminalSession.allowedCommands,
          timeoutSec: 180,
        });
      } catch (error) {
        shellResult = {
          exitCode: -1,
          stdout: "",
          stderr: String(error ?? "task terminal execution failed"),
          timedOut: false,
          durationMs: 0,
        };
      }

      const resultId = `terminal-${Date.now()}`;
      const result: TaskTerminalResult = {
        id: resultId,
        at: new Date().toISOString(),
        runId: current.parentEnvelope.record.runId,
        taskId: current.terminalSession.taskId,
        command,
        exitCode: shellResult.exitCode,
        stdoutTail: shellResult.stdout.slice(-1200),
        stderrTail: shellResult.stderr.slice(-1200),
        timedOut: shellResult.timedOut,
        durationMs: shellResult.durationMs,
        artifacts: [taskTerminalResultArtifactPath(current, resultId)],
      };

      setActiveMission((prev) => (prev ? applyTaskTerminalResult(prev, result) : prev));
      params.appendWorkspaceEvent({
        source: "mission",
        message:
          shellResult.exitCode === 0 && !shellResult.timedOut
            ? `작업용 터미널 완료: ${command}`
            : `작업용 터미널 실패: ${command}`,
        actor: "system",
        level: shellResult.exitCode === 0 && !shellResult.timedOut ? "info" : "error",
        runId: current.parentEnvelope.record.runId,
      });
    },
    [params],
  );

  const clearMission = useCallback(() => {
    setActiveMission(null);
    params.appendWorkspaceEvent({
      source: "mission",
      message: "Mission Control 세션 정리",
      actor: "system",
      level: "info",
    });
  }, [params]);

  return {
    activeMission,
    clearMission,
    executeTaskCommand,
    launchMission,
    onRoleRunCompleted,
    recordCompanionEvent,
    recordUnityVerification,
  };
}
