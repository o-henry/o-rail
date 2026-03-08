import { describe, expect, it } from "vitest";
import { isGraphResearchNode, toGraphResearchKnowledgeEntry } from "./graphResearchKnowledge";

describe("graphResearchKnowledge", () => {
  const researchNode = {
    id: "research-1",
    type: "turn",
    config: {
      sourceKind: "data_research",
      role: "기획 조사 · 시장/레퍼런스 조사",
      handoffRoleId: "pm_planner",
      taskId: "PLAN-001",
    },
  };

  it("recognizes graph research nodes", () => {
    expect(isGraphResearchNode(researchNode)).toBe(true);
    expect(
      isGraphResearchNode({
        ...researchNode,
        config: { sourceKind: "handoff" },
      }),
    ).toBe(false);
  });

  it("maps completed research posts into knowledge entries", () => {
    const entry = toGraphResearchKnowledgeEntry({
      node: researchNode,
      post: {
        id: "post-1",
        runId: "run-1",
        summary: "전투 중심 로그라이크 레퍼런스 정리",
        createdAt: "2026-03-08T10:00:00.000Z",
        agentName: "기획 조사",
        attachments: [
          { kind: "markdown", filePath: "/tmp/research.md" },
          { kind: "json", filePath: "/tmp/research.json" },
        ],
      },
    });

    expect(entry).toMatchObject({
      id: "post-1",
      runId: "run-1",
      roleId: "pm_planner",
      taskId: "PLAN-001",
      sourceKind: "web",
      markdownPath: "/tmp/research.md",
      jsonPath: "/tmp/research.json",
    });
  });
});
