export type VisualizeWidgetId =
  | "session"
  | "kpis"
  | "timeline"
  | "sourceMix"
  | "quality"
  | "sources"
  | "steam"
  | "report"
  | "evidence";

export type VisualizeWidgetRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
};

export type VisualizeWidgetLayoutState = {
  version: 1;
  maximizedWidgetId: VisualizeWidgetId | null;
  widgets: Record<VisualizeWidgetId, VisualizeWidgetRect>;
};

const DEFAULT_WIDGETS: Record<VisualizeWidgetId, VisualizeWidgetRect> = {
  session: { x: 0, y: 0, w: 420, h: 260, minW: 320, minH: 220 },
  kpis: { x: 440, y: 0, w: 420, h: 260, minW: 320, minH: 220 },
  timeline: { x: 0, y: 280, w: 540, h: 360, minW: 360, minH: 280 },
  sourceMix: { x: 560, y: 280, w: 300, h: 300, minW: 260, minH: 240 },
  quality: { x: 880, y: 280, w: 300, h: 300, minW: 260, minH: 220 },
  sources: { x: 0, y: 660, w: 280, h: 280, minW: 240, minH: 220 },
  steam: { x: 300, y: 660, w: 280, h: 280, minW: 240, minH: 220 },
  report: { x: 600, y: 660, w: 580, h: 280, minW: 380, minH: 240 },
  evidence: { x: 0, y: 960, w: 1180, h: 340, minW: 480, minH: 260 },
};

const STORAGE_KEY_PREFIX = "rail.visualize.widget-layout.v1";

function storageKeyForCwd(cwd: string) {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(String(cwd ?? "").trim() || "default")}`;
}

export function createDefaultVisualizeWidgetLayoutState(): VisualizeWidgetLayoutState {
  return {
    version: 1,
    maximizedWidgetId: null,
    widgets: { ...DEFAULT_WIDGETS },
  };
}

export function normalizeVisualizeWidgetLayoutState(input: unknown): VisualizeWidgetLayoutState {
  const fallback = createDefaultVisualizeWidgetLayoutState();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fallback;
  }
  const row = input as Partial<VisualizeWidgetLayoutState>;
  const widgets = { ...DEFAULT_WIDGETS };
  for (const widgetId of Object.keys(DEFAULT_WIDGETS) as VisualizeWidgetId[]) {
    const candidate = row.widgets?.[widgetId];
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const normalized = candidate as Partial<VisualizeWidgetRect>;
    widgets[widgetId] = {
      x: Number.isFinite(normalized.x) ? Math.max(0, Number(normalized.x)) : DEFAULT_WIDGETS[widgetId].x,
      y: Number.isFinite(normalized.y) ? Math.max(0, Number(normalized.y)) : DEFAULT_WIDGETS[widgetId].y,
      w: Number.isFinite(normalized.w) ? Math.max(DEFAULT_WIDGETS[widgetId].minW, Number(normalized.w)) : DEFAULT_WIDGETS[widgetId].w,
      h: Number.isFinite(normalized.h) ? Math.max(DEFAULT_WIDGETS[widgetId].minH, Number(normalized.h)) : DEFAULT_WIDGETS[widgetId].h,
      minW: DEFAULT_WIDGETS[widgetId].minW,
      minH: DEFAULT_WIDGETS[widgetId].minH,
    };
  }
  const maximizedWidgetId = row.maximizedWidgetId && row.maximizedWidgetId in widgets
    ? row.maximizedWidgetId
    : null;
  return {
    version: 1,
    maximizedWidgetId,
    widgets,
  };
}

export function readVisualizeWidgetLayoutState(cwd: string): VisualizeWidgetLayoutState {
  if (typeof window === "undefined") {
    return createDefaultVisualizeWidgetLayoutState();
  }
  const raw = window.localStorage.getItem(storageKeyForCwd(cwd));
  if (!raw) {
    return createDefaultVisualizeWidgetLayoutState();
  }
  try {
    return normalizeVisualizeWidgetLayoutState(JSON.parse(raw));
  } catch {
    return createDefaultVisualizeWidgetLayoutState();
  }
}

export function writeVisualizeWidgetLayoutState(cwd: string, state: VisualizeWidgetLayoutState): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKeyForCwd(cwd), JSON.stringify(state));
}

export function resetVisualizeWidgetRect(widgetId: VisualizeWidgetId): VisualizeWidgetRect {
  return { ...DEFAULT_WIDGETS[widgetId] };
}

export function computeVisualizeCanvasSize(layout: VisualizeWidgetLayoutState) {
  const widgets = Object.values(layout.widgets);
  const width = Math.max(1180, ...widgets.map((widget) => widget.x + widget.w));
  const height = Math.max(1120, ...widgets.map((widget) => widget.y + widget.h));
  return {
    width,
    height,
  };
}
