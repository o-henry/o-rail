import type { CSSProperties, ReactNode, RefObject } from "react";
import type { VisualizeWidgetId } from "./visualizeWidgetLayout";

type VisualizeWidgetFrameProps = {
  widgetId: VisualizeWidgetId;
  title: string;
  style?: CSSProperties;
  articleRef?: RefObject<HTMLElement | null>;
  maximized?: boolean;
  onToggleMaximize: (widgetId: VisualizeWidgetId) => void;
  className?: string;
  children: ReactNode;
};

export function VisualizeWidgetFrame({
  widgetId,
  title,
  style,
  articleRef,
  maximized = false,
  onToggleMaximize,
  className = "",
  children,
}: VisualizeWidgetFrameProps) {
  return (
    <article
      className={`visualize-monitor-widget ${className}${maximized ? " is-maximized" : ""}`.trim()}
      ref={articleRef}
      style={style}
    >
      <header
        className="visualize-monitor-widget-head"
        onDoubleClick={() => onToggleMaximize(widgetId)}
        title="Double-click to expand"
      >
        <div className="visualize-monitor-widget-head-main">
          <div className="visualize-monitor-widget-head-copy">
            <strong>{title}</strong>
          </div>
        </div>
      </header>
      <div className="visualize-monitor-widget-surface">{children}</div>
    </article>
  );
}
