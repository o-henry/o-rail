import { describe, expect, it } from "vitest";
import { getRoleNodeInlineActionsMeta } from "./roleNodeInlineActions";

describe("roleNodeInlineActions", () => {
  it("shows both creative and logical modes for PM and client roles", () => {
    const pm = getRoleNodeInlineActionsMeta({
      sourceKind: "handoff",
      handoffRoleId: "pm_planner",
      pmPlanningMode: "creative",
      internalChildCount: 3,
    });
    const client = getRoleNodeInlineActionsMeta({
      sourceKind: "handoff",
      handoffRoleId: "client_programmer",
      pmPlanningMode: "logical",
      internalChildCount: 0,
    });

    expect(pm.modeOptions).toEqual(["creative", "logical"]);
    expect(pm.showInternalToggle).toBe(true);
    expect(client.modeOptions).toEqual(["creative", "logical"]);
  });

  it("shows only logical mode for system-oriented roles", () => {
    const system = getRoleNodeInlineActionsMeta({
      sourceKind: "handoff",
      handoffRoleId: "system_programmer",
      pmPlanningMode: "creative",
      internalChildCount: 0,
    });

    expect(system.modeOptions).toEqual(["logical"]);
    expect(system.pmMode).toBe("logical");
    expect(system.showModeButtons).toBe(true);
    expect(system.showInternalToggle).toBe(false);
  });

  it("hides mode buttons for perspective nodes with predefined personality", () => {
    const perspective = getRoleNodeInlineActionsMeta({
      sourceKind: "handoff",
      handoffRoleId: "pm_planner",
      pmPlanningMode: "creative",
      roleMode: "perspective",
      internalChildCount: 3,
    });

    expect(perspective.modeOptions).toEqual(["creative", "logical"]);
    expect(perspective.showModeButtons).toBe(false);
  });
});
