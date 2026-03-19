import { describe, expect, it } from "vitest";
import { rememberThreadSelection, resolveThreadSelection } from "./threadSelectionState";

describe("rememberThreadSelection", () => {
  it("stores a per-thread selection and can clear it", () => {
    const remembered = rememberThreadSelection({}, "thread-a", "Program.cs");
    expect(remembered).toEqual({ "thread-a": "Program.cs" });
    expect(rememberThreadSelection(remembered, "thread-a", "")).toEqual({});
  });
});

describe("resolveThreadSelection", () => {
  it("returns the remembered value only when it exists in the thread", () => {
    const remembered = { "thread-a": "Program.cs", "thread-b": "README.md" };
    expect(resolveThreadSelection(remembered, "thread-a", ["Program.cs", "Other.cs"], "Other.cs")).toBe("Program.cs");
    expect(resolveThreadSelection(remembered, "thread-b", ["Different.cs"], "Different.cs")).toBe("Different.cs");
  });
});
