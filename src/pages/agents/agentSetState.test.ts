import { describe, expect, it } from "vitest";
import type { AgentSetPresetSnapshot, AgentSetState } from "./agentTypes";
import {
  buildDashboardInsightsBySet,
  createCustomThread,
  mergeDashboardInsightsBySetState,
  restoreSetStateFromPreset,
} from "./agentSetState";

describe("restoreSetStateFromPreset", () => {
  it("restores preset mission/threads/draft while keeping dashboard insights", () => {
    const current: AgentSetState = {
      setMission: "custom mission",
      threads: [createCustomThread("agent-9")],
      activeThreadId: "agent-9",
      draft: "custom draft",
      attachedFiles: [{ id: "file-1", name: "memo.txt" }],
      dashboardInsights: ["marketSummary: 상승 신호", "riskAlertsBoard: 변동성 확대"],
    };

    const preset: AgentSetPresetSnapshot = {
      mission: "preset mission",
      defaultDraft: "preset draft",
      threads: [
        {
          id: "market-scout",
          name: "signal-scout",
          role: "Signal Scout",
          guidance: ["핵심 신호 우선 정리"],
          starterPrompt: "최근 시장 신호를 정리해줘.",
          status: "preset",
        },
      ],
    };

    const restored = restoreSetStateFromPreset(current, preset);

    expect(restored.setMission).toBe("preset mission");
    expect(restored.draft).toBe("preset draft");
    expect(restored.activeThreadId).toBe("market-scout");
    expect(restored.threads.map((thread) => thread.name)).toEqual(["signal-scout"]);
    expect(restored.attachedFiles).toEqual([]);
    expect(restored.dashboardInsights).toEqual(current.dashboardInsights);
  });
});

describe("dashboard insights mapping", () => {
  it("maps snapshot line only to matching data topic set and formats topic token as upper snake", () => {
    const insightsBySet = buildDashboardInsightsBySet(
      [
        { id: "market-research", label: "시장 조사 세트", description: "일반 세트" },
        { id: "data-marketSummary", label: "시장 요약 세트", description: "데이터 세트" },
        { id: "data-globalHeadlines", label: "글로벌 헤드라인 세트", description: "데이터 세트" },
      ],
      {
        marketSummary: {
          topic: "marketSummary",
          model: "gpt-5.2-codex",
          generatedAt: "2026-03-01T00:00:00.000Z",
          summary: "요약 생성 완료",
          highlights: [],
          risks: [],
          events: [],
          references: [],
        },
      },
    );

    expect(insightsBySet["data-marketSummary"]).toEqual(["MARKET_SUMMARY: 요약 생성 완료"]);
    expect(insightsBySet["data-globalHeadlines"]).toEqual([]);
    expect(insightsBySet["market-research"]).toEqual([]);
  });

  it("clears stale cross-injected insight lines from unrelated sets", () => {
    const setStateMap: Record<string, AgentSetState> = {
      "market-research": {
        setMission: "시장 조사",
        threads: [createCustomThread("agent-1")],
        activeThreadId: "agent-1",
        draft: "",
        attachedFiles: [],
        dashboardInsights: ["MARKET_SUMMARY: 이전 오염 데이터"],
      },
      "data-marketSummary": {
        setMission: "시장 요약",
        threads: [createCustomThread("agent-2")],
        activeThreadId: "agent-2",
        draft: "",
        attachedFiles: [],
        dashboardInsights: ["MARKET_SUMMARY: 이전 오염 데이터"],
      },
    };

    const { nextSetStateMap, changed } = mergeDashboardInsightsBySetState(setStateMap, {
      "market-research": [],
      "data-marketSummary": ["MARKET_SUMMARY: 최신 요약"],
    });

    expect(changed).toBe(true);
    expect(nextSetStateMap["market-research"].dashboardInsights).toEqual([]);
    expect(nextSetStateMap["data-marketSummary"].dashboardInsights).toEqual(["MARKET_SUMMARY: 최신 요약"]);
  });
});
