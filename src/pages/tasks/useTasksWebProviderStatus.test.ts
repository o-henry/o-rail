import { describe, expect, it } from "vitest";
import {
  buildTasksWebProviderStatusSelectionKey,
  buildTasksWebProviderStatuses,
} from "./useTasksWebProviderStatus";

describe("buildTasksWebProviderStatuses", () => {
  it("maps an active provider session into a readable status card", () => {
    expect(buildTasksWebProviderStatuses({
      modelValues: ["Gemini"],
      health: {
        running: true,
        providers: {
          gemini: {
            sessionState: "active",
            url: "https://gemini.google.com/app",
          },
        },
        bridge: {
          connectedProviders: [{ provider: "gemini" }],
        },
      },
    })).toEqual([
      expect.objectContaining({
        provider: "gemini",
        state: "active",
        message: "브리지 연결됨",
        connected: true,
      }),
    ]);
  });

  it("surfaces login-required provider sessions", () => {
    expect(buildTasksWebProviderStatuses({
      modelValues: ["Grok"],
      health: {
        running: true,
        providers: {
          grok: {
            sessionState: "login_required",
            message: "먼저 로그인하세요.",
          },
        },
      },
    })).toEqual([
      expect.objectContaining({
        provider: "grok",
        state: "login_required",
        message: "먼저 로그인하세요.",
      }),
    ]);
  });

  it("shows worker-not-started when no provider health exists yet", () => {
    expect(buildTasksWebProviderStatuses({
      modelValues: ["Gemini"],
      health: {
        running: false,
        providers: {},
      },
    })).toEqual([
      expect.objectContaining({
        provider: "gemini",
        state: "unavailable",
        message: "워커 미시작",
      }),
    ]);
  });

  it("keeps the known status while a background refresh is running", () => {
    expect(buildTasksWebProviderStatuses({
      modelValues: ["Gemini"],
      checking: true,
      health: {
        running: true,
        providers: {
          gemini: {
            sessionState: "active",
            message: "세션 준비됨",
          },
        },
      },
    })).toEqual([
      expect.objectContaining({
        provider: "gemini",
        state: "active",
        message: "세션 준비됨",
      }),
    ]);
  });
});

describe("buildTasksWebProviderStatusSelectionKey", () => {
  it("stays stable for duplicate mentions of the same provider", () => {
    expect(buildTasksWebProviderStatusSelectionKey(["Gemini", "Gemini", "Grok"])).toBe(
      "gemini:Gemini|grok:Grok",
    );
  });
});
