import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import type { PendingKnowledgeGroupDelete } from "./useKnowledgeBaseState";

type KnowledgeDeleteGroupModalProps = {
  open: boolean;
  pendingGroupDelete: PendingKnowledgeGroupDelete | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function KnowledgeDeleteGroupModal({
  open,
  pendingGroupDelete,
  onCancel,
  onConfirm,
}: KnowledgeDeleteGroupModalProps) {
  const { t } = useI18n();

  if (!open || !pendingGroupDelete) {
    return null;
  }

  const content = (
    <div className="modal-backdrop">
      <section className="approval-modal web-turn-modal knowledge-delete-group-modal">
        <h2>그룹 삭제</h2>
        <div>{`'${pendingGroupDelete.taskId} · ${pendingGroupDelete.runId}' 그룹을 삭제하시겠습니까?`}</div>
        <div className="button-row">
          <button onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>
          <button onClick={onConfirm} type="button">
            {t("common.delete")}
          </button>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
