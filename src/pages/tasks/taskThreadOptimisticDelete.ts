import { filterThreadListByProject } from "./threadTree";
import type { ThreadListItem } from "./threadTypes";

export function buildOptimisticThreadDeleteState(params: {
  threadItems: ThreadListItem[];
  targetThreadId: string;
  activeThreadId: string;
  projectPath: string;
  cwd: string;
}) {
  const targetThreadId = String(params.targetThreadId ?? "").trim();
  const activeThreadId = String(params.activeThreadId ?? "").trim();
  const nextThreadItems = params.threadItems.filter((item) => item.thread.threadId !== targetThreadId);
  const visibleItems = filterThreadListByProject(nextThreadItems, params.projectPath);
  return {
    nextThreadItems,
    nextActiveThreadId:
      activeThreadId === targetThreadId
        ? (visibleItems[0]?.thread.threadId ?? "")
        : activeThreadId,
  };
}
