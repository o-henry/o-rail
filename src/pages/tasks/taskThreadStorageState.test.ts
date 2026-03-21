import { beforeEach, describe, expect, it } from "vitest";
import {
  loadHiddenTasksProjectList,
  loadTasksProjectList,
  normalizeTasksProjectPath,
  persistHiddenTasksProjectList,
  persistTasksProjectList,
} from "./taskThreadStorageState";

function createStorage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

describe("taskThreadStorageState", () => {
  beforeEach(() => {
    const sessionStorage = createStorage();
    const localStorage = createStorage();
    Object.defineProperty(globalThis, "window", {
      value: { sessionStorage, localStorage },
      configurable: true,
      writable: true,
    });
  });

  it("normalizes project paths consistently for hidden and visible project lists", () => {
    persistHiddenTasksProjectList(["/repo/demo/", "\\repo\\demo", "/repo/other"]);
    persistTasksProjectList(["/repo/demo", "/repo/other/", "\\repo\\third"]);

    expect(loadHiddenTasksProjectList()).toEqual(["/repo/demo", "/repo/other"]);
    expect(loadTasksProjectList("/repo/demo/")).toEqual(["/repo/demo", "/repo/other", "/repo/third"]);
  });

  it("persists hidden projects in localStorage so they survive a fresh app session", () => {
    persistHiddenTasksProjectList(["/repo/demo"]);

    const freshSessionStorage = createStorage();
    const persistedLocalStorage = window.localStorage;
    Object.defineProperty(globalThis, "window", {
      value: { sessionStorage: freshSessionStorage, localStorage: persistedLocalStorage },
      configurable: true,
      writable: true,
    });

    expect(loadHiddenTasksProjectList()).toEqual(["/repo/demo"]);
  });

  it("normalizes slashes and trailing separators with the shared helper", () => {
    expect(normalizeTasksProjectPath("\\repo\\demo\\")).toBe("/repo/demo");
    expect(normalizeTasksProjectPath("/repo/demo///")).toBe("/repo/demo");
  });
});
