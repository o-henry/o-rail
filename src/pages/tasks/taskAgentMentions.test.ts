import { describe, expect, it } from "vitest";
import {
  applyTaskAgentMention,
  extractTaskAgentMentionTokens,
  findTaskAgentMentionRemovalRange,
  getTaskAgentMentionMatch,
} from "./taskAgentMentions";

describe("getTaskAgentMentionMatch", () => {
  it("finds mention query at the cursor", () => {
    const match = getTaskAgentMentionMatch("please ask @imp", "please ask @imp".length);
    expect(match?.query).toBe("imp");
    expect(match?.options.some((option) => option.mention === "@implementer")).toBe(true);
  });

  it("surfaces researcher in mention search", () => {
    const match = getTaskAgentMentionMatch("please ask @rese", "please ask @rese".length);
    expect(match?.options.some((option) => option.mention === "@researcher")).toBe(true);
  });

  it("surfaces external provider mentions in mention search", () => {
    const match = getTaskAgentMentionMatch("please ask @ste", "please ask @ste".length);
    expect(match?.options.some((option) => option.mention === "@steel")).toBe(true);
  });

  it("surfaces AI web providers in mention search", () => {
    const match = getTaskAgentMentionMatch("please ask @g", "please ask @g".length);
    expect(match?.options.some((option) => option.mention === "@gpt")).toBe(true);
    expect(match?.options.some((option) => option.mention === "@gemini")).toBe(true);
    expect(match?.options.some((option) => option.mention === "@grok")).toBe(true);
  });

  it("surfaces orchestration mode tags with descriptions", () => {
    const match = getTaskAgentMentionMatch("please use @te", "please use @te".length);
    const option = match?.options.find((entry) => entry.mention === "@team");
    expect(option?.label).toBe("TEAM");
    expect(option?.description).toContain("계획");
  });

  it("returns null when cursor is not inside a mention token", () => {
    expect(getTaskAgentMentionMatch("please ask implementer", 10)).toBeNull();
  });
});

describe("applyTaskAgentMention", () => {
  it("replaces the current token with the selected mention", () => {
    const input = "please ask @imp about this";
    const match = getTaskAgentMentionMatch(input, "@imp".length + "please ask ".length);
    expect(match).not.toBeNull();
    expect(applyTaskAgentMention(input, match!, "@implementer")).toBe("please ask @implementer about this");
  });

  it("can insert orchestration mode mentions into the draft", () => {
    const input = "please use @te for this";
    const match = getTaskAgentMentionMatch(input, "please use @te".length);
    expect(match).not.toBeNull();
    expect(applyTaskAgentMention(input, match!, "@team")).toBe("please use @team for this");
  });
});

describe("extractTaskAgentMentionTokens", () => {
  it("returns only confirmed mention tokens in source order for inline rendering", () => {
    expect(extractTaskAgentMentionTokens("@designer hi @researcher @implementer   @designer   ")).toMatchObject([
      { mention: "@designer" },
      { mention: "@researcher" },
      { mention: "@implementer" },
      { mention: "@designer" },
    ]);
  });

  it("does not render a chip for a raw typed mention before selection is confirmed", () => {
    expect(extractTaskAgentMentionTokens("@designer")).toEqual([]);
  });
});

describe("findTaskAgentMentionRemovalRange", () => {
  it("removes a whole mention token when backspace is pressed after it", () => {
    const input = "@designer  hello";
    expect(findTaskAgentMentionRemovalRange(input, "@designer  ".length)).toEqual({
      start: 0,
      end: "@designer  ".length,
    });
  });

  it("removes the whole token plus every trailing space", () => {
    const input = "@designer  hello";
    expect(findTaskAgentMentionRemovalRange(input, "@designer  ".length)).toEqual({
      start: 0,
      end: "@designer  ".length,
    });
  });
});
