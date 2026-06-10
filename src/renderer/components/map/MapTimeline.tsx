import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

export type MapTimelineProps = {
  timeRange: { min: number; max: number }
  timeFilter: number
  timelineEnabled: boolean
  onToggle: (enabled: boolean) => void
  onChange: (value: number) => void
}

export function MapTimeline({
  timeRange,
  timeFilter,
  timelineEnabled,
  onToggle,
  onChange
}: MapTimelineProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (timeRange.max <= 0) return null

  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 border border-[var(--divider)] rounded-lg bg-[var(--color-paper)]/80 backdrop-blur-md shadow-md p-3 max-w-sm">
      <input
        type="checkbox"
        id="timeline-enable"
        checked={timelineEnabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="cursor-pointer"
      />
      <label htmlFor="timeline-enable" className="text-xs font-medium text-[var(--color-ink-800)] cursor-pointer whitespace-nowrap">
        {t('map.timeline')}
      </label>
      <input
        type="range"
        min={timeRange.min}
        max={timeRange.max}
        value={timeFilter || timeRange.max}
        disabled={!timelineEnabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={clsx('flex-1 cursor-pointer accent-[var(--color-accent)]', !timelineEnabled && 'opacity-30')}
      />
      {timelineEnabled && (
        <span className="text-[10px] text-[var(--color-ink-600)] font-mono whitespace-nowrap">
          {new Date(timeFilter || timeRange.max).toLocaleDateString()}
        </span>
      )}
    </div>
  )
}
