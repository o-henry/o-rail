import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ApprovalModal from "./ApprovalModal";

describe("ApprovalModal", () => {
  it("renders as an overlay modal when open", () => {
    const html = renderToStaticMarkup(
      <ApprovalModal
        decisionLabel={(decision) => decision}
        decisions={["accept", "decline", "cancel"]}
        method="item/commandExecution/requestApproval"
        onRespond={vi.fn()}
        open
        params='{"command":"npm run test"}'
        requestId={7}
        sourceLabel="엔진"
        submitting={false}
      />,
    );

    expect(html).toContain("modal-backdrop");
    expect(html).toContain("approval-modal");
    expect(html).toContain("item/commandExecution/requestApproval");
    expect(html).toContain("npm run test");
  });
});
