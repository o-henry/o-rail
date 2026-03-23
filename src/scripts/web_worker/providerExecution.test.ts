// @ts-nocheck
import { describe, expect, it } from 'vitest';

const workerProviderExecutionModule = await import('../../../scripts/web_worker/providerExecution.mjs');
const {
  getBridgeConnectionState,
  pickProviderResponseText,
  resolveProviderRunMode,
} = workerProviderExecutionModule;

describe('pickProviderResponseText', () => {
  it('accepts short non-echo responses', () => {
    expect(
      pickProviderResponseText(
        [
          { text: 'Reply with exactly: OK' },
          { text: 'OK' },
        ],
        'Reply with exactly: OK',
      ),
    ).toBe('OK');
  });

  it('rejects exact prompt echoes', () => {
    expect(
      pickProviderResponseText(
        [
          { text: 'Summarize this in Korean' },
          { text: 'Summarize this in Korean' },
        ],
        'Summarize this in Korean',
      ),
    ).toBe(null);
  });

  it('keeps short replies when the prompt is longer', () => {
    expect(
      pickProviderResponseText(
        [
          { text: 'Give me a one-word verdict.' },
          { text: '좋음' },
        ],
        'Give me a one-word verdict.',
      ),
    ).toBe('좋음');
  });
});

describe('getBridgeConnectionState', () => {
  it('treats recent provider bridge activity as connected', () => {
    const connectedProviders = new Map([
      ['gemini', { lastSeenAt: '2026-03-23T10:00:00.000Z' }],
    ]);

    expect(
      getBridgeConnectionState(connectedProviders, 'gemini', Date.parse('2026-03-23T10:01:00.000Z')),
    ).toMatchObject({
      connected: true,
      reason: 'connected',
    });
  });

  it('treats stale bridge activity as disconnected', () => {
    const connectedProviders = new Map([
      ['gemini', { lastSeenAt: '2026-03-23T10:00:00.000Z' }],
    ]);

    expect(
      getBridgeConnectionState(connectedProviders, 'gemini', Date.parse('2026-03-23T10:03:30.000Z')),
    ).toMatchObject({
      connected: false,
      stale: true,
      reason: 'stale',
    });
  });
});

describe('resolveProviderRunMode', () => {
  it('falls back to auto when bridge is not connected', () => {
    expect(
      resolveProviderRunMode({
        requestedMode: 'bridgeAssisted',
        provider: 'gemini',
        bridgeListening: true,
        connectedProviders: new Map(),
        nowMs: Date.parse('2026-03-23T10:01:00.000Z'),
      }),
    ).toEqual({
      mode: 'auto',
      fallbackReason: 'bridge_not_connected',
    });
  });

  it('stays on bridgeAssisted when bridge is connected', () => {
    expect(
      resolveProviderRunMode({
        requestedMode: 'bridgeAssisted',
        provider: 'gemini',
        bridgeListening: true,
        connectedProviders: new Map([
          ['gemini', { lastSeenAt: '2026-03-23T10:00:30.000Z' }],
        ]),
        nowMs: Date.parse('2026-03-23T10:01:00.000Z'),
      }),
    ).toEqual({
      mode: 'bridgeAssisted',
      fallbackReason: null,
    });
  });
});
