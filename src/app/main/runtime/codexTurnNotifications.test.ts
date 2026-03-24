import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_NOTIFICATION_DOM_EVENT, waitForTurnTerminalFromEngineNotifications } from "./codexTurnNotifications";

function buildEventWindow() {
  return Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
    dispatchEvent: EventTarget.prototype.dispatchEvent,
  });
}

describe("codexTurnNotifications", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("does not treat terminal userMessage items as final assistant output", async () => {
    const eventWindow = buildEventWindow();
    (globalThis as { window?: typeof eventWindow }).window = eventWindow;

    const waitPromise = waitForTurnTerminalFromEngineNotifications({
      threadId: "thread-user-only",
      turnId: "turn-user-only",
      idleTimeoutMs: 2_000,
    });

    eventWindow.dispatchEvent(new CustomEvent(ENGINE_NOTIFICATION_DOM_EVENT, {
      detail: {
        method: "item/completed",
        params: {
          threadId: "thread-user-only",
          turnId: "turn-user-only",
          item: {
            type: "userMessage",
            content: [
              { type: "text", text: "# ROLE\nGAME DESIGNER\n..." },
            ],
          },
        },
      },
    }));

    const result = await waitPromise;
    expect(result?.status).toBe("completed");
    expect((result?.raw as { output_text?: string })?.output_text ?? "").toBe("");
    expect(result?.hadProgress).toBe(false);
  });

  it("captures final assistant content from terminal agentMessage items", async () => {
    const eventWindow = buildEventWindow();
    (globalThis as { window?: typeof eventWindow }).window = eventWindow;

    const waitPromise = waitForTurnTerminalFromEngineNotifications({
      threadId: "thread-agent-final",
      turnId: "turn-agent-final",
      idleTimeoutMs: 2_000,
    });

    eventWindow.dispatchEvent(new CustomEvent(ENGINE_NOTIFICATION_DOM_EVENT, {
      detail: {
        method: "item/completed",
        params: {
          threadId: "thread-agent-final",
          turnId: "turn-agent-final",
          item: {
            type: "agentMessage",
            phase: "final_answer",
            content: [
              { type: "output_text", text: "## 최종 응답\n- agentMessage final answer" },
            ],
          },
        },
      },
    }));

    const result = await waitPromise;
    expect(result?.status).toBe("completed");
    expect((result?.raw as { output_text?: string })?.output_text ?? "").toContain("agentMessage final answer");
    expect(result?.hadProgress).toBe(true);
  });
});
