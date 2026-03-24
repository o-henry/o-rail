import { describe, expect, it } from "vitest";

import { toStudioRoleId } from "./roleUtils";

describe("toStudioRoleId", () => {
  it("maps task agent ids to their studio role ids", () => {
    expect(toStudioRoleId("game_designer")).toBe("pm_planner");
    expect(toStudioRoleId("level_designer")).toBe("pm_creative_director");
    expect(toStudioRoleId("unity_architect")).toBe("system_programmer");
    expect(toStudioRoleId("unity_implementer")).toBe("client_programmer");
  });

  it("keeps studio role ids unchanged", () => {
    expect(toStudioRoleId("pm_planner")).toBe("pm_planner");
    expect(toStudioRoleId("system_programmer")).toBe("system_programmer");
  });
});
