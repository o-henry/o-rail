import { describe, expect, it } from "vitest";
import type { KnowledgeSourcePost } from "../../features/studio/knowledgeTypes";
import { isRuntimeNoiseKnowledgeEntry, toKnowledgeEntry } from "./knowledgeEntryMapping";

function makePost(overrides: Partial<KnowledgeSourcePost> = {}): KnowledgeSourcePost {
  return {
    id: "post-1",
    runId: "run-1",
    topic: "CUSTOM_TOPIC",
    topicLabel: "CUSTOM_TOPIC",
    summary: "테스트 요약",
    createdAt: "2026-03-05T00:00:00.000Z",
    agentName: "agent",
    attachments: [],
    ...overrides,
  };
}

describe("KnowledgeBasePage toKnowledgeEntry", () => {
  it("maps markdown/json file paths from feed attachments", () => {
    const post = makePost({
      attachments: [
        { kind: "markdown", filePath: "/tmp/export.md" },
        { kind: "json", filePath: "/tmp/export.json" },
      ],
    });

    const entry = toKnowledgeEntry(post);
    expect(entry).not.toBeNull();
    expect(entry?.markdownPath).toBe("/tmp/export.md");
    expect(entry?.jsonPath).toBe("/tmp/export.json");
  });

  it("keeps markdown-only artifacts visible", () => {
    const post = makePost({
      attachments: [{ kind: "markdown", filePath: "/tmp/export.md" }],
    });

    const entry = toKnowledgeEntry(post);
    expect(entry).not.toBeNull();
    expect(entry?.markdownPath).toBe("/tmp/export.md");
    expect(entry?.jsonPath).toBeUndefined();
  });

  it("filters hidden dashboard topics", () => {
    const post = makePost({
      runId: "topic-market-summary-123",
      topic: "MARKET_SUMMARY",
      topicLabel: "MARKET_SUMMARY",
    });

    expect(toKnowledgeEntry(post)).toBeNull();
  });

  it("uses template/group label when topic labels are missing", () => {
    const post = makePost({
      topic: undefined,
      topicLabel: undefined,
      groupName: "주식/마켓",
      summary: "",
      agentName: "RAG",
    });
    const entry = toKnowledgeEntry(post);
    expect(entry).not.toBeNull();
    expect(entry?.taskId).toContain("주식");
    expect(entry?.title).toBe("주식/마켓");
  });

  it("treats run.json artifacts as runtime noise", () => {
    expect(isRuntimeNoiseKnowledgeEntry({ title: "리서처 · task-1 · run.json" })).toBe(true);
    expect(isRuntimeNoiseKnowledgeEntry({ jsonPath: ".rail/studio_runs/role-1/run.json" })).toBe(true);
    expect(isRuntimeNoiseKnowledgeEntry({ jsonPath: "/tmp/export.json" })).toBe(false);
  });
});
