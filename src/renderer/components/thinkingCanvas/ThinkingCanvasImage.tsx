import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { canvasAssetUrl } from '../../lib/thinkingCanvas/api'
import type { ThinkingImageElement } from '../../lib/thinkingCanvas/types'

export function ThinkingCanvasImage({
  element,
  selected,
  dragging,
  onDragStart,
  onContextMenu
}: {
  element: ThinkingImageElement
  selected: boolean
  dragging: boolean
  onDragStart: (e: React.PointerEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.getSidecarBase().then((base) => {
      if (!cancelled && base) setSrc(canvasAssetUrl(base, element.assetId))
    })
    return () => {
      cancelled = true
    }
  }, [element.assetId])

  return (
    <div
      className={clsx(
        'thinking-canvas-image',
        selected && 'thinking-canvas-image-selected',
        dragging && 'thinking-canvas-image-dragging'
      )}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onDragStart(e)
      }}
      onContextMenu={onContextMenu}
    >
      {src ? (
        <img src={src} alt={element.originalName ?? ''} draggable={false} />
      ) : (
        <div className="thinking-canvas-image-placeholder" />
      )}
    </div>
  )
}
