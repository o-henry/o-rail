import { appendRunArtifact, patchRunRecord, type AgenticRunEnvelope } from "./runContract";
import type {
  AgenticChildRole,
  AgenticFeatureMemory,
  AgenticVerificationStatus,
  TaskTerminalSession,
} from "../types";
import type { MissionControlState } from "./missionControlTypes";

export function normalizeMissionCommands(commands: string[], prompt: string): string[] {
  const seeded = [...commands];
  if (seeded.length === 0) {
    seeded.push("npm run build", "npm run test");
    if (/check|guardrail|architecture|refactor|lint/i.test(prompt)) {
      seeded.push("npm run check");
    }
  }
  return [...new Set(seeded.map((row) => String(row ?? "").trim()).filter(Boolean))];
}

export function buildMissionRunDir(cwd: string, runId: string): string {
  const base = String(cwd ?? "").trim().replace(/[\\/]+$/, "");
  return base ? `${base}/.rail/studio_runs/${runId}` : `.rail/studio_runs/${runId}`;
}

export function missionTitle(taskId: string, roleLabel: string, prompt: string): string {
  const summary = prompt.trim().split(/\n+/)[0]?.trim() ?? "";
  return `${taskId} · ${roleLabel}${summary ? ` · ${summary.slice(0, 60)}` : ""}`;
}

export function withMissionRunSummary(
  envelope: AgenticRunEnvelope,
  summary: string,
  artifactPath?: string,
): AgenticRunEnvelope {
  let next = patchRunRecord(envelope, { summary });
  if (artifactPath) {
    next = appendRunArtifact(next, {
      kind: "snapshot",
      path: artifactPath,
      meta: { summary },
    });
  }
  return next;
}

export function patchMissionChildByRole(
  rows: AgenticRunEnvelope[],
  role: AgenticChildRole,
  updater: (row: AgenticRunEnvelope) => AgenticRunEnvelope,
): AgenticRunEnvelope[] {
  return rows.map((row) => (row.record.agentRole === role ? updater(row) : row));
}

export function missionChildRunIds(rows: AgenticRunEnvelope[]): string[] {
  return rows.map((row) => row.record.runId);
}

export function missionNowIso(): string {
  return new Date().toISOString();
}

export function trimMissionTextTail(text: string, maxChars = 480): string {
  const normalized = String(text ?? "").trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
}

export function buildMissionFeatureMemory(input: {
  parentRunId: string;
  taskId: string;
  title: string;
  prompt: string;
  artifactPaths: string[];
  verificationStatus: AgenticVerificationStatus;
  openRisks: string[];
}): AgenticFeatureMemory {
  return {
    id: `memory-${input.parentRunId}`,
    parentRunId: input.parentRunId,
    taskId: input.taskId,
    title: input.title,
    summary: input.prompt,
    decisionSummary: input.prompt,
    modifiedArtifacts: input.artifactPaths,
    verificationStatus: input.verificationStatus,
    openRisks: input.openRisks,
    updatedAt: missionNowIso(),
  };
}

export function buildMissionWorkspaceFiles(state: MissionControlState) {
  const plannerBrief = {
    title: state.title,
    taskId: state.terminalSession.taskId,
    roleId: state.primaryRoleId,
    roleLabel: state.primaryRoleLabel,
    prompt: state.prompt,
    childRuns: state.childEnvelopes.map((row) => ({
      runId: row.record.runId,
      agentRole: row.record.agentRole,
      surface: row.record.surface,
      status: row.record.status,
      nextAction: row.record.nextAction,
    })),
  };
  const companionContract = {
    runId: state.parentEnvelope.record.runId,
    taskId: state.terminalSession.taskId,
    surface: "vscode",
    prompt: state.prompt,
    allowedCommands: state.terminalSession.allowedCommands,
    nextAction: state.parentEnvelope.record.nextAction,
    handoffArtifactIds: state.parentEnvelope.record.handoffArtifactIds ?? [],
  };
  const unityContract = {
    runId: state.parentEnvelope.record.runId,
    taskId: state.terminalSession.taskId,
    surface: "unity",
    verificationStatus: state.parentEnvelope.record.verificationStatus ?? "pending",
    checklist: ["Play Mode 확인", "에셋 등록 결과 확인", "오류 로그 확인"],
    nextAction: state.parentEnvelope.record.nextAction,
  };
  return {
    plannerBrief,
    companionContract,
    unityContract,
    featureMemory: state.featureMemory,
    missionSnapshot: state,
  };
}

export function taskTerminalResultArtifactPath(state: MissionControlState, resultId: string): string {
  const runDir = buildMissionRunDir(state.terminalSession.cwd, state.parentEnvelope.record.runId);
  return `${runDir}/terminal/${resultId}.json`;
}

export function isAllowedTaskTerminalCommand(session: TaskTerminalSession, command: string): boolean {
  const normalized = String(command ?? "").trim();
  return normalized.length > 0 && session.allowedCommands.includes(normalized);
}
