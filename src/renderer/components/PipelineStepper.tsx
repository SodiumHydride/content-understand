import { useEffect } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import type { TaskStage, UnderstandTask } from '../stores/types'
import { useAppStore } from '../stores/appStore'

const STAGES: TaskStage[] = ['resolve', 'download', 'model', 'write']

const STAGE_INDEX: Record<TaskStage, number> = {
  resolve: 0,
  download: 1,
  model: 2,
  write: 3
}

export function PipelineStepper({ task }: { task: UnderstandTask }): React.JSX.Element {
  const { t } = useTranslation()
  const removeTask = useAppStore((s) => s.removeTask)

  // Auto-dismiss failed/completed tasks after 15 seconds
  useEffect(() => {
    if (task.status === 'failed' || task.status === 'completed') {
      const timer = setTimeout(() => removeTask(task.id), 15_000)
      return () => clearTimeout(timer)
    }
  }, [task.status, task.id, removeTask])
  const current = task.progress?.stage ?? 'resolve'
  const currentIdx = STAGE_INDEX[current]
  const pct = task.progress?.percent ?? 0
  const railPct = Math.min(100, ((currentIdx + 0.5) / 4) * 100)

  return (
    <div className="pipeline animate-fade-up">
      <div className="pipeline-task-label">{task.title || task.url}</div>
      <div className="relative">
        <div className="pipeline-rail">
          <div className="pipeline-rail-fill" style={{ width: `${railPct}%` }} />
        </div>
        <div className="pipeline-steps">
          {STAGES.map((stage, i) => {
            const failed = task.status === 'failed'
            const done = task.status === 'completed' || (!failed && i < currentIdx)
            const active =
              task.status === 'processing' && i === currentIdx
            const failedHere = failed && i === currentIdx
            return (
              <div
                key={stage}
                className={clsx(
                  'pipeline-step',
                  done && 'pipeline-step-done',
                  active && 'pipeline-step-active',
                  failedHere && 'pipeline-step-failed'
                )}
              >
                <div className="pipeline-step-dot">{i + 1}</div>
                <span className="pipeline-step-name">{t(`tasks.stage.${stage}`)}</span>
              </div>
            )
          })}
        </div>
      </div>
      {task.status === 'processing' && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--color-paper-deep)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {task.progress?.message && task.status === 'processing' && (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{task.progress.message}</p>
      )}
      {task.status === 'failed' && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--color-danger)]">
          {task.error || t('tasks.failed')}
        </p>
      )}
    </div>
  )
}
