import { describe, expect, it } from "vitest";
import {
  computeVisualizeCanvasSize,
  createDefaultVisualizeWidgetLayoutState,
  normalizeVisualizeWidgetLayoutState,
} from "./visualizeWidgetLayout";

describe("visualizeWidgetLayout", () => {
  it("falls back to defaults for invalid input", () => {
    const state = normalizeVisualizeWidgetLayoutState(null);
    expect(state).toEqual(createDefaultVisualizeWidgetLayoutState());
  });

  it("normalizes widget bounds and preserves valid maximized ids", () => {
    const state = normalizeVisualizeWidgetLayoutState({
      maximizedWidgetId: "timeline",
      widgets: {
        session: { x: -20, y: 12, w: 140, h: 100 },
        timeline: { x: 80, y: 120, w: 900, h: 420 },
      },
    });

    expect(state.maximizedWidgetId).toBe("timeline");
    expect(state.widgets.session.x).toBe(0);
    expect(state.widgets.session.y).toBe(12);
    expect(state.widgets.session.w).toBeGreaterThanOrEqual(state.widgets.session.minW);
    expect(state.widgets.session.h).toBeGreaterThanOrEqual(state.widgets.session.minH);
    expect(state.widgets.timeline.w).toBe(900);
    expect(state.widgets.timeline.h).toBe(420);
  });

  it("expands the canvas to fit large widget positions", () => {
    const state = createDefaultVisualizeWidgetLayoutState();
    state.widgets.report = {
      ...state.widgets.report,
      x: 1320,
      y: 980,
      w: 640,
      h: 360,
    };

    const size = computeVisualizeCanvasSize(state);
    expect(size.width).toBe(1960);
    expect(size.height).toBe(1340);
  });
});
