import { useCallback, useState } from 'react'
import type { MapMode } from '../../../stores/types'

export type DragState = {
  kind: 'note'
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
}

export type UseMapDragResult = {
  drag: DragState | null
  startNoteDrag: (e: React.PointerEvent, slug: string, x: number, y: number) => void
  handleDragMove: (e: React.PointerEvent) => boolean
  endDrag: () => void
}

export function useMapDrag(opts: {
  cameraZ: number
  mapMode: 'thinking' | 'wiki'
  tool: string
  setMapNodePos: (mode: MapMode, slug: string, pos: { x: number; y: number }) => void
  wikiLayoutMode: string
  wikiPinnedSlugs: string[]
  toggleWikiPin: (slug: string) => void
}): UseMapDragResult {
  const [drag, setDrag] = useState<DragState | null>(null)

  const startNoteDrag = useCallback(
    (e: React.PointerEvent, slug: string, x: number, y: number): void => {
      if (opts.mapMode === 'thinking' && opts.tool !== 'select') return
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDrag({ kind: 'note', id: slug, startX: e.clientX, startY: e.clientY, originX: x, originY: y })
      // Auto-pin when dragging in wiki force layout
      if (opts.mapMode === 'wiki' && opts.wikiLayoutMode === 'force' && !opts.wikiPinnedSlugs.includes(slug)) {
        opts.toggleWikiPin(slug)
      }
    },
    [opts.mapMode, opts.tool, opts.wikiLayoutMode, opts.wikiPinnedSlugs, opts.toggleWikiPin]
  )

  const handleDragMove = useCallback(
    (e: React.PointerEvent): boolean => {
      if (!drag) return false
      const dx = (e.clientX - drag.startX) / opts.cameraZ
      const dy = (e.clientY - drag.startY) / opts.cameraZ
      opts.setMapNodePos(opts.mapMode, drag.id, { x: drag.originX + dx, y: drag.originY + dy })
      return true
    },
    [drag, opts.cameraZ, opts.mapMode, opts.setMapNodePos]
  )

  const endDrag = useCallback(() => {
    setDrag(null)
  }, [])

  return { drag, startNoteDrag, handleDragMove, endDrag }
}
