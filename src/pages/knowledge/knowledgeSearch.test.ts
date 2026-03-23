import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import {
  buildKnowledgeHighlightParts,
  buildKnowledgeMetadataSearchText,
  buildKnowledgeSearchDocument,
  filterKnowledgeEntriesByQuery,
  normalizeKnowledgeSearchQuery,
} from "./knowledgeSearch";

function createEntry(overrides?: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: "entry-1",
    runId: "run-1",
    taskId: "task-1",
    roleId: "research_analyst",
    sourceKind: "ai",
    title: "Gemini 아이디어 요약",
    summary: "게임 아이디어를 정리한 문서",
    createdAt: "2026-03-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeKnowledgeSearchQuery", () => {
  it("trims and lowercases the query", () => {
    expect(normalizeKnowledgeSearchQuery("  GrOk  ")).toBe("grok");
  });
});

describe("buildKnowledgeMetadataSearchText", () => {
  it("includes metadata fields that should participate in list filtering", () => {
    const text = buildKnowledgeMetadataSearchText(createEntry({
      taskAgentLabel: "GROK",
      sourceUrl: "https://example.com/grok",
    }));
    expect(text).toContain("grok");
    expect(text).toContain("https://example.com/grok");
  });
});

describe("buildKnowledgeSearchDocument", () => {
  it("combines metadata and artifact text into one searchable blob", () => {
    const document = buildKnowledgeSearchDocument(
      createEntry(),
      "Markdown body with Grok",
      "{\"provider\":\"Gemini\"}",
    );
    expect(document).toContain("grok");
    expect(document).toContain("gemini");
  });
});

describe("filterKnowledgeEntriesByQuery", () => {
  it("matches entries by indexed document content when metadata does not contain the query", () => {
    const entries = [
      createEntry({ id: "entry-a", title: "문서 A", summary: "요약" }),
      createEntry({ id: "entry-b", title: "문서 B", summary: "요약" }),
    ];
    const filtered = filterKnowledgeEntriesByQuery(entries, "grok", {
      "entry-a": "this body mentions grok",
      "entry-b": "this body mentions gemini",
    });
    expect(filtered.map((entry) => entry.id)).toEqual(["entry-a"]);
  });
});

describe("buildKnowledgeHighlightParts", () => {
  it("returns matched and unmatched segments without regex rewriting", () => {
    expect(buildKnowledgeHighlightParts("Grok and grok again", "grok")).toEqual([
      { text: "Grok", matched: true },
      { text: " and ", matched: false },
      { text: "grok", matched: true },
      { text: " again", matched: false },
    ]);
  });
});
