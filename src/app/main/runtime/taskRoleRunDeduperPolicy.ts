export type TaskRolePromptMode = "direct" | "orchestrate" | "brief" | "critique" | "final";

export function shouldDeduplicateTaskRoleRun(params: {
  mode: TaskRolePromptMode | string | undefined;
  internal?: boolean;
}): boolean {
  if (params.internal) {
    return false;
  }
  return String(params.mode ?? "direct").trim() === "direct";
}
