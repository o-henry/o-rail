import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRoleKnowledgeSourceWithProviders,
  resetRoleKnowledgeProviderRuntimeForTests,
  resolveRoleKnowledgeProviderOrder,
} from "./roleKnowledgeProviders";

describe("roleKnowledgeProviders", () => {
  beforeEach(() => {
    resetRoleKnowledgeProviderRuntimeForTests();
  });

  it("includes lightpanda and browser_use in bootstrap fallback order", () => {
    expect(
      resolveRoleKnowledgeProviderOrder({
        url: "https://docs.unity3d.com/Manual/index.html",
        roleId: "technical_writer",
        userPrompt: "공식 문서 기준으로 정리해줘",
      }),
    ).toEqual(["crawl4ai", "scrapling", "steel", "lightpanda_experimental", "browser_use"]);

    expect(
      resolveRoleKnowledgeProviderOrder({
        url: "https://steamcommunity.com/app/620/discussions/",
        roleId: "research_analyst",
        userPrompt: "커뮤니티 반응을 조사해줘",
      }),
    ).toEqual(["scrapling", "steel", "lightpanda_experimental", "browser_use", "crawl4ai"]);
  });

  it("accepts a later provider when earlier providers fail during parallel bootstrap", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "dashboard_crawl_provider_health") {
        return {
          provider: String(args?.provider ?? ""),
          ready: true,
          available: true,
          configured: true,
          installable: false,
          message: "ready",
        };
      }
      if (command === "dashboard_crawl_provider_fetch_url") {
        const provider = String(args?.provider ?? "");
        if (provider === "lightpanda_experimental") {
          return {
            provider,
            status: "ok",
            url: String(args?.url ?? ""),
            fetched_at: "2026-03-23T00:00:00Z",
            summary: "lightpanda summary",
            content: "lightpanda content",
            json_path: "/tmp/lightpanda.json",
          };
        }
        throw new Error(`${provider} unavailable`);
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await fetchRoleKnowledgeSourceWithProviders({
      cwd: "/tmp/workspace",
      invokeFn,
      url: "https://example.com/community",
      roleId: "research_analyst",
      userPrompt: "시장 반응을 조사해줘",
    });

    expect(result.status).toBe("ok");
    expect(result.provider).toBe("lightpanda_experimental");

    const fetchProviders = (invokeFn as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => String((call as [unknown])[0]) === "dashboard_crawl_provider_fetch_url")
      .map((call) => String((call as [string, Record<string, unknown> | undefined])[1]?.provider ?? ""));

    expect(fetchProviders).toEqual(
      expect.arrayContaining(["scrapling", "steel", "lightpanda_experimental", "browser_use", "crawl4ai"]),
    );
  });

  it("skips non-installable providers that are explicitly not configured before fetching", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "dashboard_crawl_provider_health") {
        const provider = String(args?.provider ?? "");
        if (provider === "scrapling") {
          return {
            provider,
            ready: true,
            available: true,
            configured: true,
            installable: true,
            message: "ready",
          };
        }
        return {
          provider,
          ready: false,
          available: false,
          configured: false,
          installable: false,
          message: `${provider} not configured`,
        };
      }
      if (command === "dashboard_crawl_provider_fetch_url") {
        return {
          provider: String(args?.provider ?? ""),
          status: "ok",
          url: String(args?.url ?? ""),
          fetched_at: "2026-03-23T00:00:00Z",
          summary: "ok",
          content: "ok",
        };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await fetchRoleKnowledgeSourceWithProviders({
      cwd: "/tmp/workspace",
      invokeFn,
      url: "https://example.com/community",
      roleId: "research_analyst",
      userPrompt: "시장 반응을 조사해줘",
    });

    expect(result.status).toBe("ok");
    const fetchProviders = (invokeFn as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => String((call as [unknown])[0]) === "dashboard_crawl_provider_fetch_url")
      .map((call) => String((call as [string, Record<string, unknown> | undefined])[1]?.provider ?? ""));

    expect(fetchProviders).toEqual(["scrapling"]);
  });
});
