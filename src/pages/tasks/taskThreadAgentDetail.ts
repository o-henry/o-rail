import { extractCodexThreadStatus, extractTaskCodexThreadRuntime } from "./taskCodexThreadRuntime";
import { findLatestCodexResponseJsonPath } from "./taskThreadBrowserState";
import type { ThreadAgentDetail } from "./threadTypes";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function hydrateAgentDetailWithCodexRuntime(params: {
  detail: ThreadAgentDetail;
  hasTauriRuntime: boolean;
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<ThreadAgentDetail> {
  if (!params.hasTauriRuntime || !params.cwd) {
    return params.detail;
  }
  const responseJsonPath = findLatestCodexResponseJsonPath(params.detail.artifactPaths);
  if (!responseJsonPath) {
    return params.detail;
  }
  try {
    const responseJson = await params.invokeFn<string>("workspace_read_text", { cwd: params.cwd, path: responseJsonPath });
    const runtime = extractTaskCodexThreadRuntime(responseJson);
    if (!runtime?.codexThreadId) {
      return params.detail;
    }
    let codexThreadStatus = runtime.codexThreadStatus ?? null;
    try {
      const threadState = await params.invokeFn<unknown>("codex_thread_read", {
        threadId: runtime.codexThreadId,
        includeTurns: false,
      });
      codexThreadStatus = extractCodexThreadStatus(threadState) || codexThreadStatus;
    } catch {
      // keep last known status
    }
    return {
      ...params.detail,
      codexThreadId: runtime.codexThreadId,
      codexTurnId: runtime.codexTurnId ?? null,
      codexThreadStatus,
    };
  } catch {
    return params.detail;
  }
}

export async function loadThreadAgentDetail(params: {
  threadId: string;
  agentId: string;
  hasTauriRuntime: boolean;
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<ThreadAgentDetail | null> {
  if (!params.threadId || !params.agentId || !params.hasTauriRuntime || !params.cwd) {
    return null;
  }
  const detail = await params.invokeFn<ThreadAgentDetail>("thread_open_agent_detail", {
    cwd: params.cwd,
    threadId: params.threadId,
    agentId: params.agentId,
  });
  return hydrateAgentDetailWithCodexRuntime({
    detail,
    hasTauriRuntime: params.hasTauriRuntime,
    cwd: params.cwd,
    invokeFn: params.invokeFn,
  });
}
