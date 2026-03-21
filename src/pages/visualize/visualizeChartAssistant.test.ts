import { describe, expect, it } from "vitest";
import { buildVisualizeChartAssistantResult } from "./visualizeChartAssistant";

describe("buildVisualizeChartAssistantResult", () => {
  it("prefers a genre chart when the prompt asks for genre popularity", () => {
    const result = buildVisualizeChartAssistantResult({
      prompt: "장르 인기 차트를 만들어줘",
      leadCopy: "genre summary",
      topSources: [{ sourceName: "Steam", itemCount: 4 }],
      timelineRows: [{ label: "03.20", count: 2 }],
      popularGenres: [{ genreLabel: "Shooter", popularityScore: 90 }],
      verificationRows: [{ verificationStatus: "verified", itemCount: 3 }],
      markdownChart: null,
    });
    expect(result.intent).toBe("genre");
    expect(result.chart?.labels).toEqual(["Shooter"]);
  });

  it("falls back to source mix when no prompt hint exists and genres are missing", () => {
    const result = buildVisualizeChartAssistantResult({
      prompt: "",
      leadCopy: "source summary",
      topSources: [{ sourceName: "Metacritic", itemCount: 5 }],
      timelineRows: [],
      popularGenres: [],
      verificationRows: [],
      markdownChart: null,
    });
    expect(result.intent).toBe("sources");
    expect(result.chart?.labels).toEqual(["Metacritic"]);
  });
});
