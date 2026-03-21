import { describe, expect, it } from "vitest";
import { resolveQualityScore } from "./VisualizePage";

describe("resolveQualityScore", () => {
  it("falls back to verification health when avg score data is missing", () => {
    expect(
      resolveQualityScore(
        {
          dbPath: "",
          jobId: "job-1",
          totals: {
            items: 10,
            sources: 4,
            verified: 6,
            warnings: 2,
            conflicted: 1,
            avgScore: 0,
            avgHotScore: 0,
          },
          bySourceType: [],
          byVerificationStatus: [],
          timeline: [],
          topSources: [],
        },
        [],
        0,
      ),
    ).toBe(74);
  });

  it("blends explicit evidence scores with verification quality", () => {
    expect(
      resolveQualityScore(
        {
          dbPath: "",
          jobId: "job-2",
          totals: {
            items: 4,
            sources: 2,
            verified: 3,
            warnings: 1,
            conflicted: 0,
            avgScore: 80,
            avgHotScore: 0,
          },
          bySourceType: [],
          byVerificationStatus: [],
          timeline: [],
          topSources: [],
        },
        [
          {
            itemFactId: "fact-1",
            jobId: "job-2",
            jobRunId: "run-1",
            viaRunId: "via-1",
            title: "A",
            sourceType: "web",
            sourceName: "Steam",
            country: "KR",
            adapter: "web",
            itemKey: "item-1",
            sourceItemId: "item-1",
            url: "https://example.com/a",
            summary: "",
            contentExcerpt: "",
            publishedAt: "",
            fetchedAt: "",
            score: 80,
            hotScore: 0,
            verificationStatus: "verified",
            sourceCount: 1,
            rawExportPath: "",
          },
        ],
        0,
      ),
    ).toBe(83);
  });
});
