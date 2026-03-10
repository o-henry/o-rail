import { getWebProviderFromExecutor, type TurnExecutor, type WebProvider, type WebResultMode } from "../../../features/workflow/domain";
import { extractFinalAnswer } from "../../../features/workflow/labels";
import { stringifyInput, tryParseJsonText } from "../../../features/workflow/promptUtils";
import { tp } from "../../../i18n";

export function normalizeWebEvidenceOutput(
  provider: WebProvider,
  output: unknown,
  mode: WebResultMode | "bridgeAssisted",
): unknown {
  const row =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : ({ text: stringifyInput(output) } as Record<string, unknown>);
  const timestamp = String(row.timestamp ?? new Date().toISOString());
  const text = String(row.text ?? extractFinalAnswer(row.raw ?? row.data ?? row) ?? "").trim();
  const raw = row.raw ?? row.data ?? output;
  const metaRow =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  const confidenceRaw = String(metaRow.confidence ?? "unknown").toLowerCase();
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? confidenceRaw
      : "unknown";
  const citations = Array.isArray(metaRow.citations)
    ? metaRow.citations.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0)
    : [];

  return {
    provider,
    timestamp,
    text,
    raw,
    meta: {
      sourceType: "web",
      provider,
      mode,
      sourceUrl: metaRow.url ? String(metaRow.url) : null,
      capturedAt: metaRow.capturedAt ? String(metaRow.capturedAt) : timestamp,
      confidence,
      citations,
      needsVerification: mode !== "bridgeAssisted",
    },
  };
}

export function normalizeWebTurnOutput(
  provider: WebProvider,
  mode: WebResultMode,
  rawInput: string,
): { ok: boolean; output?: unknown; error?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: tp("웹 응답 입력이 비어 있습니다.") };
  }
  if (mode === "manualPasteJson") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      return { ok: false, error: `${tp("JSON 파싱 실패")}: ${String(error)}` };
    }
    return {
      ok: true,
      output: normalizeWebEvidenceOutput(
        provider,
        {
          provider,
          timestamp: new Date().toISOString(),
          data: parsed,
          text: extractFinalAnswer(parsed),
        },
        mode,
      ),
    };
  }

  return {
    ok: true,
    output: normalizeWebEvidenceOutput(
      provider,
      {
        provider,
        timestamp: new Date().toISOString(),
        text: trimmed,
      },
      mode,
    ),
  };
}

export function resolveProviderByExecutor(executor: TurnExecutor): string {
  const webProvider = getWebProviderFromExecutor(executor);
  if (webProvider) {
    return webProvider;
  }
  if (executor === "via_flow") {
    return "via";
  }
  if (executor === "ollama") {
    return "ollama";
  }
  return "codex";
}

export function mergeUsageStats(
  base?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  next?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
  if (!base && !next) {
    return undefined;
  }
  return {
    inputTokens: (base?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
    outputTokens: (base?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
    totalTokens: (base?.totalTokens ?? 0) + (next?.totalTokens ?? 0),
  };
}

export function extractSchemaValidationTarget(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output;
  }
  const row = output as Record<string, unknown>;
  const artifact = row.artifact;
  if (artifact && typeof artifact === "object" && !Array.isArray(artifact)) {
    const payload = (artifact as Record<string, unknown>).payload;
    if (payload !== undefined) {
      if (typeof payload === "string") {
        return tryParseJsonText(payload) ?? { text: payload };
      }
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const payloadText = String((payload as Record<string, unknown>).text ?? "").trim();
        if (payloadText) {
          return tryParseJsonText(payloadText) ?? payload;
        }
      }
      return payload;
    }
  }
  if (row.raw !== undefined) {
    return row.raw;
  }
  if (typeof row.text === "string") {
    return tryParseJsonText(row.text) ?? { text: row.text };
  }
  return output;
}

export function buildSchemaRetryInput(
  originalInput: unknown,
  previousOutput: unknown,
  schema: unknown,
  schemaErrors: string[],
): string {
  const clip = (value: unknown, maxChars = 2800) => {
    const text = stringifyInput(value).trim();
    if (!text) {
      return tp("(없음)");
    }
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...(${tp("중략")})`;
  };

  const schemaText = (() => {
    try {
      return JSON.stringify(schema, null, 2);
    } catch {
      return stringifyInput(schema);
    }
  })();

  return [
    `[${tp("원래 입력")}]`,
    clip(originalInput),
    `[${tp("이전 출력")}]`,
    clip(extractSchemaValidationTarget(previousOutput)),
    `[${tp("출력 스키마(JSON)")}]`,
    schemaText,
    `[${tp("스키마 오류 목록")}]`,
    schemaErrors.map((row, index) => `${index + 1}. ${row}`).join("\n"),
    `[${tp("재요청 지시")}]`,
    tp("위 스키마를 엄격히 만족하는 결과만 다시 생성하세요. 불필요한 설명 없이 스키마에 맞는 구조만 출력하세요."),
  ].join("\n\n");
}
