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

  it("injects differentiated prompts for PM modes while keeping a single PM role id", () => {
    const creative = buildRoleNodeScaffold({
      roleId: "pm_planner",
      anchorX: 640,
      anchorY: 180,
      includeResearch: false,
      pmPlanningMode: "creative",
    });
    const critic = buildRoleNodeScaffold({
      roleId: "pm_planner",
      anchorX: 720,
      anchorY: 220,
      includeResearch: false,
      pmPlanningMode: "logical",
    });

    expect(creative.nodes[0]?.config).toMatchObject({
      handoffRoleId: "pm_planner",
      pmPlanningMode: "creative",
      qualityProfile: "design_planning",
      role: "기획(PM) · 창의성 AGENT",
    });
    expect(String((creative.nodes[0]?.config as Record<string, unknown>)?.promptTemplate ?? "")).toContain("차별화");
    expect(String((creative.nodes[0]?.config as Record<string, unknown>)?.promptTemplate ?? "")).toContain("## 창의적 코어 제안");

    expect(critic.nodes[0]?.config).toMatchObject({
      handoffRoleId: "pm_planner",
      pmPlanningMode: "logical",
      qualityProfile: "research_evidence",
      role: "기획(PM) · 논리 AGENT",
    });
    expect(String((critic.nodes[0]?.config as Record<string, unknown>)?.promptTemplate ?? "")).toContain("항목별 점수(0-10)");
    expect(String((critic.nodes[0]?.config as Record<string, unknown>)?.promptTemplate ?? "")).toContain("## 현실성 평가표");
  });

  it("injects role-specific mode guidance for non-PM roles", () => {
    const clientCreative = buildRoleNodeScaffold({
      roleId: "client_programmer",
      anchorX: 640,
      anchorY: 180,
      includeResearch: false,
      pmPlanningMode: "creative",
    });
    const systemLogical = buildRoleNodeScaffold({
      roleId: "system_programmer",
      anchorX: 720,
      anchorY: 220,
      includeResearch: false,
      pmPlanningMode: "creative",
    });

    expect(String((clientCreative.nodes[0]?.config as Record<string, unknown>)?.promptTemplate ?? "")).toContain("UX 감각과 상호작용의 차별화");
    expect((clientCreative.nodes[0]?.config as Record<string, unknown>)?.pmPlanningMode).toBe("creative");
    expect((clientCreative.nodes[0]?.config as Record<string, unknown>)?.role).toBe("클라이언트 · 창의성 AGENT");
    expect(String((systemLogical.nodes[0]?.config as Record<string, unknown>)?.promptTemplate ?? "")).toContain("정확성, 실패 가능성, 검증 가능성");
    expect((systemLogical.nodes[0]?.config as Record<string, unknown>)?.pmPlanningMode).toBe("logical");
    expect((systemLogical.nodes[0]?.config as Record<string, unknown>)?.role).toBe("시스템 · 논리 AGENT");
  });
});
