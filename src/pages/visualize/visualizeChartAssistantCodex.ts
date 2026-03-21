import { extractChartSpecsFromContent, type FeedChartSpec } from "../../features/feed/chartSpec";
import { extractDeltaText } from "../../app/mainAppUtils";
import { extractStringByPaths } from "../../shared/lib/valueUtils";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type VisualizeCodexChartAssistantParams = {
  cwd: string;
  invokeFn: InvokeFn;
  prompt: string;
  reportBody: string;
  collectionBody: string;
  leadCopy: string;
  topSources: Array<{ sourceName: string; itemCount: number }>;
  timelineRows: Array<{ label: string; count: number }>;
  popularGenres: Array<{ genreLabel: string; popularityScore?: number; qualityScore?: number }>;
  verificationRows: Array<{ verificationStatus: string; itemCount: number }>;
};

export type VisualizeCodexChartAssistantResult = {
  chart: FeedChartSpec | null;
  summary: string;
  logs: string[];
  rawText: string;
};

function normalize(input: string) {
  return String(input ?? "").trim();
}

function clip(input: string, limit: number) {
  const text = normalize(input);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 21))}\n\n[truncated for charting]`;
}

function formatStructuredHints(params: VisualizeCodexChartAssistantParams) {
  return JSON.stringify({
    leadCopy: params.leadCopy,
    topSources: params.topSources,
    timelineRows: params.timelineRows,
    popularGenres: params.popularGenres,
    verificationRows: params.verificationRows,
  }, null, 2);
}

export function buildVisualizeChartAssistantCodexPrompt(params: VisualizeCodexChartAssistantParams): string {
  const reportBody = clip(params.reportBody, 18_000);
  const collectionBody = clip(params.collectionBody, 18_000);
  return [
    "You are the chart-generation assistant inside the RAIL desktop app.",
    "Read the supplied research materials and build one grounded chart for the user's request.",
    "Important rules:",
    "- Read the research text itself, not just the helper metrics.",
    "- Do not invent numbers, categories, or aggregations that are not supported by the materials.",
    "- If the exact requested chart is impossible, choose the closest faithful chart and explain the limitation briefly.",
    "- Prefer a useful chart over refusing when there is grounded numeric or ranked evidence.",
    "- The UI can render only one FeedChartSpec with type bar, line, or pie.",
    "- Keep labels concise.",
    "",
    "Return format:",
    "SUMMARY: one short Korean sentence explaining what chart you made or why you could not.",
    "LOGS:",
    "- short Korean log line 1",
    "- short Korean log line 2",
    "- optional short Korean log line 3",
    "```rail-chart",
    "{\"chart\":{\"type\":\"bar\",\"labels\":[\"A\"],\"series\":[{\"name\":\"Series\",\"data\":[1]}]}}",
    "```",
    "If no grounded chart is possible, omit the rail-chart block and explain why in SUMMARY/LOGS.",
    "",
    `USER REQUEST:\n${normalize(params.prompt)}`,
    "",
    `HELPER STRUCTURED HINTS:\n${formatStructuredHints(params)}`,
    "",
    `COLLECTION DOCUMENT:\n${collectionBody || "(empty)"}`,
    "",
    `REPORT DOCUMENT:\n${reportBody || "(empty)"}`,
  ].join("\n");
}

export function parseVisualizeChartAssistantCodexOutput(raw: string): VisualizeCodexChartAssistantResult {
  const normalized = normalize(raw);
  const extracted = extractChartSpecsFromContent(normalized);
  const content = normalize(extracted.contentWithoutChartBlocks);
  const summaryMatch = content.match(/(?:^|\n)SUMMARY:\s*(.+)/i);
  const logs = [...content.matchAll(/(?:^|\n)-\s+(.+)/g)]
    .map((match) => normalize(match[1] ?? ""))
    .filter(Boolean)
    .slice(0, 4);
  const summary = normalize(summaryMatch?.[1] ?? logs[0] ?? content.split(/\n+/g)[0] ?? "");
  return {
    chart: extracted.charts[0] ?? null,
    summary,
    logs,
    rawText: normalized,
  };
}

function extractTurnText(raw: unknown): string {
  return extractStringByPaths(raw, [
    "text",
    "output_text",
    "turn.output_text",
    "turn.response.output_text",
    "turn.response.text",
    "response.output_text",
    "response.text",
  ]) ?? extractDeltaText(raw);
}

export async function runVisualizeChartAssistantWithCodex(
  params: VisualizeCodexChartAssistantParams,
): Promise<VisualizeCodexChartAssistantResult> {
  const thread = await params.invokeFn<{ threadId?: string | null }>("thread_start", {
    model: "gpt-5.4",
    cwd: params.cwd,
  });
  const threadId = normalize(String(thread?.threadId ?? ""));
  if (!threadId) {
    throw new Error("차트 해석용 thread를 시작하지 못했습니다.");
  }
  const raw = await params.invokeFn<unknown>("turn_start_blocking", {
    threadId,
    text: buildVisualizeChartAssistantCodexPrompt(params),
    reasoningEffort: "medium",
  });
  const text = extractTurnText(raw);
  if (!normalize(text)) {
    throw new Error("차트 해석 응답이 비어 있습니다.");
  }
  return parseVisualizeChartAssistantCodexOutput(text);
}
