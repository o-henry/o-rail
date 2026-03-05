import { describe, expect, it } from "vitest";
import { RAG_SOURCE_PRESETS } from "./ragSourcePresets";

describe("ragSourcePresets", () => {
  it("provides 4 source presets for dynamic crawling", () => {
    expect(RAG_SOURCE_PRESETS.map((row) => row.id)).toEqual([
      "rag.source.market_hot",
      "rag.source.community_hot",
      "rag.source.news_headlines",
      "rag.source.sns_trends",
    ]);
  });

  it("includes required fields for each preset", () => {
    for (const preset of RAG_SOURCE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.keywords.length).toBeGreaterThan(0);
      expect(preset.countries.length).toBeGreaterThan(0);
      expect(preset.sites.length).toBeGreaterThan(0);
      expect(preset.maxItems).toBeGreaterThan(0);
      expect(preset.maxItems).toBeLessThanOrEqual(120);
    }
  });
});
