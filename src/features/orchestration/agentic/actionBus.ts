export type AgenticActionTopicId = string;
export type AgenticPresetKind = string;

export type AgenticAction =
  | {
      type: "open_graph";
      payload?: {
        focusNodeId?: string;
      };
    }
  | {
      type: "focus_node";
      payload: {
        nodeId: string;
      };
    }
  | {
      type: "run_graph";
      payload?: {
        graphId?: string;
      };
    }
  | {
      type: "run_topic";
      payload: {
        topic: AgenticActionTopicId;
        followupInstruction?: string;
        setId?: string;
      };
    }
  | {
      type: "open_run";
      payload: {
        runId: string;
      };
    }
  | {
      type: "apply_template";
      payload: {
        presetKind?: AgenticPresetKind;
        setId?: string;
      };
    }
  | {
      type: "run_role";
    payload: {
        roleId: string;
        taskId: string;
        prompt?: string;
        runId?: string;
        creativeMode?: boolean;
        sourceTab?: "agents" | "workflow" | "workbench" | "tasks" | "tasks-thread";
        handoffToRole?: string;
        handoffRequest?: string;
      };
    }
  | {
      type: "run_task_collaboration";
      payload: {
        taskId: string;
        prompt?: string;
        sourceTab?: "tasks" | "tasks-thread";
        roleIds: string[];
        candidateRoleIds?: string[];
        requestedRoleIds?: string[];
        rolePrompts?: Record<string, string>;
        intent?: string;
        creativeMode?: boolean;
        primaryRoleId: string;
        synthesisRoleId: string;
        criticRoleId?: string;
        cappedParticipantCount?: boolean;
        useAdaptiveOrchestrator?: boolean;
      };
    }
  | {
      type: "create_manual_session";
      payload: {
        title: string;
        taskId: string;
        prompt?: string;
        commands?: string[];
      };
    }
  | {
      type: "open_session";
      payload: {
        sessionId: string;
      };
    }
  | {
      type: "archive_session";
      payload: {
        sessionId: string;
      };
    }
  | {
      type: "attach_session_note";
      payload: {
        sessionId: string;
        note: string;
      };
    }
  | {
      type: "handoff_create";
      payload: {
        handoffId: string;
      };
    }
  | {
      type: "handoff_consume";
      payload: {
        handoffId: string;
      };
    }
  | {
      type: "request_handoff";
      payload: {
        handoffId: string;
      };
    }
  | {
      type: "consume_handoff";
      payload: {
        handoffId: string;
      };
    }
  | {
      type: "open_handoff";
      payload?: {
        handoffId?: string;
      };
    }
  | {
      type: "open_knowledge_doc";
      payload: {
        entryId: string;
      };
    }
  | {
      type: "inject_context_sources";
      payload: {
        sourceIds: string[];
      };
    }
  | {
      type: "request_code_approval";
      payload: {
        approvalId: string;
      };
    }
  | {
      type: "resolve_code_approval";
      payload: {
        approvalId: string;
        decision: "approved" | "rejected";
      };
    };

export type AgenticActionSubscriber = (action: AgenticAction) => void;

export type AgenticActionBus = {
  publish: (action: AgenticAction) => void;
  subscribe: (handler: AgenticActionSubscriber) => () => void;
};

export function createAgenticActionBus(): AgenticActionBus {
  const subscribers = new Set<AgenticActionSubscriber>();

  const publish = (action: AgenticAction) => {
    subscribers.forEach((subscriber) => {
      subscriber(action);
    });
  };

  const subscribe = (handler: AgenticActionSubscriber) => {
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  };

  return {
    publish,
    subscribe,
  };
}
