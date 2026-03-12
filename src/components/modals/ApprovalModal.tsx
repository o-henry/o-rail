import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

type ApprovalModalProps = {
  open: boolean;
  requestId: number;
  sourceLabel: string;
  method: string;
  params: ReactNode;
  decisions: ApprovalDecision[];
  submitting: boolean;
  decisionLabel: (decision: ApprovalDecision) => string;
  onRespond: (decision: ApprovalDecision) => void;
};

export default function ApprovalModal({
  open,
  requestId,
  sourceLabel,
  method,
  params,
  decisions,
  submitting,
  decisionLabel,
  onRespond,
}: ApprovalModalProps) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  const content = (
    <div className="modal-backdrop">
      <section className="approval-modal">
        <h2>{t("modal.approvalRequired")}</h2>
        <div>{t("modal.requestSource")}: {sourceLabel}</div>
        <div>{t("modal.method")}: {method}</div>
        <div>{t("modal.requestId")}: {requestId}</div>
        <pre>{params}</pre>
        <div className="button-row">
          {decisions.map((decision) => (
            <button disabled={submitting} key={decision} onClick={() => onRespond(decision)} type="button">
              {decisionLabel(decision)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
