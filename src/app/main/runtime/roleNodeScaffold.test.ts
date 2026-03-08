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

    expect(result.nodes).toHaveLength(5);
    expect(result.edges).toHaveLength(4);
    expect(result.researchNodeIds).toHaveLength(4);
    const researchNodes = result.nodes.filter((node) => String((node.config as Record<string, unknown>).sourceKind ?? "") === "data_research");
    expect(researchNodes).toHaveLength(3);
    const sourceNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("공식 문서 조사"));
    expect(sourceNode?.config).toMatchObject({
      sourceKind: "data_research",
      role: expect.stringContaining("시스템"),
      executor: "web_grok",
      promptTemplate: expect.stringContaining("unity architecture"),
      viaCustomSites: expect.stringContaining("docs.unity3d.com"),
    });
    const synthesisNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("조사 종합"));
    expect(synthesisNode?.config).toMatchObject({
      executor: "codex",
      sourceKind: "data_pipeline",
    });
    expect(result.edges.filter((edge) => edge.to.nodeId === synthesisNode?.id)).toHaveLength(3);
    expect(result.edges[result.edges.length - 1]).toEqual({
      from: { nodeId: result.researchNodeIds[result.researchNodeIds.length - 1], port: "out" },
      to: { nodeId: result.roleNodeId, port: "in" },
    });
  });
});
