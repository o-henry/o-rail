import { describe, expect, it, vi } from "vitest";
import type { GraphData } from "../../../features/workflow/types";
import {
  findDirectInputNodeIds,
  resolveGraphDagMaxThreads,
  scheduleChildrenWhenReady,
  scheduleRunnableGraphNodes,
} from "./runGraphFlowUtils";

describe("findDirectInputNodeIds", () => {
  it("ignores internal role research nodes when resolving question-direct roots", () => {
    const graph: GraphData = {
      version: 1,
      nodes: [
        {
          id: "role",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner" },
        },
        {
          id: "research",
          type: "turn",
          position: { x: 0, y: 0 },
          config: {
            sourceKind: "data_research",
            internalParentNodeId: "role",
            internalNodeKind: "research",
          },
        },
        {
          id: "verification",
          type: "turn",
          position: { x: 0, y: 0 },
          config: {
            sourceKind: "data_pipeline",
            internalParentNodeId: "role",
            internalNodeKind: "verification",
          },
        },
      ],
      edges: [
        {
          from: { nodeId: "research", port: "out" },
          to: { nodeId: "verification", port: "in" },
        },
        {
          from: { nodeId: "verification", port: "out" },
          to: { nodeId: "role", port: "in" },
        },
      ],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    expect(findDirectInputNodeIds(graph)).toEqual(["role"]);
  });
});

describe("resolveGraphDagMaxThreads", () => {
  it("raises concurrency to match multiple direct-input roots", () => {
    expect(resolveGraphDagMaxThreads("off", 2)).toBe(2);
    expect(resolveGraphDagMaxThreads("balanced", 3)).toBe(3);
  });

  it("keeps preset concurrency when roots are singular", () => {
    expect(resolveGraphDagMaxThreads("max", 1)).toBe(4);
  });
});

describe("scheduleRunnableGraphNodes", () => {
  it("schedules multiple turn roots in the same pass when slots are available", () => {
    const queue = ["a", "b"];
    const activeTasks = new Map<string, Promise<void>>();
    const processNode = vi.fn((nodeId: string) => new Promise<void>(() => void nodeId));

    scheduleRunnableGraphNodes({
      queue,
      activeTasks,
      dagMaxThreads: 2,
      nodeMap: new Map([
        ["a", { id: "a", type: "turn", position: { x: 0, y: 0 }, config: { executor: "codex" } }],
        ["b", { id: "b", type: "turn", position: { x: 0, y: 0 }, config: { executor: "codex" } }],
      ]),
      activeTurnTasks: 0,
      processNode,
      reportSoftError: vi.fn(),
    });

    expect(queue).toEqual([]);
    expect(activeTasks.size).toBe(2);
    expect(processNode).toHaveBeenCalledTimes(2);
  });
});

describe("scheduleChildrenWhenReady", () => {
  it("prioritizes internal synthesis and verification nodes at the front of the queue", () => {
    const indegree = new Map([
      ["review", 1],
      ["unrelated", 1],
    ]);
    const queue = ["existing"];
    const onQueued = vi.fn();

    scheduleChildrenWhenReady({
      nodeId: "research-a",
      adjacency: new Map([["research-a", ["unrelated", "review"]]]),
      indegree,
      queue,
      prioritizeNodeId: (nodeId) => nodeId === "review",
      onQueued,
    });

    expect(queue).toEqual(["review", "existing", "unrelated"]);
    expect(onQueued).toHaveBeenCalledTimes(2);
  });
});
