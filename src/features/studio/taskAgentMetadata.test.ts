import { describe, expect, it } from "vitest";
import { resolveTaskAgentMetadata } from "./taskAgentMetadata";

describe("resolveTaskAgentMetadata", () => {
  it("maps studio roles onto task agent labels", () => {
    expect(resolveTaskAgentMetadata("research_analyst")).toMatchObject({
      taskAgentId: "researcher",
      taskAgentLabel: "RESEARCHER",
      studioRoleLabel: "리서처",
      orchestratorAgentId: "researcher",
      orchestratorAgentLabel: "RESEARCHER",
    });
  });

  it("omits orchestrator labels for internal collaboration artifacts", () => {
    expect(resolveTaskAgentMetadata("client_programmer", true)).toMatchObject({
      taskAgentId: "unity_implementer",
      taskAgentLabel: "UNITY IMPLEMENTER",
      orchestratorAgentId: undefined,
      orchestratorAgentLabel: undefined,
    });
  });
});
