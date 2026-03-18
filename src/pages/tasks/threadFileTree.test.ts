import { describe, expect, it } from "vitest";
import { buildThreadFileTree } from "./threadFileTree";

describe("buildThreadFileTree", () => {
  it("builds nested directories and keeps files at the correct depth", () => {
    const tree = buildThreadFileTree([
      { path: "README.md", changed: false },
      { path: "src/pages/tasks/TasksPage.tsx", changed: true },
      { path: "src/pages/tasks/useTasksThreadState.ts", changed: false },
    ]);

    expect(tree[0]).toMatchObject({
      kind: "directory",
      name: "src",
      changed: true,
    });
    expect(tree[1]).toMatchObject({
      kind: "file",
      name: "README.md",
    });
    expect(tree[0]?.children?.[0]?.children?.[0]?.children?.map((node) => node.name)).toEqual([
      "TasksPage.tsx",
      "useTasksThreadState.ts",
    ]);
  });

  it("sorts directories before files and propagates changed state upward", () => {
    const tree = buildThreadFileTree([
      { path: "z-last.ts", changed: false },
      { path: "a/inner/file.ts", changed: true },
    ]);

    expect(tree[0]?.kind).toBe("directory");
    expect(tree[0]?.changed).toBe(true);
    expect(tree[1]?.name).toBe("z-last.ts");
  });
});
