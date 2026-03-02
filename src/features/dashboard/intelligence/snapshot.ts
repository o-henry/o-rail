import type { DashboardTopicId, DashboardTopicSnapshot } from "./types";

type DashboardSnapshotLike = Partial<DashboardTopicSnapshot> & {
  topic?: unknown;
  runId?: unknown;
  model?: unknown;
  generatedAt?: unknown;
  summary?: unknown;
  highlights?: unknown;
  risks?: unknown;
  events?: unknown;
  references?: unknown;
  status?: unknown;
  statusMessage?: unknown;
  referenceEmpty?: unknown;
};

const TEXT_FIELD_PRIORITY = [
  "summary",
  "highlights",
  "highlight",
  "risks",
  "risk",
  "title",
  "headline",
  "note",
  "description",
  "content",
  "text",
  "message",
  "insight",
  "point",
  "value",
] as const;

function normalizePlainText(input: string): string {
  return String(input ?? "")
    .replace(/```(?:json|html|markdown|text)?/gi, " ")
    .replace(/```/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectReadableFragments(
  value: unknown,
  out: string[],
  depth: number,
  visited: WeakSet<object>,
): void {
  if (depth > 4 || out.length >= 24 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        collectReadableFragments(JSON.parse(trimmed), out, depth + 1, visited);
        return;
      } catch {
        // Fall through and normalize as plain text.
      }
    }
    const normalized = normalizePlainText(trimmed);
    if (!normalized) {
      return;
    }
    if (/^[\[{].*[\]}]$/.test(normalized) && /":\s*/.test(normalized)) {
      return;
    }
    if (
      /^"?[a-zA-Z0-9_ -]{1,40}"?\s*:\s*/.test(normalized) &&
      !/[가-힣]/.test(normalized) &&
      !/[.!?]/.test(normalized)
    ) {
      return;
    }
    out.push(normalized);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReadableFragments(item, out, depth + 1, visited);
      if (out.length >= 24) {
        break;
      }
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const row = value as Record<string, unknown>;
  if (visited.has(row)) {
    return;
  }
  visited.add(row);
  for (const key of TEXT_FIELD_PRIORITY) {
    if (key in row) {
      collectReadableFragments(row[key], out, depth + 1, visited);
      if (out.length >= 24) {
        return;
      }
    }
  }
  if (out.length > 0) {
    return;
  }
  for (const item of Object.values(row)) {
    collectReadableFragments(item, out, depth + 1, visited);
    if (out.length >= 24) {
      return;
    }
  }
}

function toReadableText(value: unknown, maxChars: number): string {
  const fragments: string[] = [];
  collectReadableFragments(value, fragments, 0, new WeakSet<object>());
  const unique = [...new Set(fragments.map((item) => item.trim()).filter((item) => item.length > 0))];
  const selected =
    unique.find((item) => /[A-Za-z가-힣]/.test(item) && item.length >= 3) ??
    unique.find((item) => item.length >= 3) ??
    unique[0] ??
    "";
  if (!selected) {
    return "";
  }
  return selected.length > maxChars ? selected.slice(0, maxChars).trimEnd() : selected;
}

function asStringList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toReadableText(item, maxChars))
    .filter((item) => item.length > 0)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, maxItems);
}

function asReferenceList(value: unknown): DashboardTopicSnapshot["references"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const url = String(row.url ?? "").trim();
      const title = toReadableText(row.title, 240);
      const source = toReadableText(row.source, 120);
      const publishedAt = String(row.publishedAt ?? "").trim();
      if (!url || !title || !source) {
        return null;
      }
      return {
        url: url.slice(0, 800),
        title: title.slice(0, 240),
        source: source.slice(0, 120),
        publishedAt: publishedAt ? publishedAt.slice(0, 120) : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 20);
}

function asEventList(value: unknown): DashboardTopicSnapshot["events"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const title = toReadableText(row.title, 240);
      const date = normalizePlainText(String(row.date ?? ""));
      const note = toReadableText(row.note, 260);
      if (!title) {
        return null;
      }
      return {
        title: title.slice(0, 240),
        date: date ? date.slice(0, 80) : undefined,
        note: note ? note.slice(0, 260) : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 20);
}

function extractJsonBlock(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

export function normalizeDashboardSnapshot(
  topic: DashboardTopicId,
  model: string,
  raw: unknown,
  fallbackGeneratedAt = new Date().toISOString(),
): DashboardTopicSnapshot {
  const row: DashboardSnapshotLike =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as DashboardSnapshotLike) : {};
  const summary = toReadableText(row.summary, 1200);
  return {
    topic,
    runId: String(row.runId ?? "").trim() || undefined,
    model: String(row.model ?? model).trim() || model,
    generatedAt: String(row.generatedAt ?? fallbackGeneratedAt).trim() || fallbackGeneratedAt,
    summary: summary || "No summary generated.",
    highlights: asStringList(row.highlights, 12, 320),
    risks: asStringList(row.risks, 12, 320),
    events: asEventList(row.events),
    references: asReferenceList(row.references),
    status: row.status === "degraded" ? "degraded" : "ok",
    statusMessage: String(row.statusMessage ?? "").trim() || undefined,
    referenceEmpty: Boolean(row.referenceEmpty),
  };
}

export function parseDashboardSnapshotText(
  topic: DashboardTopicId,
  model: string,
  text: string,
): DashboardTopicSnapshot {
  const candidate = extractJsonBlock(text);
  try {
    const parsed = JSON.parse(candidate);
    return normalizeDashboardSnapshot(topic, model, parsed);
  } catch {
    return buildDashboardFallbackSnapshot(topic, model, {
      summary: text,
      status: "degraded",
      statusMessage: "Model response was not valid JSON.",
    });
  }
}

export function buildDashboardFallbackSnapshot(
  topic: DashboardTopicId,
  model: string,
  input: {
    summary?: string;
    highlights?: string[];
    risks?: string[];
    events?: DashboardTopicSnapshot["events"];
    references?: DashboardTopicSnapshot["references"];
    status?: "ok" | "degraded";
    statusMessage?: string;
    referenceEmpty?: boolean;
  } = {},
): DashboardTopicSnapshot {
  return normalizeDashboardSnapshot(topic, model, {
    topic,
    model,
    generatedAt: new Date().toISOString(),
    summary: input.summary ?? "No summary generated.",
    highlights: input.highlights ?? [],
    risks: input.risks ?? [],
    events: input.events ?? [],
    references: input.references ?? [],
    status: input.status ?? "degraded",
    statusMessage: input.statusMessage,
    referenceEmpty: input.referenceEmpty,
  });
}
