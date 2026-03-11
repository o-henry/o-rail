import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PendingWebTurnModal from "./PendingWebTurnModal";

describe("PendingWebTurnModal", () => {
  it("renders preview modal inside the dedicated top layer", () => {
    const html = renderToStaticMarkup(
      <PendingWebTurnModal
        dragging={false}
        modeLabel="텍스트"
        nodeId="preview-node"
        onCancelRun={vi.fn()}
        onChangeResponseDraft={vi.fn()}
        onCopyPrompt={vi.fn()}
        onDismiss={vi.fn()}
        onDragStart={vi.fn()}
        onOpenProviderWindow={vi.fn()}
        onSubmit={vi.fn()}
        open
        panelRef={{ current: null }}
        position={{ x: 120, y: 96 }}
        preview
        prompt="미리보기"
        providerLabel="ChatGPT"
        responseDraft=""
      />,
    );

    expect(html).toContain("web-turn-modal-layer");
    expect(html).toContain("PREVIEW");
    expect(html).toContain("preview-node");
    expect(html).toContain("web-turn-close-button");
  });
});
