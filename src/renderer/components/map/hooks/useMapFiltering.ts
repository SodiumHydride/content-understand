import { useEffect, useMemo, useState } from 'react'
import { MAP_NODE_H, MAP_NODE_W, type MapCanvasRect } from '../../../lib/mapCanvasBounds'
import { documentBounds } from '../../../lib/thinkingCanvas/strokeGeometry'
import type { LibraryItem } from '../../../stores/types'
import type { ThinkingCanvasDocument } from '../../../lib/thinkingCanvas/types'

export type UseMapFilteringResult = {
  filteredLibrary: LibraryItem[]
  visibleSlugs: Set<string>
  noteRects: MapCanvasRect[]
  canvasRects: MapCanvasRect[]
  clusters: { tag: string; cx: number; cy: number; r: number }[]
  localGraphSlugs: Set<string>
  noteTimestamps: { slug: string; time: number }[]
  timeRange: { min: number; max: number }
  timelineEnabled: boolean
  setTimelineEnabled: (v: boolean) => void
  timeFilter: number
  setTimeFilter: (v: number) => void
  focusLocal: boolean
  setFocusLocal: (v: boolean | ((prev: boolean) => boolean)) => void
}

type MapItem = {
  slug: string
  title: string
  summary: string
  type: string
  tags: string[]
  created: string
  updated: string
}

export function useMapFiltering(opts: {
  library: MapItem[]
  selectedSlug: string | null
  mapMode: 'thinking' | 'wiki'
  graphEdges?: { source_slug: string; target_slug: string }[]
  layout: Record<string, { x: number; y: number }>
  thinkingCanvas: ThinkingCanvasDocument | null
}): UseMapFilteringResult {
  const [focusLocal, setFocusLocal] = useState(false)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timeFilter, setTimeFilter] = useState<number>(0)

  // Neighborhood Expansion (1-hop and 2-hop local graph slugs)
  const localGraphSlugs = useMemo(() => {
    const set = new Set<string>()
    if (!opts.selectedSlug || !opts.graphEdges) return set
    set.add(opts.selectedSlug)
    const oneHop = new Set<string>()
    for (const edge of opts.graphEdges) {
      if (edge.source_slug === opts.selectedSlug) oneHop.add(edge.target_slug)
      if (edge.target_slug === opts.selectedSlug) oneHop.add(edge.source_slug)
    }
    for (const slug of oneHop) {
      set.add(slug)
    }
    for (const edge of opts.graphEdges) {
      if (oneHop.has(edge.source_slug)) set.add(edge.target_slug)
      if (oneHop.has(edge.target_slug)) set.add(edge.source_slug)
    }
    return set
  }, [opts.selectedSlug, opts.graphEdges])

  // Timestamps of notes for timeline filter
  const noteTimestamps = useMemo(() => {
    return opts.library.map(item => {
      const dateStr = item.updated || item.created || ''
      const time = dateStr ? new Date(dateStr).getTime() : 0
      return { slug: item.slug, time }
    }).filter(x => x.time > 0)
  }, [opts.library])

  const timeRange = useMemo(() => {
    if (noteTimestamps.length === 0) return { min: 0, max: 0 }
    const times = noteTimestamps.map(x => x.time)
    return { min: Math.min(...times), max: Math.max(...times) }
  }, [noteTimestamps])

  // Sync default timeFilter to max when range changes
  useEffect(() => {
    if (timeRange.max > 0 && timeFilter === 0) {
      setTimeFilter(timeRange.max)
    }
  }, [timeRange, timeFilter])

  // Filter notes based on timeline and focusLocal
  const filteredLibrary = useMemo(() => {
    return opts.library.filter(item => {
      if (focusLocal && opts.selectedSlug && !localGraphSlugs.has(item.slug)) {
        return false
      }
      if (timelineEnabled) {
        const ts = noteTimestamps.find(x => x.slug === item.slug)?.time || 0
        if (ts > timeFilter) return false
      }
      return true
    })
  }, [opts.library, focusLocal, opts.selectedSlug, localGraphSlugs, timelineEnabled, timeFilter, noteTimestamps])

  // Memoized Set of visible slugs for WikiEdgeLayer
  const visibleSlugs = useMemo(
    () => new Set(filteredLibrary.map((i) => i.slug)),
    [filteredLibrary]
  )

  // Note rects for minimap / auto-fit
  const noteRects = useMemo((): MapCanvasRect[] => {
    return filteredLibrary.map((item) => {
      const pos = opts.layout[item.slug] ?? { x: 48, y: 48 }
      return { x: pos.x, y: pos.y, w: MAP_NODE_W, h: MAP_NODE_H }
    })
  }, [filteredLibrary, opts.layout])

  const canvasRects = useMemo((): MapCanvasRect[] => {
    const rects = [...noteRects]
    if (opts.mapMode === 'thinking' && opts.thinkingCanvas) {
      const bounds = documentBounds(opts.thinkingCanvas, [])
      if (bounds) rects.push({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })
    }
    return rects
  }, [noteRects, opts.mapMode, opts.thinkingCanvas])

  // Tag clusters bounding circles calculation
  const clusters = useMemo(() => {
    if (opts.mapMode !== 'wiki') return []
    const tagGroups: Record<string, string[]> = {}
    for (const item of filteredLibrary) {
      for (const tag of item.tags) {
        if (!tagGroups[tag]) tagGroups[tag] = []
        tagGroups[tag].push(item.slug)
      }
    }
    const list: { tag: string; cx: number; cy: number; r: number }[] = []
    for (const [tag, slugs] of Object.entries(tagGroups)) {
      if (slugs.length >= 2) {
        let sumX = 0, sumY = 0, count = 0
        for (const slug of slugs) {
          const pos = opts.layout[slug]
          if (pos) {
            sumX += pos.x
            sumY += pos.y
            count++
          }
        }
        if (count >= 2) {
          const cx = sumX / count
          const cy = sumY / count
          let maxD = 0
          for (const slug of slugs) {
            const pos = opts.layout[slug]
            if (pos) {
              const d = Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2)
              if (d > maxD) maxD = d
            }
          }
          list.push({
            tag,
            cx: cx + MAP_NODE_W / 2,
            cy: cy + MAP_NODE_H / 2,
            r: maxD + 80
          })
        }
      }
    }
    return list
  }, [filteredLibrary, opts.layout, opts.mapMode])

  return {
    filteredLibrary,
    visibleSlugs,
    noteRects,
    canvasRects,
    clusters,
    localGraphSlugs,
    noteTimestamps,
    timeRange,
    timelineEnabled,
    setTimelineEnabled,
    timeFilter,
    setTimeFilter,
    focusLocal,
    setFocusLocal
  }
}
