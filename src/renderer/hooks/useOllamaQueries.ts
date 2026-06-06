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
  type OllamaCatalog,
  type OllamaStatus,
  type LogEntry,
  type InstalledModel
} from '../lib/sidecar'
import { notify } from '../lib/notify'
import { useTaskStore } from '../stores/taskStore'
import { ollamaCatalogPollMs, waitForOllamaCatalog } from '../lib/ollamaProgress'

// ─── Catalog (polling) ───────────────────────────────────────────

export function useOllamaCatalog() {
  return useQuery<OllamaCatalog | null>({
    queryKey: ['ollama', 'catalog'],
    queryFn: fetchOllamaCatalog,
    refetchInterval: (query) => ollamaCatalogPollMs(query.state.data ?? null)
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
  return useQuery<LogEntry[]>({
    queryKey: ['logs', opts],
    queryFn: () => fetchLogs(opts),
    refetchInterval: 5_000,
    enabled: true
  })
}

// ─── All Installed Models ────────────────────────────────────────

export function useAllInstalledModels() {
  return useQuery<InstalledModel[]>({
    queryKey: ['ollama', 'installed-all'],
    queryFn: fetchAllInstalledModels,
    staleTime: 30_000
  })
}

// ─── Pull Model Mutation ─────────────────────────────────────────

type PullModelVars = { presetId: string; modelName: string; isZh: boolean }

export function usePullModel() {
  const queryClient = useQueryClient()
  const addTask = useTaskStore((s) => s.addTask)
  const completeTask = useTaskStore((s) => s.completeTask)
  const failTask = useTaskStore((s) => s.failTask)

  // Shared across onMutate + mutationFn (mutations run sequentially)
  let activeTaskId: string | null = null

  return useMutation({
    onMutate: ({ presetId, modelName, isZh }: PullModelVars) => {
      activeTaskId = addTask({
        type: 'pull',
        modelName,
        label: isZh ? `正在拉取 ${modelName}` : `Pulling ${modelName}`,
        progress: -1,
        status: 'running'
      })
      void queryClient.invalidateQueries({ queryKey: ['ollama', 'catalog'] })
    },
    mutationFn: async ({ presetId, isZh }: PullModelVars) => {
      const taskId = activeTaskId!

      const result = await pullOllamaPreset(presetId)
      if (!result.ok) {
        failTask(taskId, result.error || (isZh ? '拉取失败' : 'Pull failed'))
        throw new Error(result.error || (isZh ? '拉取失败' : 'Pull failed'))
      }

      if (result.status === 'already_installed') {
        completeTask(taskId)
        return result
      }

      if (result.status === 'in_progress' && result.preset_id && result.preset_id !== presetId) {
        const msg = isZh
          ? '已有其他模型正在拉取，请等待完成后再试'
          : 'Another model pull is already in progress'
        failTask(taskId, msg)
        throw new Error(msg)
      }

      await waitForOllamaCatalog(
        (catalog) =>
          catalog.presets?.some(
            (p) => (p.preset_id ?? p.id) === presetId && p.installed
          ) === true,
        {
          pollMs: 500,
          failIf: (catalog) =>
            catalog.operation?.state === 'error'
              ? catalog.operation.message || (isZh ? '拉取失败' : 'Pull failed')
              : null
        }
      )

      completeTask(taskId)
      return result
    },
    onSuccess: (_data, vars) => {
      activeTaskId = null
      notify(vars.isZh ? '模型已就绪' : 'Model ready', { type: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['ollama'] })
    },
    onError: (err: Error, vars) => {
      activeTaskId = null
      notify(vars.isZh ? '拉取失败' : 'Pull failed', { type: 'error', description: err.message })
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
