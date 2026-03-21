import { describe, expect, it } from "vitest";
import { resolveCachedWorkspaceChildren } from "./WorkspaceTabCache";

describe("resolveCachedWorkspaceChildren", () => {
  it("returns the latest children while a tab is active", () => {
    expect(resolveCachedWorkspaceChildren(true, "old", "new")).toBe("new");
  });

  it("keeps cached children while a tab is inactive", () => {
    expect(resolveCachedWorkspaceChildren(false, "old", "new")).toBe("old");
  });

  it("uses incoming children when no cache exists yet", () => {
    expect(resolveCachedWorkspaceChildren(false, undefined, "new")).toBe("new");
  });
});
