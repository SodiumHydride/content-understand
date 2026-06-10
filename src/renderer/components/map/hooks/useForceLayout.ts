import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../../../stores/appStore'
import { animateForceLayout, type ForceEdge } from '../../../lib/forceLayout'
import type { MapMode } from '../../../stores/types'

export type UseForceLayoutResult = {
  /** Whether force layout animation is currently running. */
  forceRunningRef: React.MutableRefObject<boolean>
  /** Memoized force edges derived from graph data. */
  forceEdges: ForceEdge[]
}

export function useForceLayout(opts: {
  mapMode: 'thinking' | 'wiki'
  wikiLayoutMode: string
  library: { slug: string }[]
  wikiPinnedSlugs: string[]
  wikiMap: Record<string, { x: number; y: number }>
  graphEdges?: { source_slug: string; target_slug: string }[]
  setMapNodePos: (mode: MapMode, slug: string, pos: { x: number; y: number }) => void
}): UseForceLayoutResult {
  const forceRunningRef = useRef(false)
  const wikiMapRef = useRef(opts.wikiMap)
  useEffect(() => { wikiMapRef.current = opts.wikiMap }, [opts.wikiMap])

  const forceEdges = useMemo((): ForceEdge[] => {
    if (!opts.graphEdges) return []
    return opts.graphEdges.map((e) => ({ source: e.source_slug, target: e.target_slug }))
  }, [opts.graphEdges])

  // Force layout animation effect
  useEffect(() => {
    if (opts.mapMode !== 'wiki' || opts.wikiLayoutMode !== 'force') return
    if (forceEdges.length === 0) return
    if (opts.library.length === 0) return

    const pinnedSet = new Set(opts.wikiPinnedSlugs)
    const currentLayout = { ...wikiMapRef.current }

    // Ensure every library node has a starting position
    for (const item of opts.library) {
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
        useAppStore.setState((s) => ({
          wikiMap: { ...s.wikiMap, ...positions }
        }))
      },
      (finalPositions) => {
        useAppStore.setState((s) => ({
          wikiMap: { ...s.wikiMap, ...finalPositions }
        }))
        forceRunningRef.current = false
      }
    )

    return () => {
      cancel()
      forceRunningRef.current = false
    }
  }, [opts.mapMode, opts.wikiLayoutMode, forceEdges, opts.library, opts.wikiPinnedSlugs])

  // Grid layout effect
  useEffect(() => {
    if (opts.mapMode !== 'wiki' || opts.wikiLayoutMode !== 'grid') return
    const cols = Math.ceil(Math.sqrt(opts.library.length))
    const spacingX = 220
    const spacingY = 160
    for (let i = 0; i < opts.library.length; i++) {
      const slug = opts.library[i].slug
      const col = i % cols
      const row = Math.floor(i / cols)
      opts.setMapNodePos('wiki', slug, { x: 48 + col * spacingX, y: 48 + row * spacingY })
    }
  }, [opts.wikiLayoutMode])

  return { forceRunningRef, forceEdges }
}
