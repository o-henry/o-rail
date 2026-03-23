// @ts-nocheck
import { describe, expect, it } from 'vitest';

const workerProviderExecutionModule = await import('../../../scripts/web_worker/providerExecution.mjs');
const {
  getBridgeConnectionState,
  pickProviderResponseText,
  resolveProviderResponseWaitDecision,
  resolveProviderRunMode,
  shouldReuseProviderPage,
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

  it('rejects prompt-derived summary titles so the worker keeps waiting for a real answer', () => {
    const prompt = [
      '역할: GAME DESIGNER',
      '사용자 요청:',
      '나는 1인 인디게임 개발자야. 현재 캐주얼/모바일/아케이드 게임을 만들고싶은데',
      '창의적인 아이디어 10가지를 제안해줄래?',
      '답변 규칙: 한국어로만 답변한다.',
    ].join('\n');

    expect(
      pickProviderResponseText(
        [
          { text: '캐주얼 모바일 아케이드 게임으로, 다양한 연령과 전문가들이 즐길 수 있는 10가지 독창적 아이디어 제안' },
        ],
        prompt,
      ),
    ).toBe(null);
  });

  it('prefers the actual structured answer over a prompt-derived summary title', () => {
    const prompt = [
      '역할: GAME DESIGNER',
      '사용자 요청:',
      '나는 1인 인디게임 개발자야. 현재 캐주얼/모바일/아케이드 게임을 만들고싶은데',
      '창의적인 아이디어 10가지를 제안해줄래?',
      '답변 규칙: 한국어로만 답변한다.',
    ].join('\n');

    expect(
      pickProviderResponseText(
        [
          { text: '캐주얼 모바일 아케이드 게임으로, 다양한 연령과 전문가들이 즐길 수 있는 10가지 독창적 아이디어 제안' },
          {
            text: [
              '1. 매그네틱 배달부',
              '한 줄 훅: 자력 하나로 배달 전쟁에서 살아남으세요.',
              '핵심 루프: 화면 탭으로 극성을 바꾸며 배달한다.',
            ].join('\n'),
          },
        ],
        prompt,
      ),
    ).toContain('1. 매그네틱 배달부');
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

describe('shouldReuseProviderPage', () => {
  it('reuses an active provider conversation page when a response is already visible', () => {
    expect(
      shouldReuseProviderPage({
        currentUrl: 'https://gemini.google.com/app/abc123',
        activeSignals: ['gemini.google.com/app'],
        loginRequired: false,
        promptReady: false,
        responseVisible: true,
        busyVisible: false,
      }),
    ).toBe(true);
  });

  it('reuses the page while the provider is still generating a response', () => {
    expect(
      shouldReuseProviderPage({
        currentUrl: 'https://grok.com/',
        activeSignals: ['grok.com'],
        loginRequired: false,
        promptReady: false,
        responseVisible: false,
        busyVisible: true,
      }),
    ).toBe(true);
  });

  it('does not reuse the page when the provider is on a login flow', () => {
    expect(
      shouldReuseProviderPage({
        currentUrl: 'https://accounts.google.com/signin',
        activeSignals: ['gemini.google.com/app'],
        loginRequired: true,
        promptReady: true,
        responseVisible: true,
        busyVisible: true,
      }),
    ).toBe(false);
  });
});

describe('resolveProviderResponseWaitDecision', () => {
  it('returns stable text once generation has settled', () => {
    expect(resolveProviderResponseWaitDecision({
      text: '완성된 응답입니다.',
      lastText: '완성된 응답입니다.',
      busyVisible: false,
      sawBusy: true,
      lastChangeAgeMs: 1800,
      lastBusyAgeMs: 1200,
      lastProgressAgeMs: 1800,
      idleTimeoutMs: 180000,
    })).toEqual({
      type: 'return_text',
      text: '완성된 응답입니다.',
    });
  });

  it('keeps the last stable text when the DOM briefly clears after completion', () => {
    expect(resolveProviderResponseWaitDecision({
      text: '',
      lastText: '마지막 응답 블록',
      busyVisible: false,
      sawBusy: true,
      lastChangeAgeMs: 2000,
      lastBusyAgeMs: 1500,
      lastProgressAgeMs: 2000,
      idleTimeoutMs: 180000,
    })).toEqual({
      type: 'return_last_text',
      text: '마지막 응답 블록',
    });
  });

  it('times out only after progress has gone idle', () => {
    expect(resolveProviderResponseWaitDecision({
      text: '',
      lastText: '',
      busyVisible: false,
      sawBusy: false,
      lastChangeAgeMs: 5000,
      lastBusyAgeMs: Number.POSITIVE_INFINITY,
      lastProgressAgeMs: 180001,
      idleTimeoutMs: 180000,
    })).toEqual({
      type: 'idle_timeout',
      text: '',
    });
  });
});
