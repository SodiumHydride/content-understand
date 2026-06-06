import type {
  CanvasPoint,
  EraserMode,
  ThinkingCanvasDocument,
  ThinkingElement,
  ThinkingImageElement,
  ThinkingStrokeElement,
  ThinkingTextElement
} from './types'
import { effectivePointWidth, eraserRadius } from './defaults'

const TEXT_EST_W = 176
const TEXT_EST_H = 40

export type ElementBounds = { x: number; y: number; w: number; h: number }

export function strokePathD(points: CanvasPoint[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (const p of rest) {
    d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  }
  return d
}

/** Variable-width pen as overlapping circles (pressure-aware). */
export function strokeCircleNodes(
  points: CanvasPoint[],
  baseWidth: number
): { cx: number; cy: number; r: number }[] {
  if (points.length === 0) return []
  const nodes: { cx: number; cy: number; r: number }[] = []
  for (const p of points) {
    nodes.push({
      cx: p.x,
      cy: p.y,
      r: effectivePointWidth(baseWidth, p) / 2
    })
  }
  return nodes
}

function dist(a: CanvasPoint, b: CanvasPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointNearEraser(
  point: CanvasPoint,
  eraserPoints: CanvasPoint[],
  radius: number,
  strokeWidth: number
): boolean {
  const hitRadius = radius + strokeWidth / 2
  for (const e of eraserPoints) {
    if (dist(point, e) <= hitRadius) return true
  }
  return false
}

function splitStrokeByEraser(
  stroke: ThinkingStrokeElement,
  eraserPoints: CanvasPoint[],
  radius: number
): ThinkingStrokeElement[] {
  const segments: CanvasPoint[][] = []
  let current: CanvasPoint[] = []

  for (const point of stroke.points) {
    if (pointNearEraser(point, eraserPoints, radius, stroke.style.width)) {
      if (current.length >= 2) segments.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  if (current.length >= 2) segments.push(current)

  return segments.map((points, i) => ({
    ...stroke,
    id: i === 0 ? stroke.id : `${stroke.id}-split-${i}`,
    points,
    updatedAt: new Date().toISOString()
  }))
}

export function applyEraser(
  doc: ThinkingCanvasDocument,
  eraserPoints: CanvasPoint[],
  mode: EraserMode,
  eraserWidth: number
): ThinkingCanvasDocument {
  if (eraserPoints.length === 0) return doc

  const radius = eraserRadius(mode, eraserWidth)
  const toRemove = new Set<string>()
  const toAdd: ThinkingStrokeElement[] = []

  for (const el of doc.elements) {
    if (el.kind !== 'stroke') continue

    if (mode === 'stroke') {
      const hit = el.points.some((p) => pointNearEraser(p, eraserPoints, radius, el.style.width))
      if (hit) toRemove.add(el.id)
      continue
    }

    const parts = splitStrokeByEraser(el, eraserPoints, radius)
    if (parts.length === 0) {
      toRemove.add(el.id)
    } else if (parts.length === 1 && parts[0].points.length === el.points.length) {
      continue
    } else {
      toRemove.add(el.id)
      toAdd.push(...parts)
    }
  }

  const elements = [...doc.elements.filter((e) => !toRemove.has(e.id)), ...toAdd]
  return { ...doc, elements }
}

export function elementBounds(el: ThinkingElement): ElementBounds {
  if (el.kind === 'text') {
    const lines = Math.max(1, el.text.split('\n').length)
    const estH = Math.max(TEXT_EST_H, lines * el.style.fontSize * el.style.lineHeight)
    return { x: el.x, y: el.y, w: TEXT_EST_W, h: estH }
  }
  if (el.kind === 'image') {
    return { x: el.x, y: el.y, w: el.width, h: el.height }
  }
  if (el.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of el.points) {
    const pad = el.style.width
    minX = Math.min(minX, p.x - pad)
    minY = Math.min(minY, p.y - pad)
    maxX = Math.max(maxX, p.x + pad)
    maxY = Math.max(maxY, p.y + pad)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function hitTestElement(
  el: ThinkingElement,
  worldX: number,
  worldY: number,
  padding = 6
): boolean {
  const b = elementBounds(el)
  return (
    worldX >= b.x - padding &&
    worldX <= b.x + b.w + padding &&
    worldY >= b.y - padding &&
    worldY <= b.y + b.h + padding
  )
}

export function hitTestDocument(
  doc: ThinkingCanvasDocument,
  worldX: number,
  worldY: number
): ThinkingElement | undefined {
  const sorted = [...doc.elements].sort((a, b) => b.zIndex - a.zIndex)
  return sorted.find((el) => {
    if (el.kind === 'stroke') {
      return el.points.some((p) => dist(p, { x: worldX, y: worldY }) <= el.style.width + 4)
    }
    return hitTestElement(el, worldX, worldY)
  })
}

export function documentBounds(
  doc: ThinkingCanvasDocument,
  noteRects: ElementBounds[] = []
): ElementBounds | null {
  const all = [...noteRects]
  for (const el of doc.elements) {
    all.push(elementBounds(el))
  }
  if (all.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of all) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export type { ThinkingTextElement, ThinkingImageElement, ThinkingStrokeElement }
