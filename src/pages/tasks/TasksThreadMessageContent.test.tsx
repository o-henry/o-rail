import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TasksThreadMessageContent } from "./TasksThreadMessageContent";

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
});
