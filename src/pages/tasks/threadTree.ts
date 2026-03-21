import type { ThreadDetail, ThreadListItem } from "./threadTypes";

export type ProjectThreadGroup = {
  projectPath: string;
  label: string;
  threads: ThreadListItem[];
  isSelected: boolean;
};

function normalizePath(input: string | null | undefined): string {
  return String(input ?? "").trim().replace(/[\\/]+$/, "");
}

export function matchesProjectPath(candidate: string | null | undefined, projectPath: string | null | undefined): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedProjectPath = normalizePath(projectPath);
  if (!normalizedProjectPath) {
    return true;
  }
  return normalizedCandidate === normalizedProjectPath;
}

export function filterThreadListByProject(items: ThreadListItem[], projectPath: string | null | undefined): ThreadListItem[] {
  return items.filter((item) => matchesProjectPath(item.projectPath || item.thread.cwd, projectPath));
}

export function filterBrowserThreadIdsByProject(details: Record<string, ThreadDetail>, order: string[], projectPath: string | null | undefined): string[] {
  return order.filter((threadId) => {
    const detail = details[threadId];
    if (!detail) {
      return false;
    }
    return matchesProjectPath(detail.task.projectPath || detail.task.worktreePath || detail.task.workspacePath, projectPath);
  });
}

export function projectTreeLabel(projectPath: string | null | undefined): string {
  const normalized = normalizePath(projectPath);
  if (!normalized) {
    return "프로젝트";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export function buildProjectThreadGroups(
  items: ThreadListItem[],
  currentProjectPath: string | null | undefined,
  knownProjectPaths: string[] = [],
  fallbackProjectPath?: string | null,
): ProjectThreadGroup[] {
  const selectedProjectPath = normalizePath(currentProjectPath || fallbackProjectPath);
  const groups = new Map<string, ThreadListItem[]>();
  for (const path of knownProjectPaths) {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
      continue;
    }
    if (!groups.has(normalizedPath)) {
      groups.set(normalizedPath, []);
    }
  }
  for (const item of items) {
    const projectPath = normalizePath(item.projectPath || item.thread.cwd || fallbackProjectPath);
    if (!projectPath) {
      continue;
    }
    const existing = groups.get(projectPath) ?? [];
    existing.push(item);
    groups.set(projectPath, existing);
  }
  const knownProjectPathSet = new Set(
    knownProjectPaths
      .map((path) => normalizePath(path))
      .filter(Boolean),
  );
  if (selectedProjectPath && knownProjectPathSet.has(selectedProjectPath) && !groups.has(selectedProjectPath)) {
    groups.set(selectedProjectPath, []);
  }
  return [...groups.entries()]
    .sort((left, right) => {
      const leftUpdatedAt = left[1][0]?.thread.updatedAt ?? "";
      const rightUpdatedAt = right[1][0]?.thread.updatedAt ?? "";
      return rightUpdatedAt.localeCompare(leftUpdatedAt) || left[0].localeCompare(right[0]);
    })
    .map(([projectPath, threads]) => ({
      projectPath,
      label: projectTreeLabel(projectPath),
      threads,
      isSelected: projectPath === selectedProjectPath,
    }));
}
