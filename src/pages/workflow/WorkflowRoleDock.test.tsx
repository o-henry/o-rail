import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WorkflowRoleDock from "./WorkflowRoleDock";

describe("WorkflowRoleDock", () => {
  it("renders a remove button for each saved queued request", () => {
    const html = renderToStaticMarkup(
      <WorkflowRoleDock
        onChangePrompt={vi.fn()}
        onDeleteQueuedRequest={vi.fn()}
        onSaveRequest={vi.fn()}
        onSelectRoleId={vi.fn()}
        prompt=""
        queuedRequests={["첫 줄\n둘째 줄", "다른 요청"]}
        requestTargetCount={2}
        roleId="pm_planner"
        roleStatusById={{}}
        saveDisabled={false}
      />,
    );

    expect(html).toContain("저장된 추가 요청 삭제: 첫 줄");
    expect(html).toContain("저장된 추가 요청 삭제: 다른 요청");
    expect(html).toContain("첫 줄\n둘째 줄");
  });
});
