const BRIDGE_CONNECTION_STALE_MS = 120_000;

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3]+/gi, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeToken(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isLikelyPromptEcho(text, prompt) {
  if (!prompt) {
    return false;
  }
  if (text === prompt) {
    return true;
  }
  if (prompt.includes(text) && text.length >= 24) {
    return true;
  }
  return text.startsWith(prompt) && text.length <= prompt.length + 24;
}

function isLikelyPromptDerivative(text, prompt) {
  if (!prompt) {
    return false;
  }
  const normalizedText = normalizeWhitespace(text);
  if (!normalizedText || normalizedText.length > 180) {
    return false;
  }
  if (/[\n\r]/.test(normalizedText)) {
    return false;
  }
  if (/^#{1,6}\s/.test(normalizedText) || /^[-*]\s/.test(normalizedText) || /^\d+\.\s/.test(normalizedText)) {
    return false;
  }
  const promptTokens = new Set(tokenize(prompt));
  const textTokens = [...new Set(tokenize(normalizedText))];
  if (textTokens.length < 4) {
    return false;
  }
  const overlapCount = textTokens.filter((token) => promptTokens.has(token)).length;
  const overlapRatio = overlapCount / textTokens.length;
  if (overlapRatio >= 0.85) {
    return true;
  }
  const promptImpliesStructuredAnswer = /(10가지|아이디어|목록|후보|제안해|제안해줄래|ideas|list)/i.test(prompt);
  const candidateLooksLikeConversationTitle =
    promptImpliesStructuredAnswer
    && normalizedText.length <= 180
    && !/[\n\r]/.test(normalizedText)
    && !/^\d+\.\s/m.test(normalizedText)
    && !/^[-*]\s/m.test(normalizedText)
    && /(아이디어|제안|목록|후보)/.test(normalizedText);
  if (candidateLooksLikeConversationTitle) {
    return true;
  }
  const looksLikeSummaryTitle =
    !/[:：]/.test(normalizedText)
    && !/[.!?]/.test(normalizedText)
    && /(아이디어|제안|요약|정리|분석|후보|플랜|계획)/.test(normalizedText);
  return overlapRatio >= 0.55 && looksLikeSummaryTitle;
}

function scoreProviderResponseCandidate(text) {
  const normalized = normalizeWhitespace(text);
  let score = normalized.length;
  if (/[\n\r]/.test(normalized)) {
    score += 240;
  }
  if (/^\d+\.\s/m.test(normalized) || /^[-*]\s/m.test(normalized)) {
    score += 180;
  }
  if (/[.!?]\s/.test(normalized)) {
    score += 40;
  }
  return score;
}

export function pickProviderResponseText(candidates, prompt) {
  const promptTrimmed = normalizeWhitespace(prompt);
  const filtered = candidates
    .map((item) => normalizeWhitespace(item?.text))
    .filter((text) => text.length >= 2)
    .filter((text) => !isLikelyPromptEcho(text, promptTrimmed));
  const nonDerivative = filtered.filter((text) => !isLikelyPromptDerivative(text, promptTrimmed));

  if (nonDerivative.length > 0) {
    return nonDerivative
      .slice()
      .sort((left, right) => scoreProviderResponseCandidate(left) - scoreProviderResponseCandidate(right))
      .at(-1);
  }

  if (filtered.length === 0) {
    return null;
  }

  return null;
}

export function shouldReuseProviderPage({
  currentUrl,
  activeSignals,
  loginRequired,
  promptReady,
  responseVisible,
  busyVisible,
}) {
  const normalizedUrl = String(currentUrl ?? "").trim().toLowerCase();
  const matchesProvider = (activeSignals ?? []).some((signal) =>
    normalizedUrl.includes(String(signal ?? "").trim().toLowerCase()),
  );
  if (!matchesProvider || loginRequired) {
    return false;
  }
  return Boolean(promptReady || responseVisible || busyVisible);
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

export function resolveProviderResponseWaitDecision({
  text,
  lastText,
  busyVisible,
  sawBusy,
  lastChangeAgeMs,
  lastBusyAgeMs,
  lastProgressAgeMs,
  idleTimeoutMs,
}) {
  const normalizedText = normalizeWhitespace(text);
  const normalizedLastText = normalizeWhitespace(lastText);
  const textVisible = normalizedText.length > 0;
  const lastTextVisible = normalizedLastText.length > 0;
  const stableWithoutBusy = !busyVisible && (!sawBusy || lastBusyAgeMs >= 900);

  if (textVisible && lastChangeAgeMs >= 1600 && stableWithoutBusy) {
    return {
      type: 'return_text',
      text: normalizedText,
    };
  }

  if (!textVisible && lastTextVisible && lastChangeAgeMs >= 1600 && stableWithoutBusy) {
    return {
      type: 'return_last_text',
      text: normalizedLastText,
    };
  }

  if (lastProgressAgeMs >= idleTimeoutMs) {
    return {
      type: 'idle_timeout',
      text: lastTextVisible ? normalizedLastText : '',
    };
  }

  return {
    type: 'continue',
    text: '',
  };
}
