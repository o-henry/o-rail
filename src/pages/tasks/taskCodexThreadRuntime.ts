import { extractStringByPaths } from "../../shared/lib/valueUtils";

export type TaskCodexThreadRuntime = {
  codexThreadId: string;
  codexTurnId?: string | null;
  codexThreadStatus?: string | null;
};

export function extractTaskCodexThreadRuntime(input: string | null | undefined): TaskCodexThreadRuntime | null {
  const text = String(input ?? "").trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    const codexThreadId = extractStringByPaths(parsed, ["codexThreadId", "threadId", "thread.threadId"]);
    if (!codexThreadId) {
      return null;
    }
    return {
      codexThreadId,
      codexTurnId: extractStringByPaths(parsed, ["codexTurnId", "turnId", "turn.id"]),
      codexThreadStatus: extractCodexThreadStatus(parsed) || null,
    };
  } catch {
    return null;
  }
}

export function extractCodexThreadStatus(input: unknown): string {
  return (
    extractStringByPaths(input, [
      "thread.status",
      "status",
      "runtime.status",
      "thread.runtime.status",
    ]) ?? ""
  ).trim();
}
