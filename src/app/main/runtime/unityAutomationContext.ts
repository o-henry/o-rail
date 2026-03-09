import { buildUnityAutomationPromptContext, isUnityAutomationPresetKind } from "../../../features/unityAutomation/promptContext";
import type { UnityDiagnosticsBundle, UnityGuardInspection } from "../../../features/unityAutomation/types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const unityContextCache = new Map<string, { expiresAt: number; value: string }>();
const UNITY_CONTEXT_TTL_MS = 30_000;

export async function loadUnityAutomationPromptContext(params: {
  presetKind: string | undefined;
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<string> {
  if (!params.presetKind || !isUnityAutomationPresetKind(params.presetKind) || !params.cwd.trim()) {
    return "";
  }
  const cacheKey = `${params.presetKind}::${params.cwd}`;
  const cached = unityContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inspection = await params.invokeFn<UnityGuardInspection>("unity_guard_inspect", {
    projectPath: params.cwd,
  });
  const diagnostics = await params.invokeFn<UnityDiagnosticsBundle>("unity_collect_diagnostics", {
    projectPath: params.cwd,
  });
  const value = buildUnityAutomationPromptContext({ inspection, diagnostics });
  unityContextCache.set(cacheKey, {
    expiresAt: Date.now() + UNITY_CONTEXT_TTL_MS,
    value,
  });
  return value;
}

export function clearUnityAutomationPromptContextCache(): void {
  unityContextCache.clear();
}
