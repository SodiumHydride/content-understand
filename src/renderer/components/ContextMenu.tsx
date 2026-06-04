import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ContextMenuEntry =
  | {
      kind: 'item'
      label: string
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      onSelect: () => void
    }
  | { kind: 'separator' }
  | { kind: 'label'; label: string }

type ContextMenuProps = {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const pad = 10
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - pad),
      y: Math.min(y, window.innerHeight - rect.height - pad)
    })
  }, [x, y, items])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu animate-context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <div key={`sep-${i}`} className="context-menu-sep" role="separator" />
        }
        if (entry.kind === 'label') {
          return (
            <div key={`label-${i}`} className="context-menu-label">
              {entry.label}
            </div>
          )
        }
        return (
          <button
            key={`item-${entry.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className={entry.danger ? 'context-menu-item context-menu-item-danger' : 'context-menu-item'}
            onClick={() => {
              if (entry.disabled) return
              entry.onSelect()
              onClose()
            }}
          >
            <span className="context-menu-item-label">{entry.label}</span>
            {entry.shortcut ? <span className="context-menu-shortcut">{entry.shortcut}</span> : null}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
