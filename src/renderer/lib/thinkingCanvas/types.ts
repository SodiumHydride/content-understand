/**
 * Thinking canvas schema — versioned, extensible element tree.
 *
 * Future extensions (without breaking schema):
 * - `kind: 'connector'` between element ids
 * - `kind: 'frame'` grouping children
 * - `meta.linkSlug` on any element
 * - `transform` on ThinkingElementBase for rotate/scale
 */

export const THINKING_CANVAS_SCHEMA_VERSION = 1

export type ThinkingTool =
  | 'select'
  | 'text'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'image'

export type EraserMode = 'stroke' | 'partial'

export interface CanvasPoint {
  x: number
  y: number
  /** Pointer pressure 0–1 when available. */
  p?: number
  /** Epoch ms — reserved for stroke smoothing / replay. */
  t?: number
}

export interface TextStyle {
  fontSize: number
  color: string
  lineHeight: number
}

export interface StrokeStyle {
  color: string
  width: number
  opacity: number
  variant: 'pen' | 'highlighter'
}

export interface EraserSettings {
  width: number
  mode: EraserMode
}

export interface ThinkingToolPreferences {
  activeTool: ThinkingTool
  pen: StrokeStyle
  highlighter: StrokeStyle
  eraser: EraserSettings
  text: TextStyle
}

export interface ThinkingElementBase {
  id: string
  kind: string
  zIndex: number
  createdAt: string
  updatedAt: string
  locked?: boolean
  /** Extension slot — e.g. linkSlug, aiPromptId */
  meta?: Record<string, unknown>
}

export interface ThinkingTextElement extends ThinkingElementBase {
  kind: 'text'
  x: number
  y: number
  text: string
  style: TextStyle
}

export interface ThinkingStrokeElement extends ThinkingElementBase {
  kind: 'stroke'
  points: CanvasPoint[]
  style: StrokeStyle
}

export interface ThinkingImageElement extends ThinkingElementBase {
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  assetId: string
  mimeType: string
  originalName?: string
}

export type ThinkingElement = ThinkingTextElement | ThinkingStrokeElement | ThinkingImageElement

export interface ThinkingCanvasDocument {
  schemaVersion: number
  revision: number
  elements: ThinkingElement[]
}

/** Legacy persisted shapes (zustand) — migrated into document on first load. */
export interface LegacyThinkingTextNode {
  id: string
  text: string
  x: number
  y: number
}

export interface LegacyThinkingStroke {
  id: string
  points: { x: number; y: number }[]
  color: string
  width: number
}

export interface LegacyScratchNode {
  id: string
  text: string
  x: number
  y: number
}

export type ThinkingDragKind = 'text' | 'image' | 'note'

export interface ThinkingSelection {
  ids: string[]
}
