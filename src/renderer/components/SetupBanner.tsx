import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRuntimeRecommend, fetchRuntimeStatus } from '../lib/sidecar'
import { useAppStore } from '../stores/appStore'

export function SetupBanner(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const sidecarOnline = useAppStore((s) => s.sidecarOnline)
  const settings = useAppStore((s) => s.settings)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const [line, setLine] = useState('')

  useEffect(() => {
    if (!sidecarOnline) return
    void (async () => {
      const st = await fetchRuntimeStatus()
      if (st?.state === 'ready') {
        setLine(t('setup.localReady'))
        return
      }
      if (st?.state === 'working') {
        setLine(`${t('setup.localWorking')} ${st.progress?.percent ?? 0}%`)
        return
      }
      if (settings.inferenceMode === 'api_only') {
        setLine('')
        return
      }
      const rec = await fetchRuntimeRecommend()
      if (rec) {
        setLine(
          i18n.language.startsWith('zh')
            ? rec.summary_zh.split('\n').slice(-1)[0]
            : rec.summary_en.split('\n').slice(-1)[0]
        )
      }
    })()
  }, [sidecarOnline, settings.inferenceMode, i18n.language, t])

  if (!line || !sidecarOnline) return null

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
