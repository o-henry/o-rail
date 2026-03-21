import ApprovalModal from "../../../components/modals/ApprovalModal";
import PendingWebConnectModal from "../../../components/modals/PendingWebConnectModal";
import PendingWebLoginModal from "../../../components/modals/PendingWebLoginModal";
import PendingWebTurnModal from "../../../components/modals/PendingWebTurnModal";

export function MainAppModals(props: any) {
  return (
    <>
      <PendingWebConnectModal
        onCancel={() => {
          props.setPendingWebConnectCheck(null);
          props.setStatus("그래프 실행 대기");
        }}
        onContinue={() => {
          if (!props.pendingWebConnectCheck) {
            return;
          }
          props.setPendingWebConnectCheck(null);
          void props.onRunGraph(true);
        }}
        onOpenBridgeTab={() => {
          props.setPendingWebConnectCheck(null);
          props.setWorkspaceTab("bridge");
          void props.refreshWebBridgeStatus(false, true);
        }}
        open={Boolean(props.pendingWebConnectCheck)}
        providersLabel={
          props.pendingWebConnectCheck
            ? props.pendingWebConnectCheck.providers
                .map((provider: any) => props.webProviderLabel(provider))
                .join(", ")
            : ""
        }
        reason={props.pendingWebConnectCheck?.reason ?? ""}
      />

      <PendingWebLoginModal
        nodeId={props.pendingWebLogin?.nodeId ?? ""}
        onCancel={() => props.resolvePendingWebLogin(false)}
        onContinueAfterLogin={() => props.resolvePendingWebLogin(true)}
        onOpenProviderSession={() => {
          if (!props.pendingWebLogin) {
            return;
          }
          void props.onOpenProviderSession(props.pendingWebLogin.provider);
        }}
        open={Boolean(props.pendingWebLogin)}
        providerLabel={props.pendingWebLogin ? props.webProviderLabel(props.pendingWebLogin.provider) : ""}
        reason={props.pendingWebLogin?.reason ?? ""}
      />

      <PendingWebTurnModal
        dragging={props.webTurnPanel.dragging}
        modeLabel={props.pendingWebTurn?.mode === "manualPasteJson" ? "JSON" : props.t("feed.webMode.text")}
        nodeId={props.pendingWebTurn?.nodeId ?? ""}
        onCancelRun={props.onCancelPendingWebTurn}
        onChangeResponseDraft={props.setWebResponseDraft}
        onCopyPrompt={() => void props.onCopyPendingWebPrompt()}
        onDismiss={props.onDismissPendingWebTurn}
        onDragStart={props.webTurnPanel.onDragStart}
        onOpenProviderWindow={() => void props.onOpenPendingProviderWindow()}
        onSubmit={props.onSubmitPendingWebTurn}
        open={Boolean(props.pendingWebTurn)}
        panelRef={props.webTurnFloatingRef}
        position={props.webTurnPanel.position}
        prompt={props.pendingWebTurn?.prompt ?? ""}
        providerLabel={props.pendingWebTurn ? props.webProviderLabel(props.pendingWebTurn.provider) : ""}
        responseDraft={props.webResponseDraft}
      />

      <ApprovalModal
        decisionLabel={props.approvalDecisionLabel}
        decisions={props.approvalDecisions}
        method={props.activeApproval?.method ?? ""}
        onRespond={props.onRespondApproval}
        open={Boolean(props.activeApproval)}
        params={props.formatUnknown(props.activeApproval?.params)}
        requestId={props.activeApproval?.requestId ?? 0}
        sourceLabel={props.approvalSourceLabel(props.activeApproval?.source ?? "remote")}
        submitting={props.approvalSubmitting}
      />
    </>
  );
}
