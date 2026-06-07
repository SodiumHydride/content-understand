import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  BookMarked,
  FolderOpen,
  Inbox,
  Link,
  Map,
  Search,
  Settings,
  Sparkles
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { searchNotes, type SearchResult } from '../lib/sidecar'
import { WikilinkSearch } from './WikilinkSearch'
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
  const [wlSearchOpen, setWlSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()
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
  const selectItem = useAppStore((s) => s.selectItem)

  const vaultDisplay = settings.vaultPath || t('vault.unconfigured')
  const uiLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const showSearch = library.length > 0
  const searchPlaceholder =
    viewMode === 'journal'
      ? t('library.search')
      : viewMode === 'vault'
        ? t('library.searchVault')
        : viewMode === 'map'
          ? t('library.searchMap')
          : t('library.searchTimeline')

  const setLanguage = (locale: AppLocale): void => {
    updateSettings({ locale })
    applyLocale()
  }

  const openVault = (): void => {
    if (settings.vaultPath) void window.api.openPath(settings.vaultPath)
  }

  const handleSearchChange = useCallback((value: string) => {
    setLibraryQuery(value)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!value.trim()) {
      setSearchResults([])
      setShowResults(false)
      return
    }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true)
      const results = await searchNotes(value)
      setSearchResults(results)
      setShowResults(true)
      setSearchLoading(false)
    }, 300)
  }, [setLibraryQuery])

  // Cmd+L opens wikilink search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault()
        setWlSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close search results dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.search-container')) {
        setShowResults(false)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return (
    <>
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
            <div className="search-container relative hidden md:block">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
              />
              <input
                value={libraryQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="toolbar-search"
              />
              {showResults && searchResults.length > 0 && (
                <div className="search-results-dropdown">
                  {searchResults.map((r) => (
                    <button
                      key={r.slug}
                      type="button"
                      className="search-result-item"
                      onClick={() => {
                        selectItem(r.slug, { reader: true })
                        setShowResults(false)
                      }}
                    >
                      <span className="search-result-title">{r.title}</span>
                      {r.snippet && (
                        <span className="search-result-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {showResults && searchResults.length === 0 && !searchLoading && (
                <div className="search-results-dropdown">
                  <div className="search-result-empty">{t('search.noResults')}</div>
                </div>
              )}
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
            onClick={() => setWlSearchOpen(true)}
            className="btn-ghost"
            aria-label={t('search.wikilinkTitle')}
            title={t('search.wikilinkTitle') + ' (⌘L)'}
          >
            <Link size={15} />
          </button>

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
    <WikilinkSearch open={wlSearchOpen} onClose={() => setWlSearchOpen(false)} />
    </>
  )
}
