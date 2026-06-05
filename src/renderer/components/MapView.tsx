import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Map, StickyNote, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import {
  MAP_NODE_H,
  MAP_NODE_W,
  MAP_SCRATCH_H,
  MAP_SCRATCH_W,
  type MapCanvasRect
} from '../lib/mapCanvasBounds'
import { mergeMapLayout } from '../lib/mapLayout'
import {
  cameraToFitBounds,
  cameraTransform,
  contentBoundsFromRects,
  panCamera,
  screenToWorld,
  zoomCameraAtPoint,
  type MapCamera
} from '../lib/mapViewport'
import { libraryItemMatchesQuery } from '../lib/libraryFilter'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../lib/contentMeta'
import { EmptyState } from './EmptyState'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'

type DragState = {
  kind: 'note' | 'scratch'
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
}

type MenuState = {
  x: number
  y: number
  canvasX: number
  canvasY: number
  target: 'canvas' | 'note'
  slug?: string
}

export function MapView(): React.JSX.Element {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const mapMode = useAppStore((s) => s.mapMode)
  const setMapMode = useAppStore((s) => s.setMapMode)
  const thinkingMap = useAppStore((s) => s.thinkingMap)
  const wikiMap = useAppStore((s) => s.wikiMap)
  const thinkingScratch = useAppStore((s) => s.thinkingScratch)
  const setMapNodePos = useAppStore((s) => s.setMapNodePos)
  const addScratchNode = useAppStore((s) => s.addScratchNode)
  const updateScratchNode = useAppStore((s) => s.updateScratchNode)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const libraryQuery = useAppStore((s) => s.libraryQuery)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const viewMode = useAppStore((s) => s.viewMode)
  const readerOpen = useAppStore((s) => s.readerOpen)
  const closeReader = useAppStore((s) => s.closeReader)

  const viewportRef = useRef<HTMLDivElement>(null)
  const spaceHeldRef = useRef(false)
  const panRef = useRef<{
    startX: number
    startY: number
    camX: number
    camY: number
  } | null>(null)
  const fittedModeRef = useRef<{ thinking: boolean; wiki: boolean }>({
    thinking: false,
    wiki: false
  })

  const [camera, setCamera] = useState<MapCamera>({ x: 0, y: 0, z: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const noteSlugs = useMemo(() => library.map((i) => i.slug), [library])

  const layout = useMemo(
    () => mergeMapLayout(noteSlugs, mapMode === 'wiki' ? wikiMap : thinkingMap),
    [noteSlugs, mapMode, wikiMap, thinkingMap]
  )

  const canvasRects = useMemo((): MapCanvasRect[] => {
    const rects: MapCanvasRect[] = library.map((item) => {
      const pos = layout[item.slug] ?? { x: 48, y: 48 }
      return { x: pos.x, y: pos.y, w: MAP_NODE_W, h: MAP_NODE_H }
    })
    if (mapMode === 'thinking') {
      for (const node of thinkingScratch) {
        rects.push({ x: node.x, y: node.y, w: MAP_SCRATCH_W, h: MAP_SCRATCH_H })
      }
    }
    return rects
  }, [library, layout, mapMode, thinkingScratch])

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport) return { x: 96, y: 96 }
      const rect = viewport.getBoundingClientRect()
      const world = screenToWorld(clientX, clientY, rect, camera)
      return {
        x: world.x - MAP_SCRATCH_W / 2,
        y: world.y - MAP_SCRATCH_H / 2
      }
    },
    [camera]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (viewMode === 'map') e.preventDefault()
      spaceHeldRef.current = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeldRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [viewMode])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || library.length === 0 || fittedModeRef.current[mapMode]) return
    const bounds = contentBoundsFromRects(canvasRects)
    if (!bounds) return
    const fit = (): void => {
      if (fittedModeRef.current[mapMode]) return
      const { width, height } = viewport.getBoundingClientRect()
      if (width < 32 || height < 32) return
      setCamera(cameraToFitBounds(bounds, width, height))
      fittedModeRef.current[mapMode] = true
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [canvasRects, mapMode, library.length])

  const spawnScratch = useCallback(
    (canvasX: number, canvasY: number) => {
      if (mapMode !== 'thinking') return
      addScratchNode(t('map.scratchDefault'), { x: canvasX, y: canvasY })
    },
    [addScratchNode, mapMode, t]
  )

  const spawnScratchAtViewportCenter = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      spawnScratch(120, 120)
      return
    }
    const rect = viewport.getBoundingClientRect()
    const center = screenToWorld(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      rect,
      camera
    )
    spawnScratch(center.x - MAP_SCRATCH_W / 2, center.y - MAP_SCRATCH_H / 2)
  }, [spawnScratch, camera])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pan = panRef.current
      if (pan) {
        setCamera((c) => ({
          ...c,
          x: pan.camX + e.clientX - pan.startX,
          y: pan.camY + e.clientY - pan.startY
        }))
        return
      }
      if (!drag) return
      const dx = (e.clientX - drag.startX) / camera.z
      const dy = (e.clientY - drag.startY) / camera.z
      const x = drag.originX + dx
      const y = drag.originY + dy
      if (drag.kind === 'note') {
        setMapNodePos(mapMode, drag.id, { x, y })
      } else {
        updateScratchNode(drag.id, { x, y })
      }
    },
    [drag, camera.z, mapMode, setMapNodePos, updateScratchNode]
  )

  const endPointer = useCallback(() => {
    panRef.current = null
    setIsPanning(false)
    setDrag(null)
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport) return
    e.preventDefault()
    const rect = viewport.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      setCamera((c) => zoomCameraAtPoint(c, e.clientX, e.clientY, rect, e.deltaY < 0))
    } else {
      setCamera((c) => panCamera(c, -e.deltaX, -e.deltaY))
    }
  }, [])

  const tryStartPan = (e: React.PointerEvent): boolean => {
    if (!isCanvasTarget(e.target)) return false
    const middle = e.button === 1
    const spacePan = e.button === 0 && spaceHeldRef.current
    if (!middle && !spacePan) return false
    e.preventDefault()
    viewportRef.current?.setPointerCapture(e.pointerId)
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      camX: camera.x,
      camY: camera.y
    }
    setIsPanning(true)
    return true
  }

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (tryStartPan(e)) return
  }

  const startDrag = (
    e: React.PointerEvent,
    kind: 'note' | 'scratch',
    id: string,
    x: number,
    y: number
  ): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind, id, startX: e.clientX, startY: e.clientY, originX: x, originY: y })
  }

  const isCanvasTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null
    if (!el) return false
    return Boolean(el.closest('.map-viewport, .map-world, .map-canvas')) &&
      !el.closest('.map-node, .map-scratch')
  }

  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    if (mapMode !== 'thinking' || !isCanvasTarget(e.target)) return
    const pos = clientToCanvas(e.clientX, e.clientY)
    spawnScratch(pos.x, pos.y)
  }

  const openCanvasMenu = (e: React.MouseEvent) => {
    if (!isCanvasTarget(e.target)) return
    e.preventDefault()
    const pos = clientToCanvas(e.clientX, e.clientY)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
      target: 'canvas'
    })
  }

  const openNoteMenu = (e: React.MouseEvent, slug: string) => {
    e.preventDefault()
    e.stopPropagation()
    selectItem(slug, { reader: false })
    const pos = clientToCanvas(e.clientX, e.clientY)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
      target: 'note',
      slug
    })
  }

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!isCanvasTarget(e.target)) return
    selectItem(null)
  }

  const menuItems = useMemo((): ContextMenuEntry[] => {
    if (!menu) return []

    if (menu.target === 'note' && menu.slug) {
      const slug = menu.slug
      const items: ContextMenuEntry[] = [
        {
          kind: 'item',
          label: t('map.menu.readNote'),
          onSelect: () => selectItem(slug, { reader: true })
        }
      ]
      if (mapMode === 'wiki') {
        items.push(
          { kind: 'separator' },
          {
            kind: 'item',
            label: t('map.menu.editLinks'),
            disabled: true,
            onSelect: () => undefined
          },
          {
            kind: 'item',
            label: t('map.menu.linkNotes'),
            disabled: true,
            onSelect: () => undefined
          }
        )
      }
      return items
    }

    if (mapMode === 'wiki') {
      return [
        { kind: 'label', label: t('map.menu.wikiCanvasLabel') },
        {
          kind: 'item',
          label: t('map.menu.linkNotes'),
          disabled: true,
          onSelect: () => undefined
        }
      ]
    }

    return [
      {
        kind: 'item',
        label: t('map.menu.newScratch'),
        shortcut: t('map.menu.newScratchShortcut'),
        onSelect: () => spawnScratch(menu.canvasX, menu.canvasY)
      }
    ]
  }, [menu, mapMode, t, spawnScratch, selectItem])

  const peekItem = useMemo(
    () => (selectedSlug ? library.find((i) => i.slug === selectedSlug) : undefined),
    [library, selectedSlug]
  )

  useEffect(() => {
    if (viewMode !== 'map') return

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()

      if (key === 'escape') {
        if (readerOpen) {
          e.preventDefault()
          closeReader()
          return
        }
        if (selectedSlug) {
          e.preventDefault()
          selectItem(null)
          return
        }
      }

      if (mapMode !== 'thinking') return
      if (key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        spawnScratchAtViewportCenter()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    viewMode,
    mapMode,
    readerOpen,
    selectedSlug,
    closeReader,
    selectItem,
    spawnScratchAtViewportCenter
  ])

  const isEmpty = library.length === 0
  const searchActive = libraryQuery.trim().length > 0

  return (
    <div className="view-page view-page-map">
      <header className="view-toolbar view-toolbar-spatial no-drag">
        <h1 className="view-toolbar-title">{t('map.pageTitle')}</h1>
        <span className="view-toolbar-spacer" />
        <div className="map-mode-pills filter-pills" role="tablist" aria-label={t('map.pageTitle')}>
          {(['thinking', 'wiki'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={mapMode === mode}
              className={clsx('filter-pill', mapMode === mode && 'filter-pill-active')}
              onClick={() => setMapMode(mode)}
            >
              {t(`map.mode.${mode}`)}
            </button>
          ))}
        </div>
      </header>

      {isEmpty ? (
        <EmptyState
          icon={<Map size={28} strokeWidth={1.25} />}
          title={t('map.empty')}
          hint={t('map.emptyHint')}
          detail={t(`map.emptyDetail.${mapMode}`)}
          action={
            <button type="button" className="btn-primary" onClick={() => setViewMode('capture')}>
              {t('capture.goInbox')}
            </button>
          }
        />
      ) : (
        <div
          ref={viewportRef}
          className={clsx(
            'map-viewport',
            mapMode === 'wiki' ? 'map-viewport-wiki' : 'map-viewport-thinking',
            isPanning && 'map-viewport-panning'
          )}
          onWheel={onWheel}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onClick={onCanvasClick}
          onDoubleClick={onCanvasDoubleClick}
          onContextMenu={openCanvasMenu}
        >
          <p className="map-viewport-nav" aria-hidden>
            {t('map.canvasNav')}
          </p>
          {mapMode === 'thinking' && thinkingScratch.length === 0 && !selectedSlug && (
            <p className="map-canvas-tip" aria-hidden>
              {t('map.canvasTip.thinking')}
            </p>
          )}
          {mapMode === 'wiki' && !selectedSlug && (
            <p className="map-canvas-tip" aria-hidden>
              {t('map.canvasTip.wiki')}
            </p>
          )}
          <div className="map-world" style={{ transform: cameraTransform(camera) }}>
            <div className="map-canvas">
            {library.map((item) => {
              const pos = layout[item.slug] ?? { x: 48, y: 48 }
              const type = normalizeShelfType(String(item.type)) as ShelfType
              const accent = TYPE_STYLES[type].accent
              const searchDim =
                searchActive && !libraryItemMatchesQuery(item, libraryQuery)
              return (
                <div
                  key={item.slug}
                  className={clsx(
                    'map-node',
                    selectedSlug === item.slug && 'map-node-selected',
                    searchDim && 'map-node-search-dim'
                  )}
                  style={{ left: pos.x, top: pos.y }}
                  onPointerDown={(e) => startDrag(e, 'note', item.slug, pos.x, pos.y)}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectItem(item.slug, { reader: false })
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    selectItem(item.slug, { reader: true })
                  }}
                  onContextMenu={(e) => openNoteMenu(e, item.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') selectItem(item.slug, { reader: true })
                  }}
                >
                  <span className="map-node-dot" style={{ background: accent }} aria-hidden />
                  <span className="map-node-title">{item.title}</span>
                  {item.summary && <span className="map-node-summary">{item.summary}</span>}
                </div>
              )
            })}

            {mapMode === 'thinking' &&
              thinkingScratch.map((node) => (
                <div
                  key={node.id}
                  className="map-scratch"
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(e) => startDrag(e, 'scratch', node.id, node.x, node.y)}
                  onContextMenu={(e) => e.stopPropagation()}
                >
                  <StickyNote size={14} className="map-scratch-icon" strokeWidth={1.5} />
                  <p>{node.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {menu && menuItems.length > 0 ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}

      {mapMode === 'wiki' && selectedSlug && !readerOpen && peekItem && (
        <div className="map-peek-bar no-drag">
          <button
            type="button"
            className="map-peek-dismiss"
            aria-label={t('map.peek.dismiss')}
            onClick={() => selectItem(null)}
          >
            <X size={14} />
          </button>
          <div className="map-peek-copy min-w-0 flex-1">
            <p className="map-peek-title">{peekItem.title}</p>
            {peekItem.summary ? (
              <p className="map-peek-summary">{peekItem.summary}</p>
            ) : null}
          </div>
          <span className="map-peek-hint hidden sm:inline">{t('map.peek.hint')}</span>
          <button
            type="button"
            className="btn-primary shrink-0"
            onClick={() => selectItem(selectedSlug, { reader: true })}
          >
            {t('map.peek.read')}
          </button>
        </div>
      )}
    </div>
  )
}
