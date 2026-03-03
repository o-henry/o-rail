import type { RefObject } from "react";

type WorkflowConversationMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
};

type WorkflowAgentConversationPanelProps = {
  isOpen: boolean;
  hasSelectedAgent: boolean;
  agentTitle: string;
  agentMeta: string;
  messages: WorkflowConversationMessage[];
  panelRef: RefObject<HTMLElement | null>;
  onToggleOpen: () => void;
};

export default function WorkflowAgentConversationPanel({
  isOpen,
  hasSelectedAgent,
  agentTitle,
  agentMeta,
  messages,
  panelRef,
  onToggleOpen,
}: WorkflowAgentConversationPanelProps) {
  if (!isOpen) {
    return (
      <div className="workflow-conversation-toggle-wrap">
        <button className="mini-action-button workflow-conversation-toggle" onClick={onToggleOpen} type="button">
          <span className="mini-action-button-label">선택 에이전트 대화</span>
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label="선택 에이전트 대화 로그"
      className="panel-card workflow-conversation-overlay"
      ref={panelRef}
    >
      <header className="workflow-conversation-head">
        <div className="workflow-conversation-head-text">
          <p className="workflow-conversation-head-date">{hasSelectedAgent ? "SELECTED AGENT" : "READY"}</p>
          <strong>{hasSelectedAgent ? agentTitle : "선택 에이전트 대화"}</strong>
          <span>{hasSelectedAgent ? agentMeta : "그래프에서 역할/핸드오프 노드를 선택하면 대화 로그를 이어갈 수 있습니다."}</span>
        </div>
        <button aria-label="대화 로그 닫기" className="mini-action-button workflow-conversation-close" onClick={onToggleOpen} type="button">
          <span className="mini-action-button-label">닫기</span>
        </button>
      </header>

      <div className="workflow-conversation-body">
        {!hasSelectedAgent ? (
          <p className="workflow-conversation-empty">대화를 시작하려면 먼저 노드를 선택해 주세요.</p>
        ) : messages.length === 0 ? (
          <p className="workflow-conversation-empty">아직 대화 로그가 없습니다. 아래 질문 입력으로 첫 요청을 전송해 보세요.</p>
        ) : (
          <ul className="workflow-conversation-list">
            {messages.map((row) => (
              <li key={row.id} className={`workflow-conversation-item is-${row.role}`}>
                <span className="workflow-conversation-role">{row.role === "user" ? "REQUEST" : "LOG"}</span>
                <p>{row.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
