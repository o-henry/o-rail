import { useRef } from "react";
import { createAgenticActionBus, type AgenticAction, type AgenticActionSubscriber } from "../../features/orchestration/agentic/actionBus";

export function useAgenticActionBus() {
  const busRef = useRef(createAgenticActionBus());

  const publishAction = (action: AgenticAction) => {
    busRef.current.publish(action);
  };

  const subscribeAction = (handler: AgenticActionSubscriber) => {
    return busRef.current.subscribe(handler);
  };

  return {
    publishAction,
    subscribeAction,
  };
}
