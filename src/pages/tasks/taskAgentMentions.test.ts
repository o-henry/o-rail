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
});

describe("extractTaskAgentMentionTokens", () => {
  it("returns only confirmed mention tokens in source order for inline rendering", () => {
    expect(extractTaskAgentMentionTokens("@designer hi @implementer   @designer   ")).toMatchObject([
      { mention: "@designer" },
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
