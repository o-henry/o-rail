import { useEffect, useState } from "react";
import {
  loadTasksActiveThreadSnapshot,
  type TasksActiveThreadSnapshot,
} from "../tasks/taskThreadStorageState";

function normalizeSnapshot(input: TasksActiveThreadSnapshot | null): TasksActiveThreadSnapshot | null {
  const threadId = String(input?.threadId ?? "").trim();
  const cwd = String(input?.cwd ?? "").trim();
  if (!threadId || !cwd) {
    return null;
  }
  return { threadId, cwd };
}

export function useShellActiveThreadSnapshot() {
  const [snapshot, setSnapshot] = useState<TasksActiveThreadSnapshot | null>(() =>
    normalizeSnapshot(loadTasksActiveThreadSnapshot()),
  );

  useEffect(() => {
    const sync = () => {
      setSnapshot(normalizeSnapshot(loadTasksActiveThreadSnapshot()));
    };

    sync();
    window.addEventListener("rail:tasks-active-thread-changed", sync as EventListener);
    window.addEventListener("rail:thread-updated", sync as EventListener);
    window.addEventListener("rail:task-updated", sync as EventListener);
    return () => {
      window.removeEventListener("rail:tasks-active-thread-changed", sync as EventListener);
      window.removeEventListener("rail:thread-updated", sync as EventListener);
      window.removeEventListener("rail:task-updated", sync as EventListener);
    };
  }, []);

  return snapshot;
}
