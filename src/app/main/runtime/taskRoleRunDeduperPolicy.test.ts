import { describe, expect, it } from "vitest";
import { shouldDeduplicateTaskRoleRun } from "./taskRoleRunDeduperPolicy";

describe("taskRoleRunDeduperPolicy", () => {
  it("deduplicates only direct user-triggered runs", () => {
    expect(shouldDeduplicateTaskRoleRun("direct")).toBe(true);
    expect(shouldDeduplicateTaskRoleRun(undefined)).toBe(true);
    expect(shouldDeduplicateTaskRoleRun("brief")).toBe(false);
    expect(shouldDeduplicateTaskRoleRun("critique")).toBe(false);
    expect(shouldDeduplicateTaskRoleRun("final")).toBe(false);
  });
});
