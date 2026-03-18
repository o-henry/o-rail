import { describe, expect, it, vi } from "vitest";
import {
  appendTerminalBuffer,
  clearTerminalBuffer,
  getTerminalBuffer,
  removeTerminalBuffer,
  subscribeTerminalBuffer,
} from "./taskTerminalBufferStore";

describe("taskTerminalBufferStore", () => {
  it("appends chunks and notifies subscribers", () => {
    const sessionId = "session:test:append";
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalBuffer(sessionId, listener);

    appendTerminalBuffer(sessionId, "hello");
    appendTerminalBuffer(sessionId, " world");

    expect(getTerminalBuffer(sessionId)).toBe("hello world");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { type: "append", chunk: "hello" });
    expect(listener).toHaveBeenNthCalledWith(2, { type: "append", chunk: " world" });

    unsubscribe();
    removeTerminalBuffer(sessionId);
  });

  it("clears and removes buffers", () => {
    const sessionId = "session:test:clear";
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalBuffer(sessionId, listener);
    appendTerminalBuffer(sessionId, "value");
    clearTerminalBuffer(sessionId);
    expect(getTerminalBuffer(sessionId)).toBe("");
    removeTerminalBuffer(sessionId);
    expect(getTerminalBuffer(sessionId)).toBe("");
    expect(listener).toHaveBeenNthCalledWith(2, { type: "clear" });
    expect(listener).toHaveBeenNthCalledWith(3, { type: "remove" });
    unsubscribe();
  });
});
