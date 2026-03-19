import { describe, expect, it, vi } from "vitest";
import {
  executeDynamicResearchCollectionJob,
  listResearchCollectionItems,
  loadResearchSentimentSeries,
  normalizeResearchCollectionItemFilters,
  normalizeDynamicCollectionKeywords,
  normalizeDynamicCollectionUrls,
  normalizeResearchReviewFilters,
  loadResearchCollectionMetrics,
  planDynamicResearchCollectionJob,
} from "./researchStorage";
import * as tauriModule from "../../../shared/tauri";

describe("normalizeResearchReviewFilters", () => {
  it("fills defaults and trims text filters", () => {
    expect(
      normalizeResearchReviewFilters({
        source: "  ",
        gameKey: " steam:2379780 ",
        sentiment: " Positive ",
        language: " english ",
        search: " one more run ",
      }),
    ).toEqual({
      source: "steam",
      gameKey: "steam:2379780",
      sentiment: "positive",
      language: "english",
      search: "one more run",
      limit: 50,
      offset: 0,
    });
  });

  it("clamps pagination values into safe bounds", () => {
    expect(normalizeResearchReviewFilters({ limit: 999, offset: -4 })).toMatchObject({
      limit: 200,
      offset: 0,
    });
  });

  it("requests sentiment series with chart-safe defaults", async () => {
    const invokeSpy = vi.spyOn(tauriModule, "invoke").mockResolvedValue({
      dbPath: "/tmp/app.db",
      source: "steam",
      gameKey: "steam:2379780",
      items: [],
    });
    await loadResearchSentimentSeries("/repo", "steam:2379780");
    expect(invokeSpy).toHaveBeenCalledWith("research_storage_sentiment_series", {
      cwd: "/repo",
      gameKey: "steam:2379780",
      source: "steam",
      limit: 90,
    });
    invokeSpy.mockRestore();
  });

  it("normalizes dynamic url inputs with dedupe and limit", () => {
    expect(
      normalizeDynamicCollectionUrls([
        " https://example.com/a ",
        "https://example.com/a",
        "",
        "https://example.com/b",
      ]),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("plans dynamic collection jobs through tauri invoke", async () => {
    const invokeSpy = vi.spyOn(tauriModule, "invoke").mockResolvedValue({
      dbPath: "/tmp/app.db",
      job: { jobId: "collect-1" },
    });
    await planDynamicResearchCollectionJob("/repo", {
      urls: ["https://reddit.com/r/gamedev"],
      keywords: ["indie game"],
      requestedSourceType: "community",
      maxItems: 30,
    });
    expect(invokeSpy).toHaveBeenCalledWith("research_storage_plan_dynamic_job", {
      cwd: "/repo",
      urls: ["https://reddit.com/r/gamedev"],
      keywords: ["indie game"],
      label: "",
      requestedSourceType: "community",
      maxItems: 30,
    });
    invokeSpy.mockRestore();
  });

  it("normalizes dynamic keyword inputs", () => {
    expect(normalizeDynamicCollectionKeywords([" indie ", "", "indie", "roguelike"])).toEqual([
      "indie",
      "roguelike",
    ]);
  });

  it("normalizes collection item filters for safe querying", () => {
    expect(
      normalizeResearchCollectionItemFilters({
        jobId: " collect-1 ",
        sourceType: " source.news ",
        verificationStatus: " verified ",
        search: " roguelike ",
        limit: 999,
        offset: -5,
      }),
    ).toEqual({
      jobId: "collect-1",
      sourceType: "source.news",
      verificationStatus: "verified",
      search: "roguelike",
      limit: 200,
      offset: 0,
    });
  });

  it("invokes dynamic collection execution with default flow id", async () => {
    const invokeSpy = vi.spyOn(tauriModule, "invoke").mockResolvedValue({
      job: { jobId: "collect-1" },
      execution: { jobRunId: "jobrun-1" },
      via: { run_id: "via-1" },
    });
    await executeDynamicResearchCollectionJob("/repo", "collect-1");
    expect(invokeSpy).toHaveBeenCalledWith("research_storage_execute_job", {
      cwd: "/repo",
      jobId: "collect-1",
      flowId: 1,
    });
    invokeSpy.mockRestore();
  });

  it("invokes collection items query with normalized filters", async () => {
    const invokeSpy = vi.spyOn(tauriModule, "invoke").mockResolvedValue({
      dbPath: "/tmp/app.db",
      total: 0,
      limit: 25,
      offset: 0,
      items: [],
    });
    await listResearchCollectionItems("/repo", {
      jobId: " collect-1 ",
      sourceType: " source.news ",
      verificationStatus: " verified ",
      search: " automation ",
      limit: 25,
    });
    expect(invokeSpy).toHaveBeenCalledWith("research_storage_list_collection_items", {
      cwd: "/repo",
      jobId: "collect-1",
      sourceType: "source.news",
      verificationStatus: "verified",
      search: "automation",
      limit: 25,
      offset: 0,
    });
    invokeSpy.mockRestore();
  });

  it("loads collection metrics for a selected job", async () => {
    const invokeSpy = vi.spyOn(tauriModule, "invoke").mockResolvedValue({
      dbPath: "/tmp/app.db",
      jobId: "collect-1",
      totals: { items: 0 },
      bySourceType: [],
      byVerificationStatus: [],
      timeline: [],
      topSources: [],
    });
    await loadResearchCollectionMetrics("/repo", "collect-1");
    expect(invokeSpy).toHaveBeenCalledWith("research_storage_collection_metrics", {
      cwd: "/repo",
      jobId: "collect-1",
    });
    invokeSpy.mockRestore();
  });
});
