import { describe, expect, it } from "vitest";

import { getDefaultTaskCreationIsolation } from "./taskCreationDefaults";

describe("getDefaultTaskCreationIsolation", () => {
  it("uses auto so non-git workspaces can still create threads", () => {
    expect(getDefaultTaskCreationIsolation()).toBe("auto");
  });
});
