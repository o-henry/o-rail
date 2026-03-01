import type { AgentSetOption, AgentThread } from "../agentTypes";

type AgentsWorkspaceSidebarProps = {
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
  setMission: string;
  activeSetOption: AgentSetOption | null;
  codexMultiAgentMode: string;
  activeThread: AgentThread | null;
  dashboardInsights: string[];
  onQueuePrompt: (prompt: string) => void;
};

export function AgentsWorkspaceSidebar({
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  setMission,
  activeSetOption,
  codexMultiAgentMode,
  activeThread,
  dashboardInsights,
  onQueuePrompt,
}: AgentsWorkspaceSidebarProps) {
  const quickActionItems = [
    {
      id: "set-mission",
      label: "세트 미션 기반 실행",
      prompt: `${activeSetOption?.label ?? "현재 세트"} 기준으로 우선순위 3개를 정리하고 바로 실행해줘.`,
    },
    {
      id: "active-agent",
      label: "활성 에이전트 실행",
      prompt: activeThread?.starterPrompt || "활성 에이전트 역할 기준으로 바로 실행해줘.",
    },
    {
      id: "snapshot-briefing",
      label: "최신 스냅샷 브리핑",
      prompt: "최신 데이터 스냅샷을 바탕으로 highlights/risks/actions 3개씩 한국어로 정리해줘.",
    },
  ];

  return (
    <aside
      className={`panel-card agents-workspace-sidebar${isSidebarCollapsed ? " is-collapsed" : ""}`}
      aria-label="Agent workspace sidebar"
    >
      <div className="agents-workspace-sidebar-head">
        <button
          aria-label={isSidebarCollapsed ? "사이드바 확대" : "사이드바 최소화"}
          className="agents-off-button agents-sidebar-toggle-button"
          onClick={() => setIsSidebarCollapsed((prev) => !prev)}
          title={isSidebarCollapsed ? "사이드바 확대" : "사이드바 최소화"}
          type="button"
        >
          <img alt="" aria-hidden="true" src={isSidebarCollapsed ? "/open.svg" : "/close.svg"} />
        </button>
      </div>

      {!isSidebarCollapsed ? (
        <>
          <section className="agents-sidebar-card">
            <h4>브리핑</h4>
            <p>{setMission || activeSetOption?.description || "세트 설명이 없습니다."}</p>
            <small>{`Mode: ${codexMultiAgentMode}`}</small>
          </section>

          <section className="agents-sidebar-card">
            <h4>활성 에이전트</h4>
            <p className="agents-sidebar-agent-name">{activeThread?.name ?? "-"}</p>
            <p className="agents-sidebar-agent-role">{activeThread?.role ?? "선택된 에이전트 없음"}</p>
            {activeThread?.starterPrompt ? <small>{activeThread.starterPrompt}</small> : null}
          </section>

          <section className="agents-sidebar-card">
            <div className="agents-sidebar-card-head">
              <h4>데이터 스냅샷</h4>
            </div>
            <ul className="agents-sidebar-list">
              {(dashboardInsights.length > 0 ? dashboardInsights : ["스냅샷 데이터가 없습니다."]).slice(0, 6).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <section className="agents-sidebar-card">
            <h4>액션 큐</h4>
            <div className="agents-sidebar-actions">
              {quickActionItems.map((item) => (
                <button key={item.id} onClick={() => onQueuePrompt(item.prompt)} type="button">
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </aside>
  );
}
