import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildTasksMessageContentPreview,
  shouldDeferTasksMarkdownRendering,
  shouldTruncateTasksMessageContent,
  TasksThreadMessageContent,
} from "./TasksThreadMessageContent";

describe("TasksThreadMessageContent", () => {
  it("renders headings, list items, and links as markdown", () => {
    const html = renderToStaticMarkup(
      <TasksThreadMessageContent
        content={`## 조사 결론\n- 인기 장르는 **슈터** 입니다.\n- 자세한 근거는 [Steam Stats](https://store.steampowered.com/stats/stats/)를 봅니다.`}
      />,
    );

    expect(html).toContain("<h2>조사 결론</h2>");
    expect(html).toContain("<li>인기 장르는 <strong>슈터</strong> 입니다.</li>");
    expect(html).toContain('href="https://store.steampowered.com/stats/stats/"');
  });

  it("only defers markdown rendering for very large documents", () => {
    expect(shouldDeferTasksMarkdownRendering("짧은 문서")).toBe(false);
    expect(shouldDeferTasksMarkdownRendering("a".repeat(6_000))).toBe(true);
  });

  it("collapses extremely large task results behind a preview by default", () => {
    const content = `${"아이디어 본문\n".repeat(2_500)}마지막 꼬리`;

    expect(shouldTruncateTasksMessageContent(content)).toBe(true);
    expect(buildTasksMessageContentPreview(content)).not.toContain("마지막 꼬리");

    const html = renderToStaticMarkup(
      <TasksThreadMessageContent content={content} />,
    );

    expect(html).toContain("긴 결과라 전체 본문은 접어 두었습니다.");
    expect(html).toContain("전체 결과 보기");
    expect(html).not.toContain("마지막 꼬리");
  });
});
