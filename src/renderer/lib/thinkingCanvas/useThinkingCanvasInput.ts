import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import type { CanvasPoint, ThinkingStrokeElement, ThinkingTool } from './types'
import {
  createImageElement,
  createStrokeElement,
  createTextElement,
  createEmptyDocument,
  moveElement,
  removeElements,
  updateTextContent
} from './document'
import { strokeStyleForTool } from './defaults'
import { applyEraser, hitTestDocument } from './strokeGeometry'
import { saveThinkingCanvas } from './api'

const STROKE_MIN_DIST = 2
const DRAG_THRESHOLD = 5

function canvasPoint(clientX: number, clientY: number, pressure: number): CanvasPoint {
  return { x: clientX, y: clientY, p: pressure, t: Date.now() }
}

export function useThinkingCanvasPersistence(enabled: boolean): void {
  const doc = useAppStore((s) => s.thinkingCanvas)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled || !doc) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void saveThinkingCanvas(doc).then((saved) => {
        if (saved) useAppStore.getState().setThinkingCanvas(saved)
      })
    }, 800)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [doc, enabled])
}

export function useThinkingCanvasInput(options: {
  enabled: boolean
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number }
  isCanvasTarget: (target: EventTarget | null) => boolean
  spaceHeld: () => boolean
  capturePointer: (e: React.PointerEvent) => void
}) {
  const toolPrefs = useAppStore((s) => s.thinkingToolPrefs)
  const setToolPrefs = useAppStore((s) => s.setThinkingToolPrefs)
  const patchDoc = useAppStore((s) => s.patchThinkingCanvas)

  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeStroke, setActiveStroke] = useState<ThinkingStrokeElement | null>(null)
  const [eraserPath, setEraserPath] = useState<CanvasPoint[]>([])
  const [drag, setDrag] = useState<{
    kind: 'text' | 'image'
    id: string
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const movedRef = useRef(false)
  const skipClickRef = useRef(false)

  const tool = toolPrefs.activeTool

  const setTool = useCallback(
    (next: ThinkingTool) => {
      setToolPrefs({ activeTool: next })
      setEditingTextId(null)
    },
    [setToolPrefs]
  )

  const worldFromEvent = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const w = options.clientToWorld(e.clientX, e.clientY)
      const pressure = typeof e.pressure === 'number' && e.pressure > 0 ? e.pressure : 0.5
      return canvasPoint(w.x, w.y, pressure)
    },
    [options]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!options.enabled || e.button !== 0 || options.spaceHeld()) return

      const onCanvas = options.isCanvasTarget(e.target)

      if (tool === 'pen' || tool === 'highlighter') {
        if (!onCanvas) return
        e.preventDefault()
        options.capturePointer(e)
        const pt = worldFromEvent(e)
        setActiveStroke({
          id: `stroke-${crypto.randomUUID()}`,
          kind: 'stroke',
          zIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          points: [pt],
          style: { ...strokeStyleForTool(toolPrefs, tool) }
        })
        setEditingTextId(null)
        return
      }

      if (tool === 'eraser') {
        if (!onCanvas) return
        e.preventDefault()
        options.capturePointer(e)
        setEraserPath([worldFromEvent(e)])
        return
      }

      if (tool === 'text') {
        if (!onCanvas) return
        e.preventDefault()
        skipClickRef.current = true
        const pt = worldFromEvent(e)
        patchDoc((doc) => {
          const result = createTextElement(doc, pt.x, pt.y, '', toolPrefs.text)
          setEditingTextId(result.element.id)
          return result.doc
        })
        return
      }

      if (tool === 'select' && onCanvas) {
        const pt = worldFromEvent(e)
        const doc = useAppStore.getState().thinkingCanvas ?? createEmptyDocument()
        const hit = hitTestDocument(doc, pt.x, pt.y)
        setSelectedIds(hit ? [hit.id] : [])
        setEditingTextId(null)
      }
    },
    [options, tool, toolPrefs, patchDoc, worldFromEvent]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!options.enabled) return

      if (activeStroke) {
        const pt = worldFromEvent(e)
        setActiveStroke((prev) => {
          if (!prev) return null
          const last = prev.points[prev.points.length - 1]
          if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) < STROKE_MIN_DIST) return prev
          return { ...prev, points: [...prev.points, pt] }
        })
        return
      }

      if (eraserPath.length > 0 && tool === 'eraser') {
        const pt = worldFromEvent(e)
        setEraserPath((prev) => {
          const last = prev[prev.length - 1]
          if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < STROKE_MIN_DIST) return prev
          return [...prev, pt]
        })
      }
    },
    [options.enabled, activeStroke, eraserPath.length, tool, worldFromEvent]
  )

  const finishPointer = useCallback(
    (zoom: number) => {
      if (activeStroke && activeStroke.points.length > 1) {
        patchDoc((doc) => createStrokeElement(doc, activeStroke.points, activeStroke.style).doc)
      }
      setActiveStroke(null)

      if (eraserPath.length > 0) {
        patchDoc((doc) =>
          applyEraser(doc, eraserPath, toolPrefs.eraser.mode, toolPrefs.eraser.width)
        )
      }
      setEraserPath([])

      if (drag && movedRef.current) {
        const dx = 0
        void dx
        void zoom
      }
      setDrag(null)
      window.setTimeout(() => {
        movedRef.current = false
      }, 0)
    },
    [activeStroke, eraserPath, drag, patchDoc, toolPrefs.eraser]
  )

  const handlePointerMoveWithZoom = useCallback(
    (e: React.PointerEvent, zoom: number) => {
      if (drag) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        movedRef.current = true
        patchDoc((doc) => moveElement(doc, drag.id, drag.originX + dx / zoom, drag.originY + dy / zoom))
        return
      }
      handlePointerMove(e)
    },
    [drag, handlePointerMove, patchDoc]
  )

  const handleCanvasClick = useCallback(() => {
    if (skipClickRef.current) {
      skipClickRef.current = false
      return false
    }
    if (editingTextId) {
      const doc = useAppStore.getState().thinkingCanvas
      const el = doc?.elements.find((x) => x.id === editingTextId)
      if (el?.kind === 'text' && !el.text.trim()) {
        patchDoc((d) => removeElements(d, new Set([editingTextId])))
      }
      setEditingTextId(null)
    }
    if (tool === 'select') setSelectedIds([])
    return true
  }, [editingTextId, patchDoc, tool])

  const commitTextEdit = useCallback(
    (id: string, draft: string) => {
      const trimmed = draft.trimEnd()
      if (!trimmed) {
        patchDoc((doc) => removeElements(doc, new Set([id])))
      } else {
        patchDoc((doc) => updateTextContent(doc, id, trimmed))
      }
      setEditingTextId(null)
    },
    [patchDoc]
  )

  const cancelTextEdit = useCallback(() => {
    if (editingTextId) {
      const doc = useAppStore.getState().thinkingCanvas
      const el = doc?.elements.find((x) => x.id === editingTextId)
      if (el?.kind === 'text' && !el.text.trim()) {
        patchDoc((d) => removeElements(d, new Set([editingTextId])))
      }
    }
    setEditingTextId(null)
  }, [editingTextId, patchDoc])

  const startElementDrag = useCallback(
    (e: React.PointerEvent, kind: 'text' | 'image', id: string, x: number, y: number) => {
      if (tool !== 'select' || editingTextId === id) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      movedRef.current = false
      setDrag({ kind, id, startX: e.clientX, startY: e.clientY, originX: x, originY: y })
      setSelectedIds([id])
    },
    [tool, editingTextId]
  )

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    patchDoc((doc) => removeElements(doc, new Set(selectedIds)))
    setSelectedIds([])
  }, [selectedIds, patchDoc])

  const insertImage = useCallback(
    async (blob: Blob, mimeType: string, worldX: number, worldY: number, name?: string) => {
      const { uploadCanvasAsset } = await import('./api')
      const uploaded = await uploadCanvasAsset(blob, mimeType, name)
      if (!uploaded) return

      const url = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image load failed'))
        img.src = url
      })
      URL.revokeObjectURL(url)

      const maxW = 480
      const scale = img.width > maxW ? maxW / img.width : 1
      const width = img.width * scale
      const height = img.height * scale

      patchDoc((doc) =>
        createImageElement(
          doc,
          worldX - width / 2,
          worldY - height / 2,
          width,
          height,
          uploaded.assetId,
          uploaded.mimeType,
          name
        ).doc
      )
    },
    [patchDoc]
  )

  return {
    tool,
    toolPrefs,
    setTool,
    setToolPrefs,
    editingTextId,
    setEditingTextId,
    selectedIds,
    activeStroke,
    eraserPath,
    handlePointerDown,
    handlePointerMoveWithZoom,
    finishPointer,
    handleCanvasClick,
    commitTextEdit,
    cancelTextEdit,
    startElementDrag,
    deleteSelected,
    insertImage
  }
}
