import React from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Pencil, Highlighter, Eraser } from 'lucide-react'

interface NoteInkToolbarProps {
  inkTool: 'pen' | 'highlighter' | 'eraser'
  penColor: string
  onToolChange: (tool: 'pen' | 'highlighter' | 'eraser') => void
  onColorChange: (color: string) => void
}

const COLORS = ['#1a1a1a', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6']

export const NoteInkToolbar = React.memo(function NoteInkToolbar({
  inkTool,
  penColor,
  onToolChange,
  onColorChange,
}: NoteInkToolbarProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="ink-toolbar">
      <button
        type="button"
        className={clsx('ink-tool-btn', inkTool === 'pen' && 'ink-tool-active')}
        onClick={() => onToolChange('pen')}
        title={t('map.tool.pen')}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        className={clsx('ink-tool-btn', inkTool === 'highlighter' && 'ink-tool-active')}
        onClick={() => onToolChange('highlighter')}
        title={t('map.tool.highlighter')}
      >
        <Highlighter size={14} />
      </button>
      <button
        type="button"
        className={clsx('ink-tool-btn', inkTool === 'eraser' && 'ink-tool-active')}
        onClick={() => onToolChange('eraser')}
        title={t('map.tool.eraser')}
      >
        <Eraser size={14} />
      </button>
      <div className="ink-color-palette">
        {COLORS.map(c => (
          <button
            key={c}
            type="button"
            className={clsx('ink-color-btn', penColor === c && 'ink-color-active')}
            style={{ background: c }}
            onClick={() => onColorChange(c)}
          />
        ))}
      </div>
    </div>
  )
})
