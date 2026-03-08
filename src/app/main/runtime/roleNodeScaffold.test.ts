import { describe, expect, it } from "vitest";
import { buildRoleNodeScaffold } from "./roleNodeScaffold";

describe("roleNodeScaffold", () => {
  it("creates a single role node when research is disabled", () => {
    const result = buildRoleNodeScaffold({
      roleId: "pm_planner",
      anchorX: 480,
      anchorY: 160,
      includeResearch: false,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.researchNodeIds).toHaveLength(0);
    expect(result.nodes[0]?.config).toMatchObject({
      sourceKind: "handoff",
      handoffRoleId: "pm_planner",
      roleResearchEnabled: false,
    });
  });

  it("creates a research chain before the role node when enabled", () => {
    const result = buildRoleNodeScaffold({
      roleId: "system_programmer",
      anchorX: 1200,
      anchorY: 240,
      includeResearch: true,
    });

    expect(result.nodes).toHaveLength(8);
    expect(result.edges).toHaveLength(7);
    expect(result.researchNodeIds).toHaveLength(7);
    const sourceNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).viaNodeType) === "source.dev");
    expect(sourceNode?.config).toMatchObject({
      viaCustomKeywords: expect.stringContaining("unity architecture"),
      viaCustomSites: expect.stringContaining("docs.unity3d.com"),
    });
    expect(result.edges[result.edges.length - 1]).toEqual({
      from: { nodeId: result.researchNodeIds[result.researchNodeIds.length - 1], port: "out" },
      to: { nodeId: result.roleNodeId, port: "in" },
    });
  });
});
