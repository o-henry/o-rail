import { memo, useDeferredValue, useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type TasksThreadMessageContentProps = {
  content: string;
};

const TASKS_DEFERRED_MARKDOWN_CHAR_THRESHOLD = 6_000;
const TASKS_INLINE_PREVIEW_CHAR_THRESHOLD = 20_000;
const TASKS_INLINE_PREVIEW_CHAR_COUNT = 12_000;

export function shouldDeferTasksMarkdownRendering(content: string): boolean {
  return String(content ?? "").length >= TASKS_DEFERRED_MARKDOWN_CHAR_THRESHOLD;
}

export function shouldTruncateTasksMessageContent(content: string): boolean {
  return String(content ?? "").length >= TASKS_INLINE_PREVIEW_CHAR_THRESHOLD;
}

export function buildTasksMessageContentPreview(content: string): string {
  const normalized = String(content ?? "");
  if (!shouldTruncateTasksMessageContent(normalized)) {
    return normalized;
  }
  return `${normalized.slice(0, TASKS_INLINE_PREVIEW_CHAR_COUNT).trimEnd()}\n\n[긴 결과라 일부만 먼저 표시합니다.]`;
}

function renderLink(props: AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
  const href = String(props.href ?? "").trim();
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {props.children}
    </a>
  );
}

function TasksThreadMessageContentImpl(props: TasksThreadMessageContentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const content = String(props.content ?? "");
  const [expanded, setExpanded] = useState(false);
  const truncated = shouldTruncateTasksMessageContent(content);
  const displayContent = truncated && !expanded ? buildTasksMessageContentPreview(content) : content;
  const deferredContent = useDeferredValue(displayContent);
  const shouldDeferMarkdown = shouldDeferTasksMarkdownRendering(displayContent);
  const [renderMarkdown, setRenderMarkdown] = useState(() => !shouldDeferMarkdown);

  useEffect(() => {
    setExpanded(false);
  }, [content]);

  useEffect(() => {
    if (!shouldDeferMarkdown) {
      setRenderMarkdown(true);
      return;
    }
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      setRenderMarkdown(true);
      return;
    }
    setRenderMarkdown(false);
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRenderMarkdown(true);
        observer.disconnect();
      }
    }, {
      rootMargin: "320px 0px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [displayContent, shouldDeferMarkdown]);

  return (
    <div className="tasks-thread-message-markdown" ref={containerRef}>
      {renderMarkdown ? (
        <ReactMarkdown
          components={{
            a: renderLink,
            h1: ({ children }) => <h1>{children}</h1>,
            h2: ({ children }) => <h2>{children}</h2>,
            h3: ({ children }) => <h3>{children}</h3>,
            p: ({ children }) => <p>{children}</p>,
            ul: ({ children }) => <ul>{children}</ul>,
            ol: ({ children }) => <ol>{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            strong: ({ children }) => <strong>{children}</strong>,
            code: ({ children }) => <code>{children}</code>,
          }}
          remarkPlugins={[remarkGfm]}
          skipHtml
        >
          {deferredContent}
        </ReactMarkdown>
      ) : (
        <pre className="tasks-thread-message-markdown-fallback">{displayContent}</pre>
      )}
      {truncated && !expanded ? (
        <div className="tasks-thread-message-preview-controls">
          <span className="tasks-thread-message-preview-note">긴 결과라 전체 본문은 접어 두었습니다.</span>
          <button
            className="tasks-thread-message-preview-button"
            onClick={() => setExpanded(true)}
            type="button"
          >
            전체 결과 보기
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const TasksThreadMessageContent = memo(TasksThreadMessageContentImpl);
TasksThreadMessageContent.displayName = "TasksThreadMessageContent";
