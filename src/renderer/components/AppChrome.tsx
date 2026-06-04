import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  BookMarked,
  FolderOpen,
  Inbox,
  Map,
  Search,
  Settings,
  Sparkles
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { ViewMode } from '../stores/types'
import type { AppLocale } from '../lib/i18n'

const MODES: { id: ViewMode; icon: typeof Inbox }[] = [
  { id: 'capture', icon: Inbox },
  { id: 'vault', icon: Archive },
  { id: 'map', icon: Map },
  { id: 'journal', icon: BookMarked }
]

export function AppChrome(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const libraryQuery = useAppStore((s) => s.libraryQuery)
  const setLibraryQuery = useAppStore((s) => s.setLibraryQuery)
  const library = useAppStore((s) => s.library)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const applyLocale = useAppStore((s) => s.applyLocale)
  const sidecarOnline = useAppStore((s) => s.sidecarOnline)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const vaultDisplay = settings.vaultPath || t('vault.unconfigured')
  const uiLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const showSearch = library.length > 0

  const setLanguage = (locale: AppLocale): void => {
    updateSettings({ locale })
    applyLocale()
  }

  const openVault = (): void => {
    if (settings.vaultPath) void window.api.openPath(settings.vaultPath)
  }

  return (
    <header className="app-chrome no-drag">
      <div className="chrome-row">
        <div className="chrome-brand">
          <div className="brand-mark">
            <Sparkles size={15} strokeWidth={1.75} />
          </div>
          <span className="brand-name hidden sm:inline">{t('app.name')}</span>
        </div>

        <nav className="mode-nav" aria-label={t('nav.modes')}>
          {MODES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              className={clsx('mode-tab', viewMode === id && 'mode-tab-active')}
            >
              <Icon size={14} strokeWidth={1.75} className="shrink-0 opacity-70" />
              {t(`modes.${id}`)}
            </button>
          ))}
        </nav>

        <div className="chrome-actions">
          {showSearch && (
            <div className="relative hidden md:block">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
              />
              <input
                value={libraryQuery}
                onChange={(e) => setLibraryQuery(e.target.value)}
                placeholder={t('library.search')}
                className="toolbar-search"
              />
            </div>
          )}

          <div className="lang-switch" role="group" aria-label={t('language.switch')}>
            <button
              type="button"
              className={clsx('lang-switch-btn', uiLang === 'zh' && 'lang-switch-active')}
              onClick={() => setLanguage('zh')}
            >
              {t('language.zh')}
            </button>
            <button
              type="button"
              className={clsx('lang-switch-btn', uiLang === 'en' && 'lang-switch-active')}
              onClick={() => setLanguage('en')}
            >
              {t('language.en')}
            </button>
          </div>

          <span
            className={clsx(
              'status-pill hidden lg:inline',
              sidecarOnline ? 'status-pill-online' : 'status-pill-demo'
            )}
            title={sidecarOnline ? t('status.onlineTitle') : t('status.demoTitle')}
          >
            {sidecarOnline ? t('status.online') : t('status.demo')}
          </span>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn-ghost"
            aria-label={t('nav.settings')}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {(viewMode === 'vault' || viewMode === 'journal' || viewMode === 'map') && (
        <div className="vault-strip">
          <span className="vault-strip-label">{t('vault.label')}</span>
          <span className="vault-path min-w-0 flex-1" title={vaultDisplay}>
            {vaultDisplay}
          </span>
          <button type="button" onClick={() => void openVault()} className="btn-ghost shrink-0">
            <FolderOpen size={13} />
            <span className="hidden sm:inline">{t('home.openVault')}</span>
          </button>
        </div>
      )}
    </header>
  )
}
