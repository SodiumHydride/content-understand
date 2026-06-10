import type { MapCanvasRect } from './mapCanvasBounds'

/** Viewport pan (screen px) + zoom (1 = 100%). Same model as tldraw/Figma camera. */
export type MapCamera = { x: number; y: number; z: number }

export const MAP_ZOOM_MIN = 0.35
export const MAP_ZOOM_MAX = 2.25
const ZOOM_STEP = 1.1

export function clampZoom(z: number): number {
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, z))
}

export function screenToWorld(
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  camera: MapCamera
): { x: number; y: number } {
  return {
    x: (clientX - viewportRect.left - camera.x) / camera.z,
    y: (clientY - viewportRect.top - camera.y) / camera.z
  }
}

/** Zoom toward cursor — keeps the world point under the pointer fixed. */
export function zoomCameraAtPoint(
  camera: MapCamera,
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  zoomIn: boolean
): MapCamera {
  const nextZ = clampZoom(camera.z * (zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP))
  const wx = (clientX - viewportRect.left - camera.x) / camera.z
  const wy = (clientY - viewportRect.top - camera.y) / camera.z
  return {
    x: clientX - viewportRect.left - wx * nextZ,
    y: clientY - viewportRect.top - wy * nextZ,
    z: nextZ
  }
}

export function panCamera(camera: MapCamera, dx: number, dy: number): MapCamera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}

export function cameraTransform(camera: MapCamera): string {
  const x = Number.isFinite(camera.x) ? camera.x : 0
  const y = Number.isFinite(camera.y) ? camera.y : 0
  const z = Number.isFinite(camera.z) && camera.z > 0 ? camera.z : 1
  return `translate(${x}px, ${y}px) scale(${z})`
}

export type MapContentBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function contentBoundsFromRects(rects: MapCanvasRect[]): MapContentBounds | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { minX, minY, maxX, maxY }
}

/** Center content in the viewport on first visit. */
export function cameraToFitBounds(
  bounds: MapContentBounds,
  viewportW: number,
  viewportH: number,
  pad = 96
): MapCamera {
  const contentW = bounds.maxX - bounds.minX + pad * 2
  const contentH = bounds.maxY - bounds.minY + pad * 2
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const z = clampZoom(
    Math.min(
      viewportW / Math.max(contentW, 320),
      viewportH / Math.max(contentH, 240),
      1
    )
  )
  return {
    x: viewportW / 2 - cx * z,
    y: viewportH / 2 - cy * z,
    z
  }
}
