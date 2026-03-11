import { describe, expect, it, vi } from "vitest";
import { ADAPTATION_RESET_CONFIRM_MESSAGE, confirmAdaptiveReset } from "./AdaptationPage";

describe("confirmAdaptiveReset", () => {
  it("uses the warning message and proceeds when confirmed", () => {
    const confirm = vi.fn(() => true);

    const result = confirmAdaptiveReset(confirm);

    expect(result).toBe(true);
    expect(confirm).toHaveBeenCalledWith(ADAPTATION_RESET_CONFIRM_MESSAGE);
  });

  it("cancels reset when the warning is declined", () => {
    const confirm = vi.fn(() => false);

    const result = confirmAdaptiveReset(confirm);

    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledWith(ADAPTATION_RESET_CONFIRM_MESSAGE);
  });
});
