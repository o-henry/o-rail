import { describe, expect, it } from "vitest";
import { buildPresetGraphByKind } from "./presets";

describe("workflow presets", () => {
  it("builds a Unity CI Doctor graph with preprocess and triage branches", () => {
    const graph = buildPresetGraphByKind("unityCiDoctor");

    expect(graph.nodes.some((node) => node.id === "turn-unityCiDoctor-preprocess")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "turn-unity-ci-intake")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "turn-unity-ci-system")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "turn-unity-ci-qa")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "turn-unity-ci-pm")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "turn-unity-ci-final")).toBe(true);

    expect(
      graph.edges.some(
        (edge) => edge.from.nodeId === "turn-unity-ci-intake" && edge.to.nodeId === "turn-unity-ci-system",
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) => edge.from.nodeId === "turn-unity-ci-intake" && edge.to.nodeId === "turn-unity-ci-qa",
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) => edge.from.nodeId === "turn-unity-ci-intake" && edge.to.nodeId === "turn-unity-ci-pm",
      ),
    ).toBe(true);
  });
});
