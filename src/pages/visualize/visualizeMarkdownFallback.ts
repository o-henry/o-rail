import type { FeedChartSpec } from "../../features/feed/chartSpec";

export type VisualizeParsedSourceRow = {
  sourceName: string;
  itemCount: number;
};

export type VisualizeParsedEvidenceRow = {
  title: string;
  verificationStatus: string;
  score: number;
  url: string;
  summary: string;
};

export type VisualizeParsedMarkdown = {
  charts: Array<{
    title: string;
    description: string;
    chart: FeedChartSpec;
  }>;
  topSources: VisualizeParsedSourceRow[];
  evidence: VisualizeParsedEvidenceRow[];
};

export type VisualizeParsedChartRow = {
  label: string;
  count: number;
};

type MarkdownSection = {
  title: string;
  paragraphs: string[];
  bullets: Array<{
    text: string;
    details: string[];
  }>;
};

function normalize(input: string) {
  return String(input ?? "").trim();
}

function parseChartBlock(raw: string): FeedChartSpec | null {
  const normalized = normalize(raw);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized) as FeedChartSpec | { chart?: FeedChartSpec };
    const candidate = typeof parsed === "object" && parsed && "chart" in parsed ? parsed.chart : parsed;
    if (!candidate || typeof candidate !== "object") {
      return null;
    }
    return candidate as FeedChartSpec;
  } catch {
    return null;
  }
}

function parseSourceBullet(input: string): VisualizeParsedSourceRow | null {
  const match = normalize(input).match(/^(.+?)\s*:\s*(\d+)\s*$/);
  if (!match) {
    return null;
  }
  return {
    sourceName: normalize(match[1] ?? ""),
    itemCount: Number.parseInt(match[2] ?? "0", 10) || 0,
  };
}

function parseEvidenceBullet(input: { text: string; details: string[] }): VisualizeParsedEvidenceRow {
  const raw = normalize(input.text);
  const titleMatch = raw.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
  const title = normalize(titleMatch?.[1] ?? raw);
  const meta = normalize(titleMatch?.[2] ?? "");
  const metaParts = meta.split(",").map((part) => normalize(part)).filter(Boolean);
  const sourceLabel = metaParts[0] ?? "";
  const verificationStatus = metaParts[1] ?? "";
  const scoreMatch = meta.match(/(?:점수|score)\s*(\d+(?:\.\d+)?)/i);
  const score = scoreMatch ? Number.parseFloat(scoreMatch[1] ?? "0") : 0;
  const detailLines = input.details.map((line) => normalize(line)).filter(Boolean);
  const url = detailLines.find((line) => /^https?:\/\//i.test(line)) ?? "";
  const summary = detailLines.filter((line) => line !== url && !/^인용:/.test(line) && !/^신뢰도:/.test(line)).join(" ").trim();
  return {
    title,
    verificationStatus: verificationStatus || sourceLabel,
    score,
    url,
    summary,
  };
}

function findSection(sections: MarkdownSection[], patterns: RegExp[]): MarkdownSection | null {
  return sections.find((section) => patterns.some((pattern) => pattern.test(section.title))) ?? null;
}

export function parseVisualizeMarkdownFallback(raw: string): VisualizeParsedMarkdown {
  const lines = String(raw ?? "").split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const charts: VisualizeParsedMarkdown["charts"] = [];
  let currentSection: MarkdownSection | null = null;
  let currentBullet: MarkdownSection["bullets"][number] | null = null;
  let insideChart = false;
  let chartLines: string[] = [];

  const ensureSection = (title: string) => {
    const section: MarkdownSection = { title, paragraphs: [], bullets: [] };
    currentSection = section;
    sections.push(section);
    currentBullet = null;
    return section;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (trimmed === "```rail-chart") {
      insideChart = true;
      chartLines = [];
      continue;
    }
    if (insideChart && trimmed === "```") {
      insideChart = false;
      const chart = parseChartBlock(chartLines.join("\n"));
      if (chart) {
        const chartSection = currentSection ?? ensureSection("");
        charts.push({
          title: chartSection.title,
          description: chartSection.paragraphs[chartSection.paragraphs.length - 1] || "",
          chart,
        });
      }
      continue;
    }
    if (insideChart) {
      chartLines.push(line);
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      ensureSection(trimmed.replace(/^##\s+/, ""));
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      ensureSection(trimmed.replace(/^#\s+/, ""));
      continue;
    }
    if (!trimmed) {
      currentBullet = null;
      continue;
    }
    if (/^- /.test(trimmed)) {
      if (!currentSection) {
        ensureSection("");
      }
      currentBullet = { text: trimmed.replace(/^- /, ""), details: [] };
      currentSection!.bullets.push(currentBullet);
      continue;
    }
    if (currentBullet && /^\s{2,}/.test(line)) {
      currentBullet.details.push(trimmed);
      continue;
    }
    if (!currentSection) {
      ensureSection("");
    }
    const activeSection = currentSection ?? ensureSection("");
    activeSection.paragraphs.push(trimmed);
    currentBullet = null;
  }

  const topSourcesSection = findSection(sections, [/주요 출처/i, /top sources?/i, /sources?/i]);
  const evidenceSection = findSection(sections, [/핵심 근거/i, /evidence/i, /reaction highlights/i, /representative/i, /compared/i]);

  return {
    charts,
    topSources: (topSourcesSection?.bullets ?? [])
      .map((bullet) => parseSourceBullet(bullet.text))
      .filter((row): row is VisualizeParsedSourceRow => Boolean(row)),
    evidence: (evidenceSection?.bullets ?? []).map((bullet) => parseEvidenceBullet(bullet)),
  };
}

export function mergeVisualizeMarkdownFallback(...parts: Array<VisualizeParsedMarkdown | null | undefined>): VisualizeParsedMarkdown {
  const merged: VisualizeParsedMarkdown = { charts: [], topSources: [], evidence: [] };
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (merged.charts.length === 0 && part.charts.length > 0) {
      merged.charts = part.charts;
    }
    if (merged.topSources.length === 0 && part.topSources.length > 0) {
      merged.topSources = part.topSources;
    }
    if (merged.evidence.length === 0 && part.evidence.length > 0) {
      merged.evidence = part.evidence;
    }
  }
  return merged;
}

export function chartRowsFromMarkdownFallback(chart: FeedChartSpec | null | undefined): VisualizeParsedChartRow[] {
  if (!chart || !Array.isArray(chart.labels) || !Array.isArray(chart.series) || chart.series.length === 0) {
    return [];
  }
  const firstSeries = chart.series[0];
  if (!Array.isArray(firstSeries?.data)) {
    return [];
  }
  return chart.labels.map((label, index) => ({
    label: String(label ?? "").trim(),
    count: Number(firstSeries.data[index] ?? 0),
  })).filter((row) => row.label && Number.isFinite(row.count));
}
