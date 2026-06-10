import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchOllamaCatalog,
  fetchOllamaStatus,
  fetchLogs,
  fetchAllInstalledModels,
  pullOllamaPreset,
  deleteOllamaModel,
  startOllama,
  stopOllama,
  getCachedSidecarBase,
  type OllamaCatalog,
  type OllamaStatus,
  type LogEntry,
  type InstalledModel
} from '../lib/sidecar'
import { notify } from '../lib/notify'
import { useTaskStore } from '../stores/taskStore'
import { ollamaCatalogPollMs, waitForOllamaCatalog } from '../lib/ollamaProgress'
import { useOllamaPullSSE } from './useOllamaPullSSE'

// ─── SSE Bridge: connects to pull stream when ssePullPresetId is set ───

/**
 * Reads ssePullPresetId from the task store. When non-null, opens an SSE
 * connection to the sidecar pull stream and drives task progress in real time.
 * On SSE complete → marks task done, clears ssePullPresetId, invalidates catalog.
 * On SSE failed → marks task error, clears ssePullPresetId, falls back to catalog polling.
 */
export function useOllamaPullSSEBridge(): void {
  const presetId = useTaskStore((s) => s.ssePullPresetId)
  const setSsePullPresetId = useTaskStore((s) => s.setSsePullPresetId)
  const updatePullFromSSE = useTaskStore((s) => s.updatePullFromSSE)
  const failPullFromSSE = useTaskStore((s) => s.failPullFromSSE)
  const completeTask = useTaskStore((s) => s.completeTask)
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  // Resolve the task id for the current preset
  const taskId = presetId ? `ollama-pull-${presetId}` : null

  useOllamaPullSSE({
    presetId,
    baseUrl: getCachedSidecarBase(),
    onProgress: (data) => {
      if (taskId) updatePullFromSSE(taskId, data)
    },
    onComplete: () => {
      if (taskId) {
        completeTask(taskId)
        setSsePullPresetId(null)
        void queryClient.invalidateQueries({ queryKey: ['ollama'] })
      }
    },
    onFailed: (data) => {
      if (taskId) {
        failPullFromSSE(taskId, data.error || t('ollama.pullFailed'))
        setSsePullPresetId(null)
        // Fall back to catalog polling which will pick up the final state
        void queryClient.invalidateQueries({ queryKey: ['ollama'] })
      }
    }
  })
}

// ─── Catalog (polling) ───────────────────────────────────────────

export function useOllamaCatalog() {
  const ssePullPresetId = useTaskStore((s) => s.ssePullPresetId)
  return useQuery<OllamaCatalog | null>({
    queryKey: ['ollama', 'catalog'],
    queryFn: fetchOllamaCatalog,
    refetchInterval: (query) => {
      // When SSE is driving a pull, slow down catalog polling to 5 s (safety net)
      if (ssePullPresetId) return 5_000
      return ollamaCatalogPollMs(query.state.data ?? null)
    }
  })
}

// ─── Runtime Status (polling) ────────────────────────────────────

export function useRuntimeStatus() {
  return useQuery<OllamaStatus | null>({
    queryKey: ['ollama', 'status'],
    queryFn: fetchOllamaStatus,
    refetchInterval: (query) => {
      const catalog = query.state.data?.catalog
      const interval = ollamaCatalogPollMs(catalog ?? null)
      return interval === false ? 10_000 : interval
    }
  })
}

// ─── Logs (polling) ──────────────────────────────────────────────

export function useLogs(opts?: { limit?: number; level?: string; jobId?: string }) {
  return useQuery<LogEntry[] | null>({
    queryKey: ['logs', opts],
    queryFn: () => fetchLogs(opts),
    refetchInterval: 5_000,
    enabled: true
  })
}

// ─── All Installed Models ────────────────────────────────────────

export function useAllInstalledModels() {
  return useQuery<InstalledModel[] | null>({
    queryKey: ['ollama', 'installed-all'],
    queryFn: fetchAllInstalledModels,
    staleTime: 30_000
  })
}

// ─── Pull Model Mutation ─────────────────────────────────────────

type PullModelVars = { presetId: string; modelName: string }

export function usePullModel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const addTask = useTaskStore((s) => s.addTask)
  const completeTask = useTaskStore((s) => s.completeTask)
  const failTask = useTaskStore((s) => s.failTask)
  const setSsePullPresetId = useTaskStore((s) => s.setSsePullPresetId)

  // Shared across onMutate + mutationFn (mutations run sequentially)
  const activeTaskIdRef = useRef<string | null>(null)

  return useMutation({
    onMutate: ({ presetId, modelName }: PullModelVars) => {
      activeTaskIdRef.current = addTask({
        type: 'pull',
        modelName,
        label: t('ollama.pulling', { model: modelName }),
        progress: -1,
        status: 'running'
      })
      void queryClient.invalidateQueries({ queryKey: ['ollama', 'catalog'] })
    },
    mutationFn: async ({ presetId }: PullModelVars) => {
      const taskId = activeTaskIdRef.current!

      const result = await pullOllamaPreset(presetId)
      if (!result.ok) {
        failTask(taskId, result.error || t('ollama.pullFailed'))
        throw new Error(result.error || t('ollama.pullFailed'))
      }

      if (result.status === 'already_installed') {
        completeTask(taskId)
        return result
      }

      if (result.status === 'in_progress' && result.preset_id && result.preset_id !== presetId) {
        const msg = t('ollama.anotherPullInProgress')
        failTask(taskId, msg)
        throw new Error(msg)
      }

      // Hand off to SSE for real-time progress.
      // The SSE bridge (useOllamaPullSSEBridge) will pick up the presetId,
      // connect to the stream, and drive task progress / completion / failure.
      // Catalog polling continues at a reduced rate as a safety net.
      setSsePullPresetId(presetId)

      await waitForOllamaCatalog(
        (catalog) =>
          catalog.presets?.some(
            (p) => (p.preset_id ?? p.id) === presetId && p.installed
          ) === true,
        {
          pollMs: 5000,
          failIf: (catalog) =>
            catalog.operation?.state === 'error'
              ? catalog.operation.message || t('ollama.pullFailed')
              : null
        }
      )

      // SSE may have already completed the task; only mark done if still running.
      const task = useTaskStore.getState().tasks[taskId]
      if (task?.status === 'running') {
        completeTask(taskId)
      }
      return result
    },
    onSuccess: (_data, vars) => {
      activeTaskIdRef.current = null
      setSsePullPresetId(null)
      notify(t('ollama.modelReady'), { type: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['ollama'] })
    },
    onError: (err: Error, vars) => {
      activeTaskIdRef.current = null
      setSsePullPresetId(null)
      notify(t('ollama.pullFailed'), { type: 'error', description: err.message })
    }
  })
}

// ─── Delete Model Mutation ───────────────────────────────────────

export function useDeleteModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (modelName: string) => {
      const ok = await deleteOllamaModel(modelName)
      if (!ok) throw new Error('Delete failed')
      return modelName
    },
    onSuccess: (modelName) => {
      notify('Model deleted', { type: 'success', description: modelName })
      void queryClient.invalidateQueries({ queryKey: ['ollama'] })
    },
    onError: (err: Error) => {
      notify('Delete failed', { type: 'error', description: err.message })
    }
  })
}

// ─── Start Ollama Mutation ───────────────────────────────────────

export function useStartOllama() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (preferUser: boolean) => {
      const result = await startOllama(preferUser)
      if (!result.ok) throw new Error(result.error || 'Start failed')
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ollama'] })
    },
    onError: (err: Error) => {
      notify('Ollama start failed', { type: 'error', description: err.message })
    }
  })
}

// ─── Stop Ollama Mutation ────────────────────────────────────────

export function useStopOllama() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      await stopOllama()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ollama'] })
    }
  })
}
