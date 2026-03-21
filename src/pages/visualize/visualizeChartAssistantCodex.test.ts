import { describe, expect, it } from "vitest";
import {
  buildVisualizeChartAssistantCodexPrompt,
  parseVisualizeChartAssistantCodexOutput,
} from "./visualizeChartAssistantCodex";

describe("visualizeChartAssistantCodex", () => {
  it("builds a prompt that includes the user request and research materials", () => {
    const prompt = buildVisualizeChartAssistantCodexPrompt({
      cwd: "/tmp/demo",
      invokeFn: async () => null as never,
      prompt: "장르별 동접자 수를 차트로 보여줘",
      reportBody: "보고서 본문",
      collectionBody: "수집 문서 본문",
      leadCopy: "요약",
      topSources: [{ sourceName: "Steam", itemCount: 3 }],
      timelineRows: [{ label: "03.20", count: 5 }],
      popularGenres: [{ genreLabel: "Shooter", popularityScore: 80 }],
      verificationRows: [{ verificationStatus: "verified", itemCount: 2 }],
    });

    expect(prompt).toContain("USER REQUEST:");
    expect(prompt).toContain("장르별 동접자 수를 차트로 보여줘");
    expect(prompt).toContain("COLLECTION DOCUMENT:");
    expect(prompt).toContain("REPORT DOCUMENT:");
    expect(prompt).toContain("\"sourceName\": \"Steam\"");
  });

  it("parses summary, logs, and a rail-chart block from model output", () => {
    const parsed = parseVisualizeChartAssistantCodexOutput(`
SUMMARY: 문서에서 확인된 타이틀별 동접자 수를 차트로 만들었습니다.
LOGS:
- 요청과 가장 가까운 정량 축을 선택했습니다.
- 문서 본문에서 확인된 수치만 사용했습니다.

\`\`\`rail-chart
{
  "chart": {
    "type": "bar",
    "labels": ["Slay the Spire 2", "ARC Raiders"],
    "series": [{ "name": "Players", "data": [304503, 106543] }]
  }
}
\`\`\`
`);

    expect(parsed.summary).toContain("차트로 만들었습니다");
    expect(parsed.logs).toEqual([
      "요청과 가장 가까운 정량 축을 선택했습니다.",
      "문서 본문에서 확인된 수치만 사용했습니다.",
    ]);
    expect(parsed.chart?.labels).toEqual(["Slay the Spire 2", "ARC Raiders"]);
  });
});
