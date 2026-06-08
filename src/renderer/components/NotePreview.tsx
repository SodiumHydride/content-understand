import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'katex/dist/katex.min.css'
import MDEditor from '@uiw/react-md-editor'
import { useQuery } from '@tanstack/react-query'
import { Download, Edit3, Eraser, ExternalLink, FolderOpen, Highlighter, Link, Pencil, Pin, Trash2, X } from 'lucide-react'
import { NoteInkLayer } from './NoteInkLayer'
import type { StrokeStyle } from '../lib/thinkingCanvas/types'
import { useAppStore } from '../stores/appStore'
import { fetchPage, fetchBacklinks, savePage } from '../lib/sidecar'
import { splitTextWithWikilinks, resolveWikilinkTarget } from '../lib/wikilink'
import {
  normalizeShelfType,
  platformLabel,
  TYPE_STYLES
} from '../lib/contentMeta'
import type { ReaderPresentation } from '../lib/readerPresentation'
import { getReaderPresentation } from '../lib/readerPresentation'
import { notify } from '../lib/notify'
import type { LibraryItem } from '../stores/types'

function WikilinkText({ text, onNavigate }: { text: string; onNavigate: (slug: string) => void }) {
  const library = useAppStore((s) => s.library)
  const segments = splitTextWithWikilinks(text)
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') return seg.value
        const slug = resolveWikilinkTarget(seg.target, library)
        if (slug) {
          return (
            <span
              key={i}
              className="wikilink"
              onClick={(e) => { e.stopPropagation(); onNavigate(slug) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(slug) } }}
              role="link"
              tabIndex={0}
            >
              {seg.display}
            </span>
          )
        }
        return (
          <span key={i} className="wikilink wikilink-broken" title={`Not found: ${seg.target}`}>
            {seg.display}
          </span>
        )
      })}
    </>
  )
}

export function NotePreview({
  presentation = 'sidebar'
}: {
  presentation?: ReaderPresentation
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const library = useAppStore((s) => s.library)
  const settings = useAppStore((s) => s.settings)
  const typography = useAppStore((s) => s.typography)
  const viewMode = useAppStore((s) => s.viewMode)
  const mapMode = useAppStore((s) => s.mapMode)
  const selectItem = useAppStore((s) => s.selectItem)
  const closeReader = useAppStore((s) => s.closeReader)
  const togglePin = useAppStore((s) => s.togglePin)
  const isPinned = useAppStore((s) => s.isPinned)
  const deletePage = useAppStore((s) => s.deletePage)

  const { data: backlinksData } = useQuery({
    queryKey: ['backlinks', selectedSlug],
    queryFn: () => fetchBacklinks(selectedSlug!),
    enabled: !!selectedSlug,
  })
  const backlinks = backlinksData ?? []

  const CodeBlock = useCallback(({ className, children, ...props }: any) => {
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
    return <code className={className} {...props}>{children}</code>
  }, [])

  const markdownComponents = useMemo(() => {
    const wrapText = (children: React.ReactNode): React.ReactNode => {
      return React.Children.map(children, (child) => {
        if (typeof child === 'string') {
          return <WikilinkText text={child} onNavigate={(slug) => selectItem(slug, { reader: true })} />
        }
        return child
      })
    }

    return {
      code: CodeBlock,
      a: ({ href, children, ...props }: any) => {
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
      p: ({ children, ...props }: any) => <p {...props}>{wrapText(children)}</p>,
      li: ({ children, ...props }: any) => <li {...props}>{wrapText(children)}</li>,
      td: ({ children, ...props }: any) => <td {...props}>{wrapText(children)}</td>,
      th: ({ children, ...props }: any) => <th {...props}>{wrapText(children)}</th>,
    }
  }, [selectItem, CodeBlock])

  const [detail, setDetail] = useState<LibraryItem | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [inkTool, setInkTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen')
  const [penColor, setPenColor] = useState('#1a1a1a')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Apply typography CSS variables to .note-markdown
  useEffect(() => {
    const el = document.querySelector('.note-markdown')
    if (!el) return
    const fontMap: Record<string, string> = {
      serif: 'var(--font-serif)',
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)'
    }
    ;(el as HTMLElement).style.setProperty('--reading-font', fontMap[typography.fontFamily])
    ;(el as HTMLElement).style.setProperty('--reading-size', `${typography.fontSize}px`)
    ;(el as HTMLElement).style.setProperty('--reading-leading', String(typography.lineHeight))
  }, [typography])

  const penStyle: StrokeStyle = useMemo(() => ({
    color: penColor,
    width: 2.5,
    opacity: 1,
    variant: 'pen'
  }), [penColor])

  const highlighterStyle: StrokeStyle = useMemo(() => ({
    color: '#fde68a',
    width: 16,
    opacity: 0.45,
    variant: 'highlighter'
  }), [])

  useEffect(() => {
    let cancelled = false
    if (!selectedSlug) {
      setDetail(null)
      setDrawMode(false)
      return
    }
    const local = library.find((i) => i.slug === selectedSlug)
    if (local?.body) {
      setDetail(local)
      return
    }
    void fetchPage(selectedSlug).then((page) => {
      if (!cancelled) setDetail(page ?? local ?? null)
    })
    return () => { cancelled = true }
  }, [selectedSlug, library])

  const dismissReader = (): void => {
    const mode = getReaderPresentation(viewMode, mapMode)
    if (mode === 'center' || mode === 'overlay') closeReader()
    else selectItem(null)
  }

  const startEdit = useCallback(() => {
    if (!detail?.body) return
    setDrawMode(false)
    setEditBody(detail.body)
    setEditMode(true)
  }, [detail?.body])

  const cancelEdit = useCallback(() => {
    setEditMode(false)
    setEditBody('')
  }, [])

  const handleSave = useCallback(async () => {
    if (!detail?.slug) return
    setSaving(true)
    try {
      const ok = await savePage(detail.slug, editBody)
      if (ok) {
        setDetail((prev) => (prev ? { ...prev, body: editBody } : prev))
        setEditMode(false)
        notify(t('note.saved'), { type: 'success' })
      } else {
        notify(t('note.saveFailed'), { type: 'error' })
      }
    } finally {
      setSaving(false)
    }
  }, [detail?.slug, editBody, t])

  useEffect(() => {
    if ((presentation !== 'center' && presentation !== 'overlay') || !selectedSlug) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeReader()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presentation, selectedSlug, closeReader])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault()
        if (editMode) cancelEdit()
        else startEdit()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        setDrawMode(prev => !prev)
      }
      if (editMode && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editMode, startEdit, cancelEdit, handleSave, drawMode])

  // Focus trap for center/overlay presentations
  useEffect(() => {
    if ((presentation !== 'center' && presentation !== 'overlay') || !selectedSlug) return
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const dialog = presentation === 'center'
        ? document.querySelector('.note-reader-overlay-panel')
        : document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!dialog) return
      const elements = (Array.from(dialog.querySelectorAll(FOCUSABLE)) as HTMLElement[])
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (elements.length === 0) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    // Focus the first element after portal renders
    const timer = setTimeout(() => {
      const dialog = presentation === 'center'
        ? document.querySelector('.note-reader-overlay-panel')
        : document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!dialog) return
      const elements = (Array.from(dialog.querySelectorAll(FOCUSABLE)) as HTMLElement[])
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (elements.length > 0) elements[0].focus()
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', handler)
    }
  }, [presentation, selectedSlug])

  if (!selectedSlug) return null

  const type = detail ? normalizeShelfType(String(detail.type)) : 'article'
  const accent = TYPE_STYLES[type].accent

  const pane = (
    <aside
      className={clsx(
        'note-preview-pane no-drag',
        presentation === 'center' && 'note-preview-pane-center',
        presentation === 'overlay' && 'note-preview-pane-overlay'
      )}
    >
      <div className="note-preview-toolbar">
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          {detail ? (
            <div className="min-w-0">
              <h2 className="note-toolbar-title" title={detail.title}>{detail.title}</h2>
              <p className="note-toolbar-meta">
                <span style={{ color: accent }}>{platformLabel(detail.platform)}</span>
                {detail.tags.length > 0 && (
                  <>
                    <span aria-hidden> · </span>
                    {detail.tags.slice(0, 2).join(' · ')}
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="h-5 w-2/3 animate-pulse rounded bg-paper-deep" />
          )}
          <button
            type="button"
            onClick={dismissReader}
            className="btn-ghost shrink-0 p-1"
            aria-label={t('preview.close')}
          >
            <X size={16} />
          </button>
        </div>
        {detail && (
          <div className="note-toolbar-actions">
            <button
              type="button"
              onClick={() => togglePin(detail.slug)}
              className={clsx('btn-ghost', isPinned(detail.slug) && 'btn-ghost-active')}
            >
              <Pin size={13} />
              {isPinned(detail.slug) ? t('preview.unpin') : t('preview.pin')}
            </button>
            <button
              type="button"
              onClick={() => {
                // Normalize path separators for cross-platform (Windows backslash)
                const sep = settings.vaultPath?.includes('\\') ? '\\' : '/'
                const normalizedPath = detail.path.replace(/[/\\]/g, sep)
                const full = settings.vaultPath
                  ? `${settings.vaultPath}${sep}${normalizedPath}`
                  : detail.path
                void window.api.showItemInFolder(full)
              }}
              className="btn-ghost"
            >
              <FolderOpen size={13} />
              {t('preview.openFolder')}
            </button>
            <button
              type="button"
              onClick={() => void window.api.exportNote(detail.path)}
              className="btn-ghost"
            >
              <Download size={13} />
              {t('preview.exportMd')}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(`[[${detail.title}]]`)
                notify(t('note.wikilinkCopied', { title: detail.title }), { type: 'success', duration: 2000 })
              }}
              className="btn-ghost"
              title={t('note.copyWikilink')}
            >
              <Link size={13} />
              {t('note.copyWikilink')}
            </button>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noreferrer" className="btn-ghost">
                <ExternalLink size={13} />
                {t('preview.source')}
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('note.deleteConfirm'))) {
                  void deletePage(detail.slug).then((ok) => {
                    if (ok) {
                      notify(t('note.deleted'), { type: 'success', duration: 2000 })
                      dismissReader()
                    }
                  })
                }
              }}
              className="btn-ghost"
              title={t('note.delete')}
            >
              <Trash2 size={13} />
              {t('note.delete')}
            </button>
            {editMode ? (
              <>
                <button type="button" className="btn-ghost" onClick={cancelEdit} title={t('note.cancel')}>
                  <X size={14} />
                </button>
                <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? t('note.saving') : t('note.save')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-ghost" onClick={startEdit} title={t('note.edit') + ' (⌘E)'}>
                  <Edit3 size={14} />
                </button>
                <button
                  type="button"
                  className={clsx('btn-ghost', drawMode && 'btn-active')}
                  onClick={() => setDrawMode(!drawMode)}
                  title={t('note.draw') + ' (⌘D)'}
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="note-reader-scroll" ref={scrollRef}>
        {drawMode && !editMode && (
          <div className="ink-toolbar">
            <button
              type="button"
              className={clsx('ink-tool-btn', inkTool === 'pen' && 'ink-tool-active')}
              onClick={() => setInkTool('pen')}
              title="Pen"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className={clsx('ink-tool-btn', inkTool === 'highlighter' && 'ink-tool-active')}
              onClick={() => setInkTool('highlighter')}
              title="Highlighter"
            >
              <Highlighter size={14} />
            </button>
            <button
              type="button"
              className={clsx('ink-tool-btn', inkTool === 'eraser' && 'ink-tool-active')}
              onClick={() => setInkTool('eraser')}
              title="Eraser"
            >
              <Eraser size={14} />
            </button>
            <div className="ink-color-palette">
              {['#1a1a1a', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6'].map(c => (
                <button
                  key={c}
                  type="button"
                  className={clsx('ink-color-btn', penColor === c && 'ink-color-active')}
                  style={{ background: c }}
                  onClick={() => setPenColor(c)}
                />
              ))}
            </div>
          </div>
        )}
        <NoteInkLayer
          slug={detail?.slug ?? ''}
          scrollRef={scrollRef}
          active={drawMode && !editMode}
          tool={inkTool}
          penStyle={penStyle}
          highlighterStyle={highlighterStyle}
          eraserWidth={20}
        />
        {!detail ? (
          <p className="note-reader-loading">{t('preview.loading')}</p>
        ) : (
          <article className="note-reader-column">
            {detail.summary && <p className="note-reader-lead">{detail.summary}</p>}
            <div className="note-markdown">
              {editMode ? (
                <div data-color-mode="light" className="note-editor">
                  <MDEditor
                    value={editBody}
                    onChange={(val) => setEditBody(val ?? '')}
                    height="100%"
                    preview="live"
                    visibleDragbar={false}
                  />
                </div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                  {detail.body || detail.summary}
                </ReactMarkdown>
              )}
            </div>
            {backlinks.length > 0 && (
              <div className="backlinks-section">
                <h3 className="backlinks-heading">
                  {t('note.backlinks')} ({backlinks.length})
                </h3>
                <ul className="backlinks-list">
                  {backlinks.map((bl) => (
                    <li key={bl.slug} className="backlinks-item" onClick={() => selectItem(bl.slug, { reader: true })}>
                      <span className="backlinks-title">{bl.title}</span>
                      {bl.context && <span className="backlinks-context">{bl.context}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}
      </div>

      {detail && (
        <footer className="note-footer">
          <p className="note-footer-text">
            {detail.path.split('/').slice(0, -1).join(' / ') || detail.type}
          </p>
        </footer>
      )}
    </aside>
  )

  if (presentation === 'center') {
    return createPortal(
      <div
        className="note-reader-overlay no-drag"
        role="presentation"
        onClick={() => closeReader()}
      >
        <div
          className="note-reader-overlay-panel"
          role="dialog"
          aria-modal="true"
          aria-label={detail?.title ?? t('preview.reading')}
          onClick={(e) => e.stopPropagation()}
        >
          {pane}
        </div>
      </div>,
      document.body
    )
  }

  if (presentation === 'overlay') {
    return createPortal(
      <div className="note-reader-drawer-layer no-drag" role="presentation">
        <button
          type="button"
          className="note-reader-drawer-scrim"
          aria-label={t('preview.close')}
          onClick={() => closeReader()}
        />
        <div role="dialog" aria-modal="true" aria-label={detail?.title ?? t('preview.reading')}>
          {pane}
        </div>
      </div>,
      document.body
    )
  }

  return pane
}
