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

function asStringList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems)
    .map((item) => (item.length > maxChars ? item.slice(0, maxChars) : item));
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
      const title = String(row.title ?? "").trim();
      const source = String(row.source ?? "").trim();
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
      const title = String(row.title ?? "").trim();
      const date = String(row.date ?? "").trim();
      const note = String(row.note ?? "").trim();
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
  const summary = String(row.summary ?? "").trim();
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
