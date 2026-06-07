import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRuntimeRecommend } from '../lib/sidecar'
import { useAppStore } from '../stores/appStore'
import { useOllamaCatalog } from '../hooks/useOllamaQueries'
import { deriveOperationProgress } from '../lib/ollamaProgress'
import { useQuery } from '@tanstack/react-query'

export function SetupBanner(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const sidecarOnline = useAppStore((s) => s.sidecarOnline)
  const settings = useAppStore((s) => s.settings)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const { data: catalog } = useOllamaCatalog()

  const { data: recommend } = useQuery({
    queryKey: ['runtime', 'recommend'],
    queryFn: fetchRuntimeRecommend,
    enabled: sidecarOnline && settings.inferenceMode !== 'api_only',
    staleTime: 60_000
  })

  const line = useMemo(() => {
    if (!sidecarOnline) return ''
    const opProgress = deriveOperationProgress(catalog ?? null, catalog?.presets ?? [], isZh)
    if (opProgress) {
      const pct =
        typeof opProgress.percent === 'number' ? ` ${opProgress.percent}%` : ''
      const speed = opProgress.speed ? ` · ${opProgress.speed}` : ''
      return `${opProgress.label}${pct}${speed}`
    }
    if (catalog?.running) return t('setup.localReady')
    if (settings.inferenceMode === 'api_only') return ''
    if (recommend) {
      return isZh
        ? recommend.summary_zh.split('\n').slice(-1)[0]
        : recommend.summary_en.split('\n').slice(-1)[0]
    }
    return ''
  }, [sidecarOnline, catalog, isZh, settings.inferenceMode, recommend, t])

  if (!sidecarOnline) {
    return (
      <div className="setup-banner setup-banner-error flex items-center justify-between gap-3 border-b border-[var(--divider)] px-4 py-2 text-xs text-ink-700">
        <span>{t('errors.sidecarOffline') || 'Engine is offline. Restart the app or check Settings.'}</span>
        <button
          type="button"
          className="btn-ghost shrink-0 py-1 text-[11px]"
          onClick={() => setSettingsOpen(true)}
        >
          {t('nav.settings') || 'Settings'}
        </button>
      </div>
    )
  }

  if (!line) return null

  return (
    <div className="setup-banner flex items-center justify-between gap-3 border-b border-[var(--divider)] px-4 py-2 text-xs text-ink-700">
      <span>{line}</span>
      <button
        type="button"
        className="settings-btn-secondary shrink-0 py-1 text-[11px]"
        onClick={() => setSettingsOpen(true)}
      >
        {t('setup.openSettings')}
      </button>
    </div>
  )
}
