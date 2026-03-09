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

    expect(result.nodes).toHaveLength(6);
    expect(result.edges).toHaveLength(5);
    expect(result.researchNodeIds).toHaveLength(5);
    const researchNodes = result.nodes.filter((node) => String((node.config as Record<string, unknown>).sourceKind ?? "") === "data_research");
    expect(researchNodes).toHaveLength(3);
    const repoContextNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("레포 구조 조사"));
    expect(repoContextNode?.config).toMatchObject({
      sourceKind: "data_research",
      role: expect.stringContaining("시스템"),
      executor: "codex",
      promptTemplate: expect.stringContaining("현재 레포의 시스템 경계"),
      knowledgeEnabled: true,
    });
    const officialNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("공식 문서·패턴 조사"));
    expect(officialNode?.config).toMatchObject({
      executor: "web_perplexity",
      viaCustomSites: expect.stringContaining("docs.unity3d.com"),
    });
    const fieldFailureNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("병목·실패 사례 조사"));
    expect(fieldFailureNode?.config).toMatchObject({
      executor: "via_flow",
      viaNodeType: "source.dev",
      viaTemplateLabel: "병목·실패 사례 조사",
    });
    const synthesisNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("조사 종합"));
    expect(synthesisNode?.config).toMatchObject({
      executor: "codex",
      sourceKind: "data_pipeline",
    });
    const verificationNode = result.nodes.find((node) => String((node.config as Record<string, unknown>).role ?? "").includes("조사 검증"));
    expect(verificationNode?.config).toMatchObject({
      executor: "codex",
      sourceKind: "data_pipeline",
      promptTemplate: expect.stringContaining("장기 유지보수 리스크"),
    });
    expect(result.edges.filter((edge) => edge.to.nodeId === synthesisNode?.id)).toHaveLength(3);
    expect(result.edges.find((edge) => edge.from.nodeId === synthesisNode?.id && edge.to.nodeId === verificationNode?.id)).toBeTruthy();
    expect(result.edges[result.edges.length - 1]).toEqual({
      from: { nodeId: verificationNode?.id ?? "", port: "out" },
      to: { nodeId: result.roleNodeId, port: "in" },
    });
  });
});
