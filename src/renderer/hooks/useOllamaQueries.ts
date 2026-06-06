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

// ─── Catalog (polling) ───────────────────────────────────────────

export function useOllamaCatalog() {
  return useQuery<OllamaCatalog | null>({
    queryKey: ['ollama', 'catalog'],
    queryFn: fetchOllamaCatalog,
    refetchInterval: (query) => {
      const op = query.state.data?.operation
      if (!op) return 30_000 // idle: poll every 30s for health
      if (op.state === 'working' || op.pulling_preset_id || op.setup_running) return 2_000
      return 30_000
    }
  })
}

// ─── Runtime Status (polling) ────────────────────────────────────

export function useRuntimeStatus() {
  return useQuery<OllamaStatus | null>({
    queryKey: ['ollama', 'status'],
    queryFn: fetchOllamaStatus,
    refetchInterval: 10_000
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

export function usePullModel() {
  const queryClient = useQueryClient()
  const addTask = useTaskStore((s) => s.addTask)
  const updateProgress = useTaskStore((s) => s.updateProgress)
  const completeTask = useTaskStore((s) => s.completeTask)
  const failTask = useTaskStore((s) => s.failTask)

  return useMutation({
    mutationFn: async ({ presetId, modelName }: { presetId: string; modelName: string }) => {
      const taskId = addTask({ type: 'pull', modelName, label: `Pulling ${modelName}`, progress: -1 })

      const result = await pullOllamaPreset(presetId)
      if (!result.ok) {
        failTask(taskId, result.error || 'Pull failed')
        throw new Error(result.error || 'Pull failed')
      }

      if (result.status === 'already_installed') {
        completeTask(taskId)
        return result
      }

      // Poll catalog until pull completes
      const deadline = Date.now() + 2 * 60 * 60 * 1000 // 2h max
      while (Date.now() < deadline) {
        const catalog = await fetchOllamaCatalog()
        const op = catalog?.operation

        if (op?.progress) {
          const p = op.progress
          updateProgress(
            taskId,
            p.percent ?? -1,
            (p as Record<string, unknown>).total_bytes as number,
            (p as Record<string, unknown>).completed_bytes as number,
            (p as Record<string, unknown>).speed_bps as number
          )
        }

        if (op?.state === 'error') {
          failTask(taskId, op.message || 'Pull failed')
          throw new Error(op.message || 'Pull failed')
        }

        const installed = catalog?.presets?.find(
          (p) => (p.preset_id ?? p.id) === presetId
        )?.installed
        if (installed) {
          completeTask(taskId)
          return result
        }

        await new Promise((r) => setTimeout(r, 2000))
      }

      failTask(taskId, 'Pull timed out')
      throw new Error('Pull timed out')
    },
    onSuccess: () => {
      notify('Model ready', { type: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['ollama'] })
    },
    onError: (err: Error) => {
      notify('Pull failed', { type: 'error', description: err.message })
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
