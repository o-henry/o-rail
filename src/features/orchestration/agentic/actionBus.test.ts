import { describe, expect, it, vi } from "vitest";
import { createAgenticActionBus } from "./actionBus";

describe("agentic action bus", () => {
  it("publishes actions to active subscribers", () => {
    const bus = createAgenticActionBus();
    const first = vi.fn();
    const second = vi.fn();

    const offFirst = bus.subscribe(first);
    bus.subscribe(second);

    bus.publish({
      type: "run_topic",
      payload: {
        topic: "marketSummary",
      },
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();

    bus.publish({
      type: "open_graph",
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    bus.publish({
      type: "run_role",
      payload: {
        roleId: "role-system_programmer",
        taskId: "SYSTEM-001",
      },
    });
    expect(second).toHaveBeenCalledTimes(3);
  });
});
