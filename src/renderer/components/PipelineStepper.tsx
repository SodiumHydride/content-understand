import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Check, X, Loader2, Download } from 'lucide-react'
import type { TaskStage, UnderstandTask } from '../stores/types'
import { useAppStore } from '../stores/appStore'

const STAGES: TaskStage[] = ['setup', 'resolve', 'download', 'model', 'write']

const STAGE_INDEX: Record<TaskStage, number> = {
  setup: 0,
  resolve: 1,
  download: 2,
  model: 3,
  write: 4
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  return `${m}m ${s}s`
}

export function PipelineStepper({ task }: { task: UnderstandTask }): React.JSX.Element {
  const { t } = useTranslation()
  const removeTask = useAppStore((s) => s.removeTask)
  const [elapsedWall, setElapsedWall] = useState(0)

  const current = task.progress?.stage ?? 'setup'
  const currentIdx = STAGE_INDEX[current]
  const pct = task.progress?.percent ?? 0
  const elapsed = task.progress?.elapsed_sec ?? elapsedWall

  // Wall-clock fallback for ETA when backend doesn't provide elapsed_sec
  useEffect(() => {
    if (task.status !== 'processing') return
    const start = Date.now()
    const id = setInterval(() => setElapsedWall((Date.now() - start) / 1000), 1000)
    return () => clearInterval(id)
  }, [task.status])

  // ETA: only show when pct > 5 and elapsed > 2s
  const eta = useMemo(() => {
    if (task.status !== 'processing') return null
    if (pct <= 5 || elapsed <= 2) return null
    const remaining = (elapsed / pct) * (100 - pct)
    return remaining > 0 ? formatEta(remaining) : null
  }, [task.status, pct, elapsed])

  // Auto-dismiss completed tasks after 8s
  useEffect(() => {
    if (task.status === 'completed') {
      const timer = setTimeout(() => removeTask(task.id), 8_000)
      return () => clearTimeout(timer)
    }
  }, [task.status, task.id, removeTask])

  const isFailed = task.status === 'failed'
  const isCompleted = task.status === 'completed'

  const stageLabel = t(`tasks.stage.${current}`)

  return (
    <div className="pipeline animate-fade-up">
      {/* Task title */}
      <div className="pipeline-task-label">{task.title || task.url}</div>

      {/* Current stage name + spinner */}
      {task.status === 'processing' && (
        <div className="flex items-center gap-1.5 mb-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-accent)]" />
          <span className="text-xs font-medium text-[var(--color-ink-800)]">
            {stageLabel}
          </span>
          {eta && (
            <span className="ml-auto text-[0.6875rem] text-[var(--color-ink-500)]">
              {t('progress.eta', { eta })}
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-paper-deep)]">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-300',
            isFailed
              ? 'bg-[var(--color-danger)]'
              : 'bg-[var(--color-accent)]'
          )}
          style={{ width: `${isFailed ? pct : isCompleted ? 100 : pct}%` }}
        />
      </div>

      {/* Stage dots */}
      <div className="flex items-center justify-between mt-2.5 px-1">
        {STAGES.map((stage, i) => {
          const done = isCompleted || (!isFailed && i < currentIdx)
          const active = task.status === 'processing' && i === currentIdx
          const failedHere = isFailed && i === currentIdx

          return (
            <div key={stage} className="flex flex-col items-center gap-1">
              <div
                className={clsx(
                  'pipeline-step-dot',
                  done && 'pipeline-step-done',
                  active && 'pipeline-step-active',
                  failedHere && 'pipeline-step-failed'
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : failedHere ? (
                  <X className="h-3 w-3" />
                ) : stage === 'setup' ? (
                  <Download className="h-3 w-3" />
                ) : (
                  <span className="text-[0.625rem]">{i + 1}</span>
                )}
              </div>
              <span
                className={clsx(
                  'pipeline-step-name',
                  failedHere && 'pipeline-step-failed'
                )}
              >
                {t(`tasks.stage.${stage}`)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Error message + dismiss */}
      {isFailed && (
        <div className="mt-3 flex items-start gap-2">
          <p className="flex-1 whitespace-pre-wrap text-xs text-[var(--color-danger)]">
            {task.error || t('tasks.failed')}
          </p>
          <button
            className="shrink-0 text-[0.6875rem] text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)] transition-colors"
            onClick={() => removeTask(task.id)}
          >
            {t('tasks.dismiss')}
          </button>
        </div>
      )}

      {/* Completed badge */}
      {isCompleted && (
        <p className="mt-2 text-xs text-[var(--color-accent)] font-medium">
          {t('tasks.complete')}
        </p>
      )}
    </div>
  )
}
