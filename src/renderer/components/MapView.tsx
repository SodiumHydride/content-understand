import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Map, Network, Pin, Trash2, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { createLink, fetchGraph } from '../lib/sidecar'
import { animateForceLayout, type ForceEdge } from '../lib/forceLayout'
import { MAP_NODE_H, MAP_NODE_W, type MapCanvasRect } from '../lib/mapCanvasBounds'
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
import { createTextElement, removeElements } from '../lib/thinkingCanvas/document'
import { documentBounds } from '../lib/thinkingCanvas/strokeGeometry'
import {
  useThinkingCanvasInput,
  useThinkingCanvasPersistence
} from '../lib/thinkingCanvas/useThinkingCanvasInput'
import { EmptyState } from './EmptyState'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { ThinkingCanvasLayer } from './thinkingCanvas/ThinkingCanvasLayer'
import {
  ThinkingCanvasOptions,
  ThinkingCanvasToolbar
} from './thinkingCanvas/ThinkingCanvasToolbar'
import { WikiEdgeLayer } from './WikiEdgeLayer'

type DragState = {
  kind: 'note'
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
  target: 'canvas' | 'note' | 'text' | 'image'
  slug?: string
  elementId?: string
}

export function MapView(): React.JSX.Element {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const mapMode = useAppStore((s) => s.mapMode)
  const setMapMode = useAppStore((s) => s.setMapMode)
  const thinkingMap = useAppStore((s) => s.thinkingMap)
  const wikiMap = useAppStore((s) => s.wikiMap)
  const thinkingCanvas = useAppStore((s) => s.thinkingCanvas)
  const thinkingCanvasReady = useAppStore((s) => s.thinkingCanvasReady)
  const loadThinkingCanvas = useAppStore((s) => s.loadThinkingCanvas)
  const thinkingToolPrefs = useAppStore((s) => s.thinkingToolPrefs)
  const setThinkingToolPrefs = useAppStore((s) => s.setThinkingToolPrefs)
  const patchThinkingCanvas = useAppStore((s) => s.patchThinkingCanvas)
  const setMapNodePos = useAppStore((s) => s.setMapNodePos)
  const wikiLayoutMode = useAppStore((s) => s.wikiLayoutMode)
  const setWikiLayoutMode = useAppStore((s) => s.setWikiLayoutMode)
  const wikiPinnedSlugs = useAppStore((s) => s.wikiPinnedSlugs)
  const toggleWikiPin = useAppStore((s) => s.toggleWikiPin)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const libraryQuery = useAppStore((s) => s.libraryQuery)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const viewMode = useAppStore((s) => s.viewMode)
  const readerOpen = useAppStore((s) => s.readerOpen)
  const closeReader = useAppStore((s) => s.closeReader)
  const deletePage = useAppStore((s) => s.deletePage)

  const viewportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageDropRef = useRef<{ x: number; y: number } | null>(null)
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

  const queryClient = useQueryClient()

  const [camera, setCamera] = useState<MapCamera>({ x: 0, y: 0, z: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [highlightSlug, setHighlightSlug] = useState<string | null>(null)
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)

  const noteSlugs = useMemo(() => library.map((i) => i.slug), [library])
  const layout = useMemo(
    () => mergeMapLayout(noteSlugs, mapMode === 'wiki' ? wikiMap : thinkingMap),
    [noteSlugs, mapMode, wikiMap, thinkingMap]
  )

  const { data: graph } = useQuery({
    queryKey: ['wiki-graph'],
    queryFn: fetchGraph,
    staleTime: 30_000,
    enabled: mapMode === 'wiki'
  })

  const linkCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (!graph?.edges) return counts
    for (const edge of graph.edges) {
      counts[edge.source_slug] = (counts[edge.source_slug] ?? 0) + 1
      counts[edge.target_slug] = (counts[edge.target_slug] ?? 0) + 1
    }
    return counts
  }, [graph?.edges])

  const connectedSlugs = useMemo(() => {
    const set = new Set<string>()
    if (!highlightSlug || !graph?.edges) return set
    set.add(highlightSlug)
    for (const edge of graph.edges) {
      if (edge.source_slug === highlightSlug) set.add(edge.target_slug)
      if (edge.target_slug === highlightSlug) set.add(edge.source_slug)
    }
    return set
  }, [highlightSlug, graph?.edges])

  // Build force edges from graph data
  const forceEdges = useMemo((): ForceEdge[] => {
    if (!graph?.edges) return []
    return graph.edges.map((e) => ({ source: e.source_slug, target: e.target_slug }))
  }, [graph?.edges])

  // Track if force layout is currently running so drag can auto-pin
  const forceRunningRef = useRef(false)

  // Force layout animation effect
  useEffect(() => {
    if (mapMode !== 'wiki' || wikiLayoutMode !== 'force') return
    if (forceEdges.length === 0) return
    if (library.length === 0) return

    const pinnedSet = new Set(wikiPinnedSlugs)
    const currentLayout = { ...wikiMap }

    // Ensure every library node has a starting position
    for (const item of library) {
      if (!currentLayout[item.slug]) {
        currentLayout[item.slug] = { x: 48, y: 48 }
      }
    }

    forceRunningRef.current = true

    const cancel = animateForceLayout(
      currentLayout,
      forceEdges,
      pinnedSet,
      (positions) => {
        // On each frame, batch update all node positions
        for (const [slug, pos] of Object.entries(positions)) {
          setMapNodePos('wiki', slug, pos)
        }
      },
      (finalPositions) => {
        // On complete, save final positions
        for (const [slug, pos] of Object.entries(finalPositions)) {
          setMapNodePos('wiki', slug, pos)
        }
        forceRunningRef.current = false
      }
    )

    return () => {
      cancel()
      forceRunningRef.current = false
    }
  }, [mapMode, wikiLayoutMode, forceEdges, library, wikiPinnedSlugs, wikiMap, setMapNodePos])

  // When switching from force to grid, reset to default grid layout
  useEffect(() => {
    if (mapMode !== 'wiki' || wikiLayoutMode !== 'grid') return
    // Only reset if we were previously in force mode (positions are scattered)
    // Apply a simple grid layout
    const cols = Math.ceil(Math.sqrt(library.length))
    const spacingX = 220
    const spacingY = 160
    for (let i = 0; i < library.length; i++) {
      const slug = library[i].slug
      const col = i % cols
      const row = Math.floor(i / cols)
      setMapNodePos('wiki', slug, { x: 48 + col * spacingX, y: 48 + row * spacingY })
    }
  }, [wikiLayoutMode]) // Only run when layout mode changes

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport) return { x: 96, y: 96 }
      return screenToWorld(clientX, clientY, viewport.getBoundingClientRect(), camera)
    },
    [camera]
  )

  const isCanvasTarget = useCallback((target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null
    if (!el) return false
    return (
      Boolean(el.closest('.map-viewport, .map-world, .map-canvas, .thinking-canvas-ink')) &&
      !el.closest('.map-node, .thinking-canvas-text, .thinking-canvas-image')
    )
  }, [])

  const canvasInput = useThinkingCanvasInput({
    enabled: mapMode === 'thinking' && thinkingCanvasReady,
    clientToWorld,
    isCanvasTarget,
    spaceHeld: () => spaceHeldRef.current,
    capturePointer: (e) => viewportRef.current?.setPointerCapture(e.pointerId)
  })

  useThinkingCanvasPersistence(mapMode === 'thinking' && thinkingCanvasReady)

  useEffect(() => {
    if (mapMode === 'thinking' && !thinkingCanvasReady) {
      void loadThinkingCanvas()
    }
  }, [mapMode, thinkingCanvasReady, loadThinkingCanvas])

  const noteRects = useMemo((): MapCanvasRect[] => {
    return library.map((item) => {
      const pos = layout[item.slug] ?? { x: 48, y: 48 }
      return { x: pos.x, y: pos.y, w: MAP_NODE_W, h: MAP_NODE_H }
    })
  }, [library, layout])

  const canvasRects = useMemo((): MapCanvasRect[] => {
    const rects = [...noteRects]
    if (mapMode === 'thinking' && thinkingCanvas) {
      const bounds = documentBounds(thinkingCanvas, [])
      if (bounds) rects.push({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })
    }
    return rects
  }, [noteRects, mapMode, thinkingCanvas])

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
    if (!viewport || fittedModeRef.current[mapMode]) return
    if (mapMode === 'wiki' && library.length === 0) return
    if (mapMode === 'thinking' && canvasRects.length === 0) return
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

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (panRef.current) {
        const pan = panRef.current
        setCamera((c) => ({
          ...c,
          x: pan.camX + e.clientX - pan.startX,
          y: pan.camY + e.clientY - pan.startY
        }))
        return
      }
      if (mapMode === 'thinking') {
        canvasInput.handlePointerMoveWithZoom(e, camera.z)
      }
      if (!drag) return
      const dx = (e.clientX - drag.startX) / camera.z
      const dy = (e.clientY - drag.startY) / camera.z
      setMapNodePos(mapMode, drag.id, { x: drag.originX + dx, y: drag.originY + dy })
    },
    [drag, camera.z, mapMode, setMapNodePos, canvasInput]
  )

  const endPointer = useCallback(() => {
    if (mapMode === 'thinking') canvasInput.finishPointer(camera.z)
    panRef.current = null
    setIsPanning(false)
    setDrag(null)
  }, [mapMode, canvasInput, camera.z])

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
    if (mapMode !== 'thinking') return

    if (canvasInput.tool === 'image' && isCanvasTarget(e.target) && e.button === 0) {
      imageDropRef.current = clientToWorld(e.clientX, e.clientY)
      fileInputRef.current?.click()
      return
    }

    canvasInput.handlePointerDown(e)
  }

  const startNoteDrag = (e: React.PointerEvent, slug: string, x: number, y: number): void => {
    if (mapMode === 'thinking' && canvasInput.tool !== 'select') return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind: 'note', id: slug, startX: e.clientX, startY: e.clientY, originX: x, originY: y })
    // Auto-pin when dragging in wiki force layout
    if (mapMode === 'wiki' && wikiLayoutMode === 'force' && !wikiPinnedSlugs.includes(slug)) {
      toggleWikiPin(slug)
    }
  }

  const onCanvasClick = () => {
    // Cancel linking mode on canvas click
    if (linkingFrom) {
      setLinkingFrom(null)
      return
    }
    if (!canvasInput.handleCanvasClick()) return
    selectItem(null)
  }

  const openCanvasMenu = (e: React.MouseEvent) => {
    if (!isCanvasTarget(e.target)) return
    e.preventDefault()
    const world = clientToWorld(e.clientX, e.clientY)
    setMenu({ x: e.clientX, y: e.clientY, canvasX: world.x, canvasY: world.y, target: 'canvas' })
  }

  const openElementMenu = (e: React.MouseEvent, kind: 'text' | 'image', elementId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: 0,
      canvasY: 0,
      target: kind,
      elementId
    })
  }

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const pos = imageDropRef.current
    imageDropRef.current = null
    if (!file || !pos) return
    await canvasInput.insertImage(file, file.type || 'image/png', pos.x, pos.y, file.name)
  }

  useEffect(() => {
    if (viewMode !== 'map' || mapMode !== 'thinking') return

    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const viewport = viewportRef.current
        if (!viewport) return
        const rect = viewport.getBoundingClientRect()
        const world = screenToWorld(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          rect,
          camera
        )
        void canvasInput.insertImage(file, file.type, world.x, world.y)
        break
      }
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [viewMode, mapMode, camera, canvasInput])

  useEffect(() => {
    if (viewMode !== 'map' || mapMode !== 'thinking') return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()

      if (key === 'escape') {
        if (canvasInput.editingTextId) {
          e.preventDefault()
          canvasInput.cancelTextEdit()
          return
        }
      }

      if (key === 'delete' || key === 'backspace') {
        if (canvasInput.selectedIds.length > 0) {
          e.preventDefault()
          canvasInput.deleteSelected()
        }
        return
      }

      const tools = {
        v: 'select',
        t: 'text',
        p: 'pen',
        h: 'highlighter',
        e: 'eraser',
        i: 'image'
      } as const
      if (key in tools) {
        e.preventDefault()
        canvasInput.setTool(tools[key as keyof typeof tools])
        if (key === 'i') fileInputRef.current?.click()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode, mapMode, canvasInput])

  useEffect(() => {
    if (viewMode !== 'map') return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key.toLowerCase() !== 'escape') return
      if (linkingFrom) {
        e.preventDefault()
        setLinkingFrom(null)
        return
      }
      if (readerOpen) {
        e.preventDefault()
        closeReader()
        return
      }
      if (selectedSlug) {
        e.preventDefault()
        selectItem(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode, readerOpen, selectedSlug, closeReader, selectItem, linkingFrom])

  const menuItems = useMemo((): ContextMenuEntry[] => {
    if (!menu) return []

    if ((menu.target === 'text' || menu.target === 'image') && menu.elementId) {
      const id = menu.elementId
      return [
        {
          kind: 'item',
          label: menu.target === 'text' ? t('map.menu.editText') : t('map.menu.replaceImage'),
          onSelect: () => {
            if (menu.target === 'text') canvasInput.setEditingTextId(id)
            else fileInputRef.current?.click()
          }
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('map.menu.deleteElement'),
          onSelect: () => patchThinkingCanvas((doc) => removeElements(doc, new Set([id])))
        }
      ]
    }

    if (menu.target === 'note' && menu.slug) {
      const slug = menu.slug
      const isWikiPinned = wikiPinnedSlugs.includes(slug)
      const items: ContextMenuEntry[] = [
        {
          kind: 'item',
          label: t('map.menu.readNote'),
          onSelect: () => selectItem(slug, { reader: true })
        }
      ]
      if (mapMode === 'wiki') {
        items.push({
          kind: 'item',
          label: t('map.menu.linkNotes'),
          onSelect: () => setLinkingFrom(slug)
        })
      }
      if (mapMode === 'wiki') {
        items.push({
          kind: 'item',
          label: isWikiPinned ? t('map.menu.unpinNote') : t('map.menu.pinNote'),
          onSelect: () => toggleWikiPin(slug)
        })
      }
      items.push({ kind: 'separator' })
      items.push({
        kind: 'item',
        label: t('note.delete'),
        onSelect: () => {
          if (window.confirm(t('note.deleteConfirm'))) {
            void deletePage(slug).then((ok) => {
              if (ok) {
                void queryClient.invalidateQueries({ queryKey: ['wiki-graph'] })
              }
            })
          }
        }
      })
      return items
    }

    if (mapMode === 'wiki') {
      return [
        { kind: 'label', label: t('map.menu.wikiCanvasLabel') },
        {
          kind: 'item',
          label: t('map.menu.linkNotes'),
          onSelect: () => {
            // If right-clicking on a note, use that as source; otherwise use selectedSlug
            const source = menu.slug ?? selectedSlug
            if (source) setLinkingFrom(source)
          }
        }
      ]
    }

    return [
      {
        kind: 'item',
        label: t('map.menu.addTextHere'),
        onSelect: () => {
          canvasInput.setTool('text')
          patchThinkingCanvas((doc) => {
            const result = createTextElement(doc, menu.canvasX, menu.canvasY, '', thinkingToolPrefs.text)
            canvasInput.setEditingTextId(result.element.id)
            return result.doc
          })
        }
      }
    ]
  }, [menu, mapMode, t, selectItem, canvasInput, patchThinkingCanvas, thinkingToolPrefs.text, wikiPinnedSlugs, toggleWikiPin, selectedSlug])

  const peekItem = useMemo(
    () => (selectedSlug ? library.find((i) => i.slug === selectedSlug) : undefined),
    [library, selectedSlug]
  )

  const showWikiEmpty = mapMode === 'wiki' && library.length === 0
  const searchActive = libraryQuery.trim().length > 0
  const tool = canvasInput.tool

  return (
    <div className="view-page view-page-map">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void handleFilePick(e)}
      />

      <header className="view-toolbar view-toolbar-spatial no-drag">
        <h1 className="view-toolbar-title">{t('map.pageTitle')}</h1>
        <span className="view-toolbar-spacer" />
        {mapMode === 'thinking' && (
          <>
            <ThinkingCanvasToolbar tool={tool} onToolChange={canvasInput.setTool} />
            <ThinkingCanvasOptions
              tool={tool}
              prefs={thinkingToolPrefs}
              onChange={setThinkingToolPrefs}
            />
          </>
        )}
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
        {mapMode === 'wiki' && (
          <div className="map-layout-toggle" role="group" aria-label="Layout mode">
            <button
              type="button"
              className={clsx('map-layout-btn', wikiLayoutMode === 'grid' && 'map-layout-btn-active')}
              onClick={() => setWikiLayoutMode('grid')}
              aria-label="Grid layout"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              className={clsx('map-layout-btn', wikiLayoutMode === 'force' && 'map-layout-btn-active')}
              onClick={() => setWikiLayoutMode('force')}
              aria-label="Force layout"
            >
              <Network size={14} />
            </button>
          </div>
        )}
      </header>

      {showWikiEmpty ? (
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
            isPanning && 'map-viewport-panning',
            linkingFrom && 'map-viewport-linking',
            tool === 'pen' && 'map-viewport-pen',
            tool === 'highlighter' && 'map-viewport-highlighter',
            tool === 'text' && 'map-viewport-text',
            tool === 'eraser' && 'map-viewport-eraser',
            tool === 'image' && 'map-viewport-image'
          )}
          onWheel={onWheel}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onClick={onCanvasClick}
          onContextMenu={openCanvasMenu}
        >
          {linkingFrom && (
            <div className="map-linking-hint">
              {t('map.linkingHint')}
            </div>
          )}
          <p className="map-viewport-nav" aria-hidden>
            {mapMode === 'thinking' ? t('map.canvasNavThinking') : t('map.canvasNav')}
          </p>
          {mapMode === 'thinking' && (
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
              {mapMode === 'wiki' && (
                <WikiEdgeLayer layout={layout} highlightSlug={highlightSlug} />
              )}
              {mapMode === 'thinking' && thinkingCanvas && (
                <ThinkingCanvasLayer
                  document={thinkingCanvas}
                  activeStroke={canvasInput.activeStroke}
                  editingTextId={canvasInput.editingTextId}
                  selectedIds={canvasInput.selectedIds}
                  tool={tool}
                  onStartTextEdit={canvasInput.setEditingTextId}
                  onCommitText={canvasInput.commitTextEdit}
                  onCancelText={canvasInput.cancelTextEdit}
                  onTextDragStart={(e, id, x, y) => canvasInput.startElementDrag(e, 'text', id, x, y)}
                  onImageDragStart={(e, id, x, y) => canvasInput.startElementDrag(e, 'image', id, x, y)}
                  onTextContextMenu={(e, id) => openElementMenu(e, 'text', id)}
                  onImageContextMenu={(e, id) => openElementMenu(e, 'image', id)}
                />
              )}

              {library.map((item) => {
                const pos = layout[item.slug] ?? { x: 48, y: 48 }
                const type = normalizeShelfType(String(item.type)) as ShelfType
                const accent = TYPE_STYLES[type].accent
                const searchDim = searchActive && !libraryItemMatchesQuery(item, libraryQuery)
                const nodeDim =
                  highlightSlug !== null && mapMode === 'wiki' && !connectedSlugs.has(item.slug)
                const linkCount = linkCounts[item.slug] ?? 0
                const nodeScale = 1 + Math.min(linkCount, 5) * 0.03
                const isLinkSource = linkingFrom === item.slug
                const isLinkTarget = linkingFrom !== null && linkingFrom !== item.slug
                return (
                  <div
                    key={item.slug}
                    className={clsx(
                      'map-node',
                      selectedSlug === item.slug && 'map-node-selected',
                      searchDim && 'map-node-search-dim',
                      nodeDim && 'map-node-dim',
                      isLinkSource && 'map-node-link-source',
                      isLinkTarget && 'map-node-link-target'
                    )}
                    style={{ left: pos.x, top: pos.y, transform: `scale(${nodeScale})` }}
                    onPointerDown={(e) => {
                      if (linkingFrom) return
                      startNoteDrag(e, item.slug, pos.x, pos.y)
                    }}
                    onPointerEnter={() => setHighlightSlug(item.slug)}
                    onPointerLeave={() => setHighlightSlug(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      // Linking mode: clicking a target creates the link
                      if (linkingFrom && linkingFrom !== item.slug) {
                        void createLink(linkingFrom, item.slug).then((ok) => {
                          if (ok) {
                            void queryClient.invalidateQueries({ queryKey: ['wiki-graph'] })
                          }
                        })
                        setLinkingFrom(null)
                        return
                      }
                      // Linking mode: clicking source again cancels
                      if (linkingFrom === item.slug) {
                        setLinkingFrom(null)
                        return
                      }
                      if (mapMode === 'thinking' && tool !== 'select') return
                      selectItem(item.slug, { reader: false })
                    }}
                    onDoubleClick={(e) => {
                      if (linkingFrom) return
                      e.preventDefault()
                      e.stopPropagation()
                      selectItem(item.slug, { reader: true })
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      selectItem(item.slug, { reader: false })
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        canvasX: 0,
                        canvasY: 0,
                        target: 'note',
                        slug: item.slug
                      })
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="map-node-dot" style={{ background: accent }} aria-hidden />
                    <span className="map-node-title">{item.title}</span>
                    {item.summary && <span className="map-node-summary">{item.summary}</span>}
                    {mapMode === 'wiki' && wikiPinnedSlugs.includes(item.slug) && (
                      <Pin size={12} className="map-node-pin-icon" aria-label={t('map.menu.unpinNote')} />
                    )}
                  </div>
                )
              })}
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
            {peekItem.summary ? <p className="map-peek-summary">{peekItem.summary}</p> : null}
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
