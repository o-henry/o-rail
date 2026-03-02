import { describe, expect, it, vi } from "vitest";
import { createEngineBridgeHandlers } from "./engineBridgeHandlers";

function createBaseParams() {
  let loginCompleted = true;
  return {
    params: {
      engineStarted: true,
      cwd: "/tmp/workspace",
      invokeFn: vi.fn(),
      setEngineStarted: vi.fn(),
      isEngineAlreadyStartedError: vi.fn(() => false),
      setError: vi.fn(),
      setStatus: vi.fn(),
      toErrorText: vi.fn((error: unknown) => String(error)),
      markCodexNodesStatusOnEngineIssue: vi.fn(),
      setRunning: vi.fn(),
      setIsGraphRunning: vi.fn(),
      setUsageInfoText: vi.fn(),
      extractAuthMode: vi.fn((value: unknown) => (typeof value === "string" ? value : null)),
      setAuthMode: vi.fn(),
      authLoginRequiredProbeCountRef: { current: 0 },
      lastAuthenticatedAtRef: { current: Date.now() },
      setLoginCompleted: vi.fn((next: boolean) => {
        loginCompleted = next;
      }),
      get loginCompleted() {
        return loginCompleted;
      },
      authLoginRequiredGraceMs: 45_000,
      authLoginRequiredConfirmCount: 2,
      formatUsageInfoForDisplay: vi.fn(() => "usage-ok"),
      setUsageResultClosed: vi.fn(),
      toUsageCheckErrorMessage: vi.fn((error: unknown) => String(error)),
      codexAuthBusy: false,
      codexLoginLastAttemptAtRef: { current: 0 },
      codexLoginCooldownMs: 45_000,
      setCodexAuthBusy: vi.fn(),
      openUrlFn: vi.fn(),
      setCwd: vi.fn(),
      pendingWebTurn: null,
      webProviderHomeUrl: vi.fn(() => ""),
      webProviderLabel: vi.fn(() => "WEB"),
      setProviderChildViewOpen: vi.fn(),
      setWebWorkerHealth: vi.fn(),
      setWebBridgeStatus: vi.fn(),
      toWebBridgeStatus: vi.fn(() => ({})),
      setWebWorkerBusy: vi.fn(),
      setWebBridgeConnectCode: vi.fn(),
    },
    getLoginCompleted: () => loginCompleted,
  };
}

describe("engineBridgeHandlers auth stability", () => {
  it("keeps session during grace window on transient login_required probe", async () => {
    const { params, getLoginCompleted } = createBaseParams();
    (params.invokeFn as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: "login_required",
      authMode: null,
      raw: null,
    });
    const handlers = createEngineBridgeHandlers(params);

    await handlers.refreshAuthStateFromEngine(true);

    expect(getLoginCompleted()).toBe(true);
    expect(params.setLoginCompleted).not.toHaveBeenCalledWith(false);
  });

  it("does not downgrade authenticated session from usage payload account=null", async () => {
    const { params, getLoginCompleted } = createBaseParams();
    (params.invokeFn as ReturnType<typeof vi.fn>).mockImplementation(async (command: string) => {
      if (command === "usage_check") {
        return {
          raw: {
            account: null,
            authMode: "chatgpt",
          },
        };
      }
      if (command === "auth_probe") {
        return {
          state: "authenticated",
          authMode: "chatgpt",
          raw: {},
        };
      }
      return {};
    });
    const handlers = createEngineBridgeHandlers(params);

    await handlers.onCheckUsage();

    expect(getLoginCompleted()).toBe(true);
    expect(params.setLoginCompleted).not.toHaveBeenCalledWith(false);
  });
});
