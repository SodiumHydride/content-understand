import * as React from 'react'
import { useCallback } from 'react'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import type { ProviderConfig, ProviderId } from '../stores/types'
import { PROVIDER_PRESETS } from '../stores/types'
import { fetchProviderModels } from '../lib/sidecar'
import { Select, type SelectOption } from './Select'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  mimo: 'MiMo API',
  gemini: 'Google Gemini',
  claude: 'Anthropic Claude',
  openai_compat: 'OpenAI Compatible',
  local_server: 'Local (Ollama)'
}

interface ProviderCardProps {
  provider: ProviderConfig
  onChange: (patch: Partial<ProviderConfig>) => void
}

export function ProviderCard({ provider, onChange }: ProviderCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [loading, setLoading] = React.useState(false)
  const [expanded, setExpanded] = React.useState(provider.enabled)
  const autoFetched = React.useRef(false)

  const preset = PROVIDER_PRESETS[provider.id]
  const hasBaseUrl = preset?.baseUrl || provider.id === 'openai_compat'
  const isLocal = provider.id === 'local_server'

  const handleFetchModels = useCallback(async (): Promise<void> => {
    if (!provider.baseUrl && !preset?.baseUrl && !isLocal) return
    setLoading(true)
    const models = await fetchProviderModels(
      provider.id,
      provider.baseUrl || preset?.baseUrl || '',
      provider.apiKeys
    )
    if (models) {
      const patch: Partial<ProviderConfig> = { models }
      if (models.length > 0) {
        if (!provider.selectedModel || !models.includes(provider.selectedModel)) {
          patch.selectedModel = models[0]
        }
      } else if (isLocal && provider.selectedModel) {
        patch.selectedModel = ''
      }
      onChange(patch)
    }
    setLoading(false)
  }, [provider.baseUrl, provider.apiKeys, provider.id, provider.selectedModel, isLocal, onChange, preset?.baseUrl])

  // Auto-fetch models when provider is enabled and has credentials
  React.useEffect(() => {
    if (autoFetched.current) return
    if (!provider.enabled) return
    if (isLocal) {
      // Local: always fetch from presets
      autoFetched.current = true
      void handleFetchModels()
      return
    }
    // Cloud: fetch if has API key (or no key needed for some providers)
    const hasKey = provider.apiKeys.trim().length > 0
    const needsKey = provider.id !== 'openai_compat' || provider.baseUrl
    if (hasKey || !needsKey) {
      autoFetched.current = true
      void handleFetchModels()
    }
  }, [provider.baseUrl, provider.id, provider.enabled, provider.apiKeys, isLocal, handleFetchModels])

  const modelOptions: SelectOption[] = isLocal
    ? provider.models.map((m) => ({ value: m, label: m }))
    : [
        ...provider.models.map((m) => ({ value: m, label: m })),
        { value: '__custom__', label: t('provider.custom') }
      ]

  const effectiveModel = provider.models.includes(provider.selectedModel)
    ? provider.selectedModel
    : provider.selectedModel || '__custom__'

  return (
    <div
      className={clsx(
        'rounded-lg border transition-colors',
        provider.enabled
          ? 'border-[var(--border-strong)] bg-white'
          : 'border-[var(--divider)] bg-[var(--color-shelf)]'
      )}
    >
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <label
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) => {
              onChange({ enabled: e.target.checked })
              if (e.target.checked) setExpanded(true)
            }}
          />
        </label>
        <span className={clsx(
          'flex-1 text-[13px] font-semibold',
          provider.enabled ? 'text-ink-900' : 'text-ink-500'
        )}>
          {PROVIDER_LABELS[provider.id]}
        </span>
        {provider.enabled && provider.selectedModel && (
          <span className="text-[11px] text-ink-500">{provider.selectedModel}</span>
        )}
        <ChevronDown
          size={14}
          className={clsx(
            'shrink-0 text-ink-500 transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {/* Body */}
      {expanded && (
        <div className="space-y-2.5 border-t border-[var(--divider)] px-3 py-3">
          {/* Base URL */}
          {hasBaseUrl && (
            <div>
              <span className="settings-field-label">Base URL</span>
              <input
                value={provider.baseUrl}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder={preset?.baseUrl || 'https://...'}
                className="settings-input text-[12px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          )}

          {/* API Keys */}
          {!isLocal && (
            <div>
              <span className="settings-field-label">
                {provider.id === 'mimo' ? 'API Keys' : 'API Key'}
              </span>
              <input
                type="password"
                value={provider.apiKeys}
                onChange={(e) => onChange({ apiKeys: e.target.value })}
                placeholder={provider.id === 'mimo' ? 'sk-xxx, sk-yyy' : 'sk-xxx'}
                className="settings-input text-[12px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              {provider.id === 'mimo' && (
                <p className="mt-1 text-[10px] text-ink-500">
                  {t('provider.commaSeparated')}
                </p>
              )}
            </div>
          )}

          {/* Model selector */}
          <div>
            <div className="flex items-center justify-between">
              <span className="settings-field-label">
                {t('provider.model')}
              </span>
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] text-ink-500 hover:text-[var(--color-accent)]"
                onClick={handleFetchModels}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <RefreshCw size={10} />
                )}
                {isLocal
                  ? t('provider.refreshInstalled')
                  : t('provider.fetchModels')}
              </button>
            </div>
            {provider.models.length > 0 ? (
              <Select
                value={effectiveModel}
                options={modelOptions}
                onChange={(v) => {
                  if (v === '__custom__') {
                    onChange({ selectedModel: '' })
                  } else {
                    onChange({ selectedModel: v })
                  }
                }}
                compact
              />
            ) : isLocal ? (
              <p className="text-[11px] leading-relaxed text-ink-500">
                {t('provider.localPullHint')}
              </p>
            ) : (
              <input
                value={provider.selectedModel}
                onChange={(e) => onChange({ selectedModel: e.target.value })}
                placeholder={PROVIDER_PRESETS[provider.id]?.defaultModels[0] || 'model-name'}
                className="settings-input text-[12px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
