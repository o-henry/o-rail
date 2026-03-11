import { describe, expect, it } from "vitest";
import { summarizeUserMemoryActivity } from "./userMemoryActivity";

describe("userMemoryActivity", () => {
  it("summarizes recent rag sources and memory reuse per node", () => {
    const rows = summarizeUserMemoryActivity([
      {
        runId: "run-1",
        startedAt: "2026-03-11T00:00:00.000Z",
        finishedAt: "2026-03-11T00:01:00.000Z",
        graphSnapshot: {
          version: 1,
          nodes: [
            {
              id: "turn-1",
              type: "turn",
              position: { x: 0, y: 0 },
              config: { role: "기획(PM)" },
            },
          ],
          edges: [],
          knowledge: { files: [], topK: 0, maxChars: 0 },
        },
        transitions: [],
        summaryLogs: [],
        threadTurnMap: {},
        knowledgeTrace: [
          {
            nodeId: "turn-1",
            fileId: "kb-1",
            fileName: "genre-loop.md",
            chunkIndex: 0,
            score: 0.91,
          },
        ],
        internalMemoryTrace: [
          {
            nodeId: "turn-1",
            snippetId: "memory-1",
            sourceRunId: "run-0",
            score: 0.88,
            reason: "relevant",
          },
        ],
        runMemory: {
          "turn-1": {
            nodeId: "turn-1",
            roleLabel: "기획(PM)",
            responsibility: "핵심 루프 정의",
            decisionSummary: "탐험-전투-강화 루프를 간결하게 유지",
            openIssues: [],
            nextRequests: [],
            updatedAt: "2026-03-11T00:01:00.000Z",
          },
        },
      },
    ] as any);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.nodeLabel).toBe("기획(PM)");
    expect(rows[0]?.ragSources).toContain("genre-loop.md");
    expect(rows[0]?.reusedMemoryCount).toBe(1);
  });
});
