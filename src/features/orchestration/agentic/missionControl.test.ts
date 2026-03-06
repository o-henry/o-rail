import { describe, expect, it } from "vitest";
import {
  applyImplementerRunResult,
  applyTaskTerminalResult,
  applyUnityVerification,
  createMissionControlState,
} from "./missionControl";
import { isAllowedTaskTerminalCommand } from "./missionControlUtils";

describe("missionControl", () => {
  it("creates a mission with explicit planner, implementer, and reviewer child runs", () => {
    const state = createMissionControlState({
      cwd: "/tmp/workspace",
      sourceTab: "agents",
      roleId: "client_programmer",
      roleLabel: "클라이언트",
      taskId: "CLIENT-001",
      prompt: "플레이어 점프를 구현해줘.",
    });

    expect(state.parentEnvelope.record.childRunIds).toHaveLength(3);
    expect(state.childEnvelopes.map((row) => row.record.agentRole)).toEqual([
      "planner",
      "implementer",
      "reviewer",
    ]);
    expect(state.parentEnvelope.record.nextAction?.surface).toBe("vscode");
    expect(state.terminalSession.allowedCommands).toContain("npm run build");
  });

  it("moves the mission to unity verification after a successful terminal result", () => {
    const launched = createMissionControlState({
      cwd: "/tmp/workspace",
      sourceTab: "agents",
      roleId: "client_programmer",
      roleLabel: "클라이언트",
      taskId: "CLIENT-001",
      prompt: "플레이어 점프를 구현해줘.",
    });
    const afterImplementer = applyImplementerRunResult(launched, {
      runId: launched.childEnvelopes[1].record.runId,
      status: "done",
      artifactPaths: ["/tmp/workspace/.rail/studio_runs/impl/output.json"],
      summary: "구현 완료",
    });

    const next = applyTaskTerminalResult(afterImplementer, {
      id: "terminal-1",
      at: new Date().toISOString(),
      runId: afterImplementer.parentEnvelope.record.runId,
      taskId: afterImplementer.terminalSession.taskId,
      command: afterImplementer.terminalSession.allowedCommands[0],
      exitCode: 0,
      stdoutTail: "ok",
      stderrTail: "",
      timedOut: false,
      durationMs: 1500,
      artifacts: ["/tmp/workspace/.rail/studio_runs/mission/terminal/terminal-1.json"],
    });

    expect(next.parentEnvelope.record.nextAction?.surface).toBe("unity");
    expect(next.childEnvelopes.find((row) => row.record.agentRole === "reviewer")?.record.status).toBe("done");
    expect(next.bridgeEvents[0]?.type).toBe("test_passed");
  });

  it("keeps the mission open when unity verification fails", () => {
    const launched = createMissionControlState({
      cwd: "/tmp/workspace",
      sourceTab: "agents",
      roleId: "client_programmer",
      roleLabel: "클라이언트",
      taskId: "CLIENT-001",
      prompt: "플레이어 점프를 구현해줘.",
      allowedCommands: ["npm run test"],
    });
    expect(isAllowedTaskTerminalCommand(launched.terminalSession, "npm run test")).toBe(true);
    expect(isAllowedTaskTerminalCommand(launched.terminalSession, "rm -rf .")).toBe(false);

    const next = applyUnityVerification(launched, {
      success: false,
      message: "플레이 모드에서 점프 애니메이션이 깨졌습니다.",
    });

    expect(next.parentEnvelope.record.verificationStatus).toBe("failed");
    expect(next.parentEnvelope.record.status).toBe("running");
    expect(next.parentEnvelope.record.nextAction?.surface).toBe("vscode");
  });
});
