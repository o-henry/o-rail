import { describe, expect, it } from "vitest";
import { buildDashboardFallbackSnapshot, parseDashboardSnapshotText } from "./snapshot";

describe("dashboard snapshot parser", () => {
  it("parses fenced json payload", () => {
    const text = [
      "```json",
      JSON.stringify({
        summary: "hello",
        highlights: ["a", "b"],
        risks: ["r1"],
        events: [{ title: "event", date: "2026-03-01" }],
        references: [{ url: "https://example.com", title: "Example", source: "example.com" }],
        generatedAt: "2026-02-28T00:00:00.000Z",
        topic: "globalHeadlines",
        model: "gpt-5.2-codex",
      }),
      "```",
    ].join("\n");

    const snapshot = parseDashboardSnapshotText("globalHeadlines", "gpt-5.2-codex", text);
    expect(snapshot.summary).toBe("hello");
    expect(snapshot.highlights).toEqual(["a", "b"]);
    expect(snapshot.references).toHaveLength(1);
    expect(snapshot.status).toBe("ok");
  });

  it("falls back to degraded snapshot when text is not json", () => {
    const snapshot = parseDashboardSnapshotText("riskAlertBoard", "gpt-5.2-codex", "plain text");
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.summary).toContain("plain text");
  });

  it("builds fallback snapshot with normalization", () => {
    const snapshot = buildDashboardFallbackSnapshot("eventCalendar", "gpt-5.2-codex", {
      summary: "fallback",
      highlights: ["x", ""],
      references: [{ url: "https://a.com", title: "A", source: "a.com" }],
    });
    expect(snapshot.summary).toBe("fallback");
    expect(snapshot.highlights).toEqual(["x"]);
    expect(snapshot.references).toHaveLength(1);
  });

  it("sanitizes machine/json/html payloads for human-readable highlights", () => {
    const text = JSON.stringify({
      summary: "<div>  시장 변동성 확대  </div>",
      highlights: [
        "{\"title\":\"미국 고용지표 둔화\",\"note\":\"채권 금리 하락\"}",
        { text: "AI 반도체 수요 증가" },
        "<p>원자재 가격 급등</p>",
      ],
      risks: [],
      events: [],
      references: [{ url: "https://example.com", title: "<b>Example</b>", source: "example.com" }],
    });
    const snapshot = parseDashboardSnapshotText("marketSummary", "gpt-5.2-codex", text);
    expect(snapshot.summary).toBe("시장 변동성 확대");
    expect(snapshot.highlights).toEqual([
      "미국 고용지표 둔화",
      "AI 반도체 수요 증가",
      "원자재 가격 급등",
    ]);
    expect(snapshot.references[0]?.title).toBe("Example");
  });
});
