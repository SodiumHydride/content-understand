import * as React from 'react'
import clsx from 'clsx'
import { Download, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import {
  deleteOllamaModel,
  downloadOllama,
  fetchOllamaCatalog,
  fetchPresets,
  fetchRuntimeRecommend,
  pullOllamaPreset,
  selectOllamaPreset,
  startOllama,
  uninstallAppOllama,
  type OllamaCatalog,
  type RuntimePreset
} from '../lib/sidecar'
import { Select, type SelectOption } from './Select'

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

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

function operationMessage(catalog: OllamaCatalog | null, isZh: boolean): string | null {
  const op = catalog?.operation
  if (!op || op.state !== 'working') return null
  const pctNum = op.progress?.percent
  const pct =
    typeof pctNum === 'number' ? ` ${pctNum}%` : ''
  const detail = op.progress?.message || op.message
  if (op.pulling_preset_id) {
    const preset = catalog?.presets.find((p) => (p.preset_id ?? p.id) === op.pulling_preset_id)
    const model = preset?.ollama_model ?? op.pulling_preset_id
    const status = detail && detail !== 'preparing' ? ` · ${detail}` : ''
    return isZh
      ? `正在拉取 ${model}…${pct}${status}`
      : `Pulling ${model}…${pct}${status}`
  }
  if (op.setup_running) {
    return isZh ? `正在启动 Ollama…${pct} ${detail}` : `Starting Ollama…${pct} ${detail}`
  }
  return detail ? `${detail}${pct}` : null
}

async function pollCatalog(
  refresh: () => Promise<void>,
  done: (catalog: OllamaCatalog | null) => boolean,
  deadlineMs = 60 * 60 * 1000
): Promise<{ ok: boolean; error?: string; catalog?: OllamaCatalog | null }> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const data = await fetchOllamaCatalog()
    if (data?.operation?.state === 'error') {
      return { ok: false, error: data.operation.message || 'Operation failed', catalog: data }
    }
    if (done(data)) return { ok: true, catalog: data }
    await new Promise((r) => setTimeout(r, 2000))
    await refresh()
  }
  return { ok: false, error: 'Operation timed out' }
}

async function waitForAppBinary(
  refresh: () => Promise<void>,
  deadlineMs = 10 * 60 * 1000
): Promise<{ ok: boolean; error?: string }> {
  const result = await pollCatalog(
    refresh,
    (data) => Boolean(data?.app_binary_installed && !data.app_download_in_progress),
    deadlineMs
  )
  if (!result.ok && result.catalog?.app_download_error) {
    return { ok: false, error: result.catalog.app_download_error }
  }
  return { ok: result.ok, error: result.error }
}

interface OllamaPanelProps {
  isZh: boolean
  localPresetId: string
  useUserOllama: boolean
  onPresetChange: (presetId: string) => void
  onUseUserOllamaChange: (value: boolean) => void
}

export function OllamaPanel({
  isZh,
  localPresetId,
  useUserOllama,
  onPresetChange,
  onUseUserOllamaChange
}: OllamaPanelProps): React.JSX.Element {
  const [catalog, setCatalog] = React.useState<OllamaCatalog | null>(null)
  const [fallbackPresets, setFallbackPresets] = React.useState<RuntimePreset[]>([])
  const [recommendedId, setRecommendedId] = React.useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = React.useState(true)
  const [loading, setLoading] = React.useState(false)
  const [pullingId, setPullingId] = React.useState<string | null>(null)
  const [actionMsg, setActionMsg] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    const data = await fetchOllamaCatalog()
    setCatalog(data)
    setCatalogLoading(false)
  }, [])

  React.useEffect(() => {
    void refresh()
    void fetchPresets().then((ps) => {
      setFallbackPresets(ps)
      setCatalogLoading(false)
    })
    void fetchRuntimeRecommend().then((r) => setRecommendedId(r?.recommended_preset_id ?? null))
  }, [refresh])

  React.useEffect(() => {
    const op = catalog?.operation
    const busy =
      Boolean(catalog?.app_download_in_progress) ||
      op?.state === 'working' ||
      Boolean(op?.pulling_preset_id) ||
      Boolean(op?.setup_running)
    if (!busy) return

    const msg = operationMessage(catalog, isZh)
    if (msg) setActionMsg(msg)
    if (op?.pulling_preset_id) setPullingId(op.pulling_preset_id)

    const id = window.setInterval(() => {
      void refresh()
    }, 2000)
    return () => window.clearInterval(id)
  }, [
    catalog?.operation?.state,
    catalog?.operation?.pulling_preset_id,
    catalog?.operation?.progress?.percent,
    catalog?.app_download_in_progress,
    isZh,
    refresh
  ])

  const presets = catalogPresetRows(catalog, fallbackPresets, catalog?.recommended_preset_id ?? recommendedId)
  const selectedId =
    localPresetId ||
    catalog?.selected_preset_id ||
    catalog?.recommended_preset_id ||
    recommendedId ||
    ''

  const presetOptions: SelectOption[] = presets.map((p) => ({
    value: p.preset_id ?? p.id,
    label: isZh ? p.label_zh : p.label_en
  }))

  const sourceLabel = (source: OllamaCatalog['source']): string => {
    if (source === 'app') return isZh ? '应用内 Ollama' : 'App Ollama'
    if (source === 'user') return isZh ? '系统 Ollama' : 'System Ollama'
    return isZh ? '未连接' : 'Offline'
  }

  const handleSelectPreset = async (presetId: string): Promise<void> => {
    onPresetChange(presetId)
    await selectOllamaPreset(presetId)
    void refresh()
  }

  const handlePull = async (preset: RuntimePreset): Promise<void> => {
    const id = preset.preset_id ?? preset.id
    setPullingId(id)
    setActionMsg(isZh ? `正在拉取 ${preset.ollama_model}…` : `Pulling ${preset.ollama_model}…`)
    try {
      const result = await pullOllamaPreset(id)
      if (!result.ok) {
        setActionMsg(result.error || (isZh ? '拉取失败' : 'Pull failed'))
        setPullingId(null)
        return
      }
      if (result.status === 'already_installed') {
        onPresetChange(id)
        setActionMsg(isZh ? '模型已就绪' : 'Model ready')
        setPullingId(null)
        void refresh()
        return
      }
      onPresetChange(id)
      const polled = await pollCatalog(
        refresh,
        (data) =>
          Boolean(
            data?.presets.find((p) => (p.preset_id ?? p.id) === id)?.installed
          ),
        2 * 60 * 60 * 1000
      )
      if (polled.ok) {
        setActionMsg(isZh ? '模型已就绪' : 'Model ready')
      } else {
        setActionMsg(polled.error || (isZh ? '拉取失败' : 'Pull failed'))
      }
    } finally {
      setPullingId(null)
      void refresh()
    }
  }

  const handleDelete = async (preset: RuntimePreset): Promise<void> => {
    const name = preset.installed_name || preset.ollama_model
    const ok = await deleteOllamaModel(name)
    if (ok) void refresh()
  }

  const handleStart = async (): Promise<void> => {
    setLoading(true)
    setActionMsg(isZh ? '正在启动…' : 'Starting…')
    try {
      const result = await startOllama(useUserOllama)
      if (!result.ok) {
        setActionMsg(result.error || (isZh ? '启动失败' : 'Start failed'))
        return
      }
      if (result.status === 'ready' && result.base_url) {
        setActionMsg(
          `${isZh ? '已连接' : 'Connected'} · ${result.source === 'user' ? (isZh ? '系统' : 'system') : (isZh ? '应用内' : 'app')}`
        )
        void refresh()
        return
      }
      const polled = await pollCatalog(refresh, (data) => Boolean(data?.running), 120_000)
      if (polled.ok && polled.catalog?.running) {
        const src = polled.catalog.source
        setActionMsg(
          `${isZh ? '已连接' : 'Connected'} · ${src === 'user' ? (isZh ? '系统' : 'system') : (isZh ? '应用内' : 'app')}`
        )
      } else {
        setActionMsg(polled.error || (isZh ? '启动失败' : 'Start failed'))
      }
      void refresh()
    } finally {
      setLoading(false)
    }
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
        await refresh()
        await handleStart()
        return
      }

      const waited = await waitForAppBinary(refresh)
      if (!waited.ok) {
        setActionMsg(waited.error || (isZh ? '下载失败' : 'Download failed'))
        return
      }

      setActionMsg(isZh ? 'Ollama 已下载，正在启动…' : 'Ollama downloaded, starting…')
      await refresh()
      await handleStart()
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
          ? (isZh ? '已移除应用内 Ollama（系统 Ollama 不受影响）' : 'App Ollama removed (system install untouched)')
          : (isZh ? '移除失败' : 'Remove failed')
      )
      void refresh()
    } finally {
      setLoading(false)
    }
  }

  const opBusy =
    catalog?.operation?.state === 'working' ||
    Boolean(catalog?.operation?.pulling_preset_id) ||
    Boolean(catalog?.operation?.setup_running)
  const downloading = loading || Boolean(catalog?.app_download_in_progress)
  const showDownloadBtn = !catalog?.app_binary_installed && !catalog?.app_download_in_progress
  const liveOpMsg = operationMessage(catalog, isZh)

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
          onClick={() => void refresh()}
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="space-y-3 px-3 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span
            className={clsx(
              'inline-block h-2 w-2 rounded-full',
              catalog?.running ? 'bg-green-500' : 'bg-ink-400'
            )}
          />
          <span className="text-ink-700">{sourceLabel(catalog?.source ?? null)}</span>
          {catalog?.running && catalog.models_dir && (
            <span className="text-[10px] text-ink-500" style={{ fontFamily: 'var(--font-mono)' }}>
              {catalog.source === 'app' ? catalog.models_dir : (isZh ? '系统模型目录' : 'system models dir')}
            </span>
          )}
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
          {showDownloadBtn && (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2"
              disabled={downloading}
              onClick={() => void handleDownloadBinary()}
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {isZh ? '下载应用内 Ollama' : 'Download app Ollama'}
            </button>
          )}
          {!catalog?.running && (catalog?.app_binary_installed || useUserOllama) && (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2"
              disabled={loading || opBusy}
              onClick={() => void handleStart()}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {isZh ? '连接 / 启动' : 'Connect / Start'}
            </button>
          )}
          {catalog?.app_binary_installed && (
            <button
              type="button"
              className="settings-btn-secondary flex items-center gap-2 text-[var(--color-danger)]"
              disabled={loading}
              onClick={() => void handleUninstallApp()}
            >
              <Trash2 size={14} />
              {isZh ? '移除应用内 Ollama' : 'Remove app Ollama'}
            </button>
          )}
        </div>

        {(actionMsg || liveOpMsg) && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-ink-600">{actionMsg || liveOpMsg}</p>
            {opBusy && typeof catalog?.operation?.progress?.percent === 'number' && (
              <div className="h-1 overflow-hidden rounded-full bg-[var(--color-paper-deep)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(2, catalog.operation.progress.percent))}%`
                  }}
                />
              </div>
            )}
          </div>
        )}
        {catalog?.app_download_in_progress && !actionMsg && !liveOpMsg && (
          <p className="text-[11px] text-ink-600">
            {isZh ? '正在下载应用内 Ollama…' : 'Downloading app Ollama…'}
          </p>
        )}

        {presets.length > 0 && (
          <div className="space-y-1.5">
            <span className="settings-field-label">
              {isZh ? '本地 preset（硬件推荐已标注）' : 'Local preset (★ = recommended)'}
            </span>
            <Select
              value={selectedId}
              options={presetOptions.map((o) => ({
                ...o,
                label: `${presets.find((p) => (p.preset_id ?? p.id) === o.value)?.recommended ? '★ ' : ''}${o.label}`
              }))}
              onChange={(v) => void handleSelectPreset(v)}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <span className="settings-field-label">
            {isZh ? '模型目录（仅 preset）' : 'Model catalog (presets only)'}
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
                const pulling =
                  pullingId === id ||
                  catalog?.operation?.pulling_preset_id === id
                return (
                  <div
                    key={id}
                    className={clsx(
                      'rounded border px-2 py-2',
                      preset.selected || id === selectedId
                        ? 'border-[var(--color-accent)] bg-[rgb(255_252_249/0.6)]'
                        : 'border-[var(--divider)]'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-ink-800">
                          {preset.recommended ? '★ ' : ''}{label}
                        </p>
                        <p className="text-[10px] text-ink-500" style={{ fontFamily: 'var(--font-mono)' }}>
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
                        {(isZh ? preset.ollama_note_zh : preset.ollama_note_en) && (
                          <p className="text-[10px] text-ink-500">
                            {isZh ? preset.ollama_note_zh : preset.ollama_note_en}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        {!preset.installed ? (
                          <button
                            type="button"
                            className="settings-btn-secondary px-2 py-1 text-[10px]"
                            disabled={pulling || loading || opBusy}
                            onClick={() => void handlePull(preset)}
                          >
                            {pulling ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              isZh ? '拉取' : 'Pull'
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost rounded p-1 text-ink-500 hover:text-[var(--color-danger)]"
                            onClick={() => void handleDelete(preset)}
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
