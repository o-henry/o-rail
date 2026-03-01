import type { DashboardTopicId } from "../../dashboard/intelligence";
import type { PresetKind } from "../../workflow/domain";

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
        topic: DashboardTopicId;
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
        presetKind?: PresetKind;
        setId?: string;
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
