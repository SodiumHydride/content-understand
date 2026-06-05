import clsx from 'clsx'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, Trash2, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { ProviderId } from '../stores/types'
import { PROVIDER_PRESETS } from '../stores/types'
import type { AppLocale } from '../lib/i18n'
import { useEffect, useState } from 'react'
import {
  fetchRuntimeRecommend,
  fetchRuntimeStatus,
  fetchPresets,
  rebuildIndex,
  startRuntimeSetup,
  fetchDownloadedModels,
  deleteModel,
  type RuntimeRecommend,
  type RuntimePreset,
  type DownloadedModel
} from '../lib/sidecar'
import type { InferenceMode } from '../stores/types'
import { Select, type SelectOption } from './Select'
import { ProviderCard } from './ProviderCard'
import { ModalityRouter } from './ModalityRouter'

type SettingsTab = 'general' | 'vault' | 'models' | 'advanced' | 'about'

const tabs: SettingsTab[] = ['general', 'vault', 'models', 'advanced', 'about']

const TIER_LABELS: Record<string, { zh: string; en: string }> = {
  ultra_lite: { zh: '极轻量', en: 'Ultra Lite' },
  cpu_lite: { zh: 'CPU 轻量', en: 'CPU Lite' },
  cpu_balanced: { zh: 'CPU 均衡', en: 'CPU Balanced' },
  balanced: { zh: '均衡', en: 'Balanced' },
  quality: { zh: '高质量', en: 'Quality' },
  high_quality: { zh: '旗舰', en: 'Flagship' }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  return `${(bytes / 1_048_576).toFixed(0)} MB`
}

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
  const [runtimeRec, setRuntimeRec] = useState<RuntimeRecommend | null>(null)
  const [runtimeState, setRuntimeState] = useState<string>('')
  const [presets, setPresets] = useState<RuntimePreset[]>([])
  const [downloaded, setDownloaded] = useState<DownloadedModel[] | null>(null)
  const [totalSize, setTotalSize] = useState(0)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!open || tab !== 'models') return
    void fetchRuntimeRecommend().then(setRuntimeRec)
    void fetchRuntimeStatus().then((s) => {
      if (s && typeof s.state === 'string') setRuntimeState(s.state)
    })
    void fetchPresets().then(setPresets)
    void fetchDownloadedModels().then((r) => {
      if (r) {
        setDownloaded(r.models)
        setTotalSize(r.total_size_bytes)
      }
    })
  }, [open, tab])

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

  // Group presets by tier, mark downloaded ones
  const presetOptions: SelectOption[] = presets.map((p) => ({
    value: p.id,
    label: `${isZh ? p.label_zh : p.label_en} (${p.download_size_gb} GB)${p.downloaded ? ' ✓' : ''}`,
    group: isZh
      ? (TIER_LABELS[p.tier]?.zh ?? p.tier)
      : (TIER_LABELS[p.tier]?.en ?? p.tier)
  }))

  // Auto-select downloaded preset if nothing selected
  const effectivePresetId =
    settings.localPresetId ||
    presets.find((p) => p.downloaded)?.id ||
    runtimeRec?.recommended_preset_id ||
    ''

  const handleDeleteModel = async (filename: string): Promise<void> => {
    setDeleting(filename)
    const ok = await deleteModel(filename)
    if (ok) {
      setDownloaded((prev) => prev?.filter((m) => m.filename !== filename) ?? null)
      setTotalSize((prev) => {
        const found = downloaded?.find((m) => m.filename === filename)
        return prev - (found?.size_bytes ?? 0)
      })
    }
    setDeleting(null)
  }

  const persist = async (): Promise<void> => {
    setSaveError(null)
    const ok = await pushEngineConfig()
    if (ok === false) {
      setSaveError(t('settings.saveFailed'))
      return
    }
    save()
    setSettingsOpen(false)
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

                {/* ── Local inference ── */}
                <Section title={isZh ? '本地推理' : 'Local Inference'}>
                  {runtimeRec && (
                    <div className="rounded-lg border border-[var(--divider)] bg-paper-deep/40 p-3 text-[11px] leading-relaxed text-ink-700">
                      <pre className="whitespace-pre-wrap font-sans">
                        {isZh ? runtimeRec.summary_zh : runtimeRec.summary_en}
                      </pre>
                      <p className="mt-2 text-ink-600">
                        {t('settings.runtimeState')}: {runtimeState || 'idle'}
                      </p>
                    </div>
                  )}
                  {presetOptions.length > 0 && (
                    <Field label={t('settings.localPreset')}>
                      <Select
                        value={effectivePresetId}
                        options={presetOptions}
                        onChange={(v) => updateSettings({ localPresetId: v })}
                        compact
                      />
                    </Field>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="settings-btn-secondary"
                      onClick={async () => {
                        const pid = settings.localPresetId || runtimeRec?.recommended_preset_id || null
                        await startRuntimeSetup(pid, settings.useOllamaIfAvailable)
                        save()
                      }}
                    >
                      {t('settings.prepareLocalEngine')}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-700">
                    <input
                      type="checkbox"
                      checked={settings.useOllamaIfAvailable}
                      onChange={(e) => updateSettings({ useOllamaIfAvailable: e.target.checked })}
                    />
                    {t('settings.useOllamaIfAvailable')}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-ink-700">
                    <input
                      type="checkbox"
                      checked={settings.autoStartLocal}
                      onChange={(e) => updateSettings({ autoStartLocal: e.target.checked })}
                    />
                    {t('settings.autoStartLocal')}
                  </label>

                  {/* Downloaded models */}
                  <ModelManager
                    models={downloaded}
                    totalSize={totalSize}
                    deleting={deleting}
                    onDelete={handleDeleteModel}
                    isZh={isZh}
                  />
                </Section>

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

            {tab === 'advanced' && (
              <div className="space-y-4">
                <Field label={t('settings.cookiesPath')}>
                  <input
                    value={settings.cookiesPath}
                    onChange={(e) => updateSettings({ cookiesPath: e.target.value })}
                    className="settings-input"
                  />
                </Field>
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
                  {t('settings.version')}: 0.2.0
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

function ModelManager({
  models,
  totalSize,
  deleting,
  onDelete,
  isZh
}: {
  models: DownloadedModel[] | null
  totalSize: number
  deleting: string | null
  onDelete: (filename: string) => void
  isZh: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  const mainModels = models?.filter((m) => !m.is_mmproj) ?? []
  const mmprojFiles = models?.filter((m) => m.is_mmproj) ?? []

  return (
    <div className="rounded-lg border border-[var(--divider)]">
      <div className="flex items-center gap-2 border-b border-[var(--divider)] px-3 py-2.5">
        <HardDrive size={14} className="text-ink-500" />
        <span className="text-[12px] font-semibold text-ink-800">
          {t('settings.downloadedModels')}
        </span>
        {models !== null && (
          <span className="ml-auto text-[11px] text-ink-500">
            {mainModels.length} {t('settings.models')}, {formatBytes(totalSize)}
          </span>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto">
        {models === null && (
          <p className="px-3 py-4 text-center text-[11px] text-ink-500">...</p>
        )}
        {models !== null && models.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] text-ink-500">
            {t('settings.noModels')}
          </p>
        )}
        {mainModels.map((m) => (
          <div
            key={m.filename}
            className="flex items-center gap-3 border-b border-[var(--divider)] px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-ink-800">
                {m.preset_label_zh && isZh
                  ? m.preset_label_zh
                  : m.preset_label_en ?? m.filename}
              </p>
              <p className="text-[10px] text-ink-500">
                {formatBytes(m.size_bytes)}
                {m.preset_id && ` · ${m.preset_id}`}
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost rounded p-1 text-ink-500 hover:text-[var(--color-danger)]"
              disabled={deleting === m.filename}
              onClick={() => onDelete(m.filename)}
              title={t('settings.deleteModel')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {mmprojFiles.length > 0 && (
          <div className="border-t border-[var(--divider)] px-3 py-1.5 text-[10px] text-ink-500">
            + {mmprojFiles.length} mmproj {t('settings.files')} ({formatBytes(
              mmprojFiles.reduce((s, m) => s + m.size_bytes, 0)
            )})
          </div>
        )}
      </div>
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
