import { describe, expect, it } from "vitest";
import {
  getStudioRoleModeOptions,
  normalizeStudioRoleSelection,
  resolveEffectiveStudioRoleId,
  resolvePmPlanningMode,
  resolveStudioRoleDisplayLabel,
  resolveStudioRolePromptLabel,
} from "./pmPlanningMode";

describe("pmPlanningMode", () => {
  it("maps pm planner mode to the effective prompt role", () => {
    expect(resolvePmPlanningMode("pm_planner", "creative")).toBe("creative");
    expect(resolvePmPlanningMode("pm_planner", "logical")).toBe("logical");
    expect(resolveEffectiveStudioRoleId("pm_planner", "creative")).toBe("pm_creative_director");
    expect(resolveEffectiveStudioRoleId("pm_planner", "logical")).toBe("pm_feasibility_critic");
  });

  it("normalizes legacy pm roles into a single selectable PM role", () => {
    expect(normalizeStudioRoleSelection("pm_creative_director")).toBe("pm_planner");
    expect(normalizeStudioRoleSelection("pm_feasibility_critic")).toBe("pm_planner");
    expect(resolveStudioRoleDisplayLabel("pm_feasibility_critic")).toBe("기획(PM)");
    expect(resolveStudioRolePromptLabel("pm_feasibility_critic")).toBe("기획(PM) · 논리 모드");
  });

  it("exposes mode options only where the role needs them", () => {
    expect(getStudioRoleModeOptions("client_programmer")).toEqual(["creative", "logical"]);
    expect(getStudioRoleModeOptions("system_programmer")).toEqual(["logical"]);
    expect(resolvePmPlanningMode("system_programmer", "creative")).toBe("logical");
    expect(getStudioRoleModeOptions("art_pipeline")).toEqual(["logical"]);
  });
});
