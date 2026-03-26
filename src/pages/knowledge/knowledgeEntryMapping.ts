import {
  isKnowledgeEntryIdHidden,
  isKnowledgeRunIdHidden,
} from "../../features/studio/knowledgeIndex";
import type {
  KnowledgeEntry,
  KnowledgeSourcePost,
} from "../../features/studio/knowledgeTypes";

const HIDDEN_MARKET_TOPICS = new Set([
  "MARKET_SUMMARY",
  "GLOBAL_HEADLINES",
  "TREND_RADAR",
  "COMMUNITY_HOT_TOPICS",
  "DEV_COMMUNITY_HOT_TOPICS",
  "EVENT_CALENDAR",
  "RISK_ALERT_BOARD",
  "DEV_ECOSYSTEM_UPDATES",
  "PAPER_TOPICS",
]);

export function toUpperSnakeToken(raw: string): string {
  const base = String(raw ?? "").trim();
  if (!base) {
    return "TASK_UNKNOWN";
  }
  const snake = base
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return snake || "TASK_UNKNOWN";
}

export function isHiddenKnowledgeEntry(entry: Pick<KnowledgeEntry, "runId" | "taskId">): boolean {
  const runId = String(entry.runId ?? "").trim();
  const taskId = toUpperSnakeToken(String(entry.taskId ?? ""));
  const raw = `${runId} ${taskId}`.toUpperCase();
  if (runId.startsWith("topic-") || HIDDEN_MARKET_TOPICS.has(taskId)) {
    return true;
  }
  return /GLOBAL_HEADLINES|MARKET_SUMMARY|TREND_RADAR|COMMUNITY_HOT_TOPICS|EVENT_CALENDAR|RISK_ALERT_BOARD|DEV_ECOSYSTEM_UPDATES/.test(
    raw,
  );
}

export function isRuntimeNoiseKnowledgeEntry(entry: Partial<Pick<KnowledgeEntry, "title" | "markdownPath" | "jsonPath" | "sourceFile">>): boolean {
  const candidates = [entry.title, entry.markdownPath, entry.jsonPath, entry.sourceFile]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return candidates.some((value) => (
    value.endsWith("run.json")
    || value.endsWith("prompt.md")
    || value.endsWith("response.json")
    || value.endsWith("response.unreadable.json")
    || value.endsWith("response.unreadable.debug.json")
    || value.endsWith("orchestration_plan.json")
    || value.endsWith("discussion_brief.md")
    || value.endsWith("discussion_direct.md")
    || value.endsWith("discussion_critique.md")
    || value.endsWith("shared_web_perspective.md")
    || value.endsWith("research_collection.json")
    || /web_.+_response\.md$/i.test(value)
  ));
}

function findAttachmentPath(post: KnowledgeSourcePost, kind: string): string | undefined {
  const match = post.attachments.find((row) => row.kind === kind);
  const path = String(match?.filePath ?? "").trim();
  return path || undefined;
}

export function formatArtifactFileNames(entry: Pick<KnowledgeEntry, "markdownPath" | "jsonPath">): string {
  const names = [entry.markdownPath, entry.jsonPath]
    .map((path) => String(path ?? "").trim())
    .filter(Boolean)
    .map((path) => toFileName(path));
  if (names.length === 0) {
    return "-";
  }
  return names.join(" · ");
}

export function toKnowledgeEntry(post: KnowledgeSourcePost): KnowledgeEntry | null {
  const entryId = String(post.id ?? "").trim();
  const runId = String(post.runId ?? "").trim();
  if (isKnowledgeRunIdHidden(runId) || isKnowledgeEntryIdHidden(entryId)) {
    return null;
  }
  const taskBase = String(post.topicLabel ?? post.groupName ?? post.topic ?? runId ?? "TASK_UNKNOWN").trim();
  const taskId = toUpperSnakeToken(taskBase);
  if (isHiddenKnowledgeEntry({ runId, taskId })) {
    return null;
  }
  const summary = String(post.summary ?? "").trim();
  const displayTitle =
    summary.slice(0, 72) || String(post.topicLabel ?? post.groupName ?? "").trim() || post.agentName;
  return {
    id: entryId,
    runId,
    taskId,
    roleId: "technical_writer",
    sourceKind: "artifact",
    title: displayTitle,
    summary,
    createdAt: post.createdAt,
    markdownPath: findAttachmentPath(post, "markdown"),
    jsonPath: findAttachmentPath(post, "json"),
    sourceFile: String(post.sourceFile ?? "").trim() || undefined,
  };
}

export function formatSourceKindLabel(kind: KnowledgeEntry["sourceKind"]): string {
  if (kind === "artifact") {
    return "산출물";
  }
  if (kind === "ai") {
    return "AI 자료";
  }
  return "WEB 자료";
}

export function toFileName(path: string): string {
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

function summarizeJsonValue(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "-";
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) {
      return "(빈 문자열)";
    }
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    return `배열 ${raw.length}개`;
  }
  if (typeof raw === "object") {
    const keys = Object.keys(raw as Record<string, unknown>);
    return keys.length > 0 ? `객체 (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", ..." : ""})` : "객체 (빈 값)";
  }
  return String(raw);
}

export function toReadableJsonInfo(text: string): {
  summaryRows: Array<{ key: string; value: string }>;
  pretty: string;
} {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { summaryRows: [], pretty: "" };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        summaryRows: [{ key: "VALUE", value: summarizeJsonValue(parsed) }],
        pretty: JSON.stringify(parsed, null, 2),
      };
    }
    const object = parsed as Record<string, unknown>;
    const summaryRows = Object.entries(object).map(([key, value]) => ({
      key: key.toUpperCase(),
      value: summarizeJsonValue(value),
    }));
    return {
      summaryRows,
      pretty: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return {
      summaryRows: [{ key: "RAW", value: "JSON 파싱 실패 (원문 표시)" }],
      pretty: trimmed,
    };
  }
}
