import React from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Download, Edit3, ExternalLink, FolderOpen, History, Link, Pencil, Pin, Trash2, X } from 'lucide-react'
import type { LibraryItem } from '../../stores/types'

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved'

interface NoteToolbarProps {
  detail: LibraryItem | null
  editMode: boolean
  drawMode: boolean
  historyMode: boolean
  saving: boolean
  autoSaveStatus: AutoSaveStatus
  accent: string
  isPinned: boolean
  onDismiss: () => void
  onPin: () => void
  onOpenFolder: () => void
  onExport: () => void
  onCopyWikilink: () => void
  onDelete: () => void
  onHistoryToggle: () => void
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onDrawToggle: () => void
}

export const NoteToolbar = React.memo(function NoteToolbar({
  detail,
  editMode,
  drawMode,
  historyMode,
  saving,
  autoSaveStatus,
  accent,
  isPinned,
  onDismiss,
  onPin,
  onOpenFolder,
  onExport,
  onCopyWikilink,
  onDelete,
  onHistoryToggle,
  onEdit,
  onCancel,
  onSave,
  onDrawToggle,
}: NoteToolbarProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="note-preview-toolbar">
      <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
        {detail ? (
          <div className="min-w-0">
            <h2 className="note-toolbar-title" title={detail.title}>{detail.title}</h2>
            <p className="note-toolbar-meta">
              <span style={{ color: accent }}>{detail.platform}</span>
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
          onClick={onDismiss}
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
            onClick={onPin}
            className={clsx('btn-ghost', isPinned && 'btn-ghost-active')}
          >
            <Pin size={13} />
            {isPinned ? t('preview.unpin') : t('preview.pin')}
          </button>
          <button
            type="button"
            onClick={onOpenFolder}
            className="btn-ghost"
          >
            <FolderOpen size={13} />
            {t('preview.openFolder')}
          </button>
          <button
            type="button"
            onClick={onExport}
            className="btn-ghost"
          >
            <Download size={13} />
            {t('preview.exportMd')}
          </button>
          <button
            type="button"
            onClick={onCopyWikilink}
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
            onClick={onDelete}
            className="btn-ghost"
            title={t('note.delete')}
          >
            <Trash2 size={13} />
            {t('note.delete')}
          </button>
          {editMode ? (
            <>
              <span
                className={clsx(
                  'text-[10px] flex items-center gap-1 select-none shrink-0',
                  autoSaveStatus === 'saving' && 'text-[var(--color-ink-500)]',
                  autoSaveStatus === 'saved' && 'text-[#7eb89a]',
                  autoSaveStatus === 'error' && 'text-[var(--color-danger)]',
                  autoSaveStatus === 'unsaved' && 'text-[var(--color-ink-400)]',
                  autoSaveStatus === 'idle' && 'text-[var(--color-ink-300)]'
                )}
                aria-live="polite"
              >
                {autoSaveStatus === 'saving' && (
                  <><span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-ink-500)] animate-pulse" /> {t('note.saving')}</>
                )}
                {autoSaveStatus === 'saved' && (
                  <><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#7eb89a]" /> {t('note.saved')}</>
                )}
                {autoSaveStatus === 'error' && (
                  <><span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-danger)]" /> {t('note.saveFailed')}</>
                )}
                {autoSaveStatus === 'unsaved' && (
                  <><span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-ink-400)]" /> {t('note.unsaved')}</>
                )}
              </span>
              <button type="button" className="btn-ghost" onClick={onCancel} title={t('note.cancel')}>
                <X size={14} />
              </button>
              <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
                {saving ? t('note.saving') : t('note.save')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={clsx('btn-ghost', historyMode && 'btn-active')}
                onClick={onHistoryToggle}
                title={t('note.historyTitle')}
              >
                <History size={14} />
              </button>
              <button type="button" className="btn-ghost" onClick={onEdit} title={t('note.edit') + ' (⌘E)'}>
                <Edit3 size={14} />
              </button>
              <button
                type="button"
                className={clsx('btn-ghost', drawMode && 'btn-active')}
                onClick={onDrawToggle}
                title={t('note.draw') + ' (⌘D)'}
              >
                <Pencil size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
})
