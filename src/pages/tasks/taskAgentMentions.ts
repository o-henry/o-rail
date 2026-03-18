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
  return `${prefix}${mention} ${suffix}`.trimEnd();
}
