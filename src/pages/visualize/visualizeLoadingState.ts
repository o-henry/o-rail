type VisualizeLoadingStateParams = {
  refreshing: boolean;
  detailLoading: boolean;
  hasVisibleContent: boolean;
};

export function shouldShowVisualizeLoadingOverlay(params: VisualizeLoadingStateParams): boolean {
  return !params.hasVisibleContent && (params.refreshing || params.detailLoading);
}
