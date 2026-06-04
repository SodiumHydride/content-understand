import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LibraryItem } from '../stores/types'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../lib/contentMeta'
import { stickyRotation } from '../lib/stickyRotate'

function displayText(item: LibraryItem): { title: string; preview: string } {
  const body = item.body?.replace(/^#+\s*.+\n+/, '').trim() ?? ''
  const firstLine = body.split('\n').find((line) => line.trim()) ?? item.summary
  return {
    title: item.title,
    preview: firstLine || item.summary
  }
}

export function StickyNoteCard({
  item,
  left,
  top,
  selected,
  editing,
  draft = '',
  wrap = false,
  dragging = false,
  instant = false,
  onSelect,
  onDoubleClick,
  onCommitEdit,
  onCancelEdit,
  onDragStart,
  onContextMenu
}: {
  item: LibraryItem
  left: number
  top: number
  selected: boolean
  editing: boolean
  draft?: string
  wrap?: boolean
  dragging?: boolean
  instant?: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onCommitEdit: (text: string) => void
  onCancelEdit: () => void
  onDragStart?: (e: React.PointerEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const type = normalizeShelfType(String(item.type)) as ShelfType
  const style = TYPE_STYLES[type]
  const rot = stickyRotation(item.slug)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const skipBlurRef = useRef(false)
  const [localDraft, setLocalDraft] = useState(draft)
  const { title, preview } = displayText(item)
  const interactive = !editing && Boolean(onDragStart)

  useEffect(() => {
    if (editing) setLocalDraft(draft)
  }, [editing, draft])

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  return (
    <div
      className={clsx(
        'sticky-note',
        selected && 'sticky-note-selected',
        editing && 'sticky-note-editing',
        wrap && 'sticky-note-wrap',
        dragging && 'sticky-note-dragging',
        instant && 'sticky-note-instant',
        interactive && 'sticky-note-grabbable'
      )}
      style={
        {
          left,
          top,
          '--stick-rot': `${rot}deg`,
          '--stick-accent': style.accent,
          '--stick-soft': style.soft
        } as React.CSSProperties
      }
      onPointerDown={
        interactive && onDragStart
          ? (e) => {
              if (e.button !== 0) return
              onDragStart(e)
            }
          : undefined
      }
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
      onContextMenu={onContextMenu}
    >
      {!wrap && <span className="sticky-note-pin" aria-hidden />}

      {editing ? (
        <textarea
          ref={textareaRef}
          className="sticky-note-input"
          value={localDraft}
          placeholder={t('vault.writePlaceholder')}
          onChange={(e) => setLocalDraft(e.target.value)}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            onCommitEdit(localDraft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              skipBlurRef.current = true
              onCancelEdit()
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <h3 className="sticky-note-title">{title}</h3>
          {preview ? <p className="sticky-note-summary">{preview}</p> : null}
          {!wrap && (
            <span className="sticky-note-meta">
              {item.platform === 'self' ? t('vault.selfNote') : t(`nav.${type}`)}
            </span>
          )}
        </>
      )}
    </div>
  )
}
