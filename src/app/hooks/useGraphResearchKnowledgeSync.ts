import { useEffect } from "react";
import { isGraphResearchNode, toGraphResearchKnowledgeEntry } from "../../features/studio/graphResearchKnowledge";
import { persistKnowledgeIndexToWorkspace, readKnowledgeEntries, upsertKnowledgeEntry } from "../../features/studio/knowledgeIndex";
import type { FeedPost } from "../main/types";

type ResearchSyncNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export function useGraphResearchKnowledgeSync(params: {
  cwd: string;
  feedPosts: FeedPost[];
  graphNodes: ResearchSyncNode[];
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}) {
  useEffect(() => {
    const graphNodeById = new Map(params.graphNodes.map((node) => [node.id, node]));
    const currentEntries = readKnowledgeEntries();
    const existingIds = new Set(currentEntries.map((entry) => entry.id));
    let changed = false;
    let nextEntries = currentEntries;

    for (const post of params.feedPosts) {
      if (String(post.status ?? "").trim() !== "done") {
        continue;
      }
      const node = graphNodeById.get(String(post.nodeId ?? "").trim());
      if (!isGraphResearchNode(node)) {
        continue;
      }
      if (existingIds.has(post.id)) {
        continue;
      }
      const nextEntry = toGraphResearchKnowledgeEntry({ post, node });
      if (!nextEntry) {
        continue;
      }
      nextEntries = upsertKnowledgeEntry(nextEntry);
      existingIds.add(nextEntry.id);
      changed = true;
    }

    if (!changed) {
      return;
    }

    void persistKnowledgeIndexToWorkspace({
      cwd: params.cwd,
      invokeFn: params.invokeFn,
      rows: nextEntries,
    });
  }, [params.cwd, params.feedPosts, params.graphNodes, params.invokeFn]);
}
