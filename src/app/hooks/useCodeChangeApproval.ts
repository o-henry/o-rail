import { useCallback, useMemo, useState } from "react";
import {
  readCodeChangeApprovals,
  upsertCodeChangeApproval,
} from "../../features/studio/approvalQueue";
import type { CodeChangeApproval } from "../../features/studio/approvalTypes";

export function useCodeChangeApproval() {
  const [items, setItems] = useState<CodeChangeApproval[]>(() => readCodeChangeApprovals());

  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);

  const requestApproval = useCallback((item: Omit<CodeChangeApproval, "status" | "createdAt" | "updatedAt">) => {
    const next = upsertCodeChangeApproval({
      ...item,
      status: "pending",
    });
    setItems(next);
  }, []);

  const resolveApproval = useCallback((id: string, decision: "approved" | "rejected", rejectReason?: string) => {
    const current = items.find((item) => item.id === id);
    if (!current) {
      return;
    }
    const next = upsertCodeChangeApproval({
      ...current,
      status: decision,
      rejectReason: decision === "rejected" ? String(rejectReason ?? "").trim() || "사용자 반려" : undefined,
    });
    setItems(next);
  }, [items]);

  return {
    approvals: items,
    pendingApprovals: pending,
    requestApproval,
    resolveApproval,
  };
}

