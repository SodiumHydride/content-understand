import React, { useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'katex/dist/katex.min.css'
import { WikilinkText } from './WikilinkText'
import { CalloutIcon } from './CalloutIcon'

interface NoteMarkdownProps {
  body: string
  selectedVersionContent: string | null
  onNavigate: (slug: string) => void
}

type CodeProps = { className?: string; children?: React.ReactNode; node?: unknown }
type AnchorProps = { href?: string; children?: React.ReactNode; node?: unknown }
type BlockProps = { children?: React.ReactNode; node?: unknown }

function CodeBlock({ className, children }: CodeProps) {
  const match = /language-(\w+)/.exec(className || '')
  const codeString = String(children).replace(/\n$/, '')

  if (match) {
    return (
      <SyntaxHighlighter
        style={oneLight}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: '1em 0',
          borderRadius: '8px',
          fontSize: '0.85em',
          background: '#f8f6f1',
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    )
  }

  // Inline code
  return <code className={className}>{children}</code>
}

function useMarkdownComponents(onNavigate: (slug: string) => void) {
  const wrapText = useCallback((children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return <WikilinkText text={child} onNavigate={onNavigate} />
      }
      return child
    })
  }, [onNavigate])

  return useMemo(() => ({
    code: CodeBlock,
    a: ({ href, children, ...props }: AnchorProps) => {
      // External links: open in system browser, don't navigate the app
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              window.open(href, '_blank', 'noopener,noreferrer')
            }}
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        )
      }
      return <a href={href} {...props}>{children}</a>
    },
    p: ({ children, ...props }: BlockProps) => <p {...props}>{wrapText(children)}</p>,
    li: ({ children, ...props }: BlockProps) => <li {...props}>{wrapText(children)}</li>,
    td: ({ children, ...props }: BlockProps) => <td {...props}>{wrapText(children)}</td>,
    th: ({ children, ...props }: BlockProps) => <th {...props}>{wrapText(children)}</th>,
    blockquote: ({ children, ...props }: BlockProps) => {
      const firstChild = React.Children.toArray(children)[0] as React.ReactElement | undefined
      if (
        firstChild &&
        firstChild.type === 'p' &&
        firstChild.props
      ) {
        const firstChildProps = firstChild.props as { children?: React.ReactNode }
        if (firstChildProps.children) {
          const pChildren = React.Children.toArray(firstChildProps.children)
          const firstText = pChildren[0]
          if (typeof firstText === 'string' && firstText.trim().startsWith('[!')) {
            const match = firstText.match(/^\[!([A-Za-z0-9_-]+)\](.*)/)
            if (match) {
              const type = match[1].toLowerCase()
              const restOfFirstLine = match[2]
              const title = restOfFirstLine.trim()
              const remainingPChildren = pChildren.slice(1)
              return (
                <div className={`callout callout-${type} my-4 p-4 border-l-4 rounded-r-md`}>
                  <div className="callout-title font-semibold flex items-center gap-2 mb-2 text-sm capitalize">
                    <CalloutIcon type={type} />
                    <span>{title || type}</span>
                  </div>
                  <div className="callout-content text-sm leading-relaxed">
                    <p>{remainingPChildren}</p>
                    {React.Children.toArray(children).slice(1)}
                  </div>
                </div>
              )
            }
          }
        }
      }
      return <blockquote {...props}>{children}</blockquote>
    }
  }), [wrapText])
}

export const NoteMarkdown = React.memo(function NoteMarkdown({
  body,
  selectedVersionContent,
  onNavigate,
}: NoteMarkdownProps): React.JSX.Element {
  const markdownComponents = useMarkdownComponents(onNavigate)

  return (
    <div className="note-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
        {selectedVersionContent !== null ? selectedVersionContent : body}
      </ReactMarkdown>
    </div>
  )
})
