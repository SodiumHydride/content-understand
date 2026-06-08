import clsx from 'clsx'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { AppLocale } from '../lib/i18n'
import { useState, useEffect } from 'react'
import { rebuildIndex, exportCookies } from '../lib/sidecar'
import type { InferenceMode } from '../stores/types'
import { Select, type SelectOption } from './Select'
import { ProviderCard } from './ProviderCard'
import { ModalityRouter } from './ModalityRouter'
import { OllamaPanel } from './OllamaPanel'
import { LogViewer } from './LogViewer'

type SettingsTab = 'general' | 'vault' | 'models' | 'logs' | 'advanced' | 'about'

const tabs: SettingsTab[] = ['general', 'vault', 'models', 'logs', 'advanced', 'about']

export function SettingsModal(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const open = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const updateProvider = useAppStore((s) => s.updateProvider)
  const setModalityRoute = useAppStore((s) => s.setModalityRoute)
  const applyLocale = useAppStore((s) => s.applyLocale)
  const pushEngineConfig = useAppStore((s) => s.pushEngineConfig)
  const refreshLibrary = useAppStore((s) => s.refreshLibrary)

  const [tab, setTab] = useState<SettingsTab>('general')
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Focus trap + Escape handler
  useEffect(() => {
    if (!open) return
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const panel = document.querySelector('.modal-panel.settings-shell')
    if (!panel) return
    const elements = (Array.from(panel.querySelectorAll(FOCUSABLE)) as HTMLElement[])
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (elements.length > 0) {
      setTimeout(() => elements[0].focus(), 0)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSettingsOpen(false)
        return
      }
      if (e.key !== 'Tab' || elements.length === 0) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, setSettingsOpen])

  if (!open) return null

  const save = (): void => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1600)
  }

  const localeOptions: SelectOption[] = [
    { value: 'system', label: t('settings.languageSystem') },
    { value: 'zh', label: t('settings.languageZh') },
    { value: 'en', label: t('settings.languageEn') }
  ]

  const inferenceOptions: SelectOption[] = [
    { value: 'prefer_api', label: t('settings.inferencePreferApi') },
    { value: 'prefer_local', label: t('settings.inferencePreferLocal') },
    { value: 'local_only', label: t('settings.inferenceLocalOnly') },
    { value: 'api_only', label: t('settings.inferenceApiOnly') }
  ]

  const persist = async (): Promise<void> => {
    setSaveError(null)
    const ok = await pushEngineConfig()
    if (ok === false) {
      setSaveError(t('settings.saveFailed'))
      return
    }
    save()
  }

  // Ordered provider list for display
  const providerOrder: string[] = ['mimo', 'gemini', 'claude', 'openai_compat', 'local_server']

  return (
    <div className="settings-overlay fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="modal-panel settings-shell animate-fade-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <nav className="settings-nav">
          <div id="settings-title" className="settings-nav-title">
            {t('settings.title')}
          </div>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setSaveError(null) }}
              className={clsx(
                'settings-nav-btn',
                tab === id && 'settings-nav-btn-active'
              )}
            >
              {t(`settings.${id}`)}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end border-b border-[var(--divider)] px-4 py-3">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="btn-ghost rounded-md p-1.5"
              aria-label={t('settings.close')}
            >
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === 'general' && (
              <div className="space-y-4">
                <Field label={t('settings.language')}>
                  <Select
                    value={settings.locale}
                    options={localeOptions}
                    onChange={(v) => {
                      updateSettings({ locale: v as AppLocale })
                      applyLocale()
                    }}
                  />
                </Field>

                <Field label={t('settings.outputLanguage')}>
                  <Select
                    value={settings.outputLanguage || 'zh'}
                    options={[
                      { value: 'zh', label: '中文' },
                      { value: 'en', label: 'English' }
                    ]}
                    onChange={(v) => updateSettings({ outputLanguage: v as 'zh' | 'en' })}
                  />
                </Field>

                <Field label={t('settings.promptTemplate')}>
                  <textarea
                    value={settings.promptTemplate || ''}
                    onChange={(e) => updateSettings({ promptTemplate: e.target.value })}
                    placeholder={t('settings.promptTemplatePlaceholder')}
                    className="settings-input text-[12px] min-h-[120px] resize-y"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <p className="mt-1 text-[11px] text-ink-400">
                    {t('settings.promptTemplateHint')}
                  </p>
                </Field>

                <Section title={t('settings.typography')}>
                  <Field label={t('settings.fontFamily')}>
                    <select
                      value={settings.typography?.fontFamily ?? 'serif'}
                      onChange={(e) => updateSettings({
                        typography: { ...settings.typography, fontFamily: e.target.value as any }
                      })}
                      className="settings-input text-[12px]"
                    >
                      <option value="serif">{isZh ? '宋体/衬线' : 'Serif (Georgia)'}</option>
                      <option value="sans">{isZh ? '黑体/无衬线' : 'Sans-serif (Inter)'}</option>
                      <option value="mono">{isZh ? '等宽' : 'Monospace'}</option>
                    </select>
                  </Field>

                  <Field label={t('settings.fontSize')}>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={12}
                        max={24}
                        step={1}
                        value={settings.typography?.fontSize ?? 16}
                        onChange={(e) => updateSettings({
                          typography: { ...settings.typography, fontSize: Number(e.target.value) }
                        })}
                        className="flex-1"
                      />
                      <span className="text-[11px] text-ink-500 w-8 text-right">
                        {settings.typography?.fontSize ?? 16}px
                      </span>
                    </div>
                  </Field>

                  <Field label={t('settings.lineHeight')}>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={1.2}
                        max={2.2}
                        step={0.1}
                        value={settings.typography?.lineHeight ?? 1.82}
                        onChange={(e) => updateSettings({
                          typography: { ...settings.typography, lineHeight: Number(e.target.value) }
                        })}
                        className="flex-1"
                      />
                      <span className="text-[11px] text-ink-500 w-8 text-right">
                        {(settings.typography?.lineHeight ?? 1.82).toFixed(2)}
                      </span>
                    </div>
                  </Field>
                </Section>
              </div>
            )}

            {tab === 'vault' && (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-ink-600">{t('settings.vaultHint')}</p>
                <Field label={t('settings.vaultPath')}>
                  <input
                    readOnly
                    value={settings.vaultPath}
                    className="settings-input text-[12px] opacity-90"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void window.api.openVaultRoot()}
                    className="settings-btn-secondary"
                  >
                    {t('settings.vaultOpen')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void window.api.exportVault()}
                    className="settings-btn-secondary"
                  >
                    {t('settings.vaultExportAll')}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await rebuildIndex()
                    await refreshLibrary()
                    save()
                  }}
                  className="settings-btn-secondary"
                >
                  {t('settings.rebuildIndex')}
                </button>
                <p className="text-[11px] text-ink-600">{t('settings.rebuildHint')}</p>
              </div>
            )}

            {tab === 'models' && (
              <div className="space-y-5">
                {/* ── Inference mode ── */}
                <Field label={t('settings.inferenceMode')}>
                  <Select
                    value={settings.inferenceMode}
                    options={inferenceOptions}
                    onChange={(v) => updateSettings({ inferenceMode: v as InferenceMode })}
                  />
                </Field>

                {/* ── Local inference (Ollama) ── */}
                <OllamaPanel
                  isZh={isZh}
                  useUserOllama={settings.useOllamaIfAvailable}
                  onUseUserOllamaChange={(value) => updateSettings({ useOllamaIfAvailable: value })}
                />

                {/* ── Cloud Providers ── */}
                <Section title={isZh ? '云端 Provider' : 'Cloud Providers'}>
                  {providerOrder.map((pid) => {
                    const provider = settings.providers[pid]
                    if (!provider) return null
                    return (
                      <ProviderCard
                        key={pid}
                        provider={provider}
                        onChange={(patch) => updateProvider(pid, patch)}
                        isZh={isZh}
                      />
                    )
                  })}
                </Section>

                {/* ── Modality Router ── */}
                <Section title={isZh ? '模态路由' : 'Modality Router'}>
                  <ModalityRouter
                    providers={settings.providers}
                    defaultProvider={settings.defaultProvider}
                    overrides={settings.modalityOverrides}
                    onDefaultChange={(pid) => updateSettings({ defaultProvider: pid })}
                    onOverrideChange={(modality, route) => setModalityRoute(modality, route)}
                    isZh={isZh}
                  />
                </Section>
              </div>
            )}

            {tab === 'logs' && (
              <div className="h-[500px]">
                <LogViewer isZh={isZh} />
              </div>
            )}

            {tab === 'advanced' && (
              <div className="space-y-4">
                {/* ── Video Processing ── */}
                <Section title={isZh ? '视频处理' : 'Video Processing'}>
                  <Field label={isZh ? '抽帧率 (FPS)' : 'Frame Rate (FPS)'}>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0.1"
                        max="5.0"
                        step="0.1"
                        value={settings.frameSettings?.fps ?? 1.0}
                        onChange={(e) => updateSettings({
                          frameSettings: { ...settings.frameSettings, fps: parseFloat(e.target.value) }
                        })}
                        className="flex-1"
                      />
                      <span className="text-[11px] text-ink-600 w-8 text-right">
                        {(settings.frameSettings?.fps ?? 1.0).toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-ink-500">
                      {isZh ? '视频越快运动，FPS 越高。讲座类 0.5~1，运动类 2~5' : 'Higher FPS for fast motion. Lectures: 0.5~1, Sports: 2~5'}
                    </p>
                  </Field>

                  <Field label={isZh ? '最大帧数' : 'Max Frames'}>
                    <Select
                      value={String(settings.frameSettings?.maxFrames ?? 30)}
                      options={[
                        { value: '10', label: '10' },
                        { value: '20', label: '20' },
                        { value: '30', label: '30' },
                        { value: '50', label: '50' },
                        { value: '100', label: '100' },
                      ]}
                      onChange={(v) => updateSettings({
                        frameSettings: { ...settings.frameSettings, maxFrames: parseInt(v) }
                      })}
                    />
                  </Field>

                  <Field label={isZh ? '帧缩放' : 'Frame Scale'}>
                    <Select
                      value={settings.frameSettings?.scale ?? ''}
                      options={[
                        { value: '', label: isZh ? '原始分辨率' : 'Original' },
                        { value: '512:-2', label: '512px' },
                        { value: '720:-2', label: '720px' },
                      ]}
                      onChange={(v) => updateSettings({
                        frameSettings: { ...settings.frameSettings, scale: v }
                      })}
                    />
                  </Field>

                  <Field label={isZh ? '上下文大小 (num_ctx)' : 'Context Size (num_ctx)'}>
                    <Select
                      value={String(settings.frameSettings?.numCtx ?? 16384)}
                      options={[
                        { value: '4096', label: '4K' },
                        { value: '8192', label: '8K' },
                        { value: '16384', label: '16K (Recommended)' },
                        { value: '32768', label: '32K' },
                        { value: '65536', label: '64K' },
                        { value: '131072', label: '128K' },
                      ]}
                      onChange={(v) => updateSettings({
                        frameSettings: { ...settings.frameSettings, numCtx: parseInt(v) }
                      })}
                    />
                    <p className="mt-1 text-[10px] text-ink-500">
                      {isZh ? 'Gemma4 支持 256K，但 16K 足够 30 秒视频。越大越慢。' : 'Gemma4 supports 256K, but 16K is enough for 30s segments. Larger = slower.'}
                    </p>
                  </Field>

                  <Field label={isZh ? '音频分离' : 'Audio Extraction'}>
                    <label className="flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={settings.audioExtractSettings?.enabled ?? true}
                        onChange={(e) => updateSettings({
                          audioExtractSettings: { ...settings.audioExtractSettings, enabled: e.target.checked }
                        })}
                      />
                      {isZh ? '从视频中分离音频轨（供音频模型使用）' : 'Extract audio track from video (for audio models)'}
                    </label>
                  </Field>
                </Section>

                <CookiesSection
                  cookiesPath={settings.cookiesPath}
                  onPathChange={(p) => updateSettings({ cookiesPath: p })}
                  onAfterExport={pushEngineConfig}
                  isZh={isZh}
                />

                {/* ── Network / Proxy ── */}
                <Section title={isZh ? '网络与代理' : 'Network & Proxy'}>
                  <Field label={isZh ? 'HTTP 代理' : 'HTTP Proxy'}>
                    <input
                      value={settings.proxySettings?.httpProxy ?? ''}
                      onChange={(e) => updateSettings({
                        proxySettings: { ...settings.proxySettings, httpProxy: e.target.value }
                      })}
                      placeholder={isZh ? '留空使用系统代理，例: http://127.0.0.1:7890' : 'Leave empty for system proxy, e.g. http://127.0.0.1:7890'}
                      className="settings-input text-[12px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </Field>

                  <Field label={isZh ? 'GitHub 下载镜像' : 'GitHub Download Mirror'}>
                    <input
                      value={settings.proxySettings?.githubMirror ?? ''}
                      onChange={(e) => updateSettings({
                        proxySettings: { ...settings.proxySettings, githubMirror: e.target.value }
                      })}
                      placeholder={isZh ? '留空直连，例: https://mirror.ghproxy.com/' : 'Leave empty for direct, e.g. https://mirror.ghproxy.com/'}
                      className="settings-input text-[12px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <p className="mt-1 text-[10px] text-ink-500">
                      {isZh ? 'Ollama 二进制下载加速。国内常用: mirror.ghproxy.com, ghfast.top' : 'Accelerate Ollama binary download.'}
                    </p>
                  </Field>

                  <Field label={isZh ? 'Ollama 模型镜像' : 'Ollama Model Mirror'}>
                    <input
                      value={settings.proxySettings?.ollamaMirror ?? ''}
                      onChange={(e) => updateSettings({
                        proxySettings: { ...settings.proxySettings, ollamaMirror: e.target.value }
                      })}
                      placeholder={isZh ? '留空用官方源，例: https://mirror.ollama.com' : 'Leave empty for official, e.g. https://mirror.ollama.com'}
                      className="settings-input text-[12px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <p className="mt-1 text-[10px] text-ink-500">
                      {isZh ? '模型拉取加速。Ollama 官方有国内镜像 mirror.ollama.com' : 'Model pull acceleration.'}
                    </p>
                  </Field>
                </Section>
                <Field label={t('settings.cacheDir')}>
                  <input
                    readOnly
                    value={settings.cacheDir}
                    className="settings-input text-[12px] opacity-90"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
                <Field label={t('settings.modelsDir')}>
                  <input
                    readOnly
                    value={settings.modelsDir}
                    className="settings-input text-[12px] opacity-90"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </Field>
              </div>
            )}

            {tab === 'about' && (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-ink-800">
                  {t('settings.aboutText')}
                </p>
                <p className="text-xs text-ink-600">
                  {t('settings.version')}: 0.2.2
                </p>
                <DataManagement />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--divider)] px-6 py-4">
            {saveError && (
              <span className="text-xs font-medium text-red-500">{saveError}</span>
            )}
            {savedFlash && (
              <span className="text-xs font-medium text-accent">{t('settings.saved')}</span>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="settings-btn-secondary"
            >
              {t('settings.close')}
            </button>
            <button type="button" onClick={() => void persist()} className="btn-primary">
              {t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="settings-field-label">{label}</span>
      {children}
    </label>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-ink-800">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function CookiesSection({
  cookiesPath,
  onPathChange,
  onAfterExport,
  isZh
}: {
  cookiesPath: string
  onPathChange: (p: string) => void
  onAfterExport?: () => Promise<boolean>
  isZh: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [exporting, setExporting] = React.useState(false)
  const [exportResult, setExportResult] = React.useState<string | null>(null)

  const handleExport = async (browser: string): Promise<void> => {
    setExporting(true)
    setExportResult(null)
    const result = await exportCookies(browser)
    if (result.ok && result.path) {
      onPathChange(result.path)
      if (onAfterExport) {
        await onAfterExport()
      }
      setExportResult(isZh ? '导出成功' : 'Exported successfully')
    } else {
      setExportResult(result.error || (isZh ? '导出失败' : 'Export failed'))
    }
    setExporting(false)
  }

  return (
    <div className="space-y-3">
      <Field label={t('settings.cookiesPath')}>
        <input
          value={cookiesPath}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder={isZh ? 'Bilibili cookies 文件路径' : 'Bilibili cookies file path'}
          className="settings-input text-[12px]"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="settings-btn-secondary"
          disabled={exporting}
          onClick={() => void handleExport('chrome')}
        >
          {exporting
            ? (isZh ? '导出中...' : 'Exporting...')
            : (isZh ? '从 Chrome 导出' : 'Export from Chrome')}
        </button>
        <button
          type="button"
          className="settings-btn-secondary"
          disabled={exporting}
          onClick={() => void handleExport('safari')}
        >
          {exporting
            ? (isZh ? '导出中...' : 'Exporting...')
            : (isZh ? '从 Safari 导出' : 'Export from Safari')}
        </button>
        <button
          type="button"
          className="settings-btn-secondary"
          disabled={exporting}
          onClick={() => void handleExport('firefox')}
        >
          {exporting
            ? (isZh ? '导出中...' : 'Exporting...')
            : (isZh ? '从 Firefox 导出' : 'Export from Firefox')}
        </button>
      </div>
      {exportResult && (
        <p className={clsx(
          'text-[11px]',
          exportResult.includes('成功') || exportResult.includes('success') ? 'text-[var(--color-accent)]' : 'text-[var(--color-danger)]'
        )}>
          {exportResult}
        </p>
      )}
      <p className="text-[10px] text-ink-500">
        {isZh
          ? '需要在对应浏览器中登录 B 站。Cookies 仅保存在本地。'
          : 'Must be logged into Bilibili in the browser. Cookies are stored locally only.'}
      </p>
    </div>
  )
}

function DataManagement(): React.JSX.Element {
  const { t } = useTranslation()
  const [dataSize, setDataSize] = React.useState<number | null>(null)

  React.useEffect(() => {
    window.api.getDataSize().then(setDataSize).catch(() => {})
  }, [])

  const sizeStr =
    dataSize !== null
      ? dataSize > 1_073_741_824
        ? `${(dataSize / 1_073_741_824).toFixed(1)} GB`
        : `${(dataSize / 1_048_576).toFixed(0)} MB`
      : '...'

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-[var(--divider)] p-4">
      <p className="text-sm font-medium text-ink-900">{t('settings.dataManagement')}</p>
      <p className="text-xs text-ink-600">
        {t('settings.dataSize')}: {sizeStr}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="settings-btn-secondary"
          onClick={() => window.api.openDataFolder()}
        >
          {t('settings.openDataFolder')}
        </button>
        <button
          type="button"
          className="settings-btn-secondary text-red-500"
          onClick={() => window.api.deleteAllData()}
        >
          {t('settings.deleteAllData')}
        </button>
      </div>
    </div>
  )
}
