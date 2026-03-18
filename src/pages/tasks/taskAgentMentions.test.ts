import { describe, expect, it } from "vitest";
import { applyTaskAgentMention, getTaskAgentMentionMatch } from "./taskAgentMentions";

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
