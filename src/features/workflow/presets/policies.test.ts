import { describe, expect, it } from "vitest";
import { resolvePresetTurnPolicy } from "./policies";

describe("resolvePresetTurnPolicy", () => {
  it("applies grounded creative tuning per creative preset node", () => {
    const diverge = resolvePresetTurnPolicy("creative", "turn-creative-diverge");
    const critic = resolvePresetTurnPolicy("creative", "turn-creative-critic");
    const finalNode = resolvePresetTurnPolicy("creative", "turn-creative-final");

    expect(diverge.temperature).toBe(0.62);
    expect(diverge.contextBudget).toBe("wide");
    expect(diverge.maxInputChars).toBe(5200);

    expect(critic.temperature).toBe(0.16);
    expect(critic.contextBudget).toBe("balanced");
    expect(critic.maxInputChars).toBe(3800);

    expect(finalNode.temperature).toBe(0.3);
    expect(finalNode.contextBudget).toBe("wide");
    expect(finalNode.maxInputChars).toBe(5400);
  });
});
