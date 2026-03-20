import type { TaskIsolation } from "./taskTypes";

// Default to auto so git worktrees are used when available, but non-git
// workspaces like docs/scratch folders can still create threads.
export function getDefaultTaskCreationIsolation(): TaskIsolation {
  return "auto";
}
