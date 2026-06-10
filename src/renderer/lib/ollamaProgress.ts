import type { OllamaCatalog, OllamaOperationProgress } from './sidecar'
import type { RuntimePreset } from './sidecar'
import { formatBytes, formatSpeed, formatEta } from './format'
import type { Task } from '../stores/taskStore'

export type OllamaOperationKind = 'pull' | 'setup' | 'download'

export interface OperationProgressView {
  kind: OllamaOperationKind
  label: string
  message: string
  percent?: number
  indeterminate: boolean
  downloaded: string
  speed: string
  eta: string
  presetId?: string
}

export interface RawOperationMetrics {
  percent: number
  totalBytes: number
  completedBytes: number
  speedBps: number
  message: string
}

const HOLD_MS = 8_000

function coalescePositive(next: number | undefined, prev: number): number {
  if (next === undefined) return prev
  return next > 0 ? next : prev
}

function metricsFromProgress(
  progress: OllamaOperationProgress | undefined,
  prev?: RawOperationMetrics
): RawOperationMetrics {
  const p = progress
  const percent = typeof p?.percent === 'number' ? p.percent : (prev?.percent ?? -1)
  const totalBytes = coalescePositive(p?.total_bytes, prev?.totalBytes ?? 0)
  const completedBytes = coalescePositive(p?.completed_bytes, prev?.completedBytes ?? 0)
  const speedBps = coalescePositive(p?.speed_bps, prev?.speedBps ?? 0)
  const message = (p?.message?.trim() || prev?.message || '').trim()
  return { percent, totalBytes, completedBytes, speedBps, message }
}

function formatMetrics(
  metrics: RawOperationMetrics
): Pick<OperationProgressView, 'percent' | 'indeterminate' | 'downloaded' | 'speed' | 'eta' | 'message'> {
  const percent = metrics.percent
  const indeterminate = percent < 0
  const downloaded =
    metrics.totalBytes > 0
      ? `${formatBytes(metrics.completedBytes)} / ${formatBytes(metrics.totalBytes)}`
      : metrics.message.includes('/') && metrics.message.toLowerCase().includes('mb')
        ? metrics.message
        : ''
  const speed = metrics.speedBps > 0 ? formatSpeed(metrics.speedBps) : ''
  const etaSec =
    metrics.speedBps > 0 && metrics.totalBytes > metrics.completedBytes
      ? (metrics.totalBytes - metrics.completedBytes) / metrics.speedBps
      : -1
  const eta = etaSec > 0 ? formatEta(etaSec) : ''
  return {
    percent: indeterminate ? undefined : percent,
    indeterminate,
    downloaded,
    speed,
    eta,
    message: metrics.message
  }
}

export function presetLabel(presets: RuntimePreset[], presetId: string, lang?: string): string {
  const preset = presets.find((p) => (p.preset_id ?? p.id) === presetId)
  if (!preset) return presetId
  const isZh = lang?.startsWith('zh') ?? true
  return isZh ? preset.label_zh : preset.label_en
}

function activePullTask(task?: Task | null): task is Task {
  return Boolean(
    task &&
      (task.type === 'pull' || task.type === 'download') &&
      (task.status === 'running' || task.status === 'queued')
  )
}

function optimisticOperationView(
  task: Task,
  kind: OllamaOperationKind = task.type === 'download' ? 'download' : 'pull'
): OperationProgressView {
  const metrics = metricsFromProgress(undefined, {
    percent: task.progress,
    totalBytes: task.totalBytes,
    completedBytes: task.completedBytes,
    speedBps: task.speedBps,
    message: ''
  })
  return {
    kind,
    label: task.label,
    presetId: undefined,
    ...formatMetrics(metrics)
  }
}

export function deriveOperationProgress(
  catalog: OllamaCatalog | null,
  presets: RuntimePreset[],
  t: (key: string, opts?: Record<string, unknown>) => string,
  task?: Task | null
): OperationProgressView | null {
  const taskMetrics = task
    ? {
        percent: task.progress,
        totalBytes: task.totalBytes,
        completedBytes: task.completedBytes,
        speedBps: task.speedBps,
        message: task.error ?? ''
      }
    : undefined

  if (!catalog) {
    return activePullTask(task) ? optimisticOperationView(task) : null
  }

  const op = catalog.operation

  if (catalog.app_download_in_progress) {
    const dl = catalog.app_download_progress
    const metrics = metricsFromProgress(dl, taskMetrics)
    const formatted = formatMetrics(metrics)
    return {
      kind: 'download',
      label: t('ollama.downloadingAppOllamaProgress'),
      presetId: undefined,
      ...formatted
    }
  }

  if (op?.pulling_preset_id && (op.state === 'working' || op.setup_running)) {
    const presetId = op.pulling_preset_id
    const model =
      presets.find((p) => (p.preset_id ?? p.id) === presetId)?.ollama_model ?? presetId
    const metrics = metricsFromProgress(op.progress, taskMetrics)
    const formatted = formatMetrics(metrics)
    const pullLabel = t('ollama.pulling', { model })
    return {
      kind: 'pull',
      label: task?.label?.trim() || pullLabel,
      presetId,
      ...formatted
    }
  }

  if (op?.setup_running || (op?.state === 'working' && !op.pulling_preset_id)) {
    const metrics = metricsFromProgress(op.progress, taskMetrics)
    const formatted = formatMetrics(metrics)
    return {
      kind: 'setup',
      label: t('ollama.settingUpRuntime'),
      presetId: undefined,
      ...formatted
    }
  }

  // Catalog not caught up yet — show optimistic UI from the local task store.
  if (activePullTask(task)) {
    return optimisticOperationView(task)
  }

  return null
}

export function isOllamaOperationActive(catalog: OllamaCatalog | null): boolean {
  if (!catalog) return false
  if (catalog.app_download_in_progress) return true
  const op = catalog.operation
  if (!op) return false
  return (
    op.state === 'working' ||
    Boolean(op.pulling_preset_id) ||
    Boolean(op.setup_running)
  )
}

export function ollamaCatalogPollMs(catalog: OllamaCatalog | null): number | false {
  return isOllamaOperationActive(catalog) ? 500 : 30_000
}

export async function waitForOllamaCatalog(
  predicate: (catalog: OllamaCatalog) => boolean,
  options?: {
    timeoutMs?: number
    pollMs?: number
    failIf?: (catalog: OllamaCatalog) => string | null
  }
): Promise<OllamaCatalog> {
  const { fetchOllamaCatalog } = await import('./sidecar')
  const timeoutMs = options?.timeoutMs ?? 2 * 60 * 60 * 1000
  const pollMs = options?.pollMs ?? 500
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const catalog = await fetchOllamaCatalog()
    if (!catalog) {
      await sleep(pollMs)
      continue
    }
    const fail = options?.failIf?.(catalog)
    if (fail) throw new Error(fail)
    if (predicate(catalog)) return catalog
    await sleep(pollMs)
  }
  throw new Error('Operation timed out')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Merge incoming snapshot metrics without letting transient zeros wipe good samples. */
export function mergeTaskMetrics(
  existing: Pick<Task, 'progress' | 'totalBytes' | 'completedBytes' | 'speedBps'>,
  incoming: {
    progress?: number
    totalBytes?: number
    completedBytes?: number
    speedBps?: number
  }
): Pick<Task, 'progress' | 'totalBytes' | 'completedBytes' | 'speedBps' | 'etaSec'> {
  const progress = incoming.progress ?? existing.progress
  const totalBytes = coalescePositive(incoming.totalBytes, existing.totalBytes)
  const completedBytes = coalescePositive(incoming.completedBytes, existing.completedBytes)
  const speedBps = coalescePositive(incoming.speedBps, existing.speedBps)
  const etaSec = speedBps > 0 && totalBytes > completedBytes ? (totalBytes - completedBytes) / speedBps : -1
  return { progress, totalBytes, completedBytes, speedBps, etaSec }
}

export const TASK_HOLD_MS = HOLD_MS
