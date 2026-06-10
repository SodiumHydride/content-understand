import { useState, useEffect, useMemo } from 'react'
import { ChevronUp, ChevronDown, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useTaskStore, type Task } from '../stores/taskStore'
import { formatSpeed, formatEta } from '../lib/format'

function TaskRow({ task }: { task: Task }): React.JSX.Element {
  const { t } = useTranslation()
  const removeTask = useTaskStore((s) => s.removeTask)
  const dismissTask = useTaskStore((s) => s.dismissTask)
  const isActive = task.status === 'running' || task.status === 'queued'
  const isDone = task.status === 'done'
  const isError = task.status === 'error'
  const canDismissOnly = isActive && (task.type === 'pull' || task.type === 'download')

  useEffect(() => {
    if (isDone || task.status === 'cancelled') {
      const timer = setTimeout(() => removeTask(task.id), 5000)
      return () => clearTimeout(timer)
    }
  }, [isDone, task.status, task.id, removeTask])

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      {isActive ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-accent)]" />
      ) : null}
      {isDone ? <CheckCircle2 size={12} className="shrink-0 text-green-500" /> : null}
      {isError ? <AlertCircle size={12} className="shrink-0 text-[var(--color-danger)]" /> : null}

      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-800">{task.label}</span>

      {isActive ? (
        <div className="flex items-center gap-2">
          <div className="h-1 w-20 overflow-hidden rounded-full bg-[var(--color-paper-deep)]">
            {typeof task.progress === 'number' && task.progress >= 0 ? (
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(2, task.progress))}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--color-accent)]" />
            )}
          </div>
          {typeof task.progress === 'number' && task.progress >= 0 ? (
            <span className="w-8 text-right text-[10px] text-ink-600">{task.progress}%</span>
          ) : null}
        </div>
      ) : null}

      {isActive && task.speedBps > 0 ? (
        <span className="text-[10px] text-ink-500">
          {formatSpeed(task.speedBps)}
          {task.etaSec > 0 ? ` · ${t('task.eta')} ${formatEta(task.etaSec)}` : ''}
        </span>
      ) : null}

      {isError && task.error ? (
        <span
          className="max-w-[200px] truncate text-[10px] text-[var(--color-danger)]"
          title={task.error}
        >
          {task.error}
        </span>
      ) : null}

      {isActive ? (
        <button
          type="button"
          className="rounded p-0.5 text-ink-500 hover:text-ink-800"
          onClick={() => dismissTask(task.id)}
          title={canDismissOnly ? t('task.hideBackground') : t('task.cancel')}
        >
          <X size={12} />
        </button>
      ) : (
        <button
          type="button"
          className="rounded p-0.5 text-ink-500 hover:text-ink-800"
          onClick={() => removeTask(task.id)}
          title={t('task.dismiss')}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export function TaskBar(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const tasks = useTaskStore(useShallow((s) => s.tasks))
  const allTasks = useMemo(() => Object.values(tasks), [tasks])
  const activeTasks = useMemo(
    () => allTasks.filter((t) => t.status === 'running' || t.status === 'queued'),
    [allTasks]
  )
  const recentTasks = useMemo(
    () =>
      allTasks.filter(
        (t) => t.status === 'done' || t.status === 'error' || t.status === 'cancelled'
      ),
    [allTasks]
  )

  const visibleTasks = expanded ? [...activeTasks, ...recentTasks] : activeTasks

  if (activeTasks.length === 0 && recentTasks.length === 0) return null

  return (
    <div className="border-t border-[var(--divider)] bg-[var(--color-paper-deep)]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1 text-[11px] text-ink-600 hover:bg-[var(--color-shelf)]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5">
          {activeTasks.length > 0 ? (
            <Loader2 size={11} className="animate-spin text-[var(--color-accent)]" />
          ) : null}
          {activeTasks.length > 0
            ? t('task.activeCount', { count: activeTasks.length })
            : t('task.completedCount', { count: recentTasks.length })}
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {visibleTasks.length > 0 ? (
        <div className="max-h-32 divide-y divide-[var(--divider)] overflow-y-auto">
          {visibleTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
