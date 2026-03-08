import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_REASONING_LEVEL,
  normalizeTurnReasoningLevel,
  toTurnReasoningEffort,
} from "./reasoningLevels";

describe("reasoningLevels", () => {
  it("uses 중간 as the default label", () => {
    expect(DEFAULT_TURN_REASONING_LEVEL).toBe("중간");
  });

  it("maps Korean labels to actual runtime effort values", () => {
    expect(toTurnReasoningEffort("낮음")).toBe("low");
    expect(toTurnReasoningEffort("중간")).toBe("medium");
    expect(toTurnReasoningEffort("높음")).toBe("high");
    expect(toTurnReasoningEffort("매우 높음")).toBe("xhigh");
  });

  it("normalizes effort ids back to Korean labels", () => {
    expect(normalizeTurnReasoningLevel("low")).toBe("낮음");
    expect(normalizeTurnReasoningLevel("medium")).toBe("중간");
    expect(normalizeTurnReasoningLevel("high")).toBe("높음");
    expect(normalizeTurnReasoningLevel("xhigh")).toBe("매우 높음");
  });
});
