import { describe, expect, it } from "vitest";
import {
  createDefaultDashboardAgentConfigMap,
  normalizeDashboardAgentConfigMap,
  normalizeDashboardTopicConfig,
} from "./config";

describe("dashboard intelligence config", () => {
  it("creates topic defaults with expected cadence", () => {
    const defaults = createDefaultDashboardAgentConfigMap();
    expect(defaults.marketSummary.cadenceHours).toBe(6);
    expect(defaults.devCommunityHotTopics.cadenceHours).toBe(6);
    expect(defaults.paperResearch.cadenceHours).toBe(24);
    expect(defaults.eventCalendar.cadenceHours).toBe(12);
    expect(defaults.riskAlertBoard.cadenceHours).toBe(3);
    expect(defaults.devEcosystem.cadenceHours).toBe(24);
    expect(defaults.devCommunityHotTopics.allowlist).toEqual(
      expect.arrayContaining(["csdn.net", "juejin.cn", "qiita.com", "zenn.dev", "news.ycombinator.com"]),
    );
    expect(defaults.industryTrendRadar.allowlist).toEqual(
      expect.arrayContaining(["x.com", "threads.net", "technologyreview.com", "venturebeat.com"]),
    );
    expect(defaults.devEcosystem.allowlist).toEqual(
      expect.arrayContaining([
        "openai.com",
        "deepmind.google",
        "huggingface.co",
        "unity.com",
        "unrealengine.com",
        "gamedeveloper.com",
      ]),
    );
    expect(defaults.riskAlertBoard.allowlist).toEqual(
      expect.arrayContaining([
        "fema.gov",
        "earthquake.usgs.gov",
        "noaa.gov",
        "weather.gov",
        "gdacs.org",
        "reliefweb.int",
      ]),
    );
    expect(defaults.marketSummary.allowlist).toEqual(
      expect.arrayContaining(["coindesk.com", "cointelegraph.com", "bitcoinmagazine.com", "finance.naver.com/sise/"]),
    );
  });

  it("normalizes invalid topic config values", () => {
    const normalized = normalizeDashboardTopicConfig("globalHeadlines", {
      enabled: "x",
      model: "",
      cadenceHours: 9999,
      maxSources: 0,
      maxSnippets: -1,
      maxSnippetChars: 999999,
      allowlist: [null, "", " Reuters.com "],
    });
    expect(normalized.enabled).toBe(true);
    expect(normalized.model.length).toBeGreaterThan(0);
    expect(normalized.cadenceHours).toBe(168);
    expect(normalized.maxSources).toBe(1);
    expect(normalized.maxSnippets).toBe(1);
    expect(normalized.maxSnippetChars).toBe(6000);
    expect(normalized.allowlist).not.toContain("reuters.com");
    expect(normalized.allowlist).not.toContain("wsj.com");
    expect(normalized.allowlist).not.toContain("ft.com");
    expect(normalized.allowlist).not.toContain("feeds.reuters.com/reuters/worldnews");
    expect(normalized.allowlist).toEqual(
      expect.arrayContaining([
        "apnews.com/hub/apf-topnews?output=rss",
        "feeds.bbci.co.uk/news/world/rss.xml",
        "rss.nytimes.com/services/xml/rss/nyt/world.xml",
        "theguardian.com/world/rss",
        "aljazeera.com/xml/rss/all.xml",
        "npr.org/rss/rss.php?id=1004",
      ]),
    );
  });

  it("fills missing topics from defaults during map normalization", () => {
    const normalized = normalizeDashboardAgentConfigMap({
      marketSummary: {
        enabled: false,
        model: "gpt-5.3-codex",
        systemPrompt: "x",
        cadenceHours: 4,
        maxSources: 6,
        maxSnippets: 5,
        maxSnippetChars: 1200,
        allowlist: ["example.com"],
      },
    });
    expect(normalized.marketSummary.enabled).toBe(false);
    expect(normalized.marketSummary.allowlist).toEqual([
      "example.com",
      "finance.yahoo.com",
      "stooq.com",
      "investing.com",
      "coindesk.com",
      "cointelegraph.com",
      "bitcoinmagazine.com",
      "finance.naver.com/sise/",
    ]);
    expect(normalized.globalHeadlines.model.length).toBeGreaterThan(0);
  });

  it("blacklists clien sources from community topics", () => {
    const normalized = normalizeDashboardTopicConfig("communityHotTopics", {
      allowlist: ["reddit.com", "clien.net", "www.clien.net", "v2ex.com"],
    });
    expect(normalized.allowlist).toContain("reddit.com");
    expect(normalized.allowlist).toContain("v2ex.com");
    expect(normalized.allowlist).not.toContain("clien.net");
    expect(normalized.allowlist).not.toContain("www.clien.net");
  });
});
