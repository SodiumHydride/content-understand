import { useMemo } from 'react'
import { contentBoundsFromRects, type MapCamera } from '../../lib/mapViewport'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../../lib/contentMeta'
import type { MapCanvasRect } from '../../lib/mapCanvasBounds'

export type MapMinimapProps = {
  canvasRects: MapCanvasRect[]
  filteredLibrary: { slug: string; type: string }[]
  layout: Record<string, { x: number; y: number }>
  camera: MapCamera
  viewportSize: { width: number; height: number }
}

export function MapMinimap({
  canvasRects,
  filteredLibrary,
  layout,
  camera,
  viewportSize
}: MapMinimapProps): React.JSX.Element | null {
  const minimapInfo = useMemo(() => {
    const bounds = contentBoundsFromRects(canvasRects)
    if (!bounds) return null
    const boundsW = bounds.maxX - bounds.minX
    const boundsH = bounds.maxY - bounds.minY
    if (boundsW === 0 || boundsH === 0) return null

    const mw = 180
    const mh = 120
    const scale = Math.min(mw / boundsW, mh / boundsH)

    const width = boundsW * scale
    const height = boundsH * scale

    const nodes = filteredLibrary.map((item) => {
      const pos = layout[item.slug] ?? { x: 48, y: 48 }
      return {
        slug: item.slug,
        x: (pos.x - bounds.minX) * scale,
        y: (pos.y - bounds.minY) * scale,
        color: TYPE_STYLES[normalizeShelfType(String(item.type)) as ShelfType].accent
      }
    })

    const w_left = -camera.x / camera.z
    const w_top = -camera.y / camera.z
    const w_w = viewportSize.width / camera.z
    const w_h = viewportSize.height / camera.z

    const vx = (w_left - bounds.minX) * scale
    const vy = (w_top - bounds.minY) * scale
    const vw = w_w * scale
    const vh = w_h * scale

    return {
      width,
      height,
      nodes,
      viewport: { x: vx, y: vy, w: vw, h: vh }
    }
  }, [canvasRects, filteredLibrary, layout, camera, viewportSize])

  if (!minimapInfo) return null

  return (
    <div className="absolute bottom-4 right-4 z-20 border border-[var(--divider)] rounded-lg overflow-hidden bg-[var(--color-paper)]/80 backdrop-blur-md shadow-md p-2">
      <svg width={minimapInfo.width} height={minimapInfo.height}>
        <rect width={minimapInfo.width} height={minimapInfo.height} fill="none" />
        {minimapInfo.nodes.map((node) => (
          <circle
            key={node.slug}
            cx={node.x}
            cy={node.y}
            r={2}
            fill={node.color}
          />
        ))}
        <rect
          x={minimapInfo.viewport.x}
          y={minimapInfo.viewport.y}
          width={Math.max(2, minimapInfo.viewport.w)}
          height={Math.max(2, minimapInfo.viewport.h)}
          fill="var(--color-accent-soft)"
          stroke="var(--color-accent)"
          strokeWidth={1}
          opacity={0.3}
        />
      </svg>
    </div>
  )
}
