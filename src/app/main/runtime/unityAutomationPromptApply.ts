import { loadUnityAutomationPromptContext } from "./unityAutomationContext";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function applyUnityAutomationPromptContext(params: {
  presetKind: string | undefined;
  cwd: string;
  text: string;
  invokeFn: InvokeFn;
  addNodeLog: (message: string) => void;
}): Promise<string> {
  try {
    const unityAutomationContext = await loadUnityAutomationPromptContext({
      presetKind: params.presetKind,
      cwd: params.cwd,
      invokeFn: params.invokeFn,
    });
    if (!unityAutomationContext) {
      return params.text;
    }
    params.addNodeLog("[UNITY 자동화] 보호/진단 컨텍스트 자동 반영");
    return `${unityAutomationContext}\n\n${params.text}`.trim();
  } catch (error) {
    params.addNodeLog(`[UNITY 자동화] 보호/진단 컨텍스트 로드 실패: ${String(error)}`);
    return params.text;
  }
}
