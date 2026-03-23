import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";

export type KnowledgeSearchIndex = Record<string, string>;
export type KnowledgeHighlightPart = {
  text: string;
  matched: boolean;
};

export function normalizeKnowledgeSearchQuery(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function buildKnowledgeMetadataSearchText(entry: KnowledgeEntry): string {
  return [
    entry.title,
    entry.summary,
    entry.taskAgentLabel,
    entry.studioRoleLabel,
    entry.orchestratorAgentLabel,
    entry.roleId,
    entry.taskId,
    entry.requestLabel,
    entry.sourceKind,
    entry.sourceUrl,
    entry.sourceFile,
    entry.markdownPath,
    entry.jsonPath,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function buildKnowledgeSearchDocument(entry: KnowledgeEntry, markdownContent: string, jsonContent: string): string {
  return [
    buildKnowledgeMetadataSearchText(entry),
    String(markdownContent ?? ""),
    String(jsonContent ?? ""),
  ]
    .join("\n")
    .toLowerCase();
}

export function filterKnowledgeEntriesByQuery(
  entries: KnowledgeEntry[],
  query: string,
  searchIndex: KnowledgeSearchIndex,
): KnowledgeEntry[] {
  const normalizedQuery = normalizeKnowledgeSearchQuery(query);
  if (!normalizedQuery) {
    return entries;
  }
  return entries.filter((entry) => {
    const metadataText = buildKnowledgeMetadataSearchText(entry);
    if (metadataText.includes(normalizedQuery)) {
      return true;
    }
    const indexedText = String(searchIndex[entry.id] ?? "").trim();
    return indexedText.includes(normalizedQuery);
  });
}

export function buildKnowledgeHighlightParts(text: string, query: string): KnowledgeHighlightPart[] {
  const source = String(text ?? "");
  const normalizedQuery = normalizeKnowledgeSearchQuery(query);
  if (!source || !normalizedQuery) {
    return source ? [{ text: source, matched: false }] : [];
  }
  const lowered = source.toLowerCase();
  const parts: KnowledgeHighlightPart[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const matchIndex = lowered.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) {
      parts.push({ text: source.slice(cursor), matched: false });
      break;
    }
    if (matchIndex > cursor) {
      parts.push({ text: source.slice(cursor, matchIndex), matched: false });
    }
    parts.push({
      text: source.slice(matchIndex, matchIndex + normalizedQuery.length),
      matched: true,
    });
    cursor = matchIndex + normalizedQuery.length;
  }
  return parts.filter((part) => part.text.length > 0);
}
