import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeViewer } from '../chat/code-viewer'
export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content }: { content: string; variant?: string }) {
  return <div className="min-w-0 space-y-2 break-words text-sm leading-6"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    code: ({ className, children }) => {
      const value = String(children).replace(/\n$/, '')
      return value.includes('\n') ? <CodeViewer code={value} language={/language-(\w+)/.exec(className || '')?.[1]} maxLines={24} />
        : <code className="rounded bg-muted px-1 font-mono">{children}</code>
    },
    pre: ({ children }) => <>{children}</>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">{children}</a>,
    img: ({ alt }) => <span className="text-muted-foreground">[图片：{alt || '采集记录'}]</span>,
    table: ({ children }) => <div className="overflow-auto"><table className="w-full border-collapse text-left">{children}</table></div>,
    th: ({ children }) => <th className="border bg-muted px-2 py-1">{children}</th>,
    td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
    ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  }}>{content}</ReactMarkdown></div>
})
