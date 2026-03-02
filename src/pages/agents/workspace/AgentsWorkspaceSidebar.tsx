import type { AgentDataSourceItem, AgentSetOption, AgentThread, AttachedFile } from "../agentTypes";
import type { CodeChangeApproval } from "../../../features/studio/approvalTypes";
import { uppercaseEnglishTokens } from "./textUtils";

type AgentsWorkspaceSidebarProps = {
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (next: boolean | ((prev: boolean) => boolean)) => void;
  setMission: string;
  activeSetOption: AgentSetOption | null;
  codexMultiAgentMode: string;
  activeThread: AgentThread | null;
  dashboardInsights: string[];
  recentDataSources: AgentDataSourceItem[];
  attachedFiles: AttachedFile[];
  enabledAttachedFileNames: string[];
  enabledDataSourceIds: string[];
  onQueuePrompt: (prompt: string) => void;
  onToggleAttachedFile: (fileName: string) => void;
  onToggleDataSource: (sourceId: string) => void;
  pendingApprovals: CodeChangeApproval[];
  onResolveApproval: (approvalId: string, decision: "approved" | "rejected") => void;
};

export function AgentsWorkspaceSidebar({
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  setMission,
  activeSetOption,
  codexMultiAgentMode,
  activeThread,
  dashboardInsights,
  recentDataSources,
  attachedFiles,
  enabledAttachedFileNames,
  enabledDataSourceIds,
  onQueuePrompt,
  onToggleAttachedFile,
  onToggleDataSource,
  pendingApprovals,
  onResolveApproval,
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
            <p className="agents-sidebar-agent-role">{uppercaseEnglishTokens(activeThread?.role ?? "선택된 에이전트 없음")}</p>
            {activeThread?.starterPrompt ? <small>{activeThread.starterPrompt}</small> : null}
          </section>

          <section className="agents-sidebar-card">
            <div className="agents-sidebar-card-head">
              <h4>컨텍스트/RAG 소스</h4>
            </div>
            <div className="agents-rag-source-group">
              <small>첨부 파일</small>
              {attachedFiles.length > 0 ? (
                <ul className="agents-rag-source-list">
                  {attachedFiles.map((file) => {
                    const enabled = enabledAttachedFileNames.includes(file.name);
                    return (
                      <li key={file.id}>
                        <span>{file.name}</span>
                        <button
                          aria-pressed={enabled}
                          className={`agents-rag-toggle${enabled ? " is-on" : " is-off"}`}
                          onClick={() => onToggleAttachedFile(file.name)}
                          type="button"
                        >
                          {enabled ? "ON" : "OFF"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>첨부 파일이 없습니다.</p>
              )}
            </div>
            <div className="agents-rag-source-group">
              <small>최근 데이터 파이프라인 산출물</small>
              {recentDataSources.length > 0 ? (
                <ul className="agents-rag-source-list">
                  {recentDataSources.map((item) => {
                    const enabled = enabledDataSourceIds.includes(item.id);
                    return (
                      <li key={item.id}>
                        <div className="agents-rag-source-copy">
                          <span>{item.detail}</span>
                          <small className="agents-rag-source-meta">{`${item.topic} · ${item.runId || "no-runid"}`}</small>
                        </div>
                        <button
                          aria-pressed={enabled}
                          className={`agents-rag-toggle${enabled ? " is-on" : " is-off"}`}
                          onClick={() => onToggleDataSource(item.id)}
                          type="button"
                        >
                          {enabled ? "ON" : "OFF"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>{(dashboardInsights.length > 0 ? dashboardInsights : ["데이터 산출물이 없습니다."]).slice(0, 1)[0]}</p>
              )}
            </div>
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
          <section className="agents-sidebar-card">
            <h4>코드 변경 승인 큐</h4>
            {pendingApprovals.length === 0 ? (
              <p>승인 대기 항목이 없습니다.</p>
            ) : (
              <ul className="agents-rag-source-list">
                {pendingApprovals.slice(0, 5).map((approval) => (
                  <li key={approval.id}>
                    <div className="agents-rag-source-copy">
                      <span>{approval.title}</span>
                      <small className="agents-rag-source-meta">{approval.taskId}</small>
                    </div>
                    <div className="agents-sidebar-inline-actions">
                      <button type="button" onClick={() => onResolveApproval(approval.id, "approved")}>승인</button>
                      <button type="button" onClick={() => onResolveApproval(approval.id, "rejected")}>반려</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </aside>
  );
}
