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

  it("keeps the workflow composer usable even when Codex login is missing", () => {
    const html = renderToStaticMarkup(
      <WorkflowQuestionComposer
        attachedFiles={[]}
        canRunGraphNow={true}
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

    expect(html).toContain("질문 입력");
    expect(html).not.toContain("<textarea disabled");
  });
});
