import clsx from 'clsx'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Map, Plus, StickyNote } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { mergeMapLayout } from '../lib/mapLayout'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../lib/contentMeta'
import { EmptyState } from './EmptyState'

type DragState = {
  kind: 'note' | 'scratch'
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
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
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)

  const canvasRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const noteSlugs = useMemo(() => library.map((i) => i.slug), [library])

  const layout = useMemo(
    () => mergeMapLayout(noteSlugs, mapMode === 'wiki' ? wikiMap : thinkingMap),
    [noteSlugs, mapMode, wikiMap, thinkingMap]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const x = drag.originX + dx
      const y = drag.originY + dy
      if (drag.kind === 'note') {
        setMapNodePos(mapMode, drag.id, { x, y })
      } else {
        updateScratchNode(drag.id, { x, y })
      }
    },
    [drag, mapMode, setMapNodePos, updateScratchNode]
  )

  const endDrag = useCallback(() => setDrag(null), [])

  const startDrag = (
    e: React.PointerEvent,
    kind: 'note' | 'scratch',
    id: string,
    x: number,
    y: number
  ): void => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind, id, startX: e.clientX, startY: e.clientY, originX: x, originY: y })
  }

  const isEmpty = library.length === 0

  return (
    <div className="view-page view-page-map">
      <header className="view-header no-drag">
        <div className="view-header-top">
          <div className="page-heading">
            <h1 className="page-title">{t('map.pageTitle')}</h1>
            <p className="page-lead">{t(`map.lead.${mapMode}`)}</p>
          </div>
        </div>
        <div className="map-mode-pills filter-pills">
          {(['thinking', 'wiki'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={clsx('filter-pill', mapMode === mode && 'filter-pill-active')}
              onClick={() => setMapMode(mode)}
            >
              {t(`map.mode.${mode}`)}
            </button>
          ))}
          {mapMode === 'thinking' && (
            <button
              type="button"
              className="map-add-scratch btn-ghost"
              onClick={() => addScratchNode(t('map.scratchDefault'))}
            >
              <Plus size={14} />
              {t('map.addScratch')}
            </button>
          )}
        </div>
      </header>

      {isEmpty ? (
        <EmptyState
          icon={<Map size={28} strokeWidth={1.25} />}
          title={t('map.empty')}
          hint={t('map.emptyHint')}
          action={
            <button type="button" className="btn-primary" onClick={() => setViewMode('capture')}>
              {t('capture.goInbox')}
            </button>
          }
        />
      ) : (
        <div
          ref={canvasRef}
          className={clsx(
            'map-scroll',
            mapMode === 'wiki' ? 'map-scroll-wiki' : 'map-scroll-thinking'
          )}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="map-canvas">
            {library.map((item) => {
              const pos = layout[item.slug] ?? { x: 48, y: 48 }
              const type = normalizeShelfType(String(item.type)) as ShelfType
              const accent = TYPE_STYLES[type].accent
              return (
                <div
                  key={item.slug}
                  className={clsx('map-node', selectedSlug === item.slug && 'map-node-selected')}
                  style={{ left: pos.x, top: pos.y }}
                  onPointerDown={(e) => startDrag(e, 'note', item.slug, pos.x, pos.y)}
                  onClick={() => selectItem(item.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && selectItem(item.slug)}
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
                >
                  <StickyNote size={14} className="map-scratch-icon" strokeWidth={1.5} />
                  <p>{node.text}</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
