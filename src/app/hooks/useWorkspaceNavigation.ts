import { useCallback, useEffect, useRef } from "react";
import type { WorkspaceTab } from "../mainAppGraphHelpers";
import type { DashboardDetailTopic } from "../../pages/dashboard/DashboardDetailPage";

type UseWorkspaceNavigationParams = {
  workspaceTab: WorkspaceTab;
  setWorkspaceTab: (next: WorkspaceTab) => void;
  dashboardDetailTopic: DashboardDetailTopic | null;
  setDashboardDetailTopic: (next: DashboardDetailTopic | null) => void;
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: string;
  }) => void;
};

export function useWorkspaceNavigation(params: UseWorkspaceNavigationParams) {
  const workspaceBackStackRef = useRef<WorkspaceTab[]>([]);
  const workspaceForwardStackRef = useRef<WorkspaceTab[]>([]);
  const suppressWorkspaceHistoryPushRef = useRef(false);

  const onSelectWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      const nextTab = tab === "bridge" ? "settings" : tab;
      if (nextTab !== params.workspaceTab) {
        workspaceForwardStackRef.current = [];
      }
      if (nextTab !== params.workspaceTab) {
        params.appendWorkspaceEvent({
          source: "navigation",
          message: `탭 이동: ${params.workspaceTab} -> ${nextTab}`,
          actor: "user",
          level: "info",
        });
      }
      params.setWorkspaceTab(nextTab);
      if (nextTab !== "dashboard") {
        params.setDashboardDetailTopic(null);
      }
    },
    [params],
  );

  useEffect(() => {
    if (suppressWorkspaceHistoryPushRef.current) {
      suppressWorkspaceHistoryPushRef.current = false;
      return;
    }
    workspaceForwardStackRef.current = [];
    const stack = workspaceBackStackRef.current;
    if (stack.length === 0 || stack[stack.length - 1] !== params.workspaceTab) {
      stack.push(params.workspaceTab);
      if (stack.length > 40) {
        stack.splice(0, stack.length - 40);
      }
    }
  }, [params.workspaceTab]);

  const onNavigateWorkspaceBack = useCallback(() => {
    if (params.dashboardDetailTopic) {
      params.setDashboardDetailTopic(null);
      return;
    }
    const forwardStack = workspaceForwardStackRef.current;
    const stack = workspaceBackStackRef.current;
    if (stack.length <= 1) {
      return;
    }
    const current = stack.pop();
    if (current && (forwardStack.length === 0 || forwardStack[forwardStack.length - 1] !== current)) {
      forwardStack.push(current);
      if (forwardStack.length > 40) {
        forwardStack.splice(0, forwardStack.length - 40);
      }
    }
    let previous = stack[stack.length - 1];
    while (previous === current && stack.length > 1) {
      stack.pop();
      previous = stack[stack.length - 1];
    }
    if (!previous) {
      return;
    }
    suppressWorkspaceHistoryPushRef.current = true;
    params.setWorkspaceTab(previous);
  }, [params]);

  const onNavigateWorkspaceForward = useCallback(() => {
    const forwardStack = workspaceForwardStackRef.current;
    if (forwardStack.length === 0) {
      return;
    }
    const next = forwardStack.pop();
    if (!next) {
      return;
    }
    const backStack = workspaceBackStackRef.current;
    if (backStack.length === 0 || backStack[backStack.length - 1] !== next) {
      backStack.push(next);
      if (backStack.length > 40) {
        backStack.splice(0, backStack.length - 40);
      }
    }
    suppressWorkspaceHistoryPushRef.current = true;
    params.setWorkspaceTab(next);
  }, [params.setWorkspaceTab]);

  useEffect(() => {
    const onMouseHistoryButton = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        onNavigateWorkspaceBack();
        return;
      }
      if (event.button === 4) {
        event.preventDefault();
        onNavigateWorkspaceForward();
      }
    };
    window.addEventListener("mousedown", onMouseHistoryButton);
    return () => window.removeEventListener("mousedown", onMouseHistoryButton);
  }, [onNavigateWorkspaceBack, onNavigateWorkspaceForward]);

  return {
    onSelectWorkspaceTab,
  };
}
