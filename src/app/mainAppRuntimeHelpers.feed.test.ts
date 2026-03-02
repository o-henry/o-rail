import { describe, expect, it } from "vitest";
import { buildFeedPost } from "./mainAppRuntimeHelpers";

describe("buildFeedPost dashboard snapshot output", () => {
  it("renders dashboard snapshot fields into markdown detail", () => {
    const built = buildFeedPost({
      runId: "topic-20260302-demo",
      node: {
        id: "dashboard-globalHeadlines",
        type: "turn",
        config: {
          executor: "codex",
          model: "gpt-5.2-codex",
          role: "DASHBOARD BRIEFING",
        },
      },
      status: "done",
      createdAt: "2026-03-02T09:22:00.000Z",
      summary: "글로벌 헤드라인 요약",
      logs: ["글로벌 헤드라인 브리핑 생성"],
      output: {
        summary: "중동 리스크와 거시경제 불확실성이 동시 확대되고 있습니다.",
        highlights: ["에너지 가격 변동성 상승", "항공/물류 경로 리스크 확대"],
        risks: ["정책 불확실성 증가"],
        references: [
          {
            title: "Global Headlines Source",
            url: "https://example.com/global",
            source: "example.com",
          },
        ],
      },
    });

    const markdown = String(
      built.post.attachments.find((attachment: { kind: string }) => attachment.kind === "markdown")?.content ?? "",
    );
    expect(markdown).toContain("## 실행 요약");
    expect(markdown).toContain("## 핵심 포인트");
    expect(markdown).toContain("## 리스크");
    expect(markdown).toContain("## 참고 링크");
    expect(markdown).not.toContain("(출력 없음)");
  });
});

