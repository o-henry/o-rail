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
    expect(markdown).toContain("## 요약");
    expect(markdown).toContain("## 핵심 포인트");
    expect(markdown).toContain("## 리스크");
    expect(markdown).toContain("## 참고 링크");
    expect(markdown).not.toContain("(출력 없음)");
  });

  it("uses via template label as topic/group fallback for via_flow nodes", () => {
    const built = buildFeedPost({
      runId: "run-rag-1",
      node: {
        id: "turn-rag-news",
        type: "turn",
        config: {
          executor: "via_flow",
          viaTemplateLabel: "뉴스",
        },
      },
      status: "done",
      createdAt: "2026-03-05T10:00:00.000Z",
      summary: "RAG 실행 완료",
      logs: ["[VIA] flow_id=1 실행 요청", "[VIA] 완료 run_id=via-1, artifacts=2"],
      output: { via: { flowId: 1, runId: "via-1", status: "done", artifacts: [] } },
    });

    expect(built.post.topicLabel).toBe("뉴스");
    expect(built.post.groupName).toBe("뉴스");
    expect(built.post.executor).toBe("via_flow");
  });

  it("builds via markdown without input snapshot/sources/logs and uses content summary", () => {
    const built = buildFeedPost({
      runId: "run-rag-2",
      node: {
        id: "turn-rag-community",
        type: "turn",
        config: {
          executor: "via_flow",
          viaTemplateLabel: "커뮤니티",
        },
      },
      status: "done",
      createdAt: "2026-03-05T11:00:00.000Z",
      summary: "턴 실행 완료",
      logs: ["[VIA] flow_id=1 실행 요청", "[VIA] 완료 run_id=via-2, artifacts=2"],
      inputSources: [{ kind: "node", agentName: "RAG", roleLabel: "source", summary: "x" }],
      inputData: { text: "snapshot" },
      output: {
        via: {
          flowId: 1,
          runId: "via-2",
          status: "done",
          detail: {
            payload: {
              highlights: ["한국 커뮤니티에서 AI 생산성 도구 급증", "미국 레딧에서 반도체 실적 논의 확대"],
              items: [],
            },
          },
        },
      },
    });

    const markdown = String(
      built.post.attachments.find((attachment: { kind: string }) => attachment.kind === "markdown")?.content ?? "",
    );
    expect(markdown).toContain("## 요약");
    expect(markdown).toContain("한국 커뮤니티에서 AI 생산성 도구 급증");
    expect(markdown).not.toContain("## 입력 출처");
    expect(markdown).not.toContain("## 전달 입력 스냅샷");
    expect(markdown).not.toContain("## 노드 로그");
    expect(markdown).not.toContain("턴 실행 완료");
  });
});
