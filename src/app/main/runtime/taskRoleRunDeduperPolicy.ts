export type TaskRolePromptMode = "direct" | "orchestrate" | "brief" | "critique" | "final";

export function shouldDeduplicateTaskRoleRun(mode: TaskRolePromptMode | string | undefined): boolean {
  return String(mode ?? "direct").trim() === "direct";
}
