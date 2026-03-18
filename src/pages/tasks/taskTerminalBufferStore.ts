const MAX_BUFFER_LENGTH = 160_000;

const terminalBuffers = new Map<string, string>();

export type TerminalBufferEvent =
  | { type: "append"; chunk: string }
  | { type: "replace"; value: string }
  | { type: "clear" }
  | { type: "remove" };

const terminalListeners = new Map<string, Set<(event: TerminalBufferEvent) => void>>();

function normalizeSessionId(input: string | null | undefined) {
  return String(input ?? "").trim();
}

function emitTerminalBuffer(sessionId: string, event: TerminalBufferEvent) {
  terminalListeners.get(sessionId)?.forEach((listener) => listener(event));
}

function trimTerminalBuffer(input: string) {
  if (input.length <= MAX_BUFFER_LENGTH) {
    return input;
  }
  const tail = input.slice(-MAX_BUFFER_LENGTH);
  const firstLineBreak = tail.indexOf("\n");
  return firstLineBreak >= 0 ? tail.slice(firstLineBreak + 1) : tail;
}

export function getTerminalBuffer(sessionId: string) {
  return terminalBuffers.get(normalizeSessionId(sessionId)) ?? "";
}

export function subscribeTerminalBuffer(sessionId: string, listener: (event: TerminalBufferEvent) => void) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return () => undefined;
  }
  const listeners = terminalListeners.get(normalizedSessionId) ?? new Set<(event: TerminalBufferEvent) => void>();
  listeners.add(listener);
  terminalListeners.set(normalizedSessionId, listeners);
  return () => {
    const current = terminalListeners.get(normalizedSessionId);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      terminalListeners.delete(normalizedSessionId);
    }
  };
}

export function appendTerminalBuffer(sessionId: string, chunk: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId || !chunk) {
    return;
  }
  const next = trimTerminalBuffer(`${getTerminalBuffer(normalizedSessionId)}${chunk}`);
  terminalBuffers.set(normalizedSessionId, next);
  emitTerminalBuffer(normalizedSessionId, { type: "append", chunk });
}

export function replaceTerminalBuffer(sessionId: string, nextValue: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  const value = trimTerminalBuffer(String(nextValue ?? ""));
  terminalBuffers.set(normalizedSessionId, value);
  emitTerminalBuffer(normalizedSessionId, { type: "replace", value });
}

export function clearTerminalBuffer(sessionId: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  terminalBuffers.set(normalizedSessionId, "");
  emitTerminalBuffer(normalizedSessionId, { type: "clear" });
}

export function removeTerminalBuffer(sessionId: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  terminalBuffers.delete(normalizedSessionId);
  emitTerminalBuffer(normalizedSessionId, { type: "remove" });
}
