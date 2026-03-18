const MAX_BUFFER_LENGTH = 80_000;

const terminalBuffers = new Map<string, string>();
const terminalListeners = new Map<string, Set<() => void>>();

function normalizeSessionId(input: string | null | undefined) {
  return String(input ?? "").trim();
}

function emitTerminalBuffer(sessionId: string) {
  terminalListeners.get(sessionId)?.forEach((listener) => listener());
}

function trimTerminalBuffer(input: string) {
  return input.length > MAX_BUFFER_LENGTH ? input.slice(-MAX_BUFFER_LENGTH) : input;
}

export function getTerminalBuffer(sessionId: string) {
  return terminalBuffers.get(normalizeSessionId(sessionId)) ?? "";
}

export function subscribeTerminalBuffer(sessionId: string, listener: () => void) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return () => undefined;
  }
  const listeners = terminalListeners.get(normalizedSessionId) ?? new Set<() => void>();
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
  emitTerminalBuffer(normalizedSessionId);
}

export function replaceTerminalBuffer(sessionId: string, nextValue: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  terminalBuffers.set(normalizedSessionId, trimTerminalBuffer(String(nextValue ?? "")));
  emitTerminalBuffer(normalizedSessionId);
}

export function clearTerminalBuffer(sessionId: string) {
  replaceTerminalBuffer(sessionId, "");
}

export function removeTerminalBuffer(sessionId: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  terminalBuffers.delete(normalizedSessionId);
  emitTerminalBuffer(normalizedSessionId);
}
