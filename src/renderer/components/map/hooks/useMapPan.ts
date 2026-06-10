import { useRef } from 'react'
import type { MapCamera } from '../../../lib/mapViewport'

export type UseMapPanResult = {
  panRef: React.RefObject<{
    startX: number
    startY: number
    camX: number
    camY: number
  } | null>
  tryStartPan: (e: React.PointerEvent) => boolean
}

export function useMapPan(opts: {
  camera: MapCamera
  viewportRef: React.RefObject<HTMLDivElement | null>
  spaceHeldRef: React.RefObject<boolean>
  isCanvasTarget: (target: EventTarget | null) => boolean
}): UseMapPanResult {
  const panRef = useRef<{
    startX: number
    startY: number
    camX: number
    camY: number
  } | null>(null)

  const tryStartPan = (e: React.PointerEvent): boolean => {
    if (!opts.isCanvasTarget(e.target)) return false
    const middle = e.button === 1
    const spacePan = e.button === 0 && opts.spaceHeldRef.current
    if (!middle && !spacePan) return false
    e.preventDefault()
    opts.viewportRef.current?.setPointerCapture(e.pointerId)
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      camX: opts.camera.x,
      camY: opts.camera.y
    }
    return true
  }

  return { panRef, tryStartPan }
}
