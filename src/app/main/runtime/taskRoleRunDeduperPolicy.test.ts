import { describe, expect, it } from "vitest";
import { shouldDeduplicateTaskRoleRun } from "./taskRoleRunDeduperPolicy";

describe("taskRoleRunDeduperPolicy", () => {
  it("deduplicates only direct user-triggered runs", () => {
    expect(shouldDeduplicateTaskRoleRun({ mode: "direct" })).toBe(true);
    expect(shouldDeduplicateTaskRoleRun({ mode: undefined })).toBe(true);
    expect(shouldDeduplicateTaskRoleRun({ mode: "brief" })).toBe(false);
    expect(shouldDeduplicateTaskRoleRun({ mode: "critique" })).toBe(false);
    expect(shouldDeduplicateTaskRoleRun({ mode: "final" })).toBe(false);
  });

  it("never deduplicates internal collaboration or retry runs", () => {
    expect(shouldDeduplicateTaskRoleRun({ mode: "direct", internal: true })).toBe(false);
    expect(shouldDeduplicateTaskRoleRun({ mode: "brief", internal: true })).toBe(false);
  });
});
