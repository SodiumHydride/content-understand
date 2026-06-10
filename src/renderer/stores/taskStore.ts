import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { OllamaCatalog } from '../lib/sidecar'
import { mergeTaskMetrics, presetLabel, TASK_HOLD_MS } from '../lib/ollamaProgress'

export type OllamaTaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type TaskType = 'pull' | 'delete' | 'load' | 'unload' | 'download'

export interface Task {
  id: string
  type: TaskType
  modelName: string
  label: string
  progress: number // 0-100, -1 for indeterminate
  totalBytes: number
  completedBytes: number
  speedBps: number
  etaSec: number
  status: OllamaTaskStatus
  error?: string
  startedAt: number
  completedAt?: number
  /** SSE stream stage label (e.g. "pulling manifest", "downloading …") */
  stage?: string
}

interface TaskStore {
  tasks: Record<string, Task>
  /** presetId currently being driven by SSE (so catalog sync can skip it) */
  ssePullPresetId: string | null
  setSsePullPresetId: (presetId: string | null) => void
  addTask: (
    task: Omit<Task, 'id' | 'status' | 'startedAt' | 'totalBytes' | 'completedBytes' | 'speedBps' | 'etaSec'> & {
      status?: OllamaTaskStatus
      id?: string
    }
  ) => string
  updateProgress: (id: string, progress: number, totalBytes?: number, completedBytes?: number, speedBps?: number) => void
  /** Apply a live SSE progress event to the pull task. */
  updatePullFromSSE: (
    taskId: string,
    data: { stage: string; percent: number; total_bytes: number; completed_bytes: number; speed_bps: number; elapsed_sec: number }
  ) => void
  /** Mark a pull task as failed from SSE and clear ssePullPresetId. */
  failPullFromSSE: (taskId: string, error: string) => void
  syncOllamaCatalog: (catalog: OllamaCatalog, t: (key: string, opts?: Record<string, unknown>) => string, lang?: string) => void
  completeTask: (id: string) => void
  failTask: (id: string, error: string) => void
  dismissTask: (id: string) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
}

export const useTaskStore = create<TaskStore>()(
  subscribeWithSelector((set, get) => ({
    tasks: {},
    ssePullPresetId: null,

    setSsePullPresetId: (presetId) => set({ ssePullPresetId: presetId }),

    addTask: (task) => {
      const { id: requestedId, ...rest } = task
      const id = requestedId ?? `${rest.type}-${rest.modelName}-${Date.now()}`
      set((s) => ({
        tasks: {
          ...s.tasks,
          [id]: {
            ...rest,
            id,
            status: task.status ?? 'queued',
            startedAt: s.tasks[id]?.startedAt ?? Date.now(),
            totalBytes: s.tasks[id]?.totalBytes ?? 0,
            completedBytes: s.tasks[id]?.completedBytes ?? 0,
            speedBps: s.tasks[id]?.speedBps ?? 0,
            etaSec: s.tasks[id]?.etaSec ?? -1
          }
        }
      }))
      return id
    },

    updateProgress: (id, progress, totalBytes, completedBytes, speedBps) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        const merged = mergeTaskMetrics(existing, {
          progress,
          totalBytes,
          completedBytes,
          speedBps
        })
        return {
          tasks: {
            ...s.tasks,
            [id]: {
              ...existing,
              status: 'running',
              ...merged
            }
          }
        }
      }),

    updatePullFromSSE: (taskId, data) =>
      set((s) => {
        const existing = s.tasks[taskId]
        if (!existing) return s
        const merged = mergeTaskMetrics(existing, {
          progress: data.percent,
          totalBytes: data.total_bytes,
          completedBytes: data.completed_bytes,
          speedBps: data.speed_bps
        })
        return {
          tasks: {
            ...s.tasks,
            [taskId]: {
              ...existing,
              status: 'running',
              stage: data.stage,
              ...merged
            }
          }
        }
      }),

    failPullFromSSE: (taskId, error) =>
      set((s) => {
        const existing = s.tasks[taskId]
        if (!existing) return s
        return {
          ssePullPresetId: null,
          tasks: {
            ...s.tasks,
            [taskId]: { ...existing, status: 'error', error, completedAt: Date.now() }
          }
        }
      }),

    syncOllamaCatalog: (catalog, t, lang) =>
      set((s) => {
        const op = catalog.operation
        const presets = catalog.presets ?? []
        const next = { ...s.tasks }
        let changed = false

        type TaskUpsertPatch = Pick<Task, 'type' | 'modelName' | 'label' | 'status'> &
          Partial<
            Pick<Task, 'progress' | 'totalBytes' | 'completedBytes' | 'speedBps' | 'etaSec' | 'error' | 'completedAt'>
          > & { startedAt?: number }

        const upsert = (id: string, patch: TaskUpsertPatch) => {
          const existing = next[id]
          const merged = existing
            ? mergeTaskMetrics(existing, {
                progress: patch.progress,
                totalBytes: patch.totalBytes,
                completedBytes: patch.completedBytes,
                speedBps: patch.speedBps
              })
            : {
                progress: patch.progress ?? -1,
                totalBytes: patch.totalBytes ?? 0,
                completedBytes: patch.completedBytes ?? 0,
                speedBps: patch.speedBps ?? 0,
                etaSec: -1 as number
              }
          const etaSec =
            merged.speedBps > 0 && merged.totalBytes > merged.completedBytes
              ? (merged.totalBytes - merged.completedBytes) / merged.speedBps
              : -1
          next[id] = {
            id,
            type: patch.type,
            modelName: patch.modelName,
            label: patch.label,
            status: patch.status,
            error: patch.error,
            startedAt: patch.startedAt ?? existing?.startedAt ?? Date.now(),
            completedAt: patch.completedAt,
            progress: patch.progress ?? merged.progress ?? existing?.progress ?? -1,
            totalBytes: merged.totalBytes,
            completedBytes: merged.completedBytes,
            speedBps: merged.speedBps,
            etaSec
          }
          changed = true
        }

        if (catalog.app_download_in_progress) {
          const p = catalog.app_download_progress
          upsert('ollama-download-binary', {
            type: 'download',
            modelName: 'ollama-binary',
            label: t('ollama.downloadingAppOllamaProgress'),
            status: 'running',
            progress: typeof p?.percent === 'number' ? p.percent : -1,
            totalBytes: p?.total_bytes ?? 0,
            completedBytes: p?.completed_bytes ?? 0,
            speedBps: p?.speed_bps ?? 0
          })
        } else if (next['ollama-download-binary']?.status === 'running') {
          upsert('ollama-download-binary', {
            type: 'download',
            modelName: 'ollama-binary',
            label: t('ollama.appOllamaReady'),
            status: 'done',
            progress: 100,
            totalBytes: next['ollama-download-binary'].totalBytes,
            completedBytes: next['ollama-download-binary'].totalBytes,
            speedBps: 0,
            completedAt: Date.now()
          })
        }

        const pullingId = op?.pulling_preset_id
        const ssePresetId = get().ssePullPresetId
        if (pullingId && (op?.state === 'working' || op?.setup_running)) {
          // Skip catalog-driven progress upsert when SSE is driving this exact pull
          if (pullingId !== ssePresetId) {
            const preset = presets.find((row) => (row.preset_id ?? row.id) === pullingId)
            const modelName = preset?.ollama_model ?? pullingId
            const p = op?.progress
            upsert(`ollama-pull-${pullingId}`, {
              type: 'pull',
              modelName,
              label: t('ollama.pulling', { model: modelName }),
              status: 'running',
              progress: typeof p?.percent === 'number' ? p.percent : -1,
              totalBytes: p?.total_bytes ?? 0,
              completedBytes: p?.completed_bytes ?? 0,
              speedBps: p?.speed_bps ?? 0
            })
          }
        } else if (op?.setup_running || (op?.state === 'working' && !pullingId)) {
          const p = op?.progress
          upsert('ollama-setup', {
            type: 'pull',
            modelName: 'runtime-setup',
            label: t('ollama.settingUpRuntime'),
            status: 'running',
            progress: typeof p?.percent === 'number' ? p.percent : -1,
            totalBytes: p?.total_bytes ?? 0,
            completedBytes: p?.completed_bytes ?? 0,
            speedBps: p?.speed_bps ?? 0
          })
        }

        const activeKeys = new Set<string>()
        if (catalog.app_download_in_progress) activeKeys.add('ollama-download-binary')
        if (pullingId && (op?.state === 'working' || op?.setup_running)) {
          activeKeys.add(`ollama-pull-${pullingId}`)
        } else if (op?.setup_running || (op?.state === 'working' && !pullingId)) {
          activeKeys.add('ollama-setup')
        }

        for (const preset of presets) {
          const pid = preset.preset_id ?? preset.id
          const taskId = `ollama-pull-${pid}`
          if (preset.installed && next[taskId]?.status === 'running') {
            upsert(taskId, {
              type: 'pull',
              modelName: preset.ollama_model,
              label: t('ollama.pullComplete', { name: presetLabel(presets, pid, lang) }),
              status: 'done',
              progress: 100,
              totalBytes: next[taskId].totalBytes,
              completedBytes: next[taskId].totalBytes || preset.size || next[taskId].completedBytes,
              speedBps: 0,
              completedAt: Date.now()
            })
          }
        }

        if (op?.state === 'error') {
          for (const key of activeKeys) {
            const row = next[key]
            if (row?.status === 'running') {
              upsert(key, {
                ...row,
                status: 'error',
                error: op.message || t('ollama.operationFailed'),
                completedAt: Date.now()
              })
            }
          }
        }

        for (const [id, task] of Object.entries(next)) {
          const startedRecently = Date.now() - task.startedAt < TASK_HOLD_MS
          const isManagedPull = id.startsWith('ollama-pull-') || id === 'ollama-setup'
          if (
            (task.type === 'pull' || task.type === 'download') &&
            task.status === 'running' &&
            !activeKeys.has(id) &&
            !presets.some((p) => `ollama-pull-${p.preset_id ?? p.id}` === id && p.installed) &&
            !(isManagedPull && startedRecently)
          ) {
            delete next[id]
            changed = true
          }
        }

        return changed ? { tasks: next } : s
      }),

    completeTask: (id) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...existing, status: 'done', progress: 100, completedAt: Date.now() }
          }
        }
      }),

    failTask: (id, error) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...existing, status: 'error', error, completedAt: Date.now() }
          }
        }
      }),

    dismissTask: (id) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        if (existing.status === 'running' || existing.status === 'queued') {
          return { tasks: { ...s.tasks, [id]: { ...existing, status: 'cancelled', completedAt: Date.now() } } }
        }
        const { [id]: _, ...rest } = s.tasks
        return { tasks: rest }
      }),

    removeTask: (id) =>
      set((s) => {
        const { [id]: _, ...rest } = s.tasks
        return { tasks: rest }
      }),

    clearCompleted: () =>
      set((s) => {
        const tasks = Object.fromEntries(
          Object.entries(s.tasks).filter(([, t]) => t.status === 'queued' || t.status === 'running')
        )
        return { tasks }
      }),
  }))
)
