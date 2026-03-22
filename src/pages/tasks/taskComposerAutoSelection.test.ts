import { describe, expect, it } from "vitest";
import { deriveAutoSelectedComposerRoleIds } from "./taskComposerAutoSelection";

describe("deriveAutoSelectedComposerRoleIds", () => {
  it("shows orchestrator-selected roles for an untagged research prompt", () => {
    expect(deriveAutoSelectedComposerRoleIds({
      draft: "최근 인디게임 시장 반응을 조사하고 추천 방향도 정리해줘",
      selectedComposerRoleIds: [],
      enabledRoleIds: ["researcher", "game_designer", "unity_architect"],
    })).toEqual(["researcher", "game_designer"]);
  });

  it("shows only the extra role when one role was manually selected", () => {
    expect(deriveAutoSelectedComposerRoleIds({
      draft: "1인 인디게임 아이디어를 추천해줘",
      selectedComposerRoleIds: ["researcher"],
      enabledRoleIds: ["researcher", "game_designer", "unity_architect"],
    })).toEqual(["game_designer"]);
  });

  it("returns nothing for an empty draft", () => {
    expect(deriveAutoSelectedComposerRoleIds({
      draft: "   ",
      selectedComposerRoleIds: [],
      enabledRoleIds: ["researcher", "game_designer"],
    })).toEqual([]);
  });
});
