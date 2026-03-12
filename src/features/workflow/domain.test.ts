import { describe, expect, it } from "vitest";
import { DEFAULT_TURN_MODEL, toTurnModelDisplayName, toTurnModelEngineId } from "./domain";

describe("workflow model defaults", () => {
  it("defaults new turn nodes to GPT-5.3-Codex", () => {
    expect(DEFAULT_TURN_MODEL).toBe("GPT-5.3-Codex");
  });

  it("maps GPT-5.4 display names to the real engine id while keeping GPT-5.3-Codex as the default", () => {
    expect(toTurnModelDisplayName("gpt-5.3-codex")).toBe("GPT-5.3-Codex");
    expect(toTurnModelEngineId("GPT-5.3-Codex")).toBe("gpt-5.3-codex");
    expect(toTurnModelDisplayName("gpt-5.4")).toBe("GPT-5.4");
    expect(toTurnModelEngineId("GPT-5.4")).toBe("gpt-5.4");
  });
});
