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

  it("creates parallel research sources before the role node when enabled", () => {
    const result = buildRoleNodeScaffold({
      roleId: "system_programmer",
      anchorX: 1200,
      anchorY: 240,
      includeResearch: true,
    });

    expect(result.nodes).toHaveLength(10);
    expect(result.edges).toHaveLength(11);
    expect(result.researchNodeIds).toHaveLength(9);
    const sourceTypes = result.nodes
      .map((node) => String((node.config as Record<string, unknown>).viaNodeType ?? ""))
      .filter((value) => value.startsWith("source."));
    expect(sourceTypes).toEqual(expect.arrayContaining(["source.community", "source.dev", "source.news"]));
    const sourceNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).viaNodeType) === "source.dev");
    expect(sourceNode?.config).toMatchObject({
      sourceKind: "data_research",
      role: expect.stringContaining("시스템"),
      viaCustomKeywords: expect.stringContaining("unity architecture"),
      viaCustomSites: expect.stringContaining("docs.unity3d.com"),
    });
    const triggerNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).viaNodeType) === "trigger.manual");
    expect(result.edges.filter((edge) => edge.from.nodeId === triggerNode?.id)).toHaveLength(3);
    expect(result.edges[result.edges.length - 1]).toEqual({
      from: { nodeId: result.researchNodeIds[result.researchNodeIds.length - 1], port: "out" },
      to: { nodeId: result.roleNodeId, port: "in" },
    });
  });
});
