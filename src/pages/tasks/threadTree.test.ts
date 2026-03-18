import { describe, expect, it } from "vitest";
import { buildProjectThreadGroups, filterBrowserThreadIdsByProject, filterThreadListByProject, matchesProjectPath, projectTreeLabel } from "./threadTree";
import type { ThreadDetail, ThreadListItem } from "./threadTypes";

describe("matchesProjectPath", () => {
  it("matches normalized paths", () => {
    expect(matchesProjectPath("/tmp/game-a/", "/tmp/game-a")).toBe(true);
    expect(matchesProjectPath("/tmp/game-a", "/tmp/game-b")).toBe(false);
  });
});

describe("filterThreadListByProject", () => {
  it("keeps only threads for the selected project", () => {
    const items = [
      { projectPath: "/tmp/game-a", thread: { cwd: "/tmp/game-a" } },
      { projectPath: "/tmp/game-b", thread: { cwd: "/tmp/game-b" } },
    ] as ThreadListItem[];
    expect(filterThreadListByProject(items, "/tmp/game-b")).toHaveLength(1);
    expect(filterThreadListByProject(items, "/tmp/game-b")[0]?.projectPath).toBe("/tmp/game-b");
  });
});

describe("filterBrowserThreadIdsByProject", () => {
  it("uses task workspace/worktree to filter thread ids", () => {
    const details = {
      a: { task: { projectPath: "/tmp/game-a", workspacePath: "/tmp/game-a", worktreePath: null } },
      b: { task: { projectPath: "/tmp/game-b", workspacePath: "/tmp/game-b", worktreePath: "/tmp/game-b-worktree" } },
    } as unknown as Record<string, ThreadDetail>;
    expect(filterBrowserThreadIdsByProject(details, ["a", "b"], "/tmp/game-b")).toEqual(["b"]);
  });
});

describe("projectTreeLabel", () => {
  it("returns the last path segment", () => {
    expect(projectTreeLabel("/Users/henry/Documents/MyGame")).toBe("MyGame");
  });
});

describe("buildProjectThreadGroups", () => {
  it("groups threads under each project without reshuffling on selection", () => {
    const items = [
      { projectPath: "/tmp/game-a", thread: { threadId: "a-1", updatedAt: "2026-03-18T10:00:00Z" } },
      { projectPath: "/tmp/game-a", thread: { threadId: "a-2", updatedAt: "2026-03-18T09:00:00Z" } },
      { projectPath: "/tmp/game-b", thread: { threadId: "b-1", updatedAt: "2026-03-18T11:00:00Z" } },
    ] as ThreadListItem[];
    const groups = buildProjectThreadGroups(items, "/tmp/game-a");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.projectPath).toBe("/tmp/game-b");
    expect(groups[0]?.isSelected).toBe(false);
    expect(groups[1]?.projectPath).toBe("/tmp/game-a");
    expect(groups[1]?.threads).toHaveLength(2);
    expect(groups[1]?.isSelected).toBe(true);
  });

  it("keeps opened projects visible even when they have no threads", () => {
    const items = [
      { projectPath: "/tmp/game-a", thread: { threadId: "a-1", updatedAt: "2026-03-18T10:00:00Z" } },
    ] as ThreadListItem[];
    const groups = buildProjectThreadGroups(items, "/tmp/game-a", ["/tmp/game-a", "/tmp/playground"]);
    expect(groups).toHaveLength(2);
    expect(groups.some((group) => group.projectPath === "/tmp/playground" && group.threads.length === 0)).toBe(true);
  });
});
