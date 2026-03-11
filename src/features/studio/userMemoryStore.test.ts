import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addUserMemoryEntry,
  buildUserMemoryPromptBlock,
  clearUserMemoryEntries,
  extractUserMemoryCandidates,
  loadUserMemoryAutoCaptureEnabled,
  rankUserMemoryEntries,
  readUserMemoryEntries,
  rememberUserMemoryFromText,
  writeUserMemoryAutoCaptureEnabled,
} from "./userMemoryStore";

function createLocalStorageMock() {
  let store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store = new Map<string, string>();
    }),
  };
}

describe("userMemoryStore", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
    });
  });

  it("stores manual memory and ranks relevant entries first", () => {
    addUserMemoryEntry("나는 1인 인디 게임 개발자다.", "manual");
    addUserMemoryEntry("나는 빠른 프로토타이핑과 작은 팀 생산성을 중시한다.", "manual");

    const ranked = rankUserMemoryEntries({
      query: "인디 게임 아이디어를 빠르게 프로토타이핑하고 싶다",
      entries: readUserMemoryEntries(),
    });

    expect(ranked[0]?.entry.text).toContain("프로토타이핑");
  });

  it("extracts and stores stable profile lines from workflow questions when auto capture is enabled", () => {
    expect(loadUserMemoryAutoCaptureEnabled()).toBe(true);

    rememberUserMemoryFromText(
      "나는 1인 인디 게임 개발자야. 이번엔 빠른 프로토타이핑과 현실적인 범위를 중요하게 생각해.",
    );

    const stored = readUserMemoryEntries();
    expect(stored.some((entry) => entry.text.includes("1인 인디 게임 개발자"))).toBe(true);
  });

  it("skips auto capture when disabled", () => {
    writeUserMemoryAutoCaptureEnabled(false);
    rememberUserMemoryFromText("나는 로그라이크 액션을 선호한다.");
    expect(readUserMemoryEntries()).toHaveLength(0);
  });

  it("builds a prompt block from curated memory entries", () => {
    const block = buildUserMemoryPromptBlock([
      {
        id: "memory-1",
        text: "나는 1인 인디 게임 개발자다.",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(block).toContain("[사용자 장기 메모리]");
    expect(block).toContain("1인 인디 게임 개발자");
  });

  it("extracts only stable candidate lines", () => {
    const lines = extractUserMemoryCandidates(
      "나는 1인 인디 게임 개발자다.\n이번 요청은 두 개의 아이디어만 줘.\n나는 빠른 프로토타이핑을 중요하게 생각한다.",
    );

    expect(lines).toHaveLength(2);
    clearUserMemoryEntries();
  });
});
