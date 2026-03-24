import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";
import { getTaskAgentLabel, orderedTaskAgentPresetIds } from "./taskAgentPresets";
import type { LiveAgentCard } from "./liveAgentState";
import type { ThreadMessage, ThreadRoleId } from "./threadTypes";

export type TimelineRenderEntry =
  | { kind: "single"; message: ThreadMessage }
  | { kind: "group"; id: string; messages: ThreadMessage[] };

type ConversationParticipationBadge = {
  key: string;
  label: string;
  kind: "agent" | "provider" | "internal";
};

const INTERNAL_PROMPT_DUMP_MARKERS = [
  "Formatting re-enabled",
  "<role_profile>",
  "</role_profile>",
  "<operating_rules>",
  "</operating_rules>",
  "<response_contract>",
  "</response_contract>",
  "<task_request>",
  "</task_request>",
  "[ROLE_KB_INJECT]",
  "[/ROLE_KB_INJECT]",
];

const HIDDEN_TIMELINE_TOKENS = new Set([
  "item/completed",
  "turn/completed",
]);

function parseTimelineMessage(content: string, agentLabels: string[]) {
  const text = String(content ?? "").trim();
  for (const label of agentLabels) {
    if (text.startsWith(`${label}:`)) {
      return {
        label,
        body: text.slice(label.length + 1).trim(),
      };
    }
    if (text.startsWith(`Created ${label} `) || text.includes(` ${label} is `)) {
      return {
        label,
        body: text,
      };
    }
  }
  return {
    label: "",
    body: text,
  };
}

function looksLikeInternalPromptDump(content: string): boolean {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    return false;
  }
  return INTERNAL_PROMPT_DUMP_MARKERS.some((marker) => normalized.includes(marker));
}

function compactDisplayedUrl(rawUrl: string): string {
  const trimmed = String(rawUrl ?? "").trim();
  const suffixMatch = trimmed.match(/[),.;:!?]+$/);
  const suffix = suffixMatch?.[0] ?? "";
  const candidate = suffix ? trimmed.slice(0, -suffix.length) : trimmed;
  try {
    const parsed = new URL(candidate);
    const base = `${parsed.origin}${parsed.pathname}`;
    if (candidate.length <= 88) {
      return `${candidate}${suffix}`;
    }
    if (base.length >= 72) {
      return `${base.slice(0, 69)}...${suffix}`;
    }
    const queryMarker = parsed.search ? "?..." : parsed.hash ? "#..." : "";
    return `${base}${queryMarker}${suffix}`;
  } catch {
    if (candidate.length <= 88) {
      return `${candidate}${suffix}`;
    }
    return `${candidate.slice(0, 85)}...${suffix}`;
  }
}

export function shouldRenderMessageMarkdown(message: ThreadMessage): boolean {
  return isFinishedThreadMessage(message) || isFailedThreadMessage(message);
}

function shouldHideTimelineMessage(message: ThreadMessage, assignedRoleIds: ThreadRoleId[]): boolean {
  const eventKind = String(message.eventKind ?? "").trim();
  if (eventKind === "agent_created") {
    return true;
  }
  if (
    assignedRoleIds.length > 0
    && eventKind === "agent_status"
    && message.sourceRoleId
    && !assignedRoleIds.includes(message.sourceRoleId)
  ) {
    return true;
  }
  return false;
}

function shouldGroupTimelineMessage(message: ThreadMessage): boolean {
  const eventKind = String(message.eventKind ?? "").trim();
  if (eventKind === "run_interrupted") {
    return false;
  }
  return !shouldRenderMessageMarkdown(message) && (message.role === "assistant" || message.role === "system");
}

function latestUserMessageId(messages: ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return String(message.id ?? "").trim();
    }
  }
  return "";
}

export function resolveTimelineMessage(message: ThreadMessage, agentLabels: string[]) {
  const parsed = parseTimelineMessage(message.content, agentLabels);
  return {
    label: String(message.agentLabel ?? "").trim() || parsed.label,
    body: parsed.body,
    artifactPath: String(message.artifactPath ?? "").trim(),
    createdAt: String(message.createdAt ?? "").trim(),
  };
}

export function normalizeTasksTimelineCopy(content: string): string {
  const normalized = String(content ?? "").trim();
  if (HIDDEN_TIMELINE_TOKENS.has(normalized.toLowerCase())) {
    return "";
  }
  if (looksLikeInternalPromptDump(content)) {
    return "내부 역할 프롬프트와 역할 지식을 준비했습니다.";
  }
  return String(content ?? "")
    .replace(/\bCreated\b/g, "CREATED")
    .replace(/\[(?:Codex|코덱스) 실행\]/g, "[코덱스 실행]")
    .replace(/\bCodex\b/g, "코덱스")
    .replace(/ROLE_KB_BOOTSTRAP 실행 중/g, "외부 근거 수집 중")
    .replace(/ROLE_KB_BOOTSTRAP 완료/g, "외부 근거 수집 완료")
    .replace(/ROLE_KB_BOOTSTRAP 실패/g, "외부 근거 수집 실패")
    .replace(/ROLE_KB_STORE 실행 중/g, "역할 지식 정리 중")
    .replace(/ROLE_KB_STORE 완료/g, "역할 지식 정리 완료")
    .replace(/ROLE_KB_STORE 실패/g, "역할 지식 정리 실패")
    .replace(/ROLE_KB_INJECT 실행 중/g, "역할 지식 주입 중")
    .replace(/ROLE_KB_INJECT 완료/g, "역할 지식 주입 완료")
    .replace(/ROLE_KB_INJECT 실패/g, "역할 지식 주입 실패")
    .replace(/\bruntime attached\b/gi, "실행 세션 연결됨")
    .replace(/\bruntime session\b/gi, "실행 세션");
}

export function compactTasksTimelineCopy(content: string): string {
  return normalizeTasksTimelineCopy(content).replace(/https?:\/\/\S+/g, (url) => compactDisplayedUrl(url));
}

export function isFinishedThreadMessage(message: ThreadMessage): boolean {
  return message.role === "assistant" && String(message.eventKind ?? "").trim() === "agent_result";
}

export function isFailedThreadMessage(message: ThreadMessage): boolean {
  return message.role === "assistant" && String(message.eventKind ?? "").trim() === "agent_failed";
}

export function shouldKeepPrimaryTimelineMessage(message: ThreadMessage): boolean {
  if (message.role === "user") {
    return true;
  }
  return isFinishedThreadMessage(message) || isFailedThreadMessage(message);
}

export function buildTimelineRenderEntries(messages: ThreadMessage[], assignedRoleIds: ThreadRoleId[] = []): TimelineRenderEntry[] {
  const entries: TimelineRenderEntry[] = [];
  let currentGroup: ThreadMessage[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      return;
    }
    entries.push({
      kind: "group",
      id: currentGroup.map((message) => String(message.id ?? "").trim()).filter(Boolean).join(":"),
      messages: currentGroup,
    });
    currentGroup = [];
  };

  for (const message of messages) {
    if (shouldHideTimelineMessage(message, assignedRoleIds)) {
      continue;
    }
    if (shouldGroupTimelineMessage(message)) {
      currentGroup.push(message);
      continue;
    }
    flushGroup();
    entries.push({ kind: "single", message });
  }
  flushGroup();
  return entries;
}

export function resolveThreadParticipationBadgeRoleIds(orchestration: AgenticCoordinationState | null): ThreadRoleId[] {
  const orchestrationRoleIds = orderedTaskAgentPresetIds(
    orchestration?.assignedRoleIds?.length
      ? orchestration.assignedRoleIds
      : (orchestration?.requestedRoleIds ?? []),
  );
  if (orchestrationRoleIds.length > 0) {
    return orchestrationRoleIds;
  }
  return [];
}

export function resolveLatestRunParticipationBadgeRoleIds(params: {
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  liveAgents: LiveAgentCard[];
}): ThreadRoleId[] {
  const latestUserId = latestUserMessageId(params.messages);
  const latestUserIndex = latestUserId
    ? params.messages.findIndex((message) => String(message.id ?? "").trim() === latestUserId)
    : -1;
  const latestRunMessages = latestUserIndex >= 0 ? params.messages.slice(latestUserIndex + 1) : [];
  const emittedRoleIds = orderedTaskAgentPresetIds(
    latestRunMessages
      .filter((message) => String(message.eventKind ?? "").trim() !== "agent_created")
      .map((message) => message.sourceRoleId)
      .filter((roleId): roleId is ThreadRoleId => Boolean(roleId)),
  );
  if (emittedRoleIds.length > 0) {
    return emittedRoleIds;
  }
  const liveRoleIds = orderedTaskAgentPresetIds(params.liveAgents.map((agent) => agent.roleId));
  if (liveRoleIds.length > 0) {
    return liveRoleIds;
  }
  const orchestrationRoleIds = resolveThreadParticipationBadgeRoleIds(params.orchestration);
  if (orchestrationRoleIds.length > 0) {
    return orchestrationRoleIds;
  }
  return orderedTaskAgentPresetIds(
    latestRunMessages
      .map((message) => message.sourceRoleId)
      .filter((roleId): roleId is ThreadRoleId => Boolean(roleId)),
  );
}

export function resolveLatestRunParticipationBadges(params: {
  orchestration: AgenticCoordinationState | null;
  messages: ThreadMessage[];
  liveAgents: LiveAgentCard[];
  internalBadges: Array<{ key: string; label: string; kind: "internal" | "provider" }>;
}): ConversationParticipationBadge[] {
  const roleBadges = resolveLatestRunParticipationBadgeRoleIds({
    orchestration: params.orchestration,
    messages: params.messages,
    liveAgents: params.liveAgents,
  }).map((roleId) => ({
    key: `agent:${roleId}`,
    label: getTaskAgentLabel(roleId),
    kind: "agent" as const,
  }));
  const internalBadges = params.internalBadges.map((badge) => ({
    key: badge.key,
    label: badge.label,
    kind: badge.kind,
  }));
  return [...roleBadges, ...internalBadges];
}

export function shouldProgressivelyRevealMessage(message: ThreadMessage, body: string): boolean {
  void message;
  void body;
  return false;
}
