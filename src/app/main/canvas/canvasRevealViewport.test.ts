import { describe, expect, it } from "vitest";
import { computeCanvasRevealViewport } from "./canvasRevealViewport";

describe("computeCanvasRevealViewport", () => {
  it("zooms out and centers the target bounds inside the canvas", () => {
    const next = computeCanvasRevealViewport({
      clientWidth: 1000,
      clientHeight: 700,
      currentZoom: 1,
      bounds: { minX: 1200, minY: 900, maxX: 2500, maxY: 1900 },
      stageInsetX: 90,
      stageInsetY: 220,
      padding: 48,
    });

    expect(next.zoom).toBeCloseTo(0.604, 3);
    expect(next.scrollLeft).toBeCloseTo(707.4, 1);
    expect(next.scrollTop).toBeCloseTo(715.6, 1);
  });
});
