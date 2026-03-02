import { describe, expect, it } from "vitest";
import {
  createAgenticRunEnvelope,
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
});

