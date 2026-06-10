import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Map, Network, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/appStore'
import { createLink, fetchGraph } from '../lib/sidecar'
import { mergeMapLayout } from '../lib/mapLayout'
import { cameraTransform, screenToWorld, type MapCamera } from '../lib/mapViewport'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../lib/contentMeta'
import { createTextElement } from '../lib/thinkingCanvas/document'
import {
  useThinkingCanvasInput,
  useThinkingCanvasPersistence
} from '../lib/thinkingCanvas/useThinkingCanvasInput'
import { EmptyState } from './EmptyState'
import { ThinkingCanvasLayer } from './thinkingCanvas/ThinkingCanvasLayer'
import {
  ThinkingCanvasOptions,
  ThinkingCanvasToolbar
} from './thinkingCanvas/ThinkingCanvasToolbar'
import { WikiEdgeLayer } from './WikiEdgeLayer'
import { useMapCamera } from './map/hooks/useMapCamera'
import { useMapDrag } from './map/hooks/useMapDrag'
import { useMapPan } from './map/hooks/useMapPan'
import { useMapShortcuts } from './map/hooks/useMapShortcuts'
import { useForceLayout } from './map/hooks/useForceLayout'
import { useMapFiltering } from './map/hooks/useMapFiltering'
import { useMapKeyboard } from './map/hooks/useMapKeyboard'
import { MapNode, type MapNodeInfo } from './map/MapNode'
import { MapContextMenu, type MapMenuState } from './map/MapContextMenu'
import { MapMinimap } from './map/MapMinimap'
import { MapTimeline } from './map/MapTimeline'

/** Subset of LibraryItem fields that MapView actually reads. */
type MapItem = {
  slug: string
  title: string
  summary: string
  type: string
  tags: string[]
  created: string
  updated: string
}

/** Extract only the fields MapView needs from the library array. */
function selectMapItems(state: { library: { slug: string; title: string; summary: string; type: string; tags: string[]; created: string; updated: string }[] }): MapItem[] {
  return state.library
}

/**
 * Stable selector for library items needed by MapView.
 * useShallow compares each array element by reference,
 * so this only re-renders when an item object actually changes.
 */
function useLibraryItems(): MapItem[] {
  return useAppStore(useShallow(selectMapItems))
}

export function MapView(): React.JSX.Element {
  const { t } = useTranslation()
  const library = useLibraryItems()
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

  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageDropRef = useRef<{ x: number; y: number } | null>(null)
  const queryClient = useQueryClient()

  // Camera hook
  const {
    camera,
    setCamera,
    viewportRef,
    viewportSize,
    onWheel,
    clientToWorld,
    useAutoFit
  } = useMapCamera()

  // Keyboard hook (space key)
  const { spaceHeldRef } = useMapKeyboard(viewMode)

  const [highlightSlug, setHighlightSlug] = useState<string | null>(null)
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)
  const [menu, setMenu] = useState<MapMenuState | null>(null)

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

  // Filtering hook
  const {
    filteredLibrary,
    visibleSlugs,
    canvasRects,
    clusters,
    noteTimestamps,
    timeRange,
    timelineEnabled,
    setTimelineEnabled,
    timeFilter,
    setTimeFilter,
    focusLocal,
    setFocusLocal
  } = useMapFiltering({
    library,
    selectedSlug,
    mapMode,
    graphEdges: graph?.edges,
    layout,
    thinkingCanvas
  })

  // Auto-fit camera on first visit per mode
  useAutoFit(canvasRects, mapMode, library.length)

  // Link counts for node scaling
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

  // Force layout hook
  useForceLayout({
    mapMode,
    wikiLayoutMode,
    library,
    wikiPinnedSlugs,
    wikiMap,
    graphEdges: graph?.edges,
    setMapNodePos
  })

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

  // Drag hook
  const { drag, startNoteDrag, handleDragMove, endDrag } = useMapDrag({
    cameraZ: camera.z,
    mapMode,
    tool: canvasInput.tool,
    setMapNodePos,
    wikiLayoutMode,
    wikiPinnedSlugs,
    toggleWikiPin
  })

  // Pan hook
  const { panRef, tryStartPan } = useMapPan({
    camera,
    viewportRef,
    spaceHeldRef,
    isCanvasTarget
  })

  const endPointer = useCallback(() => {
    if (mapMode === 'thinking') canvasInput.finishPointer(camera.z)
    panRef.current = null
    endDrag()
  }, [mapMode, canvasInput, camera.z, endDrag])

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
      handleDragMove(e)
    },
    [mapMode, canvasInput, camera.z, handleDragMove, setCamera]
  )

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

  const onCanvasClick = () => {
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
    setMenu({ x: e.clientX, y: e.clientY, canvasX: 0, canvasY: 0, target: kind, elementId })
  }

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const pos = imageDropRef.current
    imageDropRef.current = null
    if (!file || !pos) return
    await canvasInput.insertImage(file, file.type || 'image/png', pos.x, pos.y, file.name)
  }

  // Paste image handler
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
        const world = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, camera)
        void canvasInput.insertImage(file, file.type, world.x, world.y)
        break
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [viewMode, mapMode, camera, canvasInput])

  // Map shortcuts hook
  useMapShortcuts({
    viewMode,
    mapMode,
    canvasInput,
    linkingFrom,
    setLinkingFrom,
    readerOpen,
    closeReader,
    selectedSlug,
    selectItem,
    fileInputRef
  })

  const peekItem = useMemo(
    () => (selectedSlug ? library.find((i) => i.slug === selectedSlug) : undefined),
    [library, selectedSlug]
  )

  // Stable node event handlers
  const handleNodeClick = useCallback(
    (e: React.MouseEvent, slug: string) => {
      e.stopPropagation()
      if (linkingFrom && linkingFrom !== slug) {
        void createLink(linkingFrom, slug).then((ok) => {
          if (ok) void queryClient.invalidateQueries({ queryKey: ['wiki-graph'] })
        })
        setLinkingFrom(null)
        return
      }
      if (linkingFrom === slug) { setLinkingFrom(null); return }
      if (mapMode === 'thinking' && canvasInput.tool !== 'select') return
      selectItem(slug, { reader: false })
    },
    [linkingFrom, mapMode, canvasInput.tool, selectItem, queryClient]
  )

  const handleNodeDoubleClick = useCallback(
    (e: React.MouseEvent, slug: string) => {
      if (linkingFrom) return
      e.preventDefault()
      e.stopPropagation()
      selectItem(slug, { reader: true })
    },
    [linkingFrom, selectItem]
  )

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, slug: string) => {
      e.preventDefault()
      e.stopPropagation()
      selectItem(slug, { reader: false })
      setMenu({ x: e.clientX, y: e.clientY, canvasX: 0, canvasY: 0, target: 'note', slug })
    },
    [selectItem]
  )

  const handleNodePointerEnter = useCallback((slug: string) => setHighlightSlug(slug), [])
  const handleNodePointerLeave = useCallback(() => setHighlightSlug(null), [])

  const searchActive = libraryQuery.trim().length > 0

  // Pre-compute node infos (highlight/dim excluded to avoid re-rendering all nodes on hover)
  const nodeInfos = useMemo((): MapNodeInfo[] => {
    return filteredLibrary.map((item) => {
      const pos = layout[item.slug] ?? { x: 48, y: 48 }
      const type = normalizeShelfType(String(item.type)) as ShelfType
      const accent = TYPE_STYLES[type].accent
      const linkCount = linkCounts[item.slug] ?? 0
      const nodeScale = 1 + Math.min(linkCount, 5) * 0.03
      const isLinkSource = linkingFrom === item.slug
      const isLinkTarget = linkingFrom !== null && linkingFrom !== item.slug
      const showPin = mapMode === 'wiki' && wikiPinnedSlugs.includes(item.slug)
      return { item, pos, accent, nodeScale, isSelected: selectedSlug === item.slug, isLinkSource, isLinkTarget, showPin }
    })
  }, [filteredLibrary, layout, linkCounts, linkingFrom, wikiPinnedSlugs, selectedSlug])

  const showWikiEmpty = mapMode === 'wiki' && library.length === 0
  const tool = canvasInput.tool

  return (
    <div className="view-page view-page-map">
      <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => void handleFilePick(e)} />

      <header className="view-toolbar view-toolbar-spatial no-drag">
        <h1 className="view-toolbar-title">{t('map.pageTitle')}</h1>
        <span className="view-toolbar-spacer" />
        {mapMode === 'thinking' && (
          <>
            <ThinkingCanvasToolbar tool={tool} onToolChange={canvasInput.setTool} />
            <ThinkingCanvasOptions tool={tool} prefs={thinkingToolPrefs} onChange={setThinkingToolPrefs} />
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
            <button type="button" className={clsx('map-layout-btn', wikiLayoutMode === 'grid' && 'map-layout-btn-active')} onClick={() => setWikiLayoutMode('grid')} aria-label="Grid layout">
              <LayoutGrid size={14} />
            </button>
            <button type="button" className={clsx('map-layout-btn', wikiLayoutMode === 'force' && 'map-layout-btn-active')} onClick={() => setWikiLayoutMode('force')} aria-label="Force layout">
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
          action={<button type="button" className="btn-primary" onClick={() => setViewMode('capture')}>{t('capture.goInbox')}</button>}
        />
      ) : (
        <div
          ref={viewportRef}
          className={clsx(
            'map-viewport',
            mapMode === 'wiki' ? 'map-viewport-wiki' : 'map-viewport-thinking',
            panRef.current && 'map-viewport-panning',
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
          {linkingFrom && <div className="map-linking-hint">{t('map.linkingHint')}</div>}
          <p className="map-viewport-nav" aria-hidden>{mapMode === 'thinking' ? t('map.canvasNavThinking') : t('map.canvasNav')}</p>
          {mapMode === 'thinking' && <p className="map-canvas-tip" aria-hidden>{t('map.canvasTip.thinking')}</p>}
          {mapMode === 'wiki' && !selectedSlug && <p className="map-canvas-tip" aria-hidden>{t('map.canvasTip.wiki')}</p>}
          <div className="map-world" style={{ transform: cameraTransform(camera) }}>
            <div className="map-canvas">
              {mapMode === 'wiki' && <WikiEdgeLayer layout={layout} highlightSlug={highlightSlug} clusters={clusters} visibleSlugs={visibleSlugs} />}
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
              {nodeInfos.map((info) => (
                <MapNode
                  key={info.item.slug}
                  info={info}
                  linkingFrom={linkingFrom}
                  highlightSlug={highlightSlug}
                  connectedSlugs={connectedSlugs}
                  searchActive={searchActive}
                  libraryQuery={libraryQuery}
                  isDragging={drag?.id === info.item.slug}
                  onStartDrag={startNoteDrag}
                  onClickNode={handleNodeClick}
                  onDoubleClickNode={handleNodeDoubleClick}
                  onContextMenuNode={handleNodeContextMenu}
                  onPointerEnter={handleNodePointerEnter}
                  onPointerLeave={handleNodePointerLeave}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {mapMode === 'wiki' && <MapTimeline timeRange={timeRange} timeFilter={timeFilter} timelineEnabled={timelineEnabled} onToggle={setTimelineEnabled} onChange={setTimeFilter} />}
      {mapMode === 'wiki' && <MapMinimap canvasRects={canvasRects} filteredLibrary={filteredLibrary} layout={layout} camera={camera} viewportSize={viewportSize} />}

      <MapContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        mapMode={mapMode}
        selectedSlug={selectedSlug}
        wikiPinnedSlugs={wikiPinnedSlugs}
        toggleWikiPin={toggleWikiPin}
        selectItem={selectItem}
        setLinkingFrom={setLinkingFrom}
        canvasInput={canvasInput}
        patchThinkingCanvas={patchThinkingCanvas}
        thinkingToolPrefs={thinkingToolPrefs}
        deletePage={deletePage}
        queryClient={queryClient}
        fileInputRef={fileInputRef}
      />

      {mapMode === 'wiki' && selectedSlug && !readerOpen && peekItem && (
        <div className="map-peek-bar no-drag">
          <button type="button" className="map-peek-dismiss" aria-label={t('map.peek.dismiss')} onClick={() => selectItem(null)}>
            <X size={14} />
          </button>
          <div className="map-peek-copy min-w-0 flex-1">
            <p className="map-peek-title">{peekItem.title}</p>
            {peekItem.summary ? <p className="map-peek-summary">{peekItem.summary}</p> : null}
          </div>
          <button
            type="button"
            className={clsx('btn-ghost shrink-0 flex items-center gap-1 text-xs py-1 px-3 border border-[var(--divider)] rounded mr-2 cursor-pointer', focusLocal && 'btn-active')}
            onClick={() => setFocusLocal((prev: boolean) => !prev)}
          >
            <Network size={12} />
            {focusLocal ? t('map.peek.unfocusLocal') : t('map.peek.focusLocal')}
          </button>
          <span className="map-peek-hint hidden sm:inline mr-2">{t('map.peek.hint')}</span>
          <button type="button" className="btn-primary shrink-0" onClick={() => selectItem(selectedSlug, { reader: true })}>{t('map.peek.read')}</button>
        </div>
      )}
    </div>
  )
}
