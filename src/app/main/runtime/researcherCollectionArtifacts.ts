type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type EnsureResearcherCollectionArtifactsInput = {
  invokeFn: InvokeFn;
  artifactDir: string;
  existingArtifactPaths: string[];
  findingsMarkdown: string;
  fallbackSummary?: string;
};

type ParsedFinding = {
  title: string;
  detail: string;
  rank: number;
};

type ParsedEvidence = {
  title: string;
  url: string;
  sourceName: string;
  verificationStatus: string;
  score: number;
  summary: string;
};

function normalize(input: string) {
  return String(input ?? "").trim();
}

function hasArtifact(paths: string[], fileName: string) {
  return paths.some((path) => normalize(path).toLowerCase().endsWith(`/${fileName}`) || normalize(path).toLowerCase().endsWith(`\\${fileName}`));
}

function parseLinks(input: string) {
  return [...String(input ?? "").matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi)].map((match) => ({
    label: normalize(match[1] ?? ""),
    url: normalize(match[2] ?? ""),
  }));
}

function stripLinks(input: string) {
  return normalize(String(input ?? "").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, "$1"));
}

function sourceNameFromUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    const base = host.split(".")[0] ?? host;
    return base
      .split(/[-_]/g)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function parseSectionBullets(markdown: string, titlePattern: RegExp) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  let active = false;
  const bullets: Array<{ text: string; details: string[] }> = [];
  let current: { text: string; details: string[] } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      active = titlePattern.test(trimmed.replace(/^##\s+/, ""));
      current = null;
      continue;
    }
    if (!active) {
      continue;
    }
    if (!trimmed) {
      current = null;
      continue;
    }
    if (/^- /.test(trimmed)) {
      current = { text: trimmed.replace(/^- /, ""), details: [] };
      bullets.push(current);
      continue;
    }
    if (current && /^\s{2,}/.test(line)) {
      current.details.push(trimmed);
    }
  }
  return bullets;
}

function parseConclusions(markdown: string): ParsedFinding[] {
  return parseSectionBullets(markdown, /(조사 결론|결론|findings|summary|결과)/i)
    .map((bullet, index) => {
      const raw = stripLinks(bullet.text);
      const rankMatch = raw.match(/(?:^|\s)(\d+)위/);
      const rank = Number.parseInt(rankMatch?.[1] ?? `${index + 1}`, 10) || index + 1;
      const titleMatch =
        raw.match(/(?:\d+위는?|TOP\s*\d+\s*:?)\s*[`"'“”]?([^`"'“”]+?)[`"'“”]?(?:[.,]|$)/i)
        ?? raw.match(/[`"'“”]([^`"'“”]+)[`"'“”]/);
      const title = normalize(titleMatch?.[1] ?? raw);
      const detail = bullet.details.map((line) => stripLinks(line)).filter(Boolean).join(" ").trim();
      return { title, detail, rank };
    })
    .filter((row) => row.title)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 6);
}

function parseEvidence(markdown: string): ParsedEvidence[] {
  return parseSectionBullets(markdown, /(핵심 근거|evidence|reaction highlights|representative|compared)/i)
    .map((bullet) => {
      const inlineLinks = [...parseLinks(bullet.text), ...bullet.details.flatMap((line) => parseLinks(line))];
      const raw = stripLinks(bullet.text);
      const titleMatch = raw.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
      const title = normalize(titleMatch?.[1] ?? raw);
      const meta = normalize(titleMatch?.[2] ?? "");
      const metaParts = meta.split(",").map((part) => normalize(part)).filter(Boolean);
      const verificationStatus = metaParts[1] ?? metaParts[0] ?? "";
      const scoreMatch = meta.match(/(?:점수|score)\s*(\d+(?:\.\d+)?)/i);
      const score = scoreMatch ? Number.parseFloat(scoreMatch[1] ?? "0") : 0;
      const url = inlineLinks[0]?.url ?? bullet.details.find((line) => /^https?:\/\//i.test(normalize(line))) ?? "";
      const sourceName = inlineLinks[0]?.label ?? sourceNameFromUrl(url);
      const summary = bullet.details.map((line) => stripLinks(line)).filter((line) => line && !/^https?:\/\//i.test(line)).join(" ").trim();
      return {
        title,
        url,
        sourceName,
        verificationStatus,
        score,
        summary,
      };
    })
    .filter((row) => row.title || row.url);
}

function buildFallbackPayload(findingsMarkdown: string) {
  const conclusions = parseConclusions(findingsMarkdown);
  const evidence = parseEvidence(findingsMarkdown);
  const topSourceMap = new Map<string, number>();
  for (const row of evidence) {
    const name = row.sourceName || sourceNameFromUrl(row.url);
    if (name) {
      topSourceMap.set(name, (topSourceMap.get(name) ?? 0) + 1);
    }
  }
  const avgScore = evidence.length
    ? evidence.reduce((total, row) => total + (Number.isFinite(row.score) ? row.score : 0), 0) / evidence.length
    : 0;
  return {
    metrics: {
      totals: {
        items: evidence.length,
        sources: topSourceMap.size,
        verified: evidence.filter((row) => /verified/i.test(row.verificationStatus)).length,
        warnings: evidence.filter((row) => /warning/i.test(row.verificationStatus)).length,
        conflicted: evidence.filter((row) => /conflicted/i.test(row.verificationStatus)).length,
        avgScore,
        avgHotScore: 0,
      },
      bySourceType: [],
      byVerificationStatus: [
        { verificationStatus: "verified", itemCount: evidence.filter((row) => /verified/i.test(row.verificationStatus)).length },
        { verificationStatus: "warning", itemCount: evidence.filter((row) => /warning/i.test(row.verificationStatus)).length },
        { verificationStatus: "conflicted", itemCount: evidence.filter((row) => /conflicted/i.test(row.verificationStatus)).length },
      ].filter((row) => row.itemCount > 0),
      timeline: [],
      topSources: [...topSourceMap.entries()].map(([sourceName, itemCount]) => ({ sourceName, itemCount })),
    },
    items: {
      total: evidence.length,
      items: evidence.map((row, index) => ({
        itemFactId: `fallback-${index + 1}`,
        sourceType: "source.web",
        title: row.title,
        sourceName: row.sourceName,
        verificationStatus: row.verificationStatus,
        score: row.score,
        url: row.url,
        summary: row.summary,
      })),
    },
    genreRankings: {
      popular: conclusions.map((row) => ({
        genreKey: `finding-${row.rank}`,
        genreLabel: row.title,
        rank: row.rank,
        popularityScore: Math.max(100 - (row.rank - 1) * 10, 0),
        qualityScore: 0,
        representativeTitles: row.detail ? [row.detail] : [],
      })),
      quality: [],
    },
  };
}

export async function ensureResearcherCollectionArtifacts(
  input: EnsureResearcherCollectionArtifactsInput,
): Promise<string[]> {
  const existing = [...new Set(input.existingArtifactPaths.filter(Boolean))];
  const findingsMarkdown = normalize(input.findingsMarkdown);
  const collectionMarkdownContent = normalize(input.fallbackSummary ?? "") || findingsMarkdown;
  if (!findingsMarkdown && !collectionMarkdownContent) {
    return existing;
  }
  const nextPaths = [...existing];
  try {
    if (!hasArtifact(nextPaths, "research_collection.md")) {
      const markdownPath = await input.invokeFn<string>("workspace_write_text", {
        cwd: input.artifactDir,
        name: "research_collection.md",
        content: `${collectionMarkdownContent || findingsMarkdown}\n`,
      });
      nextPaths.push(markdownPath);
    }
    if (!hasArtifact(nextPaths, "research_collection.json")) {
      const payload = buildFallbackPayload(findingsMarkdown || collectionMarkdownContent);
      const jsonPath = await input.invokeFn<string>("workspace_write_text", {
        cwd: input.artifactDir,
        name: "research_collection.json",
        content: `${JSON.stringify(payload, null, 2)}\n`,
      });
      nextPaths.push(jsonPath);
    }
  } catch {
    return existing;
  }
  return [...new Set(nextPaths)];
}
