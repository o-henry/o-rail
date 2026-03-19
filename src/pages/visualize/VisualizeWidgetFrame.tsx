import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import type { VisualizeWidgetId } from "./visualizeWidgetLayout";

type VisualizeWidgetFrameProps = {
  widgetId: VisualizeWidgetId;
  title: string;
  meta?: string;
  maximized?: boolean;
  style?: CSSProperties;
  articleRef?: RefObject<HTMLElement | null>;
  onDragStart: (widgetId: VisualizeWidgetId, event: ReactPointerEvent<HTMLElement>) => void;
  onResizeStart: (widgetId: VisualizeWidgetId, event: ReactPointerEvent<HTMLElement>) => void;
  onToggleMaximize: (widgetId: VisualizeWidgetId) => void;
  onReset: (widgetId: VisualizeWidgetId) => void;
  className?: string;
  children: ReactNode;
};

export function VisualizeWidgetFrame({
  widgetId,
  title,
  meta = "",
  maximized = false,
  style,
  articleRef,
  onDragStart,
  onResizeStart,
  onToggleMaximize,
  onReset,
  className = "",
  children,
}: VisualizeWidgetFrameProps) {
  return (
    <article
      className={`visualize-monitor-widget ${className}${maximized ? " is-maximized" : ""}`.trim()}
      ref={articleRef}
      style={style}
    >
      <header className="visualize-monitor-widget-head" onPointerDown={(event) => onDragStart(widgetId, event)}>
        <div className="visualize-monitor-widget-head-main">
          <button
            aria-label={`${title} move`}
            className="visualize-monitor-widget-grip"
            onPointerDown={(event) => onDragStart(widgetId, event)}
            type="button"
          >
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </button>
          <div className="visualize-monitor-widget-head-copy">
            <strong>{title}</strong>
            {meta ? <small>{meta}</small> : null}
          </div>
        </div>
        <div className="visualize-monitor-widget-head-actions">
          <button
            aria-label={maximized ? `${title} restore` : `${title} maximize`}
            className="visualize-monitor-widget-head-button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onToggleMaximize(widgetId)}
            type="button"
          >
            <img alt="" aria-hidden="true" src="/canvas-fullscreen.svg" />
          </button>
          <button
            aria-label={`${title} reset`}
            className="visualize-monitor-widget-head-button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onReset(widgetId)}
            type="button"
          >
            <img alt="" aria-hidden="true" src="/close.svg" />
          </button>
        </div>
      </header>
      <div className="visualize-monitor-widget-surface">{children}</div>
      <button
        aria-label={`${title} resize`}
        className="visualize-monitor-widget-resize"
        onPointerDown={(event) => onResizeStart(widgetId, event)}
        type="button"
      />
    </article>
  );
}
