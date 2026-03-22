import { memo, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type TasksThreadMessageContentProps = {
  content: string;
};

function renderLink(props: AnchorHTMLAttributes<HTMLAnchorElement>): ReactNode {
  const href = String(props.href ?? "").trim();
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {props.children}
    </a>
  );
}

export const TasksThreadMessageContent = memo(function TasksThreadMessageContent(props: TasksThreadMessageContentProps) {
  return (
    <div className="tasks-thread-message-markdown">
      <ReactMarkdown
        components={{
          a: renderLink,
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h3>{children}</h3>,
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
        {String(props.content ?? "")}
      </ReactMarkdown>
    </div>
  );
});
