import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cameraToFitBounds,
  contentBoundsFromRects,
  panCamera,
  screenToWorld,
  zoomCameraAtPoint,
  type MapCamera
} from '../../../lib/mapViewport'
import type { MapCanvasRect } from '../../../lib/mapCanvasBounds'

export type UseMapCameraResult = {
  camera: MapCamera
  setCamera: React.Dispatch<React.SetStateAction<MapCamera>>
  viewportRef: React.RefObject<HTMLDivElement | null>
  viewportSize: { width: number; height: number }
  onWheel: (e: React.WheelEvent) => void
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number }
  /** Auto-fit camera to content bounds on first visit per mode. */
  useAutoFit: (canvasRects: MapCanvasRect[], mapMode: string, libraryLength: number) => void
}

export function useMapCamera(): UseMapCameraResult {
  const viewportRef = useRef<HTMLDivElement>(null)
  const fittedModeRef = useRef<{ thinking: boolean; wiki: boolean }>({
    thinking: false,
    wiki: false
  })

  const [camera, setCamera] = useState<MapCamera>({ x: 0, y: 0, z: 1 })
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 })

  // Viewport resize tracking
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        })
      }
    })
    resizeObserver.observe(viewport)
    return () => resizeObserver.disconnect()
  }, [])

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport) return { x: 96, y: 96 }
      return screenToWorld(clientX, clientY, viewport.getBoundingClientRect(), camera)
    },
    [camera]
  )

  const onWheel = useCallback((e: React.WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport) return
    e.preventDefault()
    const rect = viewport.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      setCamera((c) => zoomCameraAtPoint(c, e.clientX, e.clientY, rect, e.deltaY < 0))
    } else {
      setCamera((c) => panCamera(c, -e.deltaX, -e.deltaY))
    }
  }, [])

  const useAutoFit = useCallback(
    (canvasRects: MapCanvasRect[], mapMode: string, libraryLength: number) => {
      useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport || fittedModeRef.current[mapMode as 'thinking' | 'wiki']) return
        if (mapMode === 'wiki' && libraryLength === 0) return
        if (mapMode === 'thinking' && canvasRects.length === 0) return
        const bounds = contentBoundsFromRects(canvasRects)
        if (!bounds) return
        const fit = (): void => {
          if (fittedModeRef.current[mapMode as 'thinking' | 'wiki']) return
          const { width, height } = viewport.getBoundingClientRect()
          if (width < 32 || height < 32) return
          setCamera(cameraToFitBounds(bounds, width, height))
          fittedModeRef.current[mapMode as 'thinking' | 'wiki'] = true
        }
        fit()
        const ro = new ResizeObserver(fit)
        ro.observe(viewport)
        return () => ro.disconnect()
      }, [canvasRects, mapMode, libraryLength])
    },
    []
  )

  return {
    camera,
    setCamera,
    viewportRef,
    viewportSize,
    onWheel,
    clientToWorld,
    useAutoFit
  }
}
