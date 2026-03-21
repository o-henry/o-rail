import { describe, expect, it } from "vitest";
import {
  chartRowsFromMarkdownFallback,
  mergeVisualizeMarkdownFallback,
  parseVisualizeMarkdownFallback,
} from "./visualizeMarkdownFallback";

describe("visualizeMarkdownFallback", () => {
  it("parses rail chart blocks, top sources, and evidence rows from markdown", () => {
    const parsed = parseVisualizeMarkdownFallback(`
# 리서치 수집 결과

## 가장 인기 있는 장르
장르별 인기도를 요약합니다.

\`\`\`rail-chart
{
  "chart": {
    "type": "bar",
    "labels": ["RPG", "Roguelike"],
    "series": [{ "name": "Popularity", "data": [82, 61] }]
  }
}
\`\`\`

## 주요 출처
- Steam: 4
- Metacritic: 2

## 핵심 근거
- 발더스 게이트 3 (Steam, verified, 점수 93)
  RPG 장르 대표 사례
  https://store.steampowered.com/app/1086940/Baldurs_Gate_3/
`);

    expect(parsed.charts).toHaveLength(1);
    expect(parsed.charts[0]?.title).toBe("가장 인기 있는 장르");
    expect(parsed.topSources).toEqual([
      { sourceName: "Steam", itemCount: 4 },
      { sourceName: "Metacritic", itemCount: 2 },
    ]);
    expect(parsed.evidence[0]).toMatchObject({
      title: "발더스 게이트 3",
      verificationStatus: "verified",
      score: 93,
      url: "https://store.steampowered.com/app/1086940/Baldurs_Gate_3/",
    });
    expect(parsed.metrics).toMatchObject({
      items: 1,
      sources: 2,
      verified: 1,
      avgScore: 93,
    });
  });

  it("merges fallback blocks by preferring the first non-empty section", () => {
    const merged = mergeVisualizeMarkdownFallback(
      parseVisualizeMarkdownFallback(`
## 주요 출처
- Steam: 3
`),
      parseVisualizeMarkdownFallback(`
## 핵심 근거
- Hades (Steam, verified, 점수 91)
  https://example.com/hades
`),
    );

    expect(merged.topSources).toEqual([{ sourceName: "Steam", itemCount: 3 }]);
    expect(merged.evidence).toHaveLength(1);
  });

  it("derives sources, evidence links, and ranked conclusions from findings markdown", () => {
    const parsed = parseVisualizeMarkdownFallback(`
## 조사 결론
- 인기 장르 1위는 \`슈터/FPS/익스트랙션\`입니다.
- 인기 장르 2위는 \`오픈월드 액션/RPG\`입니다.

## 핵심 근거
- Steam 공식 통계는 [Steam Stats](https://store.steampowered.com/stats/stats/)에서 확인됩니다.
- 비평 점수의 중심축은 [Metacritic 2026 current-year 게임 목록](https://www.metacritic.com/browse/game/all/all/current-year/)입니다.
- 유럽 표본은 [Eurogamer 포스트](https://x.com/eurogamer/status/123)로 보강했습니다.
`);

    expect(parsed.conclusions).toEqual([
      { title: "슈터/FPS/익스트랙션", detail: "", rank: 1 },
      { title: "오픈월드 액션/RPG", detail: "", rank: 2 },
    ]);
    expect(parsed.topSources).toEqual([
      { sourceName: "Steam Stats", itemCount: 1 },
      { sourceName: "Metacritic 2026 current-year 게임 목록", itemCount: 1 },
      { sourceName: "Eurogamer 포스트", itemCount: 1 },
    ]);
    expect(parsed.evidence).toEqual([
      expect.objectContaining({
        title: "Steam 공식 통계는 Steam Stats에서 확인됩니다.",
        url: "https://store.steampowered.com/stats/stats/",
      }),
      expect.objectContaining({
        title: "비평 점수의 중심축은 Metacritic 2026 current-year 게임 목록입니다.",
        url: "https://www.metacritic.com/browse/game/all/all/current-year/",
      }),
      expect.objectContaining({
        title: "유럽 표본은 Eurogamer 포스트로 보강했습니다.",
        url: "https://x.com/eurogamer/status/123",
      }),
    ]);
    expect(parsed.metrics).toMatchObject({
      items: 3,
      sources: 3,
    });
  });

  it("derives table rows from a parsed markdown chart", () => {
    const parsed = parseVisualizeMarkdownFallback(`
## 타임라인
\`\`\`rail-chart
{
  "chart": {
    "type": "line",
    "labels": ["03.18", "03.19"],
    "series": [{ "name": "Items", "data": [5, 8] }]
  }
}
\`\`\`
`);

    expect(chartRowsFromMarkdownFallback(parsed.charts[0]?.chart)).toEqual([
      { label: "03.18", count: 5 },
      { label: "03.19", count: 8 },
    ]);
  });
});
