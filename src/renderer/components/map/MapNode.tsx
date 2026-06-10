import { memo } from 'react'
import clsx from 'clsx'
import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { libraryItemMatchesQuery } from '../../lib/libraryFilter'

export type MapNodeInfo = {
  item: {
    slug: string
    title: string
    summary: string
    type: string
    tags: string[]
    created: string
    updated: string
  }
  pos: { x: number; y: number }
  accent: string
  nodeScale: number
  isSelected: boolean
  isLinkSource: boolean
  isLinkTarget: boolean
  showPin: boolean
}

export type MapNodeProps = {
  info: MapNodeInfo
  linkingFrom: string | null
  highlightSlug: string | null
  connectedSlugs: Set<string>
  searchActive: boolean
  libraryQuery: string
  isDragging: boolean
  onStartDrag: (e: React.PointerEvent, slug: string, x: number, y: number) => void
  onClickNode: (e: React.MouseEvent, slug: string) => void
  onDoubleClickNode: (e: React.MouseEvent, slug: string) => void
  onContextMenuNode: (e: React.MouseEvent, slug: string) => void
  onPointerEnter: (slug: string) => void
  onPointerLeave: () => void
}

export const MapNode = memo(function MapNode({
  info,
  linkingFrom,
  highlightSlug,
  connectedSlugs,
  searchActive,
  libraryQuery,
  isDragging,
  onStartDrag,
  onClickNode,
  onDoubleClickNode,
  onContextMenuNode,
  onPointerEnter,
  onPointerLeave
}: MapNodeProps): React.JSX.Element {
  const { item, pos, accent, nodeScale, isSelected, isLinkSource, isLinkTarget, showPin } = info
  const { t } = useTranslation()

  const searchDim = searchActive && !libraryItemMatchesQuery(item, libraryQuery)
  const nodeDim = highlightSlug !== null && !connectedSlugs.has(item.slug)

  return (
    <div
      className={clsx(
        'map-node',
        isSelected && 'map-node-selected',
        searchDim && 'map-node-search-dim',
        nodeDim && 'map-node-dim',
        isLinkSource && 'map-node-link-source',
        isLinkTarget && 'map-node-link-target',
        isDragging && 'map-node-dragging'
      )}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${nodeScale})` }}
      onPointerDown={(e) => {
        if (linkingFrom) return
        onStartDrag(e, item.slug, pos.x, pos.y)
      }}
      onPointerEnter={() => onPointerEnter(item.slug)}
      onPointerLeave={() => onPointerLeave()}
      onClick={(e) => onClickNode(e, item.slug)}
      onDoubleClick={(e) => onDoubleClickNode(e, item.slug)}
      onContextMenu={(e) => onContextMenuNode(e, item.slug)}
      role="button"
      tabIndex={0}
    >
      <span className="map-node-dot" style={{ background: accent }} aria-hidden />
      <span className="map-node-title">{item.title}</span>
      {item.summary && <span className="map-node-summary">{item.summary}</span>}
      {showPin && (
        <Pin size={12} className="map-node-pin-icon" aria-label={t('map.menu.unpinNote')} />
      )}
    </div>
  )
}, (prev, next) => {
  // Custom areEqual: skip re-render if this node is not affected by highlight change
  const slug = prev.info.item.slug
  const highlightChanged = prev.highlightSlug !== next.highlightSlug
  if (highlightChanged) {
    const wasConnected = prev.connectedSlugs.has(slug)
    const isNowConnected = next.connectedSlugs.has(slug)
    // If this node's dim state wouldn't change, skip the re-render
    if (wasConnected === isNowConnected) {
      // Still need to check other props
      return (
        prev.info === next.info &&
        prev.linkingFrom === next.linkingFrom &&
        prev.searchActive === next.searchActive &&
        prev.libraryQuery === next.libraryQuery &&
        prev.isDragging === next.isDragging &&
        prev.onStartDrag === next.onStartDrag &&
        prev.onClickNode === next.onClickNode &&
        prev.onDoubleClickNode === next.onDoubleClickNode &&
        prev.onContextMenuNode === next.onContextMenuNode &&
        prev.onPointerEnter === next.onPointerEnter &&
        prev.onPointerLeave === next.onPointerLeave
      )
    }
  }
  // For all other cases, do shallow comparison
  return (
    prev.info === next.info &&
    prev.linkingFrom === next.linkingFrom &&
    prev.highlightSlug === next.highlightSlug &&
    prev.connectedSlugs === next.connectedSlugs &&
    prev.searchActive === next.searchActive &&
    prev.libraryQuery === next.libraryQuery &&
    prev.isDragging === next.isDragging &&
    prev.onStartDrag === next.onStartDrag &&
    prev.onClickNode === next.onClickNode &&
    prev.onDoubleClickNode === next.onDoubleClickNode &&
    prev.onContextMenuNode === next.onContextMenuNode &&
    prev.onPointerEnter === next.onPointerEnter &&
    prev.onPointerLeave === next.onPointerLeave
  )
})
