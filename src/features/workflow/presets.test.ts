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

  it("builds all Unity automation preset graphs", () => {
    const testsmith = buildPresetGraphByKind("unityTestsmith");
    const buildWatcher = buildPresetGraphByKind("unityBuildWatcher");
    const localizationQa = buildPresetGraphByKind("unityLocalizationQa");
    const addressablesDiet = buildPresetGraphByKind("unityAddressablesDiet");

    expect(testsmith.nodes.some((node) => node.id === "turn-unityTestsmith-preprocess")).toBe(true);
    expect(testsmith.nodes.some((node) => node.id === "turn-unity-test-editmode")).toBe(true);
    expect(buildWatcher.nodes.some((node) => node.id === "turn-unityBuildWatcher-preprocess")).toBe(true);
    expect(buildWatcher.nodes.some((node) => node.id === "turn-unity-size-regression")).toBe(true);
    expect(localizationQa.nodes.some((node) => node.id === "turn-unityLocalizationQa-preprocess")).toBe(true);
    expect(localizationQa.nodes.some((node) => node.id === "turn-unity-loc-placeholders")).toBe(true);
    expect(addressablesDiet.nodes.some((node) => node.id === "turn-unityAddressablesDiet-preprocess")).toBe(true);
    expect(addressablesDiet.nodes.some((node) => node.id === "turn-unity-addr-load")).toBe(true);
  });
});
