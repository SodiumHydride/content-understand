import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, FolderOpen, Pin, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { fetchPage } from '../lib/sidecar'
import {
  normalizeShelfType,
  platformLabel,
  TYPE_STYLES
} from '../lib/contentMeta'
import type { LibraryItem } from '../stores/types'

export function NotePreview(): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const library = useAppStore((s) => s.library)
  const settings = useAppStore((s) => s.settings)
  const selectItem = useAppStore((s) => s.selectItem)
  const togglePin = useAppStore((s) => s.togglePin)
  const isPinned = useAppStore((s) => s.isPinned)

  const [detail, setDetail] = useState<LibraryItem | null>(null)

  useEffect(() => {
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
      setDetail(page ?? local ?? null)
    })
  }, [selectedSlug, library])

  if (!selectedSlug) return null

  const type = detail ? normalizeShelfType(String(detail.type)) : 'article'
  const accent = TYPE_STYLES[type].accent

  return (
    <aside className="note-preview-pane no-drag">
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
            onClick={() => selectItem(null)}
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
                const full = settings.vaultPath
                  ? `${settings.vaultPath}/${detail.path}`
                  : detail.path
                void window.api.showItemInFolder(full)
              }}
              className="btn-ghost"
            >
              <FolderOpen size={13} />
              {t('preview.openFolder')}
            </button>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noreferrer" className="btn-ghost">
                <ExternalLink size={13} />
                {t('preview.source')}
              </a>
            )}
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {detail.body || detail.summary}
              </ReactMarkdown>
            </div>
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
}
