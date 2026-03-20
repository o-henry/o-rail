import type { FeedChartSpec } from "../../features/feed/chartSpec";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";

export type VisualizeResearchRun = {
  runId: string;
  taskId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  summary: string;
  reportEntryId?: string;
  reportMarkdownPath?: string;
  collectionEntryId?: string;
  collectionMarkdownPath?: string;
  collectionJsonPath?: string;
  responseJsonPath?: string;
};

export type ResearchReportListItem = {
  title?: string;
  detail?: string;
  badge?: string;
};

export type ResearchReportWidgetSpec = {
  title?: string;
  description?: string;
  chart?: FeedChartSpec | null;
  items?: ResearchReportListItem[];
};

export type ResearchAutoReportSpec = {
  version?: number;
  locale?: string;
  questionType?: "genre_ranking" | "game_comparison" | "community_sentiment" | "topic_research" | string;
  widgets?: {
    mainChart?: ResearchReportWidgetSpec;
    secondaryChart?: ResearchReportWidgetSpec;
    primaryList?: ResearchReportWidgetSpec;
    secondaryList?: ResearchReportWidgetSpec;
    report?: ResearchReportWidgetSpec;
    evidence?: ResearchReportWidgetSpec;
  };
};

export type ResearchCollectionPayload = {
  planned?: {
    job?: {
      jobId?: string;
      label?: string;
      resolvedSourceType?: string;
      collectorStrategy?: string;
      keywords?: string[];
      domains?: string[];
      sourceOptions?: {
        allowed_domains?: string[];
        strict_domain_isolation?: boolean;
      };
    };
  };
  metrics?: {
    jobId?: string;
    bySourceType?: Array<{
      sourceType?: string;
      itemCount?: number;
      avgScore?: number;
      avgHotScore?: number;
    }>;
    byVerificationStatus?: Array<{
      verificationStatus?: string;
      itemCount?: number;
    }>;
    timeline?: Array<{
      bucketDate?: string;
      itemCount?: number;
    }>;
    topSources?: Array<{
      sourceName?: string;
      itemCount?: number;
    }>;
    totals?: {
      items?: number;
      sources?: number;
      verified?: number;
      warnings?: number;
      conflicted?: number;
      avgScore?: number;
      avgHotScore?: number;
    };
  };
  items?: {
    total?: number;
    items?: Array<{
      itemFactId?: string;
      sourceType?: string;
      title?: string;
      sourceName?: string;
      verificationStatus?: string;
      score?: number;
      url?: string;
      summary?: string;
      fetchedAt?: string;
      publishedAt?: string;
    }>;
  };
  genreRankings?: {
    jobId?: string;
    popular?: Array<{
      genreKey?: string;
      genreLabel?: string;
      rank?: number;
      popularityScore?: number;
      qualityScore?: number;
      representativeTitles?: string[];
    }>;
    quality?: Array<{
      genreKey?: string;
      genreLabel?: string;
      rank?: number;
      popularityScore?: number;
      qualityScore?: number;
      representativeTitles?: string[];
    }>;
  };
  reportSpec?: ResearchAutoReportSpec;
};

function artifactFileName(entry: Pick<KnowledgeEntry, "markdownPath" | "jsonPath">): string {
  const raw = entry.markdownPath || entry.jsonPath || "";
  return raw.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? "";
}

function isResearcherArtifact(entry: KnowledgeEntry) {
  if (entry.roleId !== "research_analyst") {
    return false;
  }
  const fileName = artifactFileName(entry);
  return (
    fileName === "research_findings.md" ||
    fileName === "research_collection.md" ||
    fileName === "research_collection.json"
  );
}

function preferTitle(currentTitle: string, candidate: string) {
  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate) {
    return currentTitle;
  }
  if (!currentTitle.trim()) {
    return trimmedCandidate;
  }
  if (trimmedCandidate.toLowerCase().includes("research_findings")) {
    return currentTitle;
  }
  return currentTitle;
}

export function buildVisualizeResearchRuns(entries: KnowledgeEntry[]): VisualizeResearchRun[] {
  const grouped = new Map<string, VisualizeResearchRun>();
  const sortedEntries = [...entries].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

  for (const entry of sortedEntries) {
    if (!isResearcherArtifact(entry)) {
      continue;
    }
    const runId = String(entry.runId ?? "").trim();
    if (!runId) {
      continue;
    }
    const fileName = artifactFileName(entry);
    const current = grouped.get(runId) ?? {
      runId,
      taskId: String(entry.taskId ?? "").trim(),
      createdAt: String(entry.createdAt ?? "").trim(),
      updatedAt: String(entry.createdAt ?? "").trim(),
      title: String(entry.title ?? "").trim() || String(entry.summary ?? "").trim() || runId,
      summary: String(entry.summary ?? "").trim(),
    };

    current.updatedAt = String(entry.createdAt ?? "").trim() || current.updatedAt;
    current.title = preferTitle(current.title, String(entry.title ?? "").trim());
    current.summary = current.summary || String(entry.summary ?? "").trim();

    if (fileName === "research_findings.md") {
      current.reportEntryId = entry.id;
      current.reportMarkdownPath = entry.markdownPath;
    } else if (fileName === "research_collection.md") {
      current.collectionEntryId = entry.id;
      current.collectionMarkdownPath = entry.markdownPath;
    } else if (fileName === "research_collection.json") {
      current.collectionEntryId = current.collectionEntryId || entry.id;
      current.collectionJsonPath = entry.jsonPath;
    }

    grouped.set(runId, current);
  }

  return [...grouped.values()]
    .filter((row) => row.reportMarkdownPath || row.collectionMarkdownPath || row.collectionJsonPath)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export function parseResearchCollectionPayload(raw: string): ResearchCollectionPayload | null {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized) as ResearchCollectionPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
