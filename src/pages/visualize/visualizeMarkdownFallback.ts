import type { FeedChartSpec } from "../../features/feed/chartSpec";

export type VisualizeParsedSourceRow = {
  sourceName: string;
  itemCount: number;
};

export type VisualizeParsedFindingRow = {
  title: string;
  detail: string;
  rank: number;
};

export type VisualizeParsedEvidenceRow = {
  title: string;
  verificationStatus: string;
  score: number;
  url: string;
  summary: string;
};

export type VisualizeParsedQuantitativeRow = {
  label: string;
  value: number;
  unit: "players";
  sourceText: string;
};

export type VisualizeParsedMarkdown = {
  charts: Array<{
    title: string;
    description: string;
    chart: FeedChartSpec;
  }>;
  topSources: VisualizeParsedSourceRow[];
  evidence: VisualizeParsedEvidenceRow[];
  conclusions: VisualizeParsedFindingRow[];
  quantitativeRows: VisualizeParsedQuantitativeRow[];
  metrics: {
    items: number;
    sources: number;
    verified: number;
    warnings: number;
    conflicted: number;
    avgScore: number;
  };
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

type MarkdownLink = {
  label: string;
  url: string;
};

function parseMarkdownLinks(input: string): MarkdownLink[] {
  return [...String(input ?? "").matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi)].map((match) => ({
    label: normalize(match[1] ?? ""),
    url: normalize(match[2] ?? ""),
  })).filter((row) => row.label || row.url);
}

function stripMarkdownLinks(input: string) {
  return normalize(String(input ?? "").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, "$1"));
}

function sourceNameFromUrl(input: string) {
  try {
    const host = new URL(input).hostname.replace(/^www\./i, "");
    const base = host.split(".")[0] ?? host;
    return base
      .split(/[-_]/g)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function parsePlayerCountRows(input: string): VisualizeParsedQuantitativeRow[] {
  const raw = stripMarkdownLinks(input);
  if (!/(동접|동시 접속|concurrent|player|players|steam 공식 stats|steam stats|명)/i.test(raw)) {
    return [];
  }
  const searchText = raw.replace(/^.*?기준으로\s+/i, "");
  const rows = [...searchText.matchAll(
    /(?:^|,\s*|기준으로\s+|에서는\s+|통계는\s+|stats는\s+)([A-Za-z0-9가-힣][A-Za-z0-9가-힣:'"&+./·()\- ]{1,80}?)\s+(\d{1,3}(?:,\d{3})+|\d+)\s*명/gi,
  )].map((match) => ({
    label: normalize(match[1] ?? "")
      .replace(/^(?:Steam 공식 Stats는?|Steam Stats는?)\s*/i, "")
      .replace(/^(?:202\d[^A-Za-z가-힣]+)+/, "")
      .trim(),
    value: Number.parseInt(String(match[2] ?? "0").replace(/,/g, ""), 10) || 0,
    unit: "players" as const,
    sourceText: raw,
  })).filter((row) => {
    if (!row.label || !Number.isFinite(row.value) || row.value <= 0) {
      return false;
    }
    if (row.label.length > 64) {
      return false;
    }
    if (/기준|업데이트|공식|통계|stats|보여줍니다|상위권|입니다$/i.test(row.label)) {
      return false;
    }
    return /[A-Za-z가-힣]/.test(row.label);
  });
  const deduped = new Map<string, VisualizeParsedQuantitativeRow>();
  for (const row of rows) {
    if (!deduped.has(row.label)) {
      deduped.set(row.label, row);
    }
  }
  return [...deduped.values()];
}

function parseEvidenceBullet(input: { text: string; details: string[] }): VisualizeParsedEvidenceRow {
  const raw = stripMarkdownLinks(input.text);
  const titleMatch = raw.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
  const title = normalize(titleMatch?.[1] ?? raw);
  const meta = normalize(titleMatch?.[2] ?? "");
  const metaParts = meta.split(",").map((part) => normalize(part)).filter(Boolean);
  const sourceLabel = metaParts[0] ?? "";
  const verificationStatus = metaParts[1] ?? "";
  const scoreMatch = meta.match(/(?:점수|score)\s*(\d+(?:\.\d+)?)/i);
  const score = scoreMatch ? Number.parseFloat(scoreMatch[1] ?? "0") : 0;
  const detailLines = input.details.map((line) => stripMarkdownLinks(line)).filter(Boolean);
  const inlineLinks = [
    ...parseMarkdownLinks(input.text),
    ...input.details.flatMap((line) => parseMarkdownLinks(line)),
  ];
  const url = inlineLinks[0]?.url ?? detailLines.find((line) => /^https?:\/\//i.test(line)) ?? "";
  const summary = detailLines
    .filter((line) => line !== url && !/^인용:/.test(line) && !/^신뢰도:/.test(line))
    .join(" ")
    .trim();
  return {
    title,
    verificationStatus: verificationStatus || sourceLabel || sourceNameFromUrl(url),
    score,
    url,
    summary,
  };
}

function parseConclusionBullet(
  input: { text: string; details: string[] },
  fallbackRank: number,
): VisualizeParsedFindingRow | null {
  const raw = stripMarkdownLinks(input.text);
  const rankMatch = raw.match(/(?:^|\s)(\d+)위/);
  const rank = Number.parseInt(rankMatch?.[1] ?? `${fallbackRank}`, 10) || fallbackRank;
  const titleMatch =
    raw.match(/(?:\d+위는?|TOP\s*\d+\s*:?)\s*[`"'“”]?([^`"'“”]+?)[`"'“”]?(?:[.,]|$)/i)
    ?? raw.match(/[`"'“”]([^`"'“”]+)[`"'“”]/);
  const title = normalize(titleMatch?.[1] ?? raw.replace(/^[-*]\s*/, ""));
  if (!title) {
    return null;
  }
  const detail = input.details.map((line) => stripMarkdownLinks(line)).filter(Boolean).join(" ").trim();
  return { title, detail, rank };
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
  const conclusionsSection = findSection(sections, [/조사 결론/i, /결론/i, /findings/i, /summary/i, /결과/i]);
  const evidence = (evidenceSection?.bullets ?? []).map((bullet) => parseEvidenceBullet(bullet));
  const inferredTopSources = new Map<string, number>();
  for (const bullet of evidenceSection?.bullets ?? []) {
    const bulletLinks = [
      ...parseMarkdownLinks(bullet.text),
      ...bullet.details.flatMap((line) => parseMarkdownLinks(line)),
    ];
    if (bulletLinks.length > 0) {
      for (const link of bulletLinks) {
        const name = link.label || sourceNameFromUrl(link.url);
        if (name) {
          inferredTopSources.set(name, (inferredTopSources.get(name) ?? 0) + 1);
        }
      }
      continue;
    }
    const parsedEvidence = parseEvidenceBullet(bullet);
    const name = sourceNameFromUrl(parsedEvidence.url);
    if (name) {
      inferredTopSources.set(name, (inferredTopSources.get(name) ?? 0) + 1);
    }
  }
  if (topSourcesSection) {
    for (const paragraph of topSourcesSection.paragraphs) {
      for (const link of parseMarkdownLinks(paragraph)) {
        const name = link.label || sourceNameFromUrl(link.url);
        if (name) {
          inferredTopSources.set(name, (inferredTopSources.get(name) ?? 0) + 1);
        }
      }
    }
  }
  const topSources = (topSourcesSection?.bullets ?? [])
    .map((bullet) => parseSourceBullet(bullet.text))
    .filter((row): row is VisualizeParsedSourceRow => Boolean(row));
  const conclusions = (conclusionsSection?.bullets ?? [])
    .map((bullet, index) => parseConclusionBullet(bullet, index + 1))
    .filter((row): row is VisualizeParsedFindingRow => Boolean(row))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 5);
  const quantitativeRows = new Map<string, VisualizeParsedQuantitativeRow>();
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      for (const row of parsePlayerCountRows(paragraph)) {
        if (!quantitativeRows.has(row.label)) {
          quantitativeRows.set(row.label, row);
        }
      }
    }
    for (const bullet of section.bullets) {
      for (const row of parsePlayerCountRows(bullet.text)) {
        if (!quantitativeRows.has(row.label)) {
          quantitativeRows.set(row.label, row);
        }
      }
      for (const detail of bullet.details) {
        for (const row of parsePlayerCountRows(detail)) {
          if (!quantitativeRows.has(row.label)) {
            quantitativeRows.set(row.label, row);
          }
        }
      }
    }
  }
  const metrics = {
    items: evidence.length,
    sources: (topSources.length ? topSources : [...inferredTopSources.entries()].map(([sourceName, itemCount]) => ({ sourceName, itemCount }))).length,
    verified: evidence.filter((row) => /verified/i.test(row.verificationStatus)).length,
    warnings: evidence.filter((row) => /warning/i.test(row.verificationStatus)).length,
    conflicted: evidence.filter((row) => /conflicted/i.test(row.verificationStatus)).length,
    avgScore: evidence.length > 0
      ? evidence.reduce((total, row) => total + (Number.isFinite(row.score) ? row.score : 0), 0) / evidence.length
      : 0,
  };

  return {
    charts,
    topSources: topSources.length > 0
      ? topSources
      : [...inferredTopSources.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([sourceName, itemCount]) => ({ sourceName, itemCount }))
        .slice(0, 8),
    evidence,
    conclusions,
    quantitativeRows: [...quantitativeRows.values()]
      .sort((left, right) => right.value - left.value)
      .slice(0, 8),
    metrics,
  };
}

export function mergeVisualizeMarkdownFallback(...parts: Array<VisualizeParsedMarkdown | null | undefined>): VisualizeParsedMarkdown {
  const merged: VisualizeParsedMarkdown = {
    charts: [],
    topSources: [],
    evidence: [],
    conclusions: [],
    quantitativeRows: [],
    metrics: {
      items: 0,
      sources: 0,
      verified: 0,
      warnings: 0,
      conflicted: 0,
      avgScore: 0,
    },
  };
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
    if (merged.conclusions.length === 0 && part.conclusions.length > 0) {
      merged.conclusions = part.conclusions;
    }
    if (merged.quantitativeRows.length === 0 && part.quantitativeRows.length > 0) {
      merged.quantitativeRows = part.quantitativeRows;
    }
    if (merged.metrics.items === 0 && part.metrics.items > 0) {
      merged.metrics = part.metrics;
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
