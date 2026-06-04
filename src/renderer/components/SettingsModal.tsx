import clsx from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { BackendId } from '../stores/types'
import type { AppLocale } from '../lib/i18n'
import { rebuildIndex } from '../lib/sidecar'

type SettingsTab = 'general' | 'vault' | 'models' | 'advanced' | 'about'

const tabs: SettingsTab[] = ['general', 'vault', 'models', 'advanced', 'about']

const backends: BackendId[] = ['mimo', 'openai_compat', 'gemma']

export function SettingsModal(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const applyLocale = useAppStore((s) => s.applyLocale)
  const refreshLibrary = useAppStore((s) => s.refreshLibrary)

  const [tab, setTab] = useState<SettingsTab>('general')
  const [savedFlash, setSavedFlash] = useState(false)

  if (!open) return null

  const save = (): void => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1600)
  }

  const backendLabel = (id: BackendId): string => {
    if (id === 'mimo') return t('settings.backendMimo')
    if (id === 'gemma') return t('settings.backendGemma')
    return t('settings.backendOpenAI')
  }

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
              onClick={() => setTab(id)}
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
                  <select
                    value={settings.locale}
                    onChange={(e) => {
                      updateSettings({ locale: e.target.value as AppLocale })
                      applyLocale()
                    }}
                    className="settings-input"
                  >
                    <option value="system">{t('settings.languageSystem')}</option>
                    <option value="zh">{t('settings.languageZh')}</option>
                    <option value="en">{t('settings.languageEn')}</option>
                  </select>
                </Field>
              </div>
            )}

            {tab === 'vault' && (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-ink-600">{t('settings.vaultHint')}</p>
                <Field label={t('settings.vaultPath')}>
                  <div className="flex gap-2">
                    <input
                      value={settings.vaultPath}
                      onChange={(e) => updateSettings({ vaultPath: e.target.value })}
                      placeholder={t('settings.vaultPathPlaceholder')}
                      className="settings-input flex-1 text-[12px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const picked = await window.api.pickVault()
                        if (picked) updateSettings({ vaultPath: picked })
                      }}
                      className="settings-btn-secondary shrink-0"
                    >
                      {t('settings.vaultPick')}
                    </button>
                  </div>
                </Field>
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
              <div className="space-y-4">
                <Field label={t('settings.apiBase')}>
                  <input
                    value={settings.apiBase}
                    onChange={(e) => updateSettings({ apiBase: e.target.value })}
                    placeholder={t('settings.apiBasePlaceholder')}
                    className="settings-input"
                  />
                </Field>
                <Field label={t('settings.apiKey')}>
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => updateSettings({ apiKey: e.target.value })}
                    placeholder={t('settings.apiKeyPlaceholder')}
                    className="settings-input"
                  />
                </Field>
                {(
                  [
                    ['videoBackend', 'settings.videoBackend'],
                    ['imageBackend', 'settings.imageBackend'],
                    ['audioBackend', 'settings.audioBackend'],
                    ['articleBackend', 'settings.articleBackend']
                  ] as const
                ).map(([key, labelKey]) => (
                  <Field key={key} label={t(labelKey)}>
                    <select
                      value={settings[key]}
                      onChange={(e) =>
                        updateSettings({ [key]: e.target.value as BackendId })
                      }
                      className="settings-input"
                    >
                      {backends.map((b) => (
                        <option key={b} value={b}>
                          {backendLabel(b)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
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
                    value={settings.cacheDir}
                    onChange={(e) => updateSettings({ cacheDir: e.target.value })}
                    placeholder={t('settings.cacheDirPlaceholder')}
                    className="settings-input text-[12px]"
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
                  {t('settings.version')}: 0.1.0
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--divider)] px-6 py-4">
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
            <button
              type="button"
              onClick={() => {
                save()
                setSettingsOpen(false)
              }}
              className="btn-primary"
            >
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
