import { useCallback, type MutableRefObject } from "react";
import type { DashboardTopicId } from "../../features/dashboard/intelligence";
import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import type { AgentWorkspaceLaunchRequest } from "../../pages/agents/agentTypes";

type UseDashboardAgentBridgeParams = {
  setAgentLaunchRequest: (next: AgentWorkspaceLaunchRequest | null) => void;
  agentLaunchRequestSeqRef: MutableRefObject<number>;
  setWorkspaceTab: (next: "agents" | "settings") => void;
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: DashboardTopicId;
  }) => void;
  setStatus: (message: string) => void;
  t: (key: string) => string;
  loginCompleted: boolean;
  setError: (message: string) => void;
  runDashboardTopic: (topic: DashboardTopicId, followupInstruction?: string) => Promise<unknown>;
  refreshDashboardSnapshots: () => Promise<void>;
  dispatchAction?: (action: AgenticAction) => void;
};

export function useDashboardAgentBridge(params: UseDashboardAgentBridgeParams) {
  const openAgentWorkspaceForTopic = useCallback(
    (topic: DashboardTopicId, draft?: string) => {
      params.agentLaunchRequestSeqRef.current += 1;
      params.setAgentLaunchRequest({
        id: params.agentLaunchRequestSeqRef.current,
        setId: `data-${topic}`,
        draft,
      });
      params.setWorkspaceTab("agents");
      params.appendWorkspaceEvent({
        source: "data",
        message: `에이전트 실행 요청: ${topic}`,
        actor: "user",
        level: "info",
      });
      params.setStatus(`${params.t(`dashboard.widget.${topic}.title`)} 실행 요청을 에이전트 탭으로 전달했습니다.`);
    },
    [params],
  );

  const onRequestDashboardTopicRunInAgents = useCallback(
    (topic: DashboardTopicId, followupInstruction?: string) => {
      openAgentWorkspaceForTopic(topic, followupInstruction);
    },
    [openAgentWorkspaceForTopic],
  );

  const onRunDashboardTopicFromAgents = useCallback(
    async (topic: DashboardTopicId, followupInstruction?: string) => {
      if (!params.loginCompleted) {
        params.setError("Codex 로그인이 필요합니다. 설정에서 먼저 로그인해 주세요.");
        params.setWorkspaceTab("settings");
        return;
      }
      params.setStatus(`에이전트 실행: ${params.t(`dashboard.widget.${topic}.title`)} 파이프라인 시작`);
      if (params.dispatchAction) {
        params.dispatchAction({
          type: "run_topic",
          payload: {
            topic,
            followupInstruction,
            setId: `data-${topic}`,
          },
        });
        return;
      }
      await params.runDashboardTopic(topic, followupInstruction);
      await params.refreshDashboardSnapshots();
    },
    [params],
  );

  return {
    openAgentWorkspaceForTopic,
    onRequestDashboardTopicRunInAgents,
    onRunDashboardTopicFromAgents,
  };
}
