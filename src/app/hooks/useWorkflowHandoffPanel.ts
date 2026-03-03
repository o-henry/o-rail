import { useMemo, useState } from "react";
import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import {
  persistHandoffRecordsToWorkspace,
  readHandoffRecords,
  upsertHandoffRecord,
} from "../../features/studio/handoffStore";
import type { HandoffRecord, StudioRoleId } from "../../features/studio/handoffTypes";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import { invoke } from "../../shared/tauri";

function createHandoffId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `handoff-${stamp}-${random}`;
}

type UseWorkflowHandoffPanelParams = {
  cwd: string;
  publishAction: (action: AgenticAction) => void;
  setStatus: (message: string) => void;
  onConsumeHandoff: (payload: {
    handoffId: string;
    toRole: StudioRoleId;
    taskId: string;
    request: string;
  }) => void;
};

export function useWorkflowHandoffPanel(params: UseWorkflowHandoffPanelParams) {
  const [handoffRecords, setHandoffRecords] = useState<HandoffRecord[]>(() => readHandoffRecords());
  const [selectedHandoffId, setSelectedHandoffId] = useState<string>(() => readHandoffRecords()[0]?.id ?? "");
  const [handoffFromRole, setHandoffFromRole] = useState<StudioRoleId>("pm_planner");
  const [handoffToRole, setHandoffToRole] = useState<StudioRoleId>("client_programmer");
  const [handoffTaskId, setHandoffTaskId] = useState("TASK-001");
  const [handoffRequestText, setHandoffRequestText] = useState("");

  const selectedHandoff = useMemo(
    () => handoffRecords.find((row) => row.id === selectedHandoffId) ?? handoffRecords[0] ?? null,
    [handoffRecords, selectedHandoffId],
  );

  const handoffRoleOptions = useMemo(
    () => STUDIO_ROLE_TEMPLATES.map((role) => ({ value: role.id, label: role.label })),
    [],
  );

  const saveRows = (next: HandoffRecord[]) => {
    setHandoffRecords(next);
    void persistHandoffRecordsToWorkspace({ cwd: params.cwd, invokeFn: invoke, rows: next });
  };

  const createHandoff = () => {
    const request = handoffRequestText.trim();
    const taskId = handoffTaskId.trim();
    if (!request || !taskId) {
      return;
    }
    const id = createHandoffId();
    const next = upsertHandoffRecord({
      id,
      fromRole: handoffFromRole,
      toRole: handoffToRole,
      taskId,
      request,
      artifactPaths: [],
      status: "requested",
    });
    saveRows(next);
    setSelectedHandoffId(id);
    setHandoffRequestText("");
    params.publishAction({
      type: "handoff_create",
      payload: { handoffId: id },
    });
    params.setStatus(`핸드오프 등록: ${taskId}`);
  };

  const createAutoHandoff = (input: {
    runId: string;
    fromRole: StudioRoleId;
    toRole: StudioRoleId;
    taskId: string;
    request: string;
    artifactPaths?: string[];
  }) => {
    const taskId = String(input.taskId ?? "").trim();
    const request = String(input.request ?? "").trim();
    const runId = String(input.runId ?? "").trim();
    if (!taskId || !request || !runId) {
      return;
    }
    const id = createHandoffId();
    const next = upsertHandoffRecord({
      id,
      runId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      taskId,
      request,
      artifactPaths: Array.isArray(input.artifactPaths)
        ? input.artifactPaths.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
      status: "requested",
    });
    saveRows(next);
    setSelectedHandoffId(id);
    params.publishAction({
      type: "handoff_create",
      payload: { handoffId: id },
    });
    params.setStatus(`핸드오프 자동 생성: ${taskId} (${input.fromRole} → ${input.toRole})`);
  };

  const updateHandoffStatus = (status: HandoffRecord["status"], rejectReason?: string) => {
    if (!selectedHandoff) {
      return;
    }
    const next = upsertHandoffRecord({
      ...selectedHandoff,
      status,
      rejectReason: status === "rejected" ? (rejectReason ?? "요구사항 보완 필요") : undefined,
    });
    saveRows(next);
    params.setStatus(`핸드오프 상태 변경: ${selectedHandoff.taskId} (${status.toUpperCase()})`);
  };

  const consumeHandoff = () => {
    if (!selectedHandoff) {
      return;
    }
    params.onConsumeHandoff({
      handoffId: selectedHandoff.id,
      toRole: selectedHandoff.toRole,
      taskId: selectedHandoff.taskId,
      request: selectedHandoff.request,
    });
    params.setStatus(`핸드오프 컨텍스트 주입: ${selectedHandoff.taskId}`);
  };

  const clearHandoffsByRole = (roleId: StudioRoleId) => {
    const next = handoffRecords.filter((row) => row.fromRole !== roleId && row.toRole !== roleId);
    saveRows(next);
    setSelectedHandoffId(next[0]?.id ?? "");
    params.setStatus(`핸드오프 정리 완료: ${roleId.toUpperCase()}`);
  };

  return {
    createAutoHandoff,
    createHandoff,
    clearHandoffsByRole,
    consumeHandoff,
    handoffFromRole,
    handoffRecords,
    handoffRequestText,
    handoffRoleOptions,
    handoffTaskId,
    handoffToRole,
    selectedHandoff,
    selectedHandoffId,
    setHandoffFromRole,
    setHandoffRequestText,
    setHandoffTaskId,
    setHandoffToRole,
    setSelectedHandoffId,
    updateHandoffStatus,
  };
}
