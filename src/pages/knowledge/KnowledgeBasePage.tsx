import type { KnowledgeEntry, KnowledgeSourcePost } from "../../features/studio/knowledgeTypes";
import { KnowledgeBaseDetailPanel } from "./KnowledgeBaseDetailPanel";
import { KnowledgeDeleteGroupModal } from "./KnowledgeDeleteGroupModal";
import { KnowledgeBaseListPanel } from "./KnowledgeBaseListPanel";
import { useKnowledgeBaseState } from "./useKnowledgeBaseState";

type KnowledgeBasePageProps = {
  cwd: string;
  posts: KnowledgeSourcePost[];
  onInjectContextSources: (entries: KnowledgeEntry[]) => void;
  onOpenInVisualize?: (entry: KnowledgeEntry) => void;
};

export default function KnowledgeBasePage({
  cwd,
  posts,
  onInjectContextSources,
  onOpenInVisualize,
}: KnowledgeBasePageProps) {
  const state = useKnowledgeBaseState({ cwd, posts });

  return (
    <section aria-label="데이터베이스 작업공간" className="panel-card knowledge-view workspace-tab-panel" data-e2e="knowledge-page">
      <header className="knowledge-head">
        <h2>데이터베이스</h2>
        <p>역할 실행으로 생성된 산출물(Markdown/JSON)을 탐색하고 에이전트 컨텍스트로 재주입합니다.</p>
      </header>
      <section className="knowledge-layout">
        <KnowledgeBaseListPanel
          collapsedByGroup={state.collapsedByGroup}
          filteredCount={state.filtered.length}
          grouped={state.grouped}
          onDeleteGroup={state.onDeleteGroup}
          onSelectEntry={state.setSelectedId}
          onToggleGroup={state.onToggleGroup}
          selectedEntry={state.selected}
        />
        <KnowledgeBaseDetailPanel
          detailError={state.detailError}
          detailLoading={state.detailLoading}
          jsonContent={state.jsonContent}
          jsonReadable={state.jsonReadable}
          markdownContent={state.markdownContent}
          onDeleteSelected={state.onDeleteSelected}
          onInjectContextSources={onInjectContextSources}
          onOpenInVisualize={onOpenInVisualize}
          onRevealPath={state.onRevealPath}
          selected={state.selected}
        />
      </section>
      <KnowledgeDeleteGroupModal
        onCancel={state.onCancelDeleteGroup}
        onConfirm={state.onConfirmDeleteGroup}
        open={Boolean(state.pendingGroupDelete)}
        pendingGroupDelete={state.pendingGroupDelete}
      />
    </section>
  );
}
