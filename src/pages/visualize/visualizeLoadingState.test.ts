import { describe, expect, it } from "vitest";
import { shouldShowVisualizeLoadingOverlay } from "./visualizeLoadingState";

describe("shouldShowVisualizeLoadingOverlay", () => {
  it("keeps the existing UI visible during refresh when content already exists", () => {
    expect(shouldShowVisualizeLoadingOverlay({
      refreshing: true,
      detailLoading: false,
      hasVisibleContent: true,
    })).toBe(false);
  });

  it("shows the overlay for an empty initial refresh", () => {
    expect(shouldShowVisualizeLoadingOverlay({
      refreshing: true,
      detailLoading: false,
      hasVisibleContent: false,
    })).toBe(true);
  });

  it("shows the overlay while report details are loading", () => {
    expect(shouldShowVisualizeLoadingOverlay({
      refreshing: false,
      detailLoading: true,
      hasVisibleContent: false,
    })).toBe(true);
  });

  it("keeps the existing UI visible while report details refresh over existing content", () => {
    expect(shouldShowVisualizeLoadingOverlay({
      refreshing: false,
      detailLoading: true,
      hasVisibleContent: true,
    })).toBe(false);
  });
});
