import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-white font-black text-base mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-white font-bold text-sm mb-1.5 mt-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-slate font-bold text-sm mb-1 mt-2 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-slate text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-white font-bold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic opacity-80">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="space-y-1 mb-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="space-y-1 mb-2 list-decimal list-inside">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="flex gap-2 text-slate text-sm">
      <span className="text-teal shrink-0 mt-0.5">·</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  code: ({ children }) => (
    <code className="bg-surface px-1 py-0.5 rounded text-teal text-xs font-mono">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-teal/40 pl-3 my-2 italic opacity-70">{children}</blockquote>
  ),
  hr: () => <hr className="border-surface my-3" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-teal underline underline-offset-2 hover:text-teal-dark transition-colors">
      {children}
    </a>
  ),
}

export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  )
}
