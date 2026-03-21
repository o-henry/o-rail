import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WorkflowQuestionComposer from "./WorkflowQuestionComposer";

describe("WorkflowQuestionComposer", () => {
  it("renders attached graph files with remove buttons", () => {
    const html = renderToStaticMarkup(
      <WorkflowQuestionComposer
        attachedFiles={[
          {
            id: "file-1",
            name: "guide.md",
            path: "/tmp/guide.md",
            ext: ".md",
            enabled: true,
          },
        ]}
        canRunGraphNow={true}
        codexAuthCheckPending={false}
        codexLoginLocked={false}
        isWorkflowBusy={false}
        onApplyModelSelection={vi.fn()}
        onOpenKnowledgeFilePicker={vi.fn()}
        onRemoveKnowledgeFile={vi.fn()}
        onRunGraph={vi.fn(async () => {})}
        questionInputRef={createRef<HTMLTextAreaElement>()}
        setWorkflowQuestion={vi.fn()}
        workflowQuestion=""
      />,
    );

    expect(html).toContain("guide.md");
    expect(html).toContain("agents-file-chip-remove");
    expect(html).toContain("guide.md 삭제");
  });

  it("shows a login-required placeholder when Codex login is blocked", () => {
    const html = renderToStaticMarkup(
      <WorkflowQuestionComposer
        attachedFiles={[]}
        canRunGraphNow={false}
        codexAuthCheckPending={false}
        codexLoginLocked
        isWorkflowBusy={false}
        onApplyModelSelection={vi.fn()}
        onOpenKnowledgeFilePicker={vi.fn()}
        onRemoveKnowledgeFile={vi.fn()}
        onRunGraph={vi.fn(async () => {})}
        questionInputRef={createRef<HTMLTextAreaElement>()}
        setWorkflowQuestion={vi.fn()}
        workflowQuestion=""
      />,
    );

    expect(html).toContain("Codex 로그인 후 그래프를 실행할 수 있습니다.");
    expect(html).toContain("disabled");
  });
});
