import { describe, expect, it } from "vitest";
import { buildQualityReport } from "./mainAppRuntimeHelpers";

describe("buildQualityReport content validation", () => {
  it("passes evidence-backed research output", async () => {
    const report = await buildQualityReport({
      node: {
        id: "research-node",
        type: "turn",
        config: {
          executor: "codex",
          qualityProfile: "research_evidence",
        },
      } as any,
      config: {
        executor: "codex",
        qualityProfile: "research_evidence",
      } as any,
      output: JSON.stringify({
        market_size: 120,
        growth_rate: 18,
        source_url: "https://example.com/report",
        as_of: "2026-03-01",
        risk_note: "supply constraint remains",
      }),
      cwd: "/tmp",
    });

    expect(report.decision).toBe("PASS");
    expect(report.checks.find((row: { id: string }) => row.id === "content_claims")?.passed).toBe(true);
    expect(report.checks.find((row: { id: string }) => row.id === "content_citations")?.passed).toBe(true);
    expect(report.checks.find((row: { id: string }) => row.id === "content_conflicts")?.passed).toBe(true);
  });

  it("rejects research output without usable evidence", async () => {
    const report = await buildQualityReport({
      node: {
        id: "weak-research-node",
        type: "turn",
        config: {
          executor: "codex",
          qualityProfile: "research_evidence",
        },
      } as any,
      config: {
        executor: "codex",
        qualityProfile: "research_evidence",
      } as any,
      output: "좋아 보입니다. 그냥 이렇게 가면 됩니다.",
      cwd: "/tmp",
    });

    expect(report.decision).toBe("REJECT");
    expect(report.checks.find((row: { id: string }) => row.id === "content_citations")?.passed).toBe(false);
    expect(report.checks.find((row: { id: string }) => row.id === "content_issues")?.passed).toBe(false);
  });

  it("rejects research output with conflicting numeric claims", async () => {
    const report = await buildQualityReport({
      node: {
        id: "conflict-node",
        type: "turn",
        config: {
          executor: "codex",
          qualityProfile: "research_evidence",
        },
      } as any,
      config: {
        executor: "codex",
        qualityProfile: "research_evidence",
      } as any,
      output: JSON.stringify({
        revenue: 100,
        Revenue: 160,
        source_url: "https://example.com/revenue",
        as_of: "2026-03-01",
      }),
      cwd: "/tmp",
    });

    expect(report.decision).toBe("REJECT");
    expect(report.checks.find((row: { id: string }) => row.id === "content_conflicts")?.passed).toBe(false);
    expect(report.warnings.some((row: string) => row.includes("근거 충돌"))).toBe(true);
  });
});
