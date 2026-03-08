import { describe, expect, it } from "vitest";
import { DEFAULT_TURN_MODEL, toTurnModelDisplayName, toTurnModelEngineId } from "./domain";

describe("workflow model defaults", () => {
  it("defaults new turn nodes to GPT-5.4", () => {
    expect(DEFAULT_TURN_MODEL).toBe("GPT-5.4");
  });

  it("maps GPT-5.4 display names to the real engine id", () => {
    expect(toTurnModelDisplayName("gpt-5.4")).toBe("GPT-5.4");
    expect(toTurnModelEngineId("GPT-5.4")).toBe("gpt-5.4");
  });
});
