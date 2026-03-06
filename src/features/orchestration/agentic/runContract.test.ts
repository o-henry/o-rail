import { describe, expect, it } from "vitest";
import {
  createAgenticRunEnvelope,
  patchRunRecord,
  queueKeyForGraph,
  queueKeyForRole,
  queueKeyForTopic,
} from "./runContract";

describe("runContract", () => {
  it("creates market topic run envelope by default when topic is provided", () => {
    const envelope = createAgenticRunEnvelope({
      sourceTab: "agents",
      queueKey: queueKeyForTopic("globalHeadlines"),
      topic: "globalHeadlines",
    });
    expect(envelope.record.runKind).toBe("market_topic");
    expect(envelope.record.topic).toBe("globalHeadlines");
  });

  it("creates graph run envelope for graph queue", () => {
    const envelope = createAgenticRunEnvelope({
      sourceTab: "workflow",
      queueKey: queueKeyForGraph("default"),
    });
    expect(envelope.record.runKind).toBe("graph");
  });

  it("creates studio role run envelope with role queue", () => {
    const envelope = createAgenticRunEnvelope({
      sourceTab: "agents",
      runKind: "studio_role",
      queueKey: queueKeyForRole("role-system_programmer"),
      roleId: "role-system_programmer",
      taskId: "SYSTEM-001",
      approvalState: "pending",
    });
    expect(envelope.record.runKind).toBe("studio_role");
    expect(envelope.record.roleId).toBe("role-system_programmer");
    expect(envelope.record.taskId).toBe("SYSTEM-001");
    expect(envelope.record.approvalState).toBe("pending");
  });

  it("patches orchestration metadata on a run record", () => {
    const envelope = createAgenticRunEnvelope({
      sourceTab: "agents",
      runKind: "studio_role",
      queueKey: queueKeyForRole("client_programmer"),
      roleId: "client_programmer",
      taskId: "CLIENT-001",
    });

    const next = patchRunRecord(envelope, {
      surface: "vscode",
      agentRole: "implementer",
      parentRunId: "mission-1",
      childRunIds: ["planner-1", "reviewer-1"],
      verificationStatus: "pending",
      nextAction: {
        surface: "vscode",
        title: "VS Code에서 구현",
      },
    });

    expect(next.record.surface).toBe("vscode");
    expect(next.record.agentRole).toBe("implementer");
    expect(next.record.parentRunId).toBe("mission-1");
    expect(next.record.childRunIds).toEqual(["planner-1", "reviewer-1"]);
    expect(next.record.nextAction?.title).toBe("VS Code에서 구현");
  });
});
