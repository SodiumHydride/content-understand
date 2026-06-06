import clsx from 'clsx'
import {
  Eraser,
  Highlighter,
  ImagePlus,
  MousePointer2,
  Pencil,
  Type
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThinkingTool, ThinkingToolPreferences } from '../../lib/thinkingCanvas/types'

export function ThinkingCanvasToolbar({
  tool,
  onToolChange
}: {
  tool: ThinkingTool
  onToolChange: (tool: ThinkingTool) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const items: {
    id: ThinkingTool
    icon: typeof MousePointer2
    label: string
    shortcut: string
  }[] = [
    { id: 'select', icon: MousePointer2, label: t('map.tool.select'), shortcut: 'V' },
    { id: 'text', icon: Type, label: t('map.tool.text'), shortcut: 'T' },
    { id: 'pen', icon: Pencil, label: t('map.tool.pen'), shortcut: 'P' },
    { id: 'highlighter', icon: Highlighter, label: t('map.tool.highlighter'), shortcut: 'H' },
    { id: 'eraser', icon: Eraser, label: t('map.tool.eraser'), shortcut: 'E' },
    { id: 'image', icon: ImagePlus, label: t('map.tool.image'), shortcut: 'I' }
  ]

  return (
    <div className="thinking-canvas-toolbar no-drag" role="toolbar" aria-label={t('map.toolBar')}>
      {items.map(({ id, icon: Icon, label, shortcut }) => (
        <button
          key={id}
          type="button"
          className={clsx('map-tool-btn', tool === id && 'map-tool-btn-active')}
          aria-pressed={tool === id}
          title={`${label} (${shortcut})`}
          onClick={() => onToolChange(id)}
        >
          <Icon size={16} strokeWidth={1.75} />
          <span className="map-tool-label">{label}</span>
        </button>
      ))}
    </div>
  )
}

export function ThinkingCanvasOptions({
  tool,
  prefs,
  onChange
}: {
  tool: ThinkingTool
  prefs: ThinkingToolPreferences
  onChange: (patch: Partial<ThinkingToolPreferences>) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (tool === 'pen' || tool === 'highlighter') {
    const key = tool === 'pen' ? 'pen' : 'highlighter'
    const style = prefs[key]
    const presets =
      tool === 'pen'
        ? ['#2c2825', '#57534e', '#2563eb', '#dc2626', '#16a34a', '#9333ea']
        : ['#fde047', '#bbf7d0', '#fbcfe8', '#bae6fd', '#fed7aa']
    const range = tool === 'pen' ? { min: 1, max: 12, step: 0.5 } : { min: 8, max: 40, step: 2 }

    return (
      <div className="thinking-canvas-options no-drag">
        <div className="thinking-color-row">
          {presets.map((color) => (
            <button
              key={color}
              type="button"
              className={clsx('thinking-color-swatch', style.color === color && 'active')}
              style={{ background: color }}
              aria-label={color}
              onClick={() => onChange({ [key]: { ...style, color } })}
            />
          ))}
        </div>
        <label className="thinking-size-control">
          <span>{t('map.toolSize')}</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={style.width}
            onChange={(e) =>
              onChange({ [key]: { ...style, width: Number(e.target.value) } })
            }
          />
        </label>
      </div>
    )
  }

  if (tool === 'eraser') {
    return (
      <div className="thinking-canvas-options no-drag">
        <label className="thinking-size-control">
          <span>{t('map.toolSize')}</span>
          <input
            type="range"
            min={8}
            max={48}
            step={2}
            value={prefs.eraser.width}
            onChange={(e) =>
              onChange({ eraser: { ...prefs.eraser, width: Number(e.target.value) } })
            }
          />
        </label>
        <div className="thinking-eraser-modes">
          {(['partial', 'stroke'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={clsx(
                'filter-pill thinking-eraser-pill',
                prefs.eraser.mode === mode && 'filter-pill-active'
              )}
              onClick={() => onChange({ eraser: { ...prefs.eraser, mode } })}
            >
              {t(`map.eraser.${mode}`)}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (tool === 'text') {
    const presets = ['#1c1917', '#57534e', '#2563eb', '#dc2626', '#16a34a']
    return (
      <div className="thinking-canvas-options no-drag">
        <div className="thinking-color-row">
          {presets.map((color) => (
            <button
              key={color}
              type="button"
              className={clsx(
                'thinking-color-swatch',
                prefs.text.color === color && 'active'
              )}
              style={{ background: color }}
              onClick={() => onChange({ text: { ...prefs.text, color } })}
            />
          ))}
        </div>
        <label className="thinking-size-control">
          <span>{t('map.textSize')}</span>
          <input
            type="range"
            min={12}
            max={48}
            step={1}
            value={prefs.text.fontSize}
            onChange={(e) =>
              onChange({ text: { ...prefs.text, fontSize: Number(e.target.value) } })
            }
          />
        </label>
      </div>
    )
  }

  return null
}
