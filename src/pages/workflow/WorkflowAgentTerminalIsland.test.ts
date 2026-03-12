import { describe, expect, it } from "vitest";
import { buildViewportText, canSubmitNodeFollowup, isAgentTerminalVisible } from "./WorkflowAgentTerminalIsland";

describe("buildViewportText", () => {
  it("shows selected node request and queued follow-ups before logs", () => {
    const text = buildViewportText({
      graphFileName: "demo",
      paneBuffer: "",
      paneTitle: "툴링 엔지니어",
      selectedNode: {
        id: "turn-tooling",
        type: "turn",
        position: { x: 0, y: 0 },
        config: {
          role: "툴링 엔지니어 AGENT",
          taskId: "TOOL-001",
          sourceKind: "handoff",
          promptTemplate: "툴링 엔지니어 관점에서 빌드 도구와 자동화 전략을 정리합니다.",
        },
      } as any,
      selectedNodeState: {
        status: "idle",
        logs: [],
      },
      pendingRequests: ["빌드 스크립트까지 포함해줘", "실패 케이스도 적어줘"],
    });

    expect(text).toContain("[agent] 툴링 엔지니어");
    expect(text).toContain("[task] TOOL-001");
    expect(text).toContain("[current request]");
    expect(text).toContain("툴링 엔지니어 관점에서 빌드 도구와 자동화 전략을 정리합니다.");
    expect(text).toContain("[queued follow-ups]");
    expect(text).toContain("1. 빌드 스크립트까지 포함해줘");
  });

  it("keeps the full current request text without inserting ellipsis", () => {
    const longPrompt = "긴 요청 ".repeat(120);
    const text = buildViewportText({
      graphFileName: "demo",
      paneBuffer: "",
      paneTitle: "기획",
      selectedNode: {
        id: "turn-pm",
        type: "turn",
        position: { x: 0, y: 0 },
        config: {
          role: "기획 AGENT",
          promptTemplate: longPrompt,
        },
      } as any,
      selectedNodeState: {
        status: "idle",
        logs: [],
      },
      pendingRequests: [],
    });

    expect(text).toContain(longPrompt.trim());
    expect(text).not.toContain("...");
  });

  it("disables follow-up submit when the input is empty", () => {
    expect(canSubmitNodeFollowup("", true)).toBe(false);
    expect(canSubmitNodeFollowup("   ", true)).toBe(false);
    expect(canSubmitNodeFollowup("수정해줘", true)).toBe(true);
    expect(canSubmitNodeFollowup("수정해줘", false)).toBe(false);
  });

  it("shows the terminal only when the selected node matches the opened node", () => {
    expect(
      isAgentTerminalVisible({
        selectedNodeId: "pm-node",
        openNodeId: "pm-node",
        activeRoleId: "pm_planner",
        hasPane: true,
      }),
    ).toBe(true);
    expect(
      isAgentTerminalVisible({
        selectedNodeId: "pm-node",
        openNodeId: "qa-node",
        activeRoleId: "pm_planner",
        hasPane: true,
      }),
    ).toBe(false);
    expect(
      isAgentTerminalVisible({
        selectedNodeId: "pm-node",
        openNodeId: "pm-node",
        activeRoleId: null,
        hasPane: true,
      }),
    ).toBe(false);
  });
});
