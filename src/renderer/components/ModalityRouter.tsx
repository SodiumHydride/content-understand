import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import type { ModalityRoute, ProviderConfig, ProviderId } from '../stores/types'
import { Select, type SelectOption } from './Select'

const MODALITY_KEYS: Record<string, string> = {
  video: 'modalityRouter.video',
  image: 'modalityRouter.image',
  audio: 'modalityRouter.audio',
  article: 'modalityRouter.article'
}

interface ModalityRouterProps {
  providers: Record<string, ProviderConfig>
  defaultProvider: ProviderId
  overrides: Record<string, ModalityRoute>
  onDefaultChange: (providerId: ProviderId) => void
  onOverrideChange: (modality: string, route: ModalityRoute) => void
}

export function ModalityRouter({
  providers,
  defaultProvider,
  overrides,
  onDefaultChange,
  onOverrideChange
}: ModalityRouterProps): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)

  const enabledProviders = Object.values(providers).filter((p) => p.enabled)

  const providerOptions: SelectOption[] = [
    ...enabledProviders.map((p) => ({
      value: p.id,
      label: p.id === 'mimo' ? 'MiMo'
        : p.id === 'gemini' ? 'Gemini'
        : p.id === 'claude' ? 'Claude'
        : p.id === 'openai_compat' ? 'OpenAI'
        : 'Local'
    }))
  ]

  const getModelOptions = (providerId: ProviderId | null): SelectOption[] => {
    const pid = providerId || defaultProvider
    const provider = providers[pid]
    if (!provider) return []
    const models = provider.models.length > 0
      ? provider.models
      : provider.selectedModel ? [provider.selectedModel] : []
    return models.map((m) => ({ value: m, label: m }))
  }

  const getEffectiveRoute = (modality: string): ModalityRoute => {
    const override = overrides[modality]
    if (override?.providerId) return override
    return { providerId: null, model: '' }
  }

  return (
    <div className="rounded-lg border border-[var(--divider)]">
      {/* Default provider */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="text-[12px] font-semibold text-ink-800">
          {t('modalityRouter.defaultProvider')}
        </span>
        <div className="flex-1">
          <Select
            value={defaultProvider}
            options={providerOptions}
            onChange={(v) => onDefaultChange(v as ProviderId)}
            compact
          />
        </div>
      </div>

      {/* Expand toggle */}
      <button
        type="button"
        className="flex w-full items-center gap-1 border-t border-[var(--divider)] px-3 py-1.5 text-[11px] text-ink-500 hover:text-ink-700"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown
          size={12}
          className={clsx('transition-transform', expanded && 'rotate-180')}
        />
        {t('modalityRouter.perModalityOverrides')}
      </button>

      {/* Per-modality overrides */}
      {expanded && (
        <div className="border-t border-[var(--divider)]">
          {Object.entries(MODALITY_KEYS).map(([modality, labelKey]) => {
            const route = getEffectiveRoute(modality)
            const isOverridden = !!route.providerId
            return (
              <div
                key={modality}
                className="flex items-center gap-2 border-b border-[var(--divider)] px-3 py-2 last:border-b-0"
              >
                <span className="w-12 shrink-0 text-[11px] font-medium text-ink-600">
                  {t(labelKey)}
                </span>
                <div className="w-28">
                  <Select
                    value={route.providerId || ''}
                    options={[
                      { value: '', label: t('modalityRouter.default') },
                      ...providerOptions
                    ]}
                    onChange={(v) => {
                      if (!v) {
                        onOverrideChange(modality, { providerId: null, model: '' })
                      } else {
                        const pid = v as ProviderId
                        const models = getModelOptions(pid)
                        onOverrideChange(modality, {
                          providerId: pid,
                          model: models[0]?.value || ''
                        })
                      }
                    }}
                    compact
                  />
                </div>
                {isOverridden && (
                  <div className="flex-1">
                    <Select
                      value={route.model}
                      options={getModelOptions(route.providerId)}
                      onChange={(v) => {
                        onOverrideChange(modality, { ...route, model: v })
                      }}
                      compact
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
