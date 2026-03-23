import { describe, expect, it } from "vitest";
import { buildStructuredExternalWebPerspective } from "./externalWebPerspective";

describe("buildStructuredExternalWebPerspective", () => {
  it("re-buckets external web notes into rag-friendly sections", () => {
    const document = buildStructuredExternalWebPerspective([
      "- 아이디어 후보: 소리 리듬으로 탄막을 피하는 모바일 한 손 게임",
      "- 차별화 포인트는 상투적인 뱀서라이크 조합보다 청각 중심 판독성에 있음",
      "- 리스크: 첫 30초 온보딩이 실패하면 리텐션이 급락할 수 있음",
      "- 그러나 코어 루프가 너무 복잡하면 캐주얼층 진입이 어렵다는 이견도 있음",
      "- claim: 짧은 세션에서도 반복 플레이 동기가 살아야 함",
    ].join("\n"));

    expect(document).toContain("# 외부 웹 AI 관점");
    expect(document).toContain("## claims");
    expect(document).toContain("## ideas");
    expect(document).toContain("## risks");
    expect(document).toContain("## disagreements");
    expect(document).toContain("## novelty_signals");
    expect(document).toContain("소리 리듬으로 탄막을 피하는 모바일 한 손 게임");
    expect(document).toContain("온보딩이 실패하면 리텐션이 급락");
    expect(document).toContain("캐주얼층 진입이 어렵다는 이견");
  });

  it("falls back to claims when the summary is plain text", () => {
    const document = buildStructuredExternalWebPerspective("시장 진입 타이밍과 차별화 포인트를 먼저 검증해야 한다.");

    expect(document).toContain("## claims");
    expect(document).toContain("시장 진입 타이밍과 차별화 포인트를 먼저 검증해야 한다.");
  });
});
