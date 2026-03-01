export type AgenticQueue = {
  enqueue: <T>(queueKey: string, task: () => Promise<T>) => Promise<T>;
  getPendingCount: (queueKey?: string) => number;
  getActiveKeys: () => string[];
};

export function createAgenticQueue(): AgenticQueue {
  const tails = new Map<string, Promise<void>>();
  const pendingCounts = new Map<string, number>();

  const getPendingCount = (queueKey?: string): number => {
    if (!queueKey) {
      let total = 0;
      for (const count of pendingCounts.values()) {
        total += count;
      }
      return total;
    }
    return pendingCounts.get(queueKey) ?? 0;
  };

  const getActiveKeys = (): string[] => {
    return [...pendingCounts.entries()]
      .filter(([, count]) => count > 0)
      .map(([key]) => key)
      .sort();
  };

  const enqueue = async <T>(queueKey: string, task: () => Promise<T>): Promise<T> => {
    const key = String(queueKey ?? "").trim() || "default";
    const previousTail = tails.get(key) ?? Promise.resolve();
    const stablePreviousTail = previousTail.catch(() => undefined);

    let resolveGate: (() => void) | null = null;
    const gatePromise = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const nextTail = stablePreviousTail.then(() => gatePromise);
    tails.set(key, nextTail);
    pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1);

    await stablePreviousTail;

    try {
      return await task();
    } finally {
      const nextCount = Math.max(0, (pendingCounts.get(key) ?? 1) - 1);
      if (nextCount > 0) {
        pendingCounts.set(key, nextCount);
      } else {
        pendingCounts.delete(key);
      }

      if (resolveGate) {
        resolveGate();
      }

      queueMicrotask(() => {
        if (tails.get(key) === nextTail) {
          tails.delete(key);
        }
      });
    }
  };

  return {
    enqueue,
    getPendingCount,
    getActiveKeys,
  };
}
