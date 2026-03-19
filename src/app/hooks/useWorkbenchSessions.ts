import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgenticActionSubscriber } from "../../features/orchestration/agentic/actionBus";
import type { AgenticRunEnvelope } from "../../features/orchestration/agentic/runContract";
import type { CompanionEventType, TaskTerminalResult } from "../../features/orchestration/types";
import {
  appendSessionArtifactPath,
  appendSessionNote,
  applyRoleRunCompletion,
  applySessionCompanion,
  applySessionTaskResult,
  applySessionUnityResult,
  createManualTaskSession,
  createRoleRunSession,
  patchManualSessionStatus,
  sortSessions,
} from "../../features/orchestration/workbench/sessionState";
import {
  normalizeWorkSessionRecord,
  readWorkbenchSessionsFromLocalStorage,
  workSessionIndexPath,
  writeWorkbenchSessionsToLocalStorage,
} from "../../features/orchestration/workbench/sessionStore";
import type { WorkSession, WorkSessionRecord, WorkSessionReviewState, WorkSessionStatus } from "../../features/orchestration/workbench/types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TaskTerminalExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

function findSessionByRunId(sessions: WorkSession[], runId: string): WorkSession | null {
  return sessions.find((session) => session.linkedRunIds.includes(runId)) ?? null;
}

function writeRecordToFile(cwd: string, invokeFn: InvokeFn, record: WorkSessionRecord): Promise<string> {
  const targetPath = workSessionIndexPath(cwd);
  const slashIndex = Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\"));
  return invokeFn<string>("workspace_write_text", {
    cwd: targetPath.slice(0, slashIndex),
    name: targetPath.slice(slashIndex + 1),
    content: `${JSON.stringify(record, null, 2)}\n`,
  });
}

export function useWorkbenchSessions(params: {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
  appendWorkspaceEvent: (input: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
  }) => void;
  subscribeAction: (handler: AgenticActionSubscriber) => () => void;
}) {
  const [record, setRecord] = useState<WorkSessionRecord>(() => readWorkbenchSessionsFromLocalStorage(params.cwd));
  const recordRef = useRef(record);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  useEffect(() => {
    setRecord(readWorkbenchSessionsFromLocalStorage(params.cwd));
  }, [params.cwd]);

  useEffect(() => {
    writeWorkbenchSessionsToLocalStorage(params.cwd, record);
  }, [params.cwd, record]);

  useEffect(() => {
    if (!params.hasTauriRuntime || !params.cwd) {
      return;
    }
    let cancelled = false;
    void params.invokeFn<string>("workspace_read_text", { cwd: params.cwd, path: workSessionIndexPath(params.cwd) })
      .then((raw) => {
        if (cancelled || !raw) {
          return;
        }
        const next = normalizeWorkSessionRecord(JSON.parse(raw));
        if (next.sessions.length > 0) {
          setRecord((current) => (current.sessions.length > 0 ? current : next));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.cwd, params.hasTauriRuntime, params.invokeFn]);

  useEffect(() => {
    if (!params.hasTauriRuntime || !params.cwd) {
      return;
    }
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      void writeRecordToFile(params.cwd, params.invokeFn, record).catch(() => undefined);
    }, 120);
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [params.cwd, params.hasTauriRuntime, params.invokeFn, record]);

  const sessions = useMemo(
    () => sortSessions(record.sessions.filter((session) => !session.archived)),
    [record.sessions],
  );
  const selectedSessionId = record.selectedSessionId ?? sessions[0]?.id ?? null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  const commitSessions = useCallback((updater: (current: WorkSessionRecord) => WorkSessionRecord) => {
    setRecord((current) => normalizeWorkSessionRecord(updater(current)));
  }, []);

  const createRoleSession = useCallback((input: {
    roleId: string;
    roleLabel: string;
    taskId: string;
    prompt: string;
    allowedCommands?: string[];
  }) => {
    const session = createRoleRunSession({
      cwd: params.cwd,
      roleId: input.roleId,
      roleLabel: input.roleLabel,
      taskId: input.taskId,
      prompt: input.prompt,
      allowedCommands: input.allowedCommands,
    });
    commitSessions((current) => ({
      ...current,
      sessions: sortSessions([session, ...current.sessions]),
      selectedSessionId: session.id,
    }));
    params.appendWorkspaceEvent({
      source: "workbench",
      message: `작업 세션 시작: ${session.title}`,
      actor: "user",
      level: "info",
      runId: session.linkedRunIds[0],
    });
    return {
      sessionId: session.id,
      parentRunId: session.linkedRunIds[0] ?? "",
      implementerRunId: session.mission?.childEnvelopes.find((row) => row.record.agentRole === "implementer")?.record.runId ?? "",
    };
  }, [commitSessions, params]);

  const createManualSessionAction = useCallback((input: {
    title: string;
    taskId: string;
    prompt?: string;
    commands?: string[];
  }) => {
    const session = createManualTaskSession(input);
    commitSessions((current) => ({
      ...current,
      sessions: sortSessions([session, ...current.sessions]),
      selectedSessionId: session.id,
    }));
  }, [commitSessions]);

  const patchSession = useCallback((sessionId: string, updater: (session: WorkSession) => WorkSession) => {
    commitSessions((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (session.id === sessionId ? updater(session) : session)),
      selectedSessionId: current.selectedSessionId ?? sessionId,
    }));
  }, [commitSessions]);

  const openSession = useCallback((sessionId: string) => {
    commitSessions((current) => ({ ...current, selectedSessionId: sessionId }));
  }, [commitSessions]);

  const archiveSession = useCallback((sessionId: string) => {
    commitSessions((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (
        session.id === sessionId ? { ...session, archived: true, updatedAt: new Date().toISOString() } : session
      )),
      selectedSessionId: current.selectedSessionId === sessionId ? current.sessions.find((session) => session.id !== sessionId)?.id ?? null : current.selectedSessionId,
    }));
  }, [commitSessions]);

  const attachSessionNote = useCallback((sessionId: string, note: string) => {
    patchSession(sessionId, (session) => appendSessionNote(session, note));
  }, [patchSession]);

  const attachArtifactPath = useCallback((sessionId: string, path: string) => {
    patchSession(sessionId, (session) => appendSessionArtifactPath(session, path));
  }, [patchSession]);

  const setManualSessionStatus = useCallback((sessionId: string, status: WorkSessionStatus) => {
    patchSession(sessionId, (session) => patchManualSessionStatus(session, status));
  }, [patchSession]);

  const setSessionReviewState = useCallback((sessionId: string, reviewState: WorkSessionReviewState) => {
    patchSession(sessionId, (session) => ({ ...session, reviewState, updatedAt: new Date().toISOString() }));
  }, [patchSession]);

  const recordCompanionEvent = useCallback((sessionId: string, type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => {
    patchSession(sessionId, (session) => applySessionCompanion(session, type, message));
  }, [patchSession]);

  const recordUnityVerification = useCallback((sessionId: string, success: boolean, message: string) => {
    patchSession(sessionId, (session) => applySessionUnityResult(session, success, message));
  }, [patchSession]);

  const executeSessionCommand = useCallback(async (sessionId: string, command: string) => {
    const session = recordRef.current.sessions.find((row) => row.id === sessionId);
    const normalized = String(command ?? "").trim();
    if (!session || !normalized || !session.commands.includes(normalized)) {
      return;
    }
    if (!params.hasTauriRuntime || !params.cwd) {
      params.appendWorkspaceEvent({
        source: "workbench",
        message: "작업용 터미널은 Tauri 런타임에서만 실행할 수 있습니다.",
        actor: "system",
        level: "error",
      });
      return;
    }
    let shellResult: TaskTerminalExecResponse;
    try {
      shellResult = await params.invokeFn<TaskTerminalExecResponse>("task_terminal_exec", {
        cwd: params.cwd,
        command: normalized,
        allowedCommands: session.commands,
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
    const result: TaskTerminalResult = {
      id: `terminal-${Date.now()}`,
      at: new Date().toISOString(),
      runId: session.linkedRunIds[0] ?? session.id,
      taskId: session.taskId,
      command: normalized,
      exitCode: shellResult.exitCode,
      stdoutTail: shellResult.stdout.slice(-1200),
      stderrTail: shellResult.stderr.slice(-1200),
      timedOut: shellResult.timedOut,
      durationMs: shellResult.durationMs,
      artifacts: [],
    };
    patchSession(sessionId, (current) => applySessionTaskResult(current, result));
  }, [params, patchSession]);

  const onRoleRunCompleted = useCallback((payload: {
    runId: string;
    artifactPaths: string[];
    runStatus: "done" | "error";
    envelope?: AgenticRunEnvelope;
  }) => {
    const session = findSessionByRunId(recordRef.current.sessions, payload.runId);
    if (!session) {
      return;
    }
    patchSession(session.id, (current) => applyRoleRunCompletion(current, payload));
  }, [patchSession]);

  useEffect(() => {
    return params.subscribeAction((action) => {
      if (action.type === "create_manual_session") {
        createManualSessionAction(action.payload);
        return;
      }
      if (action.type === "open_session") {
        openSession(action.payload.sessionId);
        return;
      }
      if (action.type === "archive_session") {
        archiveSession(action.payload.sessionId);
        return;
      }
      if (action.type === "attach_session_note") {
        attachSessionNote(action.payload.sessionId, action.payload.note);
      }
    });
  }, [archiveSession, attachSessionNote, createManualSessionAction, openSession, params]);

  return {
    sessions,
    selectedSession,
    selectedSessionId,
    createRoleSession,
    createManualSession: createManualSessionAction,
    openSession,
    archiveSession,
    attachSessionNote,
    attachArtifactPath,
    setManualSessionStatus,
    setSessionReviewState,
    recordCompanionEvent,
    recordUnityVerification,
    executeSessionCommand,
    onRoleRunCompleted,
  };
}
