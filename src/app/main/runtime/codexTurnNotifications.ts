import { extractCompletedStatus, extractDeltaText } from "../../mainAppUtils";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";

export const ENGINE_NOTIFICATION_DOM_EVENT = "rail:engine-notification";

type EngineNotificationPayload = {
  method?: string;
  params?: unknown;
};

type EngineNotificationWaitResult = {
  raw: unknown;
  status: string;
  hadProgress: boolean;
};

let activeExclusiveWaiters = 0;

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function extractThreadId(value: unknown): string {
  return normalizeId(extractStringByPaths(value, [
    "threadId",
    "thread_id",
    "turn.threadId",
    "turn.thread_id",
    "item.threadId",
    "item.thread_id",
    "response.threadId",
    "response.thread_id",
  ]));
}

function extractTurnId(value: unknown): string {
  return normalizeId(extractStringByPaths(value, [
    "turnId",
    "turn_id",
    "id",
    "turn.id",
    "item.turnId",
    "item.turn_id",
    "response.id",
  ]));
}

function resolveTerminalStatus(method: string, params: unknown): string {
  const normalizedMethod = String(method ?? "").trim().toLowerCase();
  if (normalizedMethod === "turn/completed") {
    return "completed";
  }
  if (normalizedMethod === "turn/failed") {
    return "failed";
  }
  if (normalizedMethod === "item/completed") {
    const completedStatus = String(extractCompletedStatus(params) ?? "").trim().toLowerCase();
    if (completedStatus) {
      return completedStatus;
    }
    return "completed";
  }
  return "";
}

function isTerminalNotification(method: string): boolean {
  const normalizedMethod = String(method ?? "").trim().toLowerCase();
  return normalizedMethod === "turn/completed"
    || normalizedMethod === "turn/failed"
    || normalizedMethod === "item/completed";
}

function collectNestedText(input: unknown, depth = 0): string[] {
  if (depth > 8 || input == null) {
    return [];
  }
  if (typeof input === "string") {
    const normalized = input.trim();
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => collectNestedText(item, depth + 1));
  }
  if (typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const direct = ["text", "output_text", "outputText", "markdown", "value"]
    .flatMap((key) => collectNestedText(record[key], depth + 1));
  const nested = ["content", "parts", "chunks", "item", "message", "response", "data"]
    .flatMap((key) => collectNestedText(record[key], depth + 1));
  return [...direct, ...nested];
}

function extractAgentMessageText(params: unknown): string {
  if (!params || typeof params !== "object") {
    return "";
  }
  const record = params as Record<string, unknown>;
  const candidates = [
    record.item,
    record.message,
    params,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const item = candidate as Record<string, unknown>;
    const type = String(item.type ?? "").trim().toLowerCase();
    const role = String(item.role ?? item.author ?? item.sender ?? "").trim().toLowerCase();
    const phase = String(item.phase ?? "").trim().toLowerCase();
    const looksLikeAssistantMessage =
      type === "agentmessage" ||
      role === "assistant" ||
      phase === "final_answer";
    if (!looksLikeAssistantMessage) {
      continue;
    }
    const text = [...new Set(collectNestedText(item))].join("\n").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function matchesNotification(params: {
  payload: EngineNotificationPayload;
  threadId: string;
  turnId?: string;
  allowUnscopedMatch: boolean;
}): boolean {
  const payloadThreadId = extractThreadId(params.payload.params);
  const payloadTurnId = extractTurnId(params.payload.params);
  if (payloadThreadId && payloadThreadId === params.threadId) {
    return true;
  }
  if (params.turnId && payloadTurnId && payloadTurnId === params.turnId) {
    return true;
  }
  return params.allowUnscopedMatch;
}

export function dispatchEngineNotificationEvent(payload: EngineNotificationPayload): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(ENGINE_NOTIFICATION_DOM_EVENT, {
    detail: payload,
  }));
}

export async function waitForTurnTerminalFromEngineNotifications(params: {
  threadId: string;
  turnId?: string;
  idleTimeoutMs: number;
  onProgress?: (message?: string) => void;
}): Promise<EngineNotificationWaitResult | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const allowUnscopedMatch = activeExclusiveWaiters === 0;
  activeExclusiveWaiters += 1;
  let idleDeadline = Date.now() + Math.max(params.idleTimeoutMs, 1_000);
  let accumulatedDelta = "";
  let finalAgentText = "";
  let hadProgress = false;
  let terminalResult: EngineNotificationWaitResult | null = null;

  try {
    await new Promise<void>((resolve) => {
      let finished = false;
      let intervalId: number | null = null;

      const cleanup = () => {
        if (intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
        window.removeEventListener(ENGINE_NOTIFICATION_DOM_EVENT, onNotification as EventListener);
      };

      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        resolve();
      };

      const onNotification = (event: Event) => {
        const payload = (event as CustomEvent<EngineNotificationPayload>).detail;
        const method = String(payload?.method ?? "").trim();
        if (!method) {
          return;
        }
        if (!matchesNotification({
          payload,
          threadId: params.threadId,
          turnId: params.turnId,
          allowUnscopedMatch,
        })) {
          return;
        }

        const agentText = extractAgentMessageText(payload.params);
        if (agentText) {
          finalAgentText = agentText;
          hadProgress = true;
          idleDeadline = Date.now() + params.idleTimeoutMs;
          params.onProgress?.("코덱스 알림 스트림을 통해 최종 응답을 수신하는 중");
        }

        if (method === "item/agentMessage/delta") {
          const delta = String(extractDeltaText(payload.params) ?? "").trim();
          if (!delta) {
            return;
          }
          accumulatedDelta += delta;
          hadProgress = true;
          idleDeadline = Date.now() + params.idleTimeoutMs;
          params.onProgress?.("코덱스 알림 스트림을 통해 응답을 수신하는 중");
          return;
        }

        if (!isTerminalNotification(method)) {
          return;
        }

        const status = resolveTerminalStatus(method, payload.params);
        const outputText = String(
          extractStringByPaths(payload.params, [
            "text",
            "output_text",
            "turn.output_text",
            "turn.response.output_text",
            "turn.response.text",
            "response.output_text",
            "response.text",
          ]) ?? "",
        ).trim() || finalAgentText.trim() || accumulatedDelta.trim();
        terminalResult = {
          raw: {
            method,
            status,
            output_text: outputText,
            params: payload.params ?? null,
          },
          status,
          hadProgress: hadProgress || Boolean(outputText),
        };
        finish();
      };

      intervalId = window.setInterval(() => {
        if (Date.now() >= idleDeadline) {
          finish();
        }
      }, 400);

      window.addEventListener(ENGINE_NOTIFICATION_DOM_EVENT, onNotification as EventListener);
    });
  } finally {
    activeExclusiveWaiters = Math.max(0, activeExclusiveWaiters - 1);
  }

  return terminalResult;
}
