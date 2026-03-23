const BRIDGE_CONNECTION_STALE_MS = 120_000;

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isLikelyPromptEcho(text, prompt) {
  if (!prompt) {
    return false;
  }
  if (text === prompt) {
    return true;
  }
  return text.startsWith(prompt) && text.length <= prompt.length + 24;
}

export function pickProviderResponseText(candidates, prompt) {
  const promptTrimmed = normalizeWhitespace(prompt);
  const filtered = candidates
    .map((item) => normalizeWhitespace(item?.text))
    .filter((text) => text.length >= 2)
    .filter((text) => !isLikelyPromptEcho(text, promptTrimmed));

  if (filtered.length === 0) {
    return null;
  }

  return filtered[filtered.length - 1];
}

function parseIsoTime(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getBridgeConnectionState(connectedProviders, provider, nowMs = Date.now()) {
  const row = connectedProviders?.get?.(provider) ?? null;
  const lastSeenMs = parseIsoTime(row?.lastSeenAt);
  if (!row || !lastSeenMs) {
    return {
      connected: false,
      stale: false,
      reason: 'missing',
    };
  }
  if (nowMs - lastSeenMs > BRIDGE_CONNECTION_STALE_MS) {
    return {
      connected: false,
      stale: true,
      reason: 'stale',
      lastSeenAt: row.lastSeenAt ?? null,
    };
  }
  return {
    connected: true,
    stale: false,
    reason: 'connected',
    lastSeenAt: row.lastSeenAt ?? null,
  };
}

export function resolveProviderRunMode({
  requestedMode,
  provider,
  bridgeListening,
  connectedProviders,
  nowMs = Date.now(),
}) {
  if (requestedMode !== 'bridgeAssisted') {
    return {
      mode: 'auto',
      fallbackReason: null,
    };
  }

  if (!bridgeListening) {
    return {
      mode: 'auto',
      fallbackReason: 'bridge_not_running',
    };
  }

  const connection = getBridgeConnectionState(connectedProviders, provider, nowMs);
  if (!connection.connected) {
    return {
      mode: 'auto',
      fallbackReason: connection.stale ? 'bridge_stale' : 'bridge_not_connected',
    };
  }

  return {
    mode: 'bridgeAssisted',
    fallbackReason: null,
  };
}
