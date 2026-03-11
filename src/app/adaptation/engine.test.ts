import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateAdaptiveRecipe } from "./engine";
import type { AdaptiveWorkspaceData } from "./types";

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe("evaluateAdaptiveRecipe", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: createStorage(),
      },
    });
  });

  it("records comparisons and promotes a repeated winner after 3 wins in the last 5 eligible comparisons", async () => {
    const writes = new Map<string, string>();
    const invokeFn: any = vi.fn(async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === "workspace_read_text") {
        return String(writes.get(String(args?.path ?? "")) ?? "") as T;
      }
      if (command === "workspace_write_text") {
        const target = `${String(args?.cwd ?? "")}/${String(args?.name ?? "")}`;
        writes.set(target, String(args?.content ?? ""));
        return target as T;
      }
      return "" as T;
    });
    const baselineRecipe = {
      id: "baseline-a",
      workspace: "/tmp/adapt",
      family: "preset:creative" as const,
      familyBucket: "creative" as const,
      graphShapeHash: "g0",
      promptPackHash: "p0",
      tuningBundleHash: "t0",
      presetKind: "creative" as const,
      primaryRoleIds: [],
      artifactTypes: [],
      graphSummary: "graph baseline",
      promptSummary: "prompt baseline",
      tuningSummary: "tuning baseline",
      candidateKind: "current" as const,
      createdAt: new Date().toISOString(),
      turnNodes: [],
    };
    const challengerRecipe = {
      id: "candidate-a",
      workspace: "/tmp/adapt",
      family: "preset:creative" as const,
      familyBucket: "creative" as const,
      graphShapeHash: "g",
      promptPackHash: "p",
      tuningBundleHash: "t",
      presetKind: "creative" as const,
      primaryRoleIds: [],
      artifactTypes: [],
      graphSummary: "graph",
      promptSummary: "prompt",
      tuningSummary: "tuning",
      candidateKind: "current" as const,
      createdAt: new Date().toISOString(),
      turnNodes: [],
    };

    let latest: AdaptiveWorkspaceData | null = null;
    await evaluateAdaptiveRecipe({
      cwd: "/tmp/adapt",
      invokeFn,
      recipe: baselineRecipe,
      evaluation: {
        question: "창의적인 아이디어",
        finalAnswer: "## 결론\n- 기본안\n## 실행안\n- 단계\n## 리스크\n- 범위",
        evidenceCount: 1,
        knowledgeTraceCount: 1,
        internalMemoryTraceCount: 0,
        runMemoryCount: 0,
        qualityPassRate: 0.7,
        qualityAvgScore: 72,
        totalNodeCount: 4,
        failedNodeCount: 0,
        userMemory: [],
        artifactTypeCount: 1,
      },
    });
    for (let index = 0; index < 3; index += 1) {
      latest = await evaluateAdaptiveRecipe({
        cwd: "/tmp/adapt",
        invokeFn,
        recipe: { ...challengerRecipe, createdAt: new Date(Date.now() + index * 1000).toISOString() },
        evaluation: {
          question: "창의적인 아이디어",
          finalAnswer: "## 결론\n- 창의적인 아이디어 제안\n## 실행안\n- 단계\n## 리스크\n- 범위와 테스트",
          evidenceCount: 3,
          knowledgeTraceCount: 2,
          internalMemoryTraceCount: 1,
          runMemoryCount: 1,
          qualityPassRate: 1,
          qualityAvgScore: 84,
          totalNodeCount: 4,
          failedNodeCount: 0,
          userMemory: [],
          artifactTypeCount: 1,
        },
      });
    }

    expect(latest?.comparisons[0]?.promoted || latest?.champions[0]?.promotedAt).toBeTruthy();
  });

  it("keeps recording while frozen without promoting challengers", async () => {
    const writes = new Map<string, string>();
    const invokeFn: any = vi.fn(async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === "workspace_read_text") {
        return String(writes.get(String(args?.path ?? "")) ?? "") as T;
      }
      if (command === "workspace_write_text") {
        const target = `${String(args?.cwd ?? "")}/${String(args?.name ?? "")}`;
        writes.set(target, String(args?.content ?? ""));
        return target as T;
      }
      return "" as T;
    });
    writes.set(
      "/tmp/frozen/.rail/studio_adaptation/state.json",
      JSON.stringify({
        version: 1,
        workspace: "/tmp/frozen",
        learningState: "frozen",
        updatedAt: new Date().toISOString(),
      }),
    );

    const next = await evaluateAdaptiveRecipe({
      cwd: "/tmp/frozen",
      invokeFn,
      recipe: {
        id: "candidate-frozen",
        workspace: "/tmp/frozen",
        family: "preset:research",
        familyBucket: "research",
        graphShapeHash: "g2",
        promptPackHash: "p2",
        tuningBundleHash: "t2",
        presetKind: "research",
        primaryRoleIds: [],
        artifactTypes: [],
        graphSummary: "graph",
        promptSummary: "prompt",
        tuningSummary: "tuning",
        candidateKind: "current",
        createdAt: new Date().toISOString(),
        turnNodes: [],
      },
      evaluation: {
        question: "근거 중심 리서치",
        finalAnswer: "## 결론\n- 근거\n## 실행안\n- 단계\n## 리스크\n- 모호성",
        evidenceCount: 5,
        knowledgeTraceCount: 4,
        internalMemoryTraceCount: 1,
        runMemoryCount: 1,
        qualityPassRate: 1,
        qualityAvgScore: 89,
        totalNodeCount: 4,
        failedNodeCount: 0,
        userMemory: [],
        artifactTypeCount: 1,
      },
    });

    expect(next.profile.learningState).toBe("frozen");
    expect(next.comparisons.length).toBeGreaterThan(0);
    expect(next.comparisons[0]?.promoted).toBe(false);
  });
});
