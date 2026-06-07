import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasPoint, StrokeStyle, ThinkingStrokeElement } from '../lib/thinkingCanvas/types'
import { applyEraser } from '../lib/thinkingCanvas/strokeGeometry'
import { fetchNoteInk, saveNoteInk } from '../lib/sidecar'

// ── Smooth path for handwriting ──

function smoothPathD(points: CanvasPoint[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (points.length === 2)
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2
    const midY = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

// ── Helpers ──

function nowIso(): string {
  return new Date().toISOString()
}

function newStrokeId(slug: string): string {
  return `${slug}-ink-${crypto.randomUUID()}`
}

function makeStrokeElement(
  slug: string,
  points: CanvasPoint[],
  style: StrokeStyle,
  zIndex: number
): ThinkingStrokeElement {
  const ts = nowIso()
  return {
    id: newStrokeId(slug),
    kind: 'stroke',
    zIndex,
    createdAt: ts,
    updatedAt: ts,
    points: points.map((p) => ({ ...p })),
    style: { ...style }
  }
}

/** Deserialize raw JSON from sidecar into typed stroke elements. */
function deserializeStrokes(raw: Record<string, unknown>[]): ThinkingStrokeElement[] {
  return raw
    .filter(
      (s) => s.kind === 'stroke' && Array.isArray(s.points) && typeof s.id === 'string'
    )
    .map((s) => ({
      id: s.id as string,
      kind: 'stroke' as const,
      zIndex: (s.zIndex as number) ?? 0,
      createdAt: (s.createdAt as string) ?? nowIso(),
      updatedAt: (s.updatedAt as string) ?? nowIso(),
      points: (s.points as { x: number; y: number; p?: number; t?: number }[]).map((p) => ({
        x: p.x,
        y: p.y,
        p: p.p,
        t: p.t
      })),
      style: { ...(s.style as StrokeStyle) }
    }))
}

/** Serialize strokes for sidecar persistence. */
function serializeStrokes(strokes: ThinkingStrokeElement[]): Record<string, unknown>[] {
  return strokes.map((s) => ({
    id: s.id,
    kind: s.kind,
    zIndex: s.zIndex,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    points: s.points,
    style: s.style
  }))
}

// ── Component ──

export interface NoteInkLayerProps {
  slug: string
  scrollRef: React.RefObject<HTMLDivElement | null>
  active: boolean
  tool: 'pen' | 'highlighter' | 'eraser'
  penStyle: StrokeStyle
  highlighterStyle: StrokeStyle
  eraserWidth: number
}

export function NoteInkLayer({
  slug,
  scrollRef,
  active,
  tool,
  penStyle,
  highlighterStyle,
  eraserWidth
}: NoteInkLayerProps): React.JSX.Element {
  const [strokes, setStrokes] = useState<ThinkingStrokeElement[]>([])
  const [activeStroke, setActiveStroke] = useState<ThinkingStrokeElement | null>(null)
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 })

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const nextZ = useRef(1)
  const drawingRef = useRef(false)
  const eraserPointsRef = useRef<CanvasPoint[]>([])

  // ── Coordinate transform ──

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): CanvasPoint => {
      const scroll = scrollRef.current
      if (!scroll) return { x: 0, y: 0 }
      const rect = scroll.getBoundingClientRect()
      return {
        x: clientX - rect.left + scroll.scrollLeft,
        y: clientY - rect.top + scroll.scrollTop,
        t: Date.now()
      }
    },
    [scrollRef]
  )

  // ── Load ink on slug change ──

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const raw = await fetchNoteInk(slug)
      if (cancelled) return
      const loaded = deserializeStrokes(raw)
      setStrokes(loaded)
      // Ensure z-index counter stays ahead of loaded strokes
      if (loaded.length > 0) {
        nextZ.current = Math.max(...loaded.map((s) => s.zIndex)) + 1
      } else {
        nextZ.current = 1
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  // ── Auto-save with debounce ──

  const scheduleSave = useCallback(
    (nextStrokes: ThinkingStrokeElement[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        await saveNoteInk(slug, serializeStrokes(nextStrokes))
      }, 800)
    },
    [slug]
  )

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // ── Resize observer ──

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return

    const measure = () => {
      setSvgSize({
        width: scroll.scrollWidth,
        height: scroll.scrollHeight
      })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scroll)
    // Also observe direct children to catch content changes
    for (let i = 0; i < scroll.children.length; i++) {
      ro.observe(scroll.children[i]!)
    }

    return () => ro.disconnect()
  }, [scrollRef])

  // ── Commit any active stroke (used by slug change / active toggle) ──

  const commitActiveStroke = useCallback(() => {
    setActiveStroke((prev) => {
      if (prev && prev.points.length >= 1) {
        setStrokes((s) => {
          const next = [...s, prev]
          scheduleSave(next)
          return next
        })
      }
      return null
    })
    drawingRef.current = false
    eraserPointsRef.current = []
  }, [scheduleSave])

  // Commit active stroke when active toggles off
  useEffect(() => {
    if (!active) {
      commitActiveStroke()
    }
  }, [active, commitActiveStroke])

  // Commit active stroke before slug changes (runs on slug change due to cleanup)
  const prevSlugRef = useRef(slug)
  useEffect(() => {
    if (prevSlugRef.current !== slug) {
      // Force save immediately for the old slug
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setActiveStroke((prev) => {
        if (prev && prev.points.length >= 1) {
          setStrokes((s) => {
            const next = [...s, prev]
            // Immediate save for slug transition
            saveNoteInk(prevSlugRef.current, serializeStrokes(next))
            return next
          })
        }
        return null
      })
      drawingRef.current = false
      eraserPointsRef.current = []
      prevSlugRef.current = slug
    }
  }, [slug])

  // ── Pointer handlers ──

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

      const point: CanvasPoint = {
        ...clientToWorld(e.clientX, e.clientY),
        p: e.pressure || 0.5
      }

      if (tool === 'eraser') {
        drawingRef.current = true
        eraserPointsRef.current = [point]
        return
      }

      const style = tool === 'pen' ? penStyle : highlighterStyle
      const stroke = makeStrokeElement(slug, [point], style, nextZ.current++)
      setActiveStroke(stroke)
      drawingRef.current = true
    },
    [active, tool, penStyle, highlighterStyle, slug, clientToWorld]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return
      e.preventDefault()

      const point: CanvasPoint = {
        ...clientToWorld(e.clientX, e.clientY),
        p: e.pressure || 0.5
      }

      if (tool === 'eraser') {
        eraserPointsRef.current.push(point)

        // Apply eraser to all strokes in real-time
        const doc = { schemaVersion: 1, revision: 0, elements: strokes }
        const eraserPoints = eraserPointsRef.current
        const result = applyEraser(doc, eraserPoints, 'partial', eraserWidth)
        const next = result.elements.filter(
          (el): el is ThinkingStrokeElement => el.kind === 'stroke'
        )
        setStrokes(next)
        scheduleSave(next)
        return
      }

      setActiveStroke((prev) => {
        if (!prev) return null
        // Min distance check: skip if too close to last point
        const last = prev.points[prev.points.length - 1]
        if (last) {
          const dx = point.x - last.x
          const dy = point.y - last.y
          if (Math.hypot(dx, dy) < 2) return prev
        }
        return { ...prev, points: [...prev.points, point], updatedAt: nowIso() }
      })
    },
    [tool, clientToWorld, strokes, eraserWidth, scheduleSave]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return
      e.preventDefault()

      if (tool === 'eraser') {
        drawingRef.current = false
        eraserPointsRef.current = []
        return
      }

      // Commit active stroke
      setActiveStroke((prev) => {
        if (prev && prev.points.length >= 1) {
          setStrokes((s) => {
            const next = [...s, prev]
            scheduleSave(next)
            return next
          })
        }
        return null
      })
      drawingRef.current = false
    },
    [tool, scheduleSave]
  )

  return (
    <svg
      className={`ink-overlay ${active ? 'ink-overlay-active' : ''}`}
      width={svgSize.width}
      height={svgSize.height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: active ? 'auto' : 'none',
        overflow: 'visible',
        zIndex: 10,
        touchAction: 'none'
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={smoothPathD(stroke.points)}
          fill="none"
          stroke={stroke.style.color}
          strokeWidth={stroke.style.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.style.variant === 'highlighter' ? stroke.style.opacity : 1}
        />
      ))}
      {activeStroke && (
        <path
          d={smoothPathD(activeStroke.points)}
          fill="none"
          stroke={activeStroke.style.color}
          strokeWidth={activeStroke.style.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={
            activeStroke.style.variant === 'highlighter'
              ? activeStroke.style.opacity
              : 1
          }
        />
      )}
    </svg>
  )
}
