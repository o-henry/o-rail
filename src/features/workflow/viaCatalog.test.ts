import { describe, expect, it } from "vitest";
import {
  isViaNodeType,
  viaNodeIconText,
  viaNodeLabel,
  VIA_NODE_OPTIONS,
} from "./viaCatalog";

describe("viaCatalog", () => {
  it("contains source/transform/agent/export nodes", () => {
    const ids = VIA_NODE_OPTIONS.map((row) => row.value);
    expect(ids).toContain("source.news");
    expect(ids).toContain("source.sns");
    expect(ids).toContain("source.community");
    expect(ids).toContain("source.dev");
    expect(ids).toContain("source.market");
    expect(ids).toContain("transform.normalize");
    expect(ids).toContain("transform.verify");
    expect(ids).toContain("transform.rank");
    expect(ids).toContain("agent.codex");
    expect(ids).toContain("export.rag");
    expect(ids).not.toContain("source.threads");
    expect(ids).not.toContain("source.reddit");
    expect(ids).not.toContain("source.hn");
  });

  it("recognizes known via node types (legacy aliases included)", () => {
    expect(isViaNodeType("source.news")).toBe(true);
    expect(isViaNodeType("source.sns")).toBe(true);
    expect(isViaNodeType("source.x")).toBe(true);
    expect(isViaNodeType("source.hn")).toBe(true);
    expect(isViaNodeType("random.node")).toBe(false);
  });

  it("maps labels and icon placeholders", () => {
    expect(viaNodeLabel("source.news")).toBe("뉴스 수집 (미/일/중/한)");
    expect(viaNodeIconText("source.news")).toBe("NEWS");
    expect(viaNodeLabel("source.threads")).toBe("SNS 수집 (X+Threads)");
    expect(viaNodeLabel("unknown.type")).toBe("unknown.type");
    expect(viaNodeIconText("unknown.type")).toBe("NODE");
  });
});
