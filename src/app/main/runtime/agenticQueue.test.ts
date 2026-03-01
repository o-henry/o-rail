import { describe, expect, it } from "vitest";
import { createAgenticQueue } from "./agenticQueue";

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("agenticQueue", () => {
  it("runs jobs serially within the same queue key", async () => {
    const queue = createAgenticQueue();
    const order: string[] = [];

    const first = queue.enqueue("topic:marketSummary", async () => {
      order.push("first:start");
      await sleep(25);
      order.push("first:end");
      return "first";
    });

    const second = queue.enqueue("topic:marketSummary", async () => {
      order.push("second:start");
      await sleep(5);
      order.push("second:end");
      return "second";
    });

    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("runs jobs in parallel across different queue keys", async () => {
    const queue = createAgenticQueue();
    const order: string[] = [];

    const first = queue.enqueue("topic:a", async () => {
      order.push("a:start");
      await sleep(20);
      order.push("a:end");
    });

    const second = queue.enqueue("topic:b", async () => {
      order.push("b:start");
      await sleep(5);
      order.push("b:end");
    });

    await Promise.all([first, second]);

    const aStart = order.indexOf("a:start");
    const bStart = order.indexOf("b:start");
    const aEnd = order.indexOf("a:end");
    const bEnd = order.indexOf("b:end");

    expect(aStart).toBeGreaterThanOrEqual(0);
    expect(bStart).toBeGreaterThanOrEqual(0);
    expect(aEnd).toBeGreaterThanOrEqual(0);
    expect(bEnd).toBeGreaterThanOrEqual(0);
    expect(bEnd).toBeLessThan(aEnd);
  });
});
