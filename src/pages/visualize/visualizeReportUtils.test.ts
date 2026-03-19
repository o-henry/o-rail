import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import { buildVisualizeResearchRuns, parseResearchCollectionPayload } from "./visualizeReportUtils";

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "entry-1",
    runId: "run-1",
    taskId: "thread-1",
    roleId: "research_analyst",
    sourceKind: "artifact",
    title: "RESEARCHER · thread-1 · research_findings.md",
    summary: "스팀 게임 최근 리뷰와 장르별 평가 조사",
    createdAt: "2026-03-19T06:00:00.000Z",
    ...overrides,
  };
}

describe("visualizeReportUtils", () => {
  it("groups researcher artifacts into a single report run", () => {
    const runs = buildVisualizeResearchRuns([
      makeEntry({
        id: "collection-md",
        markdownPath: "/tmp/run-1/research_collection.md",
        title: "RESEARCHER · thread-1 · research_collection.md",
      }),
      makeEntry({
        id: "collection-json",
        jsonPath: "/tmp/run-1/research_collection.json",
        title: "RESEARCHER · thread-1 · research_collection.json",
        createdAt: "2026-03-19T06:00:01.000Z",
      }),
      makeEntry({
        id: "findings",
        markdownPath: "/tmp/run-1/research_findings.md",
        title: "RESEARCHER · thread-1 · research_findings.md",
        createdAt: "2026-03-19T06:00:02.000Z",
      }),
      makeEntry({
        id: "ignored",
        markdownPath: "/tmp/run-1/prompt.md",
        title: "RESEARCHER · thread-1 · prompt.md",
      }),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: "run-1",
      reportEntryId: "findings",
      collectionEntryId: "collection-md",
      reportMarkdownPath: "/tmp/run-1/research_findings.md",
      collectionMarkdownPath: "/tmp/run-1/research_collection.md",
      collectionJsonPath: "/tmp/run-1/research_collection.json",
    });
  });

  it("parses collection payload JSON", () => {
    const payload = parseResearchCollectionPayload(
      JSON.stringify({
        planned: { job: { jobId: "job-1", resolvedSourceType: "community" } },
        metrics: { totals: { items: 12 } },
      }),
    );
    expect(payload?.planned?.job?.jobId).toBe("job-1");
    expect(payload?.metrics?.totals?.items).toBe(12);
  });
});
