import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  computeVisualizeCanvasSize,
  readVisualizeWidgetLayoutState,
  resetVisualizeWidgetRect,
  type VisualizeWidgetId,
  type VisualizeWidgetLayoutState,
  writeVisualizeWidgetLayoutState,
} from "./visualizeWidgetLayout";

type InteractionState =
  | {
      type: "drag" | "resize";
      widgetId: VisualizeWidgetId;
      pointerX: number;
      pointerY: number;
      startState: VisualizeWidgetLayoutState;
    }
  | null;

type UseVisualizeWidgetLayoutParams = {
  cwd: string;
};

export function useVisualizeWidgetLayout({ cwd }: UseVisualizeWidgetLayoutParams) {
  const [layoutState, setLayoutState] = useState<VisualizeWidgetLayoutState>(() => readVisualizeWidgetLayoutState(cwd));
  const interactionRef = useRef<InteractionState>(null);

  useEffect(() => {
    setLayoutState(readVisualizeWidgetLayoutState(cwd));
  }, [cwd]);

  useEffect(() => {
    writeVisualizeWidgetLayoutState(cwd, layoutState);
  }, [cwd, layoutState]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = interactionRef.current;
      if (!active) {
        return;
      }
      const widget = active.startState.widgets[active.widgetId];
      const deltaX = event.clientX - active.pointerX;
      const deltaY = event.clientY - active.pointerY;
      setLayoutState((current) => {
        const next = { ...current, widgets: { ...current.widgets } };
        if (active.type === "drag") {
          next.widgets[active.widgetId] = {
            ...widget,
            x: Math.max(0, widget.x + deltaX),
            y: Math.max(0, widget.y + deltaY),
          };
        } else {
          next.widgets[active.widgetId] = {
            ...widget,
            w: Math.max(widget.minW, widget.w + deltaX),
            h: Math.max(widget.minH, widget.h + deltaY),
          };
        }
        return next;
      });
    };

    const onPointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const startDrag = useCallback((widgetId: VisualizeWidgetId, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    interactionRef.current = {
      type: "drag",
      widgetId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startState: layoutState,
    };
  }, [layoutState]);

  const startResize = useCallback((widgetId: VisualizeWidgetId, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      type: "resize",
      widgetId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startState: layoutState,
    };
  }, [layoutState]);

  const toggleMaximize = useCallback((widgetId: VisualizeWidgetId) => {
    setLayoutState((current) => ({
      ...current,
      maximizedWidgetId: current.maximizedWidgetId === widgetId ? null : widgetId,
    }));
  }, []);

  const resetWidget = useCallback((widgetId: VisualizeWidgetId) => {
    setLayoutState((current) => ({
      ...current,
      widgets: {
        ...current.widgets,
        [widgetId]: resetVisualizeWidgetRect(widgetId),
      },
      maximizedWidgetId: current.maximizedWidgetId === widgetId ? null : current.maximizedWidgetId,
    }));
  }, []);

  const canvasSize = useMemo(() => computeVisualizeCanvasSize(layoutState), [layoutState]);

  return {
    canvasSize,
    layoutState,
    resetWidget,
    startDrag,
    startResize,
    toggleMaximize,
  };
}
