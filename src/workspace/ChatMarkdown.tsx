import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 space-y-3 break-words [&_p]:whitespace-pre-wrap">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => (
            <h3 className="text-lg font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="text-base font-semibold">{children}</h4>
          ),
          h3: ({ children }) => <h5 className="font-semibold">{children}</h5>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs [&_code]:whitespace-pre">
              {children}
            </pre>
          ),
          code: ({ children, className }) => (
            <code
              className={`rounded bg-muted px-1 font-mono text-xs ${className ?? ''}`}
            >
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-left">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border px-2 py-1 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border px-2 py-1">{children}</td>
          ),
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {children}
              </a>
            );
          },
          // Avoid automatic third-party image requests from untrusted model output.
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
