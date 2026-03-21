import type { FeedChartSpec } from "../../features/feed/chartSpec";

type TopSourceRow = {
  sourceName: string;
  itemCount: number;
};

type TimelineRow = {
  label: string;
  count: number;
};

type GenreRow = {
  genreLabel: string;
  popularityScore?: number;
  qualityScore?: number;
};

type VerificationRow = {
  verificationStatus: string;
  itemCount: number;
};

type QuantitativeRow = {
  label: string;
  value: number;
  unit: "players";
};

export type VisualizeChartAssistantIntent =
  | "players"
  | "genre"
  | "timeline"
  | "sources"
  | "verification"
  | "fallback";

export type VisualizeChartAssistantContext = {
  prompt: string;
  leadCopy: string;
  topSources: TopSourceRow[];
  timelineRows: TimelineRow[];
  popularGenres: GenreRow[];
  verificationRows: VerificationRow[];
  quantitativeRows: QuantitativeRow[];
  markdownChart: FeedChartSpec | null;
};

export type VisualizeChartAssistantResult = {
  title: string;
  chart: FeedChartSpec | null;
  intent: VisualizeChartAssistantIntent;
  steps: string[];
  summary: string;
};

function normalize(input: string) {
  return String(input ?? "").trim();
}

function includesAny(input: string, patterns: string[]) {
  return patterns.some((pattern) => input.includes(pattern));
}

function buildSourcesChart(rows: TopSourceRow[]): FeedChartSpec | null {
  if (!rows.length) {
    return null;
  }
  return {
    type: "bar",
    labels: rows.map((row) => row.sourceName || "-"),
    series: [{ name: "Sources", data: rows.map((row) => row.itemCount), color: "#0f172a" }],
  };
}

function buildTimelineChart(rows: TimelineRow[]): FeedChartSpec | null {
  if (!rows.length) {
    return null;
  }
  return {
    type: "line",
    labels: rows.map((row) => row.label),
    series: [{ name: "Items", data: rows.map((row) => row.count), color: "#2563eb" }],
  };
}

function buildGenreChart(rows: GenreRow[]): FeedChartSpec | null {
  if (!rows.length) {
    return null;
  }
  const labels = rows.map((row) => row.genreLabel || "-");
  const data = rows.map((row) => Math.round(Number(row.popularityScore ?? row.qualityScore ?? 0)));
  if (!data.some((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return {
    type: "bar",
    labels,
    series: [{ name: "Popularity", data, color: "#0f172a" }],
  };
}

function buildVerificationChart(rows: VerificationRow[]): FeedChartSpec | null {
  if (!rows.length) {
    return null;
  }
  return {
    type: "bar",
    labels: rows.map((row) => row.verificationStatus || "-"),
    series: [{ name: "Verification", data: rows.map((row) => row.itemCount), color: "#475569" }],
  };
}

function buildPlayersChart(rows: QuantitativeRow[]): FeedChartSpec | null {
  if (!rows.length) {
    return null;
  }
  return {
    type: "bar",
    labels: rows.map((row) => row.label || "-"),
    series: [{ name: "Players", data: rows.map((row) => row.value), color: "#0f172a" }],
  };
}

function resolveIntent(prompt: string, context: VisualizeChartAssistantContext): VisualizeChartAssistantIntent {
  const normalized = normalize(prompt).toLowerCase();
  if (includesAny(normalized, ["동접", "동시 접속", "player", "players", "concurrent", "ccu"])) {
    return context.quantitativeRows.length > 0 ? "players" : "fallback";
  }
  if (includesAny(normalized, ["genre", "장르", "popular", "popularity"])) {
    return "genre";
  }
  if (includesAny(normalized, ["timeline", "추이", "시간", "날짜", "변화"])) {
    return "timeline";
  }
  if (includesAny(normalized, ["source", "sources", "출처", "사이트", "소스"])) {
    return "sources";
  }
  if (includesAny(normalized, ["verify", "verification", "quality", "검증", "품질", "warning"])) {
    return "verification";
  }
  if (context.popularGenres.length > 0) {
    return "genre";
  }
  if (context.timelineRows.length > 0) {
    return "timeline";
  }
  if (context.topSources.length > 0) {
    return "sources";
  }
  if (context.verificationRows.length > 0) {
    return "verification";
  }
  if (context.quantitativeRows.length > 0) {
    return "players";
  }
  return "fallback";
}

function resolveChart(intent: VisualizeChartAssistantIntent, context: VisualizeChartAssistantContext): FeedChartSpec | null {
  switch (intent) {
    case "players":
      return buildPlayersChart(context.quantitativeRows) ?? context.markdownChart;
    case "genre":
      return buildGenreChart(context.popularGenres) ?? context.markdownChart;
    case "timeline":
      return buildTimelineChart(context.timelineRows) ?? context.markdownChart;
    case "sources":
      return buildSourcesChart(context.topSources) ?? context.markdownChart;
    case "verification":
      return buildVerificationChart(context.verificationRows) ?? context.markdownChart;
    default:
      return context.markdownChart
        ?? buildPlayersChart(context.quantitativeRows)
        ?? buildGenreChart(context.popularGenres)
        ?? buildTimelineChart(context.timelineRows)
        ?? buildSourcesChart(context.topSources)
        ?? buildVerificationChart(context.verificationRows);
  }
}

function resolveTitle(intent: VisualizeChartAssistantIntent, prompt: string): string {
  const normalizedPrompt = normalize(prompt);
  if (normalizedPrompt) {
    return normalizedPrompt.slice(0, 48);
  }
  if (intent === "players") {
    return "PLAYER COUNTS";
  }
  if (intent === "genre") {
    return "POPULAR GENRES";
  }
  if (intent === "timeline") {
    return "RESEARCH TIMELINE";
  }
  if (intent === "sources") {
    return "TOP SOURCES";
  }
  if (intent === "verification") {
    return "QUALITY MIX";
  }
  return "RESEARCH CHART";
}

function intentLabel(intent: VisualizeChartAssistantIntent): string {
  if (intent === "players") {
    return "동접/규모";
  }
  if (intent === "genre") {
    return "장르/인기";
  }
  if (intent === "timeline") {
    return "타임라인";
  }
  if (intent === "sources") {
    return "상위 소스";
  }
  if (intent === "verification") {
    return "검증/품질";
  }
  return "대표 차트";
}

export function buildVisualizeChartAssistantResult(
  context: VisualizeChartAssistantContext,
): VisualizeChartAssistantResult {
  const intent = resolveIntent(context.prompt, context);
  const chart = resolveChart(intent, context);
  const title = resolveTitle(intent, context.prompt);
  return {
    title,
    chart,
    intent,
    steps: [
      "리서치 문서와 수집 지표를 스캔해서 차트 후보를 정리했습니다.",
      `요청을 ${intentLabel(intent)} 중심 시각화로 해석했습니다.`,
      chart
        ? "가장 정보량이 높은 축으로 labels와 series를 구성했습니다."
        : "현재 문서에서 바로 차트화할 수 있는 구조화 축이 부족해 fallback 후보를 찾고 있습니다.",
      chart ? `"${title}" 차트를 생성했습니다.` : "생성 가능한 차트 축을 찾지 못했습니다.",
    ],
    summary: chart
      ? `${context.leadCopy || "리서치 문서"}를 바탕으로 ${intentLabel(intent)} 차트를 만들었습니다.`
      : "문서 요약은 확인했지만 바로 그릴 수 있는 차트 축이 부족했습니다.",
  };
}
