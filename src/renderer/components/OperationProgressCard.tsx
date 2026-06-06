import { Activity, Loader2 } from 'lucide-react'
import type { OperationProgressView } from '../lib/ollamaProgress'

interface OperationProgressCardProps {
  progress: OperationProgressView
  isZh: boolean
}

export function OperationProgressCard({
  progress,
  isZh
}: OperationProgressCardProps): React.JSX.Element {
  const showBar = typeof progress.percent === 'number' || progress.indeterminate

  return (
    <div className="space-y-1.5 rounded-md bg-[var(--color-accent-soft)] px-3 py-2">
      <div className="flex items-center gap-2 text-[11px]">
        {progress.indeterminate && typeof progress.percent !== 'number' ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-accent)]" />
        ) : (
          <Activity size={12} className="shrink-0 text-[var(--color-accent)]" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{progress.label}</span>
      </div>

      {progress.message && !progress.downloaded ? (
        <p className="truncate text-[10px] text-ink-600">{progress.message}</p>
      ) : null}

      {showBar ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-paper-deep)]">
          {progress.indeterminate && typeof progress.percent !== 'number' ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--color-accent)]" />
          ) : (
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
              style={{
                width: `${Math.min(100, Math.max(2, progress.percent ?? 0))}%`
              }}
            />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-600">
        {typeof progress.percent === 'number' ? <span>{progress.percent}%</span> : null}
        {progress.downloaded ? <span>{progress.downloaded}</span> : null}
        {progress.speed ? <span>{progress.speed}</span> : null}
        {progress.eta ? (
          <span>{isZh ? `剩余 ${progress.eta}` : `ETA ${progress.eta}`}</span>
        ) : null}
      </div>
    </div>
  )
}
