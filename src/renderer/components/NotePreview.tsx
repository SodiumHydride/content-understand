import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, FolderOpen, Link, Pin, Trash2, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { fetchPage, fetchBacklinks } from '../lib/sidecar'
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
      p: ({ children, ...props }: any) => <p {...props}>{wrapText(children)}</p>,
      li: ({ children, ...props }: any) => <li {...props}>{wrapText(children)}</li>,
      td: ({ children, ...props }: any) => <td {...props}>{wrapText(children)}</td>,
      th: ({ children, ...props }: any) => <th {...props}>{wrapText(children)}</th>,
    }
  }, [selectItem])

  const [detail, setDetail] = useState<LibraryItem | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!selectedSlug) {
      setDetail(null)
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
              <h2 className="note-toolbar-title">{detail.title}</h2>
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
          </div>
        )}
      </div>

      <div className="note-reader-scroll">
        {!detail ? (
          <p className="note-reader-loading">{t('preview.loading')}</p>
        ) : (
          <article className="note-reader-column">
            {detail.summary && <p className="note-reader-lead">{detail.summary}</p>}
            <div className="note-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {detail.body || detail.summary}
              </ReactMarkdown>
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
          <div>{detail.path}</div>
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
