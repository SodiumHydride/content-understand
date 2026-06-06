import { useState, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import { Download, Loader2, Play, RefreshCw, Square, Trash2, AlertCircle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  downloadOllama,
  uninstallAppOllama,
  type OllamaCatalog,
  type RuntimePreset
} from '../lib/sidecar'
import {
  useOllamaCatalog,
  usePullModel,
  useDeleteModel,
  useStartOllama,
  useStopOllama
} from '../hooks/useOllamaQueries'
import { useTaskStore } from '../stores/taskStore'
import { useQueryClient } from '@tanstack/react-query'
import { formatBytes } from '../lib/format'
import { deriveOperationProgress, waitForOllamaCatalog } from '../lib/ollamaProgress'
import { OperationProgressCard } from './OperationProgressCard'

// ── Helpers ──────────────────────────────────────────────────────

function catalogPresetRows(
  catalog: OllamaCatalog | null,
  fallback: RuntimePreset[],
  recommendedId: string | null
): RuntimePreset[] {
  if (catalog?.presets?.length) return catalog.presets
  return fallback
    .filter((p) => (p.ollama_model || '').trim())
    .map((p) => ({
      ...p,
      preset_id: p.preset_id ?? p.id,
      installed: false,
      recommended: (p.preset_id ?? p.id) === recommendedId
    }))
}

function healthColor(health?: string): string {
  if (health === 'healthy') return 'bg-green-500'
  if (health === 'unhealthy') return 'bg-yellow-500'
  if (health === 'restarting') return 'bg-blue-400 animate-pulse'
  if (health === 'error') return 'bg-red-500'
  return 'bg-ink-400'
}

function healthLabel(health: string | undefined, isZh: boolean): string {
  if (health === 'healthy') return isZh ? '健康' : 'Healthy'
  if (health === 'unhealthy') return isZh ? '异常' : 'Unhealthy'
  if (health === 'restarting') return isZh ? '重启中' : 'Restarting'
  if (health === 'error') return isZh ? '错误' : 'Error'
  return ''
}

function resolveHealth(catalog: OllamaCatalog | null): string | undefined {
  const op = catalog?.operation
  if (!catalog?.running) return undefined
  if (op?.state === 'error') return 'error'
  return op?.ollama_health ?? 'healthy'
}

// ── Component ────────────────────────────────────────────────────

interface OllamaPanelProps {
  isZh: boolean
  useUserOllama: boolean
  onUseUserOllamaChange: (value: boolean) => void
}

export function OllamaPanel({
  isZh,
  useUserOllama,
  onUseUserOllamaChange
}: OllamaPanelProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const { data: catalogData, isLoading: catalogLoading } = useOllamaCatalog()
  const catalog = catalogData ?? null
  const pullMutation = usePullModel()
  const deleteMutation = useDeleteModel()
  const startMutation = useStartOllama()
  const stopMutation = useStopOllama()

  const pullTask = useTaskStore(
    useShallow((s) => {
      const active = Object.values(s.tasks).find(
        (t) => t.type === 'pull' && (t.status === 'running' || t.status === 'queued')
      )
      return active ?? null
    })
  )

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ollama'] })
  }, [queryClient])

  const presets = catalogPresetRows(catalog, [], catalog?.recommended_preset_id ?? null)
  const op = catalog?.operation
  const opBusy =
    op?.state === 'working' || Boolean(op?.pulling_preset_id) || Boolean(op?.setup_running)
  const downloading = loading || Boolean(catalog?.app_download_in_progress)
  const opError = op?.state === 'error' ? op.message : catalog?.app_download_error ?? null
  const health = resolveHealth(catalog)

  const operationProgress = useMemo(
    () => deriveOperationProgress(catalog, presets, isZh, pullTask),
    [catalog, presets, isZh, pullTask]
  )

  const handlePull = (preset: RuntimePreset): void => {
    const id = preset.preset_id ?? preset.id
    pullMutation.mutate({ presetId: id, modelName: preset.ollama_model, isZh })
  }

  const handleDelete = (preset: RuntimePreset): void => {
    const name = preset.installed_name || preset.ollama_model
    deleteMutation.mutate(name)
  }

  const handleStart = async (): Promise<void> => {
    setLoading(true)
    setActionMsg(isZh ? '正在启动…' : 'Starting…')
    try {
      const result = await startMutation.mutateAsync(useUserOllama)
      let source = result.source
      if (result.status === 'started' || result.status === 'in_progress') {
        const ready = await waitForOllamaCatalog((c) => c.running === true, {
          pollMs: 500,
          timeoutMs: 10 * 60 * 1000,
          failIf: (c) =>
            c.operation?.state === 'error'
              ? c.operation.message || (isZh ? '启动失败' : 'Start failed')
              : null
        })
        source = ready.source ?? source
        void queryClient.invalidateQueries({ queryKey: ['ollama'] })
      }
      setActionMsg(
        `${isZh ? '已连接' : 'Connected'} · ${source === 'user' ? (isZh ? '系统' : 'system') : (isZh ? '应用内' : 'app')}`
      )
    } catch (err) {
      setActionMsg((err as Error).message || (isZh ? '启动失败' : 'Start failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleStop = (): void => {
    stopMutation.mutate()
    setActionMsg(isZh ? '已停止' : 'Stopped')
  }

  const handleDownloadBinary = async (): Promise<void> => {
    setLoading(true)
    setActionMsg(isZh ? '正在下载应用内 Ollama…' : 'Downloading app Ollama…')
    try {
      const result = await downloadOllama()
      if (!result.ok) {
        setActionMsg(result.error || (isZh ? '下载失败' : 'Download failed'))
        return
      }
      if (result.status === 'already_installed') {
        setActionMsg(isZh ? 'Ollama 已在应用目录，正在启动…' : 'Ollama already installed, starting…')
        await handleStart()
        return
      }
      if (result.status === 'started' || result.status === 'in_progress') {
        await waitForOllamaCatalog((c) => !c.app_download_in_progress && c.app_binary_installed, {
          pollMs: 500,
          timeoutMs: 30 * 60 * 1000,
          failIf: (c) =>
            c.app_download_error
              ? c.app_download_error
              : c.operation?.state === 'error'
                ? c.operation.message
                : null
        })
        void queryClient.invalidateQueries({ queryKey: ['ollama'] })
      }
      setActionMsg(isZh ? 'Ollama 已下载，正在启动…' : 'Ollama downloaded, starting…')
      await handleStart()
    } catch (err) {
      setActionMsg((err as Error).message || (isZh ? '下载失败' : 'Download failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleUninstallApp = async (): Promise<void> => {
    setLoading(true)
    try {
      const ok = await uninstallAppOllama()
      setActionMsg(
        ok
          ? isZh
            ? '已移除应用内 Ollama（系统 Ollama 不受影响）'
            : 'App Ollama removed (system install untouched)'
          : isZh
            ? '移除失败'
            : 'Remove failed'
      )
      refresh()
    } finally {
      setLoading(false)
    }
  }

  const sourceLabel = (source: OllamaCatalog['source']): string => {
    if (source === 'app') return isZh ? '应用内 Ollama' : 'App Ollama'
    if (source === 'user') return isZh ? '系统 Ollama' : 'System Ollama'
    return isZh ? '未连接' : 'Offline'
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--divider)]">
      <div className="flex items-center justify-between border-b border-[var(--divider)] px-3 py-2.5">
        <div>
          <span className="text-[13px] font-semibold text-ink-800">
            {isZh ? '本地推理 · Ollama' : 'Local inference · Ollama'}
          </span>
          <p className="mt-0.5 text-[10px] text-ink-500">
            {isZh
              ? '仅使用目录中的 preset 模型；应用 Ollama 与模型存放在应用数据目录'
              : 'Catalog presets only; app Ollama + models live in app data'}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost rounded p-1"
          onClick={refresh}
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="space-y-3 px-3 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span
            className={clsx('inline-block h-2 w-2 rounded-full', healthColor(health))}
          />
          <span className="text-ink-700">{sourceLabel(catalog?.source ?? null)}</span>
          {catalog?.running && catalog.models_dir ? (
            <span className="text-[10px] text-ink-500" style={{ fontFamily: 'var(--font-mono)' }}>
              {catalog.source === 'app' ? catalog.models_dir : isZh ? '系统模型目录' : 'system models dir'}
            </span>
          ) : null}
          {health && health !== 'healthy' ? (
            <span
              className={clsx(
                'flex items-center gap-1 text-[10px]',
                health === 'error' ? 'text-[var(--color-danger)]' : 'text-ink-600'
              )}
            >
              {health === 'error' ? <AlertCircle size={10} /> : null}
              {healthLabel(health, isZh)}
            </span>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-[12px] text-ink-700">
          <input
            type="checkbox"
            checked={useUserOllama}
            onChange={(e) => onUseUserOllamaChange(e.target.checked)}
          />
          {isZh
            ? '若系统已运行 Ollama，优先连接（仍可管理目录内模型）'
            : 'Prefer system Ollama when running (catalog models still manageable)'}
        </label>

        <div className="flex flex-wrap gap-2">
          {/* Download: only when not running AND binary not installed */}
          {!catalog?.running && !catalog?.app_binary_installed ? (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2"
              disabled={downloading}
              onClick={() => void handleDownloadBinary()}
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {isZh ? '下载应用内 Ollama' : 'Download app Ollama'}
            </button>
          ) : null}
          {/* Connect / Start: not running + can start (binary installed OR user Ollama allowed) */}
          {!catalog?.running && (catalog?.app_binary_installed || useUserOllama) ? (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2"
              disabled={loading || opBusy}
              onClick={() => void handleStart()}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {isZh ? '连接 / 启动' : 'Connect / Start'}
            </button>
          ) : null}
          {/* Stop: only for app-managed Ollama (not system) */}
          {catalog?.running && catalog?.source === 'app' ? (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2"
              disabled={opBusy}
              onClick={handleStop}
            >
              <Square size={14} />
              {isZh ? '停止' : 'Stop'}
            </button>
          ) : null}
          {/* Remove: only when binary installed AND not running */}
          {catalog?.app_binary_installed && !catalog?.running ? (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2 text-[var(--color-danger)]"
              disabled={loading}
              onClick={() => void handleUninstallApp()}
            >
              <Trash2 size={14} />
              {isZh ? '移除应用内 Ollama' : 'Remove app Ollama'}
            </button>
          ) : null}
        </div>

        {opError ? (
          <div className="flex items-start gap-2 rounded-md bg-[var(--color-danger-soft)] px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-[var(--color-danger)]">{opError}</p>
              <button
                type="button"
                className="mt-1 text-[10px] text-[var(--color-accent)] hover:underline"
                onClick={refresh}
              >
                {isZh ? '重试' : 'Retry'}
              </button>
            </div>
          </div>
        ) : null}

        {operationProgress ? <OperationProgressCard progress={operationProgress} isZh={isZh} /> : null}

        {actionMsg && !opError && !operationProgress ? (
          <p className="text-[11px] text-ink-600">{actionMsg}</p>
        ) : null}

        <div className="space-y-1.5">
          <span className="settings-field-label">
            {isZh ? '模型目录' : 'Model catalog'}
          </span>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {catalogLoading && presets.length === 0 ? (
              <p className="text-[11px] text-ink-500">{isZh ? '加载目录…' : 'Loading catalog…'}</p>
            ) : presets.length === 0 ? (
              <p className="text-[11px] text-ink-500">
                {isZh ? '暂无 preset 模型（请确认 sidecar 已连接）' : 'No catalog presets (check sidecar connection)'}
              </p>
            ) : (
              presets.map((preset) => {
                const id = preset.preset_id ?? preset.id
                const label = isZh ? preset.label_zh : preset.label_en
                const pullingThis =
                  op?.pulling_preset_id === id ||
                  pullMutation.isPending ||
                  pullTask?.modelName === preset.ollama_model
                return (
                  <div
                    key={id}
                    className={clsx(
                      'rounded border px-2 py-2 transition-colors',
                      preset.selected
                        ? 'border-[var(--color-accent)] bg-[rgb(255_252_249/0.6)]'
                        : 'border-[var(--divider)]'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-ink-800">
                          {preset.recommended ? '★ ' : ''}
                          {label}
                        </p>
                        <p
                          className="text-[10px] text-ink-500"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          {preset.ollama_model}
                          {' · '}
                          {preset.modalities.join(', ')}
                          {' · ~'}
                          {preset.download_size_gb} GB
                        </p>
                        {preset.installed && preset.size ? (
                          <p className="text-[10px] text-green-700">
                            {isZh ? '已安装' : 'Installed'} · {formatBytes(preset.size)}
                          </p>
                        ) : null}
                        {(isZh ? preset.ollama_note_zh : preset.ollama_note_en) ? (
                          <p className="text-[10px] text-ink-500">
                            {isZh ? preset.ollama_note_zh : preset.ollama_note_en}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        {!preset.installed ? (
                          <button
                            type="button"
                            className="settings-btn-secondary px-2 py-1 text-[10px]"
                            disabled={pullingThis || loading || opBusy}
                            onClick={() => handlePull(preset)}
                          >
                            {pullingThis ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : isZh ? (
                              '拉取'
                            ) : (
                              'Pull'
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost rounded p-1 text-ink-500 hover:text-[var(--color-danger)]"
                            onClick={() => handleDelete(preset)}
                            title={isZh ? '删除模型' : 'Delete model'}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
