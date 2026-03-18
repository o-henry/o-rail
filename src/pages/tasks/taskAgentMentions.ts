import { UNITY_TASK_AGENT_PRESETS, type TaskAgentPresetId } from "./taskAgentPresets";

export type TaskAgentMentionOption = {
  presetId: TaskAgentPresetId;
  label: string;
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

const MENTION_OPTIONS: TaskAgentMentionOption[] = UNITY_TASK_AGENT_PRESETS.map((preset) => {
  const alias = preset.tagAliases[0] ?? preset.id;
  return {
    presetId: preset.id,
    label: preset.label,
    mention: `@${alias}`,
    searchText: [preset.id, preset.label, ...preset.tagAliases].join(" ").toLowerCase(),
  };
});

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
    const option = MENTION_OPTIONS.find((entry) => entry.presetId === presetId);
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
    entry.mention === `@${normalizedAlias}` || entry.searchText.split(" ").includes(normalizedAlias),
  );
  return option?.presetId ?? null;
}
