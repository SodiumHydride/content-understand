import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThinkingTextElement } from '../../lib/thinkingCanvas/types'

export function ThinkingCanvasText({
  element,
  editing,
  selected,
  dragging,
  draggable,
  clickToEdit,
  onStartEdit,
  onCommit,
  onCancel,
  onDragStart,
  onContextMenu
}: {
  element: ThinkingTextElement
  editing: boolean
  selected: boolean
  dragging: boolean
  draggable: boolean
  clickToEdit: boolean
  onStartEdit: () => void
  onCommit: (text: string) => void
  onCancel: () => void
  onDragStart: (e: React.PointerEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const skipBlurRef = useRef(false)
  const [localDraft, setLocalDraft] = useState(element.text)
  const grabbable = draggable && !editing && !clickToEdit
  const trimmed = element.text.trim()

  useEffect(() => {
    if (editing) setLocalDraft(element.text)
  }, [editing, element.text])

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing])

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <div
      className={clsx(
        'thinking-canvas-text',
        editing && 'thinking-canvas-text-editing',
        selected && 'thinking-canvas-text-selected',
        dragging && 'thinking-canvas-text-dragging',
        grabbable && 'thinking-canvas-text-grabbable',
        !trimmed && !editing && 'thinking-canvas-text-empty'
      )}
      style={{
        left: element.x,
        top: element.y,
        color: element.style.color,
        fontSize: element.style.fontSize,
        lineHeight: element.style.lineHeight
      }}
      onPointerDown={
        grabbable
          ? (e) => {
              if (e.button !== 0) return
              onDragStart(e)
            }
          : clickToEdit && !editing
            ? (e) => {
                e.stopPropagation()
                onStartEdit()
              }
            : undefined
      }
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) onStartEdit()
      }}
      onContextMenu={onContextMenu}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="thinking-canvas-text-input"
          value={localDraft}
          placeholder={t('map.textPlaceholder')}
          rows={1}
          style={{ color: element.style.color, fontSize: element.style.fontSize }}
          onChange={(e) => {
            setLocalDraft(e.target.value)
            autosize(e.target)
          }}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            onCommit(localDraft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              skipBlurRef.current = true
              onCancel()
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : trimmed ? (
        <p className="thinking-canvas-text-body">{element.text}</p>
      ) : (
        <p className="thinking-canvas-text-body thinking-canvas-text-placeholder">
          {t('map.textPlaceholder')}
        </p>
      )}
    </div>
  )
}
