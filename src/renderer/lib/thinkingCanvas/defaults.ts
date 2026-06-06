import type { CanvasPoint, EraserMode, StrokeStyle, TextStyle, ThinkingToolPreferences } from './types'

export const DEFAULT_TOOL_PREFERENCES: ThinkingToolPreferences = {
  activeTool: 'text',
  pen: {
    color: '#2c2825',
    width: 2.5,
    opacity: 1,
    variant: 'pen'
  },
  highlighter: {
    color: '#fde047',
    width: 16,
    opacity: 0.45,
    variant: 'highlighter'
  },
  eraser: {
    width: 20,
    mode: 'partial'
  },
  text: {
    fontSize: 16,
    color: '#1c1917',
    lineHeight: 1.55
  }
}

export const PEN_COLOR_PRESETS = [
  '#2c2825',
  '#57534e',
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea'
] as const

export const HIGHLIGHTER_COLOR_PRESETS = [
  '#fde047',
  '#bbf7d0',
  '#fbcfe8',
  '#bae6fd',
  '#fed7aa'
] as const

export const TEXT_COLOR_PRESETS = ['#1c1917', '#57534e', '#2563eb', '#dc2626', '#16a34a'] as const

export const PEN_WIDTH_RANGE = { min: 1, max: 12, step: 0.5 } as const
export const HIGHLIGHTER_WIDTH_RANGE = { min: 8, max: 40, step: 2 } as const
export const ERASER_WIDTH_RANGE = { min: 8, max: 48, step: 2 } as const
export const TEXT_SIZE_RANGE = { min: 12, max: 48, step: 1 } as const

export function strokeStyleForTool(
  prefs: ThinkingToolPreferences,
  tool: 'pen' | 'highlighter'
): StrokeStyle {
  return tool === 'pen' ? prefs.pen : prefs.highlighter
}

export function effectivePointWidth(baseWidth: number, point: CanvasPoint): number {
  const pressure = point.p ?? 0.5
  return baseWidth * (0.35 + 0.65 * pressure)
}

export function eraserRadius(mode: EraserMode, width: number): number {
  return width / 2
}

export const DEFAULT_TEXT_STYLE: TextStyle = DEFAULT_TOOL_PREFERENCES.text
