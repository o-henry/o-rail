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
