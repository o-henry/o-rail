type VisualizeLoadingStateParams = {
  refreshing: boolean;
  detailLoading: boolean;
  hasVisibleContent: boolean;
};

export function shouldShowVisualizeLoadingOverlay(params: VisualizeLoadingStateParams): boolean {
  if (params.detailLoading) {
    return true;
  }
  return params.refreshing && !params.hasVisibleContent;
}
