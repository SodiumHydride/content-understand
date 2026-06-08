import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchGraph, type GraphEdge } from '../lib/sidecar'
import { MAP_NODE_H, MAP_NODE_W } from '../lib/mapCanvasBounds'
import { useAppStore } from '../stores/appStore'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../lib/contentMeta'

interface MapNodePos {
  x: number
  y: number
}

interface WikiEdgeLayerProps {
  layout: Record<string, MapNodePos>
  highlightSlug: string | null
}

function buildPath(src: MapNodePos, tgt: MapNodePos): string {
  const x1 = src.x + MAP_NODE_W / 2
  const y1 = src.y + MAP_NODE_H / 2
  const x2 = tgt.x + MAP_NODE_W / 2
  const y2 = tgt.y + MAP_NODE_H / 2

  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  const offset = dist * 0.15

  const cx1 = x1 + dx * 0.25
  const cy1 = y1 + offset
  const cx2 = x1 + dx * 0.75
  const cy2 = y2 - offset

  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
}

export function WikiEdgeLayer({ layout, highlightSlug }: WikiEdgeLayerProps): React.JSX.Element | null {
  const library = useAppStore((s) => s.library)

  const { data: graph } = useQuery({
    queryKey: ['wiki-graph'],
    queryFn: fetchGraph,
    staleTime: 30_000
  })

  const slugToType = useMemo(() => {
    const map = new Map<string, ShelfType>()
    for (const item of library) {
      map.set(item.slug, normalizeShelfType(String(item.type)))
    }
    return map
  }, [library])

  const edges = useMemo(() => {
    if (!graph?.edges) return []
    // Deduplicate bidirectional edges — only render one line per pair
    const seen = new Set<string>()
    return graph.edges.filter((e) => {
      if (!layout[e.source_slug] || !layout[e.target_slug]) return false
      const key = e.source_slug < e.target_slug
        ? `${e.source_slug}|${e.target_slug}`
        : `${e.target_slug}|${e.source_slug}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [graph?.edges, layout])

  // Compute SVG dimensions from layout extents
  const svgSize = useMemo(() => {
    const entries = Object.values(layout)
    if (entries.length === 0) return { width: 0, height: 0 }
    let maxX = 0
    let maxY = 0
    for (const pos of entries) {
      maxX = Math.max(maxX, pos.x + MAP_NODE_W)
      maxY = Math.max(maxY, pos.y + MAP_NODE_H)
    }
    return { width: maxX + 80, height: maxY + 80 }
  }, [layout])

  if (edges.length === 0 || svgSize.width === 0) return null

  return (
    <svg
      className="wiki-edge-layer"
      width={svgSize.width}
      height={svgSize.height}
      viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
    >
      {edges.map((edge) => {
        const srcPos = layout[edge.source_slug]
        const tgtPos = layout[edge.target_slug]
        if (!srcPos || !tgtPos) return null

        const srcType = slugToType.get(edge.source_slug) ?? 'article'
        const accent = TYPE_STYLES[srcType].accent

        const isConnected =
          highlightSlug !== null &&
          (edge.source_slug === highlightSlug || edge.target_slug === highlightSlug)

        let opacity = 0.25
        let strokeWidth = 1.5
        if (highlightSlug !== null) {
          if (isConnected) {
            opacity = 0.7
            strokeWidth = 2
          } else {
            opacity = 0.05
          }
        }

        return (
          <path
            key={`${edge.source_slug}->${edge.target_slug}`}
            d={buildPath(srcPos, tgtPos)}
            fill="none"
            stroke={accent}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}
