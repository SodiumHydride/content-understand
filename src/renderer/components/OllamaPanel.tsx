import * as React from 'react'
import { Download, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  fetchOllamaStatus,
  downloadOllama,
  startOllama,
  fetchOllamaModels,
  pullOllamaModel,
  deleteOllamaModel,
  type OllamaStatus,
  type OllamaModel
} from '../lib/sidecar'
import { Select, type SelectOption } from './Select'

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

const RECOMMENDED_MODELS = [
  { name: 'qwen2.5-vl:3b', label: 'Qwen2.5-VL 3B (图像+视频)' },
  { name: 'qwen2.5-vl:7b', label: 'Qwen2.5-VL 7B (高质量)' },
  { name: 'minicpm-o:latest', label: 'MiniCPM-o (图像+视频+音频)' },
  { name: 'gemma3:4b', label: 'Gemma 3 4B (轻量)' },
  { name: 'gemma3:12b', label: 'Gemma 3 12B (高质量)' },
  { name: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision 11B' }
]

interface OllamaPanelProps {
  isZh: boolean
}

export function OllamaPanel({ isZh }: OllamaPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState<OllamaStatus | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [actionMsg, setActionMsg] = React.useState<string | null>(null)
  const [pullName, setPullName] = React.useState('')
  const [pulling, setPulling] = React.useState(false)
  const [models, setModels] = React.useState<OllamaModel[]>([])

  const refresh = React.useCallback(async () => {
    const s = await fetchOllamaStatus()
    setStatus(s)
    if (s?.running) {
      setModels(s.models as OllamaModel[])
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleDownload = async (): Promise<void> => {
    setLoading(true)
    setActionMsg(isZh ? '正在下载 Ollama...' : 'Downloading Ollama...')
    const result = await downloadOllama()
    if (result.ok) {
      setActionMsg(isZh ? '下载完成' : 'Download complete')
      void refresh()
    } else {
      setActionMsg(result.error || (isZh ? '下载失败' : 'Download failed'))
    }
    setLoading(false)
  }

  const handleStart = async (): Promise<void> => {
    setLoading(true)
    setActionMsg(isZh ? '正在启动 Ollama...' : 'Starting Ollama...')
    const result = await startOllama()
    if (result.ok) {
      setActionMsg(isZh ? 'Ollama 已启动' : 'Ollama started')
      void refresh()
    } else {
      setActionMsg(result.error || (isZh ? '启动失败' : 'Start failed'))
    }
    setLoading(false)
  }

  const handlePull = async (): Promise<void> => {
    if (!pullName.trim()) return
    setPulling(true)
    setActionMsg(isZh ? `正在拉取 ${pullName}...` : `Pulling ${pullName}...`)
    const result = await pullOllamaModel(pullName.trim())
    if (result.ok) {
      setActionMsg(isZh ? `${pullName} 拉取完成` : `${pullName} pulled`)
      setPullName('')
      void refresh()
    } else {
      setActionMsg(result.error || (isZh ? '拉取失败' : 'Pull failed'))
    }
    setPulling(false)
  }

  const handleDelete = async (name: string): Promise<void> => {
    const ok = await deleteOllamaModel(name)
    if (ok) {
      setModels((prev) => prev.filter((m) => m.name !== name))
    }
  }

  const isRunning = status?.running ?? false
  const isInstalled = status?.installed ?? false

  return (
    <div className="rounded-lg border border-[var(--divider)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--divider)] px-3 py-2.5">
        <span className="text-[13px] font-semibold text-ink-800">
          {isZh ? 'Ollama 本地推理' : 'Ollama Local Inference'}
        </span>
        <button
          type="button"
          className="btn-ghost rounded p-1"
          onClick={() => void refresh()}
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="space-y-3 p-3">
        {/* Status */}
        <div className="flex items-center gap-2 text-[12px]">
          <span className={clsx(
            'inline-block h-2 w-2 rounded-full',
            isRunning ? 'bg-green-500' : isInstalled ? 'bg-yellow-500' : 'bg-ink-400'
          )} />
          <span className="text-ink-700">
            {isRunning
              ? `${isZh ? '运行中' : 'Running'}${status?.version ? ` · v${status.version}` : ''}`
              : isInstalled
                ? (isZh ? '已安装，未运行' : 'Installed, not running')
                : (isZh ? '未安装' : 'Not installed')}
          </span>
        </div>

        {/* Actions */}
        {!isInstalled && (
          <button
            type="button"
            className="settings-btn-secondary flex items-center gap-2"
            disabled={loading}
            onClick={() => void handleDownload()}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {isZh ? '下载 Ollama' : 'Download Ollama'}
          </button>
        )}
        {isInstalled && !isRunning && (
          <button
            type="button"
            className="settings-btn-secondary flex items-center gap-2"
            disabled={loading}
            onClick={() => void handleStart()}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {isZh ? '启动 Ollama' : 'Start Ollama'}
          </button>
        )}

        {/* Action message */}
        {actionMsg && (
          <p className="text-[11px] text-ink-600">{actionMsg}</p>
        )}

        {/* Models list */}
        {isRunning && (
          <>
            {models.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-ink-600">
                  {isZh ? '已安装模型' : 'Installed Models'}
                </span>
                {models.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center gap-2 rounded border border-[var(--divider)] px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-ink-800">{m.name}</p>
                      <p className="text-[10px] text-ink-500">
                        {formatBytes(m.size)}
                        {m.details?.parameter_size && ` · ${m.details.parameter_size}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost rounded p-1 text-ink-500 hover:text-[var(--color-danger)]"
                      onClick={() => void handleDelete(m.name)}
                      title={isZh ? '删除' : 'Delete'}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Pull model */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-ink-600">
                {isZh ? '拉取新模型' : 'Pull Model'}
              </span>
              <div className="flex gap-2">
                <input
                  value={pullName}
                  onChange={(e) => setPullName(e.target.value)}
                  placeholder={isZh ? '模型名，如 qwen2.5-vl:3b' : 'e.g. qwen2.5-vl:3b'}
                  className="settings-input flex-1 text-[12px]"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handlePull() }}
                />
                <button
                  type="button"
                  className="settings-btn-secondary flex items-center gap-1"
                  disabled={pulling || !pullName.trim()}
                  onClick={() => void handlePull()}
                >
                  {pulling ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  {isZh ? '拉取' : 'Pull'}
                </button>
              </div>

              {/* Recommended models */}
              <div className="flex flex-wrap gap-1">
                {RECOMMENDED_MODELS.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    className="rounded border border-[var(--divider)] px-1.5 py-0.5 text-[10px] text-ink-600 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                    onClick={() => setPullName(m.name)}
                    title={m.label}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
