import {
  THINKING_CANVAS_SCHEMA_VERSION,
  type CanvasPoint,
  type LegacyScratchNode,
  type LegacyThinkingStroke,
  type LegacyThinkingTextNode,
  type StrokeStyle,
  type TextStyle,
  type ThinkingCanvasDocument,
  type ThinkingElement,
  type ThinkingImageElement,
  type ThinkingStrokeElement,
  type ThinkingTextElement,
  type ThinkingToolPreferences
} from './types'

export function createEmptyDocument(): ThinkingCanvasDocument {
  return {
    schemaVersion: THINKING_CANVAS_SCHEMA_VERSION,
    revision: 0,
    elements: []
  }
}

export function cloneDocument(doc: ThinkingCanvasDocument): ThinkingCanvasDocument {
  return structuredClone(doc)
}

function nowIso(): string {
  return new Date().toISOString()
}

function nextZIndex(doc: ThinkingCanvasDocument): number {
  if (doc.elements.length === 0) return 1
  return Math.max(...doc.elements.map((e) => e.zIndex)) + 1
}

export function newElementId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function sortByZIndex(elements: ThinkingElement[]): ThinkingElement[] {
  return [...elements].sort((a, b) => a.zIndex - b.zIndex)
}

export function getElement(doc: ThinkingCanvasDocument, id: string): ThinkingElement | undefined {
  return doc.elements.find((e) => e.id === id)
}

export function upsertElement(
  doc: ThinkingCanvasDocument,
  element: ThinkingElement
): ThinkingCanvasDocument {
  const idx = doc.elements.findIndex((e) => e.id === element.id)
  const elements =
    idx >= 0
      ? doc.elements.map((e, i) => (i === idx ? element : e))
      : [...doc.elements, element]
  return { ...doc, elements }
}

export function removeElements(
  doc: ThinkingCanvasDocument,
  ids: Set<string>
): ThinkingCanvasDocument {
  if (ids.size === 0) return doc
  return { ...doc, elements: doc.elements.filter((e) => !ids.has(e.id)) }
}

export function patchElement(
  doc: ThinkingCanvasDocument,
  id: string,
  patch: Partial<ThinkingElement>
): ThinkingCanvasDocument {
  const el = getElement(doc, id)
  if (!el) return doc
  const updated = {
    ...el,
    ...patch,
    updatedAt: nowIso()
  } as ThinkingElement
  return upsertElement(doc, updated)
}

export function moveElement(
  doc: ThinkingCanvasDocument,
  id: string,
  x: number,
  y: number
): ThinkingCanvasDocument {
  const el = getElement(doc, id)
  if (!el || (el.kind !== 'text' && el.kind !== 'image')) return doc
  if (el.kind === 'text') {
    return upsertElement(doc, { ...el, x, y, updatedAt: nowIso() })
  }
  return upsertElement(doc, { ...el, x, y, updatedAt: nowIso() })
}

export function updateTextContent(
  doc: ThinkingCanvasDocument,
  id: string,
  text: string
): ThinkingCanvasDocument {
  const el = getElement(doc, id)
  if (!el || el.kind !== 'text') return doc
  return upsertElement(doc, { ...el, text, updatedAt: nowIso() })
}

export function createTextElement(
  doc: ThinkingCanvasDocument,
  x: number,
  y: number,
  text: string,
  style: TextStyle
): { doc: ThinkingCanvasDocument; element: ThinkingTextElement } {
  const ts = nowIso()
  const element: ThinkingTextElement = {
    id: newElementId('text'),
    kind: 'text',
    zIndex: nextZIndex(doc),
    createdAt: ts,
    updatedAt: ts,
    x,
    y,
    text,
    style: { ...style }
  }
  return { doc: upsertElement(doc, element), element }
}

export function createStrokeElement(
  doc: ThinkingCanvasDocument,
  points: CanvasPoint[],
  style: StrokeStyle
): { doc: ThinkingCanvasDocument; element: ThinkingStrokeElement } {
  const ts = nowIso()
  const element: ThinkingStrokeElement = {
    id: newElementId('stroke'),
    kind: 'stroke',
    zIndex: nextZIndex(doc),
    createdAt: ts,
    updatedAt: ts,
    points: points.map((p) => ({ ...p })),
    style: { ...style }
  }
  return { doc: upsertElement(doc, element), element }
}

export function createImageElement(
  doc: ThinkingCanvasDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  assetId: string,
  mimeType: string,
  originalName?: string
): { doc: ThinkingCanvasDocument; element: ThinkingImageElement } {
  const ts = nowIso()
  const element: ThinkingImageElement = {
    id: newElementId('image'),
    kind: 'image',
    zIndex: nextZIndex(doc),
    createdAt: ts,
    updatedAt: ts,
    x,
    y,
    width,
    height,
    assetId,
    mimeType,
    originalName
  }
  return { doc: upsertElement(doc, element), element }
}

export function bringToFront(doc: ThinkingCanvasDocument, id: string): ThinkingCanvasDocument {
  const el = getElement(doc, id)
  if (!el) return doc
  return patchElement(doc, id, { zIndex: nextZIndex(doc) })
}

export function migrateLegacyToDocument(input: {
  texts?: LegacyThinkingTextNode[]
  strokes?: LegacyThinkingStroke[]
  scratch?: LegacyScratchNode[]
  textStyle: TextStyle
  penStyle: StrokeStyle
}): ThinkingCanvasDocument {
  let doc = createEmptyDocument()
  const legacyTexts = [
    ...(input.texts ?? []),
    ...(input.scratch ?? []).map((s) => ({ id: s.id, text: s.text, x: s.x, y: s.y }))
  ]

  for (const node of legacyTexts) {
    const ts = nowIso()
    const element: ThinkingTextElement = {
      id: node.id.startsWith('scratch-') ? `text-${node.id.slice('scratch-'.length)}` : node.id,
      kind: 'text',
      zIndex: nextZIndex(doc),
      createdAt: ts,
      updatedAt: ts,
      x: node.x,
      y: node.y,
      text: node.text,
      style: { ...input.textStyle }
    }
    doc = upsertElement(doc, element)
  }

  for (const stroke of input.strokes ?? []) {
    const ts = nowIso()
    const element: ThinkingStrokeElement = {
      id: stroke.id,
      kind: 'stroke',
      zIndex: nextZIndex(doc),
      createdAt: ts,
      updatedAt: ts,
      points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
      style: {
        color: stroke.color,
        width: stroke.width,
        opacity: 1,
        variant: 'pen'
      }
    }
    doc = upsertElement(doc, element)
  }

  return doc
}

export function collectAssetIds(doc: ThinkingCanvasDocument): string[] {
  return doc.elements
    .filter((e): e is ThinkingImageElement => e.kind === 'image')
    .map((e) => e.assetId)
}

export function applyToolPreferences(
  prefs: ThinkingToolPreferences,
  patch: Partial<ThinkingToolPreferences>
): ThinkingToolPreferences {
  return {
    ...prefs,
    ...patch,
    pen: { ...prefs.pen, ...patch.pen },
    highlighter: { ...prefs.highlighter, ...patch.highlighter },
    eraser: { ...prefs.eraser, ...patch.eraser },
    text: { ...prefs.text, ...patch.text }
  }
}
