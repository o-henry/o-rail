import type { CoordinationMode } from "../../features/orchestration/agentic/coordinationTypes";
import { UNITY_TASK_AGENT_PRESETS, type TaskAgentPresetId } from "./taskAgentPresets";

export type TaskAgentMentionOption = {
  kind: "agent" | "mode";
  presetId?: TaskAgentPresetId;
  mode?: CoordinationMode;
  label: string;
  description: string;
  mention: string;
  searchText: string;
};

export type TaskAgentMentionMatch = {
  query: string;
  rangeStart: number;
  rangeEnd: number;
  options: TaskAgentMentionOption[];
};

export type TaskAgentMentionToken = TaskAgentMentionOption & {
  start: number;
  end: number;
  content: string;
};

const AGENT_MENTION_OPTIONS: TaskAgentMentionOption[] = UNITY_TASK_AGENT_PRESETS.map((preset) => {
  const alias = preset.tagAliases[0] ?? preset.id;
  return {
    kind: "agent",
    presetId: preset.id,
    label: preset.label,
    description: preset.defaultSummary,
    mention: `@${alias}`,
    searchText: [preset.id, preset.label, ...preset.tagAliases].join(" ").toLowerCase(),
  };
});

const MODE_MENTION_OPTIONS: TaskAgentMentionOption[] = [
  {
    kind: "mode",
    mode: "quick",
    label: "QUICK",
    description: "가장 단순한 흐름으로 바로 실행합니다.",
    mention: "@quick",
    searchText: "quick fast direct simple orchestration mode 빠른 단순 자동",
  },
  {
    kind: "mode",
    mode: "fanout",
    label: "FANOUT",
    description: "여러 관점의 탐색과 조사를 병렬로 진행합니다.",
    mention: "@fanout",
    searchText: "fanout parallel research compare explore orchestration mode 병렬 조사 비교",
  },
  {
    kind: "mode",
    mode: "team",
    label: "TEAM",
    description: "계획, 실행, 검토가 포함된 더 긴 흐름으로 진행합니다.",
    mention: "@team",
    searchText: "team planner review multi step orchestration mode 계획 검토 단계",
  },
];

const MENTION_OPTIONS: TaskAgentMentionOption[] = [...AGENT_MENTION_OPTIONS, ...MODE_MENTION_OPTIONS];

export function getTaskAgentMentionMatch(input: string, cursor: number): TaskAgentMentionMatch | null {
  const safeInput = String(input ?? "");
  const safeCursor = Math.max(0, Math.min(cursor, safeInput.length));
  const beforeCursor = safeInput.slice(0, safeCursor);
  const match = beforeCursor.match(/(^|\s)@([a-z0-9_-]*)$/i);
  if (!match) {
    return null;
  }
  const query = String(match[2] ?? "").toLowerCase();
  const tokenLength = query.length + 1;
  const rangeEnd = safeCursor;
  const rangeStart = safeCursor - tokenLength;
  const options = MENTION_OPTIONS.filter((option) => !query || option.searchText.includes(query));
  if (options.length === 0) {
    return null;
  }
  return {
    query,
    rangeStart,
    rangeEnd,
    options,
  };
}

export function applyTaskAgentMention(input: string, match: TaskAgentMentionMatch, mention: string): string {
  const safeInput = String(input ?? "");
  const prefix = safeInput.slice(0, match.rangeStart);
  const suffix = safeInput.slice(match.rangeEnd).replace(/^\s*/, "");
  return `${prefix}${mention} ${suffix}`;
}

export function stripTaskAgentMentionMatch(input: string, match: TaskAgentMentionMatch): string {
  const safeInput = String(input ?? "");
  const prefix = safeInput.slice(0, match.rangeStart);
  const suffix = safeInput.slice(match.rangeEnd).replace(/^\s*/, "");
  return `${prefix}${suffix}`.replace(/\s{2,}/g, " ").trimStart();
}

export function extractTaskAgentMentionTokens(input: string): TaskAgentMentionToken[] {
  const safeInput = String(input ?? "");
  const matches = [...safeInput.matchAll(/(^|\s)(@([a-z0-9_-]+))(?=\s)/gi)];
  const tokens: TaskAgentMentionToken[] = [];
  for (const match of matches) {
    const mention = String(match[2] ?? "").trim();
    const alias = String(match[3] ?? "").trim();
    const presetId = alias ? resolvePresetId(alias) : null;
    if (!presetId) {
      continue;
    }
    const option = MENTION_OPTIONS.find((entry) => entry.kind === "agent" && entry.presetId === presetId);
    if (!option || typeof match.index !== "number") {
      continue;
    }
    const leading = String(match[1] ?? "");
    const mentionStart = match.index + leading.length;
    const start = mentionStart;
    const mentionEnd = mentionStart + mention.length;
    const chipEnd = safeInput[mentionEnd] === " " ? mentionEnd + 1 : mentionEnd;
    tokens.push({
      ...option,
      start,
      end: chipEnd,
      content: safeInput.slice(start, chipEnd),
    });
  }
  return tokens;
}

export function findTaskAgentMentionRemovalRange(input: string, cursor: number): { start: number; end: number } | null {
  const safeInput = String(input ?? "");
  const safeCursor = Math.max(0, Math.min(cursor, safeInput.length));
  const tokens = extractTaskAgentMentionTokens(safeInput);
  for (const token of tokens) {
    let trailingSpaceEnd = token.end;
    while (trailingSpaceEnd < safeInput.length && safeInput[trailingSpaceEnd] === " ") {
      trailingSpaceEnd += 1;
    }
    if (safeCursor === trailingSpaceEnd || safeCursor === token.end) {
      return {
        start: token.start,
        end: trailingSpaceEnd,
      };
    }
  }
  return null;
}

function resolvePresetId(alias: string): TaskAgentPresetId | null {
  const normalizedAlias = String(alias ?? "").trim().toLowerCase();
  const option = MENTION_OPTIONS.find((entry) =>
    entry.kind === "agent" && (entry.mention === `@${normalizedAlias}` || entry.searchText.split(" ").includes(normalizedAlias)),
  );
  return option?.presetId ?? null;
}
