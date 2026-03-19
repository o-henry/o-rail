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

type ResearchCollectionPayload = {
  planned?: {
    job?: {
      jobId?: string;
      label?: string;
      resolvedSourceType?: string;
      collectorStrategy?: string;
      keywords?: string[];
      domains?: string[];
    };
  };
  metrics?: {
    totals?: {
      items?: number;
      sources?: number;
      verified?: number;
      warnings?: number;
      conflicted?: number;
      avgScore?: number;
    };
  };
  items?: {
    items?: Array<{
      title?: string;
      sourceName?: string;
      verificationStatus?: string;
      score?: number;
      url?: string;
      summary?: string;
    }>;
  };
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
      title: String(entry.summary ?? "").trim() || String(entry.title ?? "").trim() || runId,
      summary: String(entry.summary ?? "").trim(),
    };

    current.updatedAt = String(entry.createdAt ?? "").trim() || current.updatedAt;
    current.title = preferTitle(current.title, String(entry.summary ?? entry.title ?? "").trim());
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
