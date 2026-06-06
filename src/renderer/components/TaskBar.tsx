import { useState, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { ChevronUp, ChevronDown, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useTaskStore, type Task } from '../stores/taskStore'

function formatSpeed(bps: number): string {
  if (bps <= 0) return ''
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
}

function formatEta(seconds: number): string {
  if (seconds <= 0 || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function TaskRow({ task }: { task: Task }): React.JSX.Element {
  const removeTask = useTaskStore((s) => s.removeTask)
  const cancelTask = useTaskStore((s) => s.cancelTask)
  const isActive = task.status === 'running' || task.status === 'queued'
  const isDone = task.status === 'done'
  const isError = task.status === 'error'

  // Auto-remove completed tasks after 5s
  useEffect(() => {
    if (isDone || isError || task.status === 'cancelled') {
      const timer = setTimeout(() => removeTask(task.id), 5000)
      return () => clearTimeout(timer)
    }
  }, [isDone, isError, task.status, task.id, removeTask])

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      {/* Status icon */}
      {isActive && <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-accent)]" />}
      {isDone && <CheckCircle2 size={12} className="shrink-0 text-green-500" />}
      {isError && <AlertCircle size={12} className="shrink-0 text-[var(--color-danger)]" />}

      {/* Label */}
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-800">{task.label}</span>

      {/* Progress */}
      {isActive && typeof task.progress === 'number' && task.progress >= 0 && (
        <div className="flex items-center gap-2">
          <div className="h-1 w-20 overflow-hidden rounded-full bg-[var(--color-paper-deep)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(2, task.progress))}%` }}
            />
          </div>
          <span className="w-8 text-right text-[10px] text-ink-600">{task.progress}%</span>
        </div>
      )}

      {/* Speed / ETA */}
      {isActive && task.speedBps > 0 && (
        <span className="text-[10px] text-ink-500">
          {formatSpeed(task.speedBps)}
          {task.etaSec > 0 && ` · ETA ${formatEta(task.etaSec)}`}
        </span>
      )}

      {/* Error message */}
      {isError && task.error && (
        <span className="max-w-[200px] truncate text-[10px] text-[var(--color-danger)]">
          {task.error}
        </span>
      )}

      {/* Actions */}
      {isActive && (
        <button
          type="button"
          className="rounded p-0.5 text-ink-500 hover:text-[var(--color-danger)]"
          onClick={() => cancelTask(task.id)}
          title="Cancel"
        >
          <X size={12} />
        </button>
      )}
      {!isActive && (
        <button
          type="button"
          className="rounded p-0.5 text-ink-500 hover:text-ink-800"
          onClick={() => removeTask(task.id)}
          title="Dismiss"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export function TaskBar(): React.JSX.Element | null {
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
        (t) =>
          t.status === 'done' ||
          t.status === 'error' ||
          t.status === 'cancelled'
      ),
    [allTasks]
  )

  const visibleTasks = expanded ? [...activeTasks, ...recentTasks] : activeTasks

  if (activeTasks.length === 0 && recentTasks.length === 0) return null

  return (
    <div className="border-t border-[var(--divider)] bg-[var(--color-paper-deep)]">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1 text-[11px] text-ink-600 hover:bg-[var(--color-shelf)]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5">
          {activeTasks.length > 0 && (
            <Loader2 size={11} className="animate-spin text-[var(--color-accent)]" />
          )}
          {activeTasks.length > 0
            ? `${activeTasks.length} active`
            : `${recentTasks.length} completed`}
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {/* Task list */}
      {visibleTasks.length > 0 && (
        <div className="max-h-32 divide-y divide-[var(--divider)] overflow-y-auto">
          {visibleTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}
