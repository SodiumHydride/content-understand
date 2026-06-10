import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  BookMarked,
  FolderOpen,
  Inbox,
  Link,
  Loader2,
  Map,
  Search,
  Settings,
  Sparkles,
  X,
  HelpCircle
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { searchNotes, type SearchResult } from '../lib/sidecar'
import { parseSearchQuery, removeFilterFromQuery, type SearchFilters } from '../lib/searchParser'
import { WikilinkSearch } from './WikilinkSearch'
import type { ViewMode } from '../stores/types'
import type { AppLocale } from '../lib/i18n'

const sanitizeSnippet = (html: string): string => {
  return html.replace(/<(?!\/?mark\b)[^>]*>/gi, '')
}

const MODES: { id: ViewMode; icon: typeof Inbox }[] = [
  { id: 'capture', icon: Inbox },
  { id: 'vault', icon: Archive },
  { id: 'map', icon: Map },
  { id: 'journal', icon: BookMarked }
]

/** Human-readable label for a filter chip. */
function chipLabel(key: string, value: string): string {
  switch (key) {
    case 'tag': return `tag:${value}`
    case 'type': return `type:${value}`
    case 'created': return `created:${value}`
    case 'has:link': return 'has:link'
    case 'has:backlink': return 'has:backlink'
    case 'orphan': return 'orphan'
    case 'exactPhrase': return `"${value}"`
    default: return `${key}:${value}`
  }
}

/** Derive chip descriptors from parsed filters. */
function buildChips(filters: SearchFilters): { key: string; value?: string; label: string }[] {
  const chips: { key: string; value?: string; label: string }[] = []
  for (const t of filters.tags ?? []) chips.push({ key: 'tag', value: t, label: chipLabel('tag', t) })
  for (const t of filters.types ?? []) chips.push({ key: 'type', value: t, label: chipLabel('type', t) })
  if (filters.createdPrefix) chips.push({ key: 'created', value: filters.createdPrefix, label: chipLabel('created', filters.createdPrefix) })
  if (filters.hasLink) chips.push({ key: 'has:link', label: chipLabel('has:link', '') })
  if (filters.hasBacklink) chips.push({ key: 'has:backlink', label: chipLabel('has:backlink', '') })
  if (filters.orphan) chips.push({ key: 'orphan', label: chipLabel('orphan', '') })
  for (const p of filters.exactPhrases ?? []) chips.push({ key: 'exactPhrase', value: p, label: chipLabel('exactPhrase', p) })
  return chips
}

const SEARCH_HELP_ITEMS = [
  { syntax: 'tag:tech', desc: 'Filter by tag' },
  { syntax: 'type:video', desc: 'Filter by content type' },
  { syntax: 'created:2024-01', desc: 'Filter by creation date' },
  { syntax: 'has:link', desc: 'Has outgoing wikilinks' },
  { syntax: 'has:backlink', desc: 'Has incoming backlinks' },
  { syntax: 'orphan:true', desc: 'No links at all' },
  { syntax: '"exact phrase"', desc: 'Exact phrase match' },
  { syntax: 'plain text', desc: 'Full-text search' },
]

export function AppChrome(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [wlSearchOpen, setWlSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
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

  // Parse current query for chips
  const parsed = parseSearchQuery(libraryQuery)
  const chips = buildChips(parsed.filters)

  const removeChip = useCallback((key: string, value?: string) => {
    const newQuery = removeFilterFromQuery(libraryQuery, key, value)
    handleSearchChange(newQuery)
  }, [libraryQuery])

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
      setSearchResults(results ?? [])
      setShowResults(true)
      setSearchLoading(false)
    }, 150)
  }, [setLibraryQuery])

  // Wikilink search toggle via shortcut manager
  useEffect(() => {
    const toggle = () => setWlSearchOpen((v) => !v)
    window.addEventListener('app:toggleWikilinkSearch', toggle)
    return () => window.removeEventListener('app:toggleWikilinkSearch', toggle)
  }, [])

  // Close search results dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.search-container')) {
        setShowResults(false)
        setShowHelp(false)
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

              {/* Filter chips + help icon row */}
              {chips.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap px-2.5 py-1.5 border-t border-[var(--divider)]">
                  {chips.map((c, i) => (
                    <span
                      key={`${c.key}-${c.value ?? ''}-${i}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    >
                      {c.label}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeChip(c.key, c.value) }}
                        className="hover:opacity-70"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Help icon always visible */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowHelp((v) => !v) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)] hover:text-[var(--color-ink-700)]"
                title="Search syntax help"
              >
                <HelpCircle size={14} />
              </button>

              {/* Syntax help popover */}
              {showHelp && (
                <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--color-paper)] shadow-xl p-3">
                  <div className="text-[11px] font-bold text-[var(--color-ink-700)] mb-2">Search Syntax</div>
                  <div className="space-y-1">
                    {SEARCH_HELP_ITEMS.map((item) => (
                      <div key={item.syntax} className="flex items-center gap-2 text-[10px]">
                        <code className="px-1 py-0.5 rounded bg-[var(--color-paper-deep)] text-[var(--color-accent)] font-mono shrink-0">
                          {item.syntax}
                        </code>
                        <span className="text-[var(--color-ink-500)]">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[9px] text-[var(--color-ink-400)] mt-2 pt-1.5 border-t border-[var(--divider)]">
                    Filters combine with AND. Multiple tag: values are ORed.
                  </div>
                </div>
              )}

              {showResults && searchLoading && (
                <div className="search-result-loading">
                  <Loader2 size={14} className="animate-spin" />
                </div>
              )}
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
                        <span className="search-result-snippet" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet ?? '') }} />
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
