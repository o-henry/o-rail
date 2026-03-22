import { describe, expect, it } from "vitest";
import {
  getWebProviderFromExecutor,
  isExternalWebProvider,
  webProviderHomeUrl,
  webProviderUsesWorkerBridge,
} from "./domain";

describe("workflow web provider mapping", () => {
  it("maps new external executors to external providers", () => {
    expect(getWebProviderFromExecutor("web_steel")).toBe("steel");
    expect(getWebProviderFromExecutor("web_lightpanda_experimental")).toBe("lightpanda_experimental");
  });

  it("does not expose browser home urls for external providers", () => {
    expect(webProviderHomeUrl("steel")).toBeNull();
    expect(webProviderHomeUrl("lightpanda_experimental")).toBeNull();
  });

  it("marks only external providers as non-worker-backed", () => {
    expect(isExternalWebProvider("steel")).toBe(true);
    expect(isExternalWebProvider("lightpanda_experimental")).toBe(true);
    expect(webProviderUsesWorkerBridge("steel")).toBe(false);
    expect(webProviderUsesWorkerBridge("gpt")).toBe(true);
  });
});
