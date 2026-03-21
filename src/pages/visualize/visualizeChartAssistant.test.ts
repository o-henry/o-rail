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
      quantitativeRows: [],
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
      quantitativeRows: [],
      markdownChart: null,
    });
    expect(result.intent).toBe("sources");
    expect(result.chart?.labels).toEqual(["Metacritic"]);
  });

  it("uses extracted player counts when the prompt asks for concurrency", () => {
    const result = buildVisualizeChartAssistantResult({
      prompt: "장르별 동접자 수를 차트로 보여줘",
      leadCopy: "player summary",
      topSources: [],
      timelineRows: [],
      popularGenres: [],
      verificationRows: [],
      quantitativeRows: [
        { label: "Slay the Spire 2", value: 304503, unit: "players" },
        { label: "ARC Raiders", value: 106543, unit: "players" },
      ],
      markdownChart: null,
    });

    expect(result.intent).toBe("players");
    expect(result.chart?.labels).toEqual(["Slay the Spire 2", "ARC Raiders"]);
    expect(result.chart?.series[0]?.data).toEqual([304503, 106543]);
  });
});
