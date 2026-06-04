import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { LibraryItem } from '../stores/types'
import {
  VAULT_NOTE_H,
  VAULT_NOTE_W,
  getVaultWrapSlices,
  mergeVaultLayout,
  wrapVaultPos
} from '../lib/vaultBoard'
import { StickyNoteCard } from './StickyNoteCard'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'

type MenuState = {
  x: number
  y: number
  boardX: number
  boardY: number
  target: 'board' | 'note'
  slug?: string
}

type DragState = {
  slug: string
  startX: number
  startY: number
  originX: number
  originY: number
  rawX: number
  rawY: number
}

const DRAG_THRESHOLD = 5

function pinnedItems(library: LibraryItem[], pinnedSlugs: string[]): LibraryItem[] {
  const bySlug = new Map(library.map((item) => [item.slug, item]))
  return pinnedSlugs.flatMap((slug) => {
    const item = bySlug.get(slug)
    return item ? [item] : []
  })
}

function notePlainBody(body: string | undefined): string {
  if (!body) return ''
  return body.replace(/^#+\s*.+\n+/, '').trimStart()
}

function bodyFromPlain(title: string, plain: string): string {
  const text = plain.trim()
  if (!text) return ''
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const heading = firstLine || title
  const rest = text.includes('\n') ? text.slice(text.indexOf('\n') + 1).trimStart() : ''
  return rest ? `# ${heading}\n\n${rest}` : `# ${heading}\n\n`
}

export function VaultView(): React.JSX.Element {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const pinnedSlugs = useAppStore((s) => s.pinnedSlugs)
  const vaultLayout = useAppStore((s) => s.vaultLayout)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const createNote = useAppStore((s) => s.createNote)
  const pinNote = useAppStore((s) => s.pinNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const setVaultNodePos = useAppStore((s) => s.setVaultNodePos)
  const updateNote = useAppStore((s) => s.updateNote)

  const boardRef = useRef<HTMLDivElement>(null)
  const clickTimerRef = useRef<number | null>(null)
  const [boardSize, setBoardSize] = useState({ w: 800, h: 520 })
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [instantSlug, setInstantSlug] = useState<string | null>(null)
  const movedRef = useRef(false)

  const pinned = useMemo(() => pinnedItems(library, pinnedSlugs), [library, pinnedSlugs])
  const slugs = useMemo(() => pinned.map((item) => item.slug), [pinned])
  const layout = useMemo(
    () => mergeVaultLayout(slugs, vaultLayout, boardSize.w, boardSize.h),
    [slugs, vaultLayout, boardSize.w, boardSize.h]
  )

  const unpinned = useMemo(
    () => library.filter((item) => !pinnedSlugs.includes(item.slug)),
    [library, pinnedSlugs]
  )

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = () => {
      setBoardSize({ w: el.clientWidth, h: el.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (boardSize.w < VAULT_NOTE_W || boardSize.h < VAULT_NOTE_H) return
    const savedLayout = useAppStore.getState().vaultLayout
    for (const slug of slugs) {
      const saved = savedLayout[slug]
      if (!saved) continue
      const wrapped = wrapVaultPos(saved.x, saved.y, boardSize.w, boardSize.h)
      if (wrapped.x !== saved.x || wrapped.y !== saved.y) {
        setVaultNodePos(slug, wrapped)
      }
    }
  }, [boardSize.w, boardSize.h, slugs, setVaultNodePos])

  const clientToBoard = useCallback(
    (clientX: number, clientY: number) => {
      const board = boardRef.current
      if (!board) return wrapVaultPos(120, 120, boardSize.w, boardSize.h)
      const rect = board.getBoundingClientRect()
      const raw = {
        x: clientX - rect.left - VAULT_NOTE_W / 2,
        y: clientY - rect.top - VAULT_NOTE_H / 2
      }
      return wrapVaultPos(raw.x, raw.y, boardSize.w, boardSize.h)
    },
    [boardSize.w, boardSize.h]
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  const spawnSticky = useCallback(
    (boardX: number, boardY: number, edit = true) => {
      const pos = wrapVaultPos(boardX, boardY, boardSize.w, boardSize.h)
      const slug = createNote({
        pin: true,
        viewMode: 'vault',
        pos
      })
      selectItem(slug)
      if (edit) setEditingSlug(slug)
    },
    [createNote, selectItem, boardSize.w, boardSize.h]
  )

  const clearPendingClick = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
  }, [])

  const onBoardPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.sticky-note')) return
    if (e.button !== 0) return
    clearPendingClick()
    clickTimerRef.current = window.setTimeout(() => {
      selectItem(null)
      setEditingSlug(null)
      clickTimerRef.current = null
    }, 240)
  }

  const onBoardDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sticky-note')) return
    clearPendingClick()
    const pos = clientToBoard(e.clientX, e.clientY)
    spawnSticky(pos.x, pos.y, true)
  }

  const openBoardMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    clearPendingClick()
    const pos = clientToBoard(e.clientX, e.clientY)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      boardX: pos.x,
      boardY: pos.y,
      target: 'board'
    })
  }

  const openNoteMenu = (e: React.MouseEvent, slug: string) => {
    e.preventDefault()
    e.stopPropagation()
    clearPendingClick()
    const pos = clientToBoard(e.clientX, e.clientY)
    selectItem(slug)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      boardX: pos.x,
      boardY: pos.y,
      target: 'note',
      slug
    })
  }

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      movedRef.current = true
      setDrag({
        ...drag,
        rawX: drag.originX + dx,
        rawY: drag.originY + dy
      })
    },
    [drag]
  )

  const endDrag = useCallback(() => {
    if (drag && movedRef.current) {
      const pos = wrapVaultPos(drag.rawX, drag.rawY, boardSize.w, boardSize.h)
      setVaultNodePos(drag.slug, pos)
      setInstantSlug(drag.slug)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setInstantSlug(null))
      })
    }
    setDrag(null)
    window.setTimeout(() => {
      movedRef.current = false
    }, 0)
  }, [drag, boardSize.w, boardSize.h, setVaultNodePos])

  const startDrag = (e: React.PointerEvent, slug: string, x: number, y: number) => {
    if (editingSlug === slug) return
    e.preventDefault()
    e.stopPropagation()
    clearPendingClick()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    movedRef.current = false
    setDrag({
      slug,
      startX: e.clientX,
      startY: e.clientY,
      originX: x,
      originY: y,
      rawX: x,
      rawY: y
    })
    selectItem(slug)
  }

  const onNoteClick = (slug: string) => {
    if (movedRef.current) return
    clearPendingClick()
    selectItem(slug)
  }

  const onNoteDoubleClick = (slug: string, item: LibraryItem) => {
    clearPendingClick()
    if (item.platform !== 'self') return
    selectItem(slug)
    setEditingSlug(slug)
  }

  const commitEdit = (slug: string, draft: string) => {
    const item = library.find((i) => i.slug === slug)
    const fallback = item?.title ?? t('vault.untitled')
    const trimmed = draft.trim()
    const title =
      trimmed.split('\n').find((line) => line.trim())?.trim().slice(0, 80) || fallback
    const body = bodyFromPlain(title, draft)
    const summary = notePlainBody(body).split('\n').find((line) => line.trim())?.slice(0, 120) ?? ''
    updateNote(slug, { title, body, summary })
    setEditingSlug(null)
  }

  useEffect(() => () => clearPendingClick(), [clearPendingClick])

  const menuItems = useMemo((): ContextMenuEntry[] => {
    if (!menu) return []

    if (menu.target === 'board') {
      const items: ContextMenuEntry[] = [
        {
          kind: 'item',
          label: t('vault.menu.newSticky'),
          onSelect: () => spawnSticky(menu.boardX, menu.boardY, true)
        }
      ]
      if (unpinned.length > 0) {
        items.push({ kind: 'separator' }, { kind: 'label', label: t('vault.menu.pinExisting') })
        unpinned.slice(0, 8).forEach((item, i) => {
          items.push({
            kind: 'item',
            label: item.title,
            onSelect: () =>
              pinNote(
                item.slug,
                wrapVaultPos(menu.boardX + (i % 3) * 20, menu.boardY + Math.floor(i / 3) * 16, boardSize.w, boardSize.h)
              )
          })
        })
      }
      return items
    }

    const slug = menu.slug
    if (!slug) return []
    const item = library.find((i) => i.slug === slug)
    return [
      {
        kind: 'item',
        label: t('vault.menu.edit'),
        disabled: item?.platform !== 'self',
        onSelect: () => setEditingSlug(slug)
      },
      {
        kind: 'item',
        label: t('vault.menu.read'),
        onSelect: () => {
          selectItem(slug)
          setViewMode('journal')
        }
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: t('vault.menu.unpin'),
        danger: true,
        onSelect: () => {
          togglePin(slug)
          if (editingSlug === slug) setEditingSlug(null)
        }
      }
    ]
  }, [
    menu,
    t,
    spawnSticky,
    unpinned,
    pinNote,
    library,
    selectItem,
    setViewMode,
    togglePin,
    editingSlug,
    boardSize.w,
    boardSize.h
  ])

  return (
    <div className="view-page view-page-vault">
      <header className="view-header view-header-vault no-drag">
        <div className="view-header-top">
          <div className="page-heading">
            <h1 className="page-title">{t('vault.pageTitle')}</h1>
            <p className="page-lead">{t('vault.pageSub')}</p>
          </div>
          <span className="journal-milestone">{t('vault.pinnedCount', { count: pinned.length })}</span>
        </div>
      </header>

      <div
        ref={boardRef}
        className="vault-board-scroll"
        onPointerDown={onBoardPointerDown}
        onDoubleClick={onBoardDoubleClick}
        onContextMenu={openBoardMenu}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="vault-canvas">
          {pinned.length === 0 && (
            <div className="vault-empty-hint" aria-hidden>
              <Pin size={24} strokeWidth={1.25} />
              <p>{t('vault.emptyCanvasHint')}</p>
            </div>
          )}

          {pinned.flatMap((item) => {
            const isDragging = drag?.slug === item.slug
            const base = isDragging
              ? { x: drag.rawX, y: drag.rawY }
              : (layout[item.slug] ?? wrapVaultPos(32, 32, boardSize.w, boardSize.h))
            const slices = getVaultWrapSlices(base.x, base.y, boardSize.w, boardSize.h)
            const editing = editingSlug === item.slug
            const draft = editing ? notePlainBody(item.body) || item.title : undefined

            return slices.map((slice, idx) => {
              const isBody = slice.kind === 'body'
              return (
                <StickyNoteCard
                  key={`${item.slug}-${slice.kind}-${idx}`}
                  item={item}
                  left={slice.x}
                  top={slice.y}
                  selected={selectedSlug === item.slug}
                  editing={editing && isBody && !isDragging}
                  draft={draft}
                  wrap={slice.kind === 'wrap'}
                  dragging={isDragging}
                  instant={instantSlug === item.slug}
                  onSelect={() => onNoteClick(item.slug)}
                  onDoubleClick={() => onNoteDoubleClick(item.slug, item)}
                  onCommitEdit={(text) => commitEdit(item.slug, text)}
                  onCancelEdit={() => setEditingSlug(null)}
                  onDragStart={(e) => startDrag(e, item.slug, base.x, base.y)}
                  onContextMenu={(e) => openNoteMenu(e, item.slug)}
                />
              )
            })
          })}
        </div>
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} /> : null}
    </div>
  )
}
