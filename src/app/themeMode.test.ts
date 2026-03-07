import { afterEach, describe, expect, it } from "vitest";
import { loadPersistedThemeMode, normalizeThemeMode } from "./themeMode";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function setWindowMock(next: unknown) {
  Object.defineProperty(globalThis, "window", {
    value: next,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (windowDescriptor) {
    Object.defineProperty(globalThis, "window", windowDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, "window");
});

describe("themeMode", () => {
  it("normalizes light and dark theme values", () => {
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("LIGHT")).toBe("light");
    expect(normalizeThemeMode("unknown")).toBe("light");
  });

  it("falls back to light when window is unavailable", () => {
    Reflect.deleteProperty(globalThis, "window");
    expect(loadPersistedThemeMode()).toBe("light");
  });

  it("loads persisted mode when available", () => {
    setWindowMock({
      localStorage: {
        getItem: () => "dark",
      },
    });
    expect(loadPersistedThemeMode()).toBe("dark");

    setWindowMock({
      localStorage: {
        getItem: () => "INVALID_THEME",
      },
    });
    expect(loadPersistedThemeMode()).toBe("light");
  });
});
