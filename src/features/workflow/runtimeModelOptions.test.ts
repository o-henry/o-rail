import { describe, expect, it } from "vitest";
import { findRuntimeModelOption, RUNTIME_MODEL_OPTIONS } from "./runtimeModelOptions";

describe("runtimeModelOptions", () => {
  it("exposes external web runtimes in the shared model menu options", () => {
    const optionValues = RUNTIME_MODEL_OPTIONS.map((option) => option.value);
    expect(optionValues).toContain("WEB / STEEL");
    expect(optionValues).toContain("WEB / LIGHTPANDA");
  });

  it("maps external web runtime labels to the correct executors", () => {
    expect(findRuntimeModelOption("WEB / STEEL")).toMatchObject({
      label: "WEB / STEEL",
      executor: "web_steel",
      allowsReasonLevel: false,
    });
    expect(findRuntimeModelOption("WEB / LIGHTPANDA")).toMatchObject({
      label: "WEB / LIGHTPANDA",
      executor: "web_lightpanda_experimental",
      allowsReasonLevel: false,
    });
  });
});
