import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search,
  FileText,
  Terminal,
  Settings,
  Moon,
  Sun,
  Inbox,
  Archive,
  Map,
  BookMarked,
  Brain,
  Plus,
  X
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { searchNotes, type SearchResult } from '../lib/sidecar'
import { parseSearchQuery, removeFilterFromQuery } from '../lib/searchParser'
import type { ViewMode } from '../stores/types'
import { useShortcuts } from '../hooks/useShortcuts'

interface CommandItem {
  id: string
  title: string
  subtitle?: string
  category: 'commands' | 'navigation' | 'notes'
  icon: React.ComponentType<{ size: number; className?: string }>
  action: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [remoteResults, setRemoteResults] = useState<SearchResult[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  const library = useAppStore((s) => s.library)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const selectItem = useAppStore((s) => s.selectItem)
  const createNote = useAppStore((s) => s.createNote)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const theme = useAppStore((s) => s.settings.theme || 'system')
  const updateSettings = useAppStore((s) => s.updateSettings)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Parse query for filter chips
  const parsed = parseSearchQuery(query)
  const chips = useMemo(() => {
    const result: { key: string; value?: string; label: string }[] = []
    for (const t of parsed.filters.tags ?? []) result.push({ key: 'tag', value: t, label: `tag:${t}` })
    for (const t of parsed.filters.types ?? []) result.push({ key: 'type', value: t, label: `type:${t}` })
    if (parsed.filters.createdPrefix) result.push({ key: 'created', value: parsed.filters.createdPrefix, label: `created:${parsed.filters.createdPrefix}` })
    if (parsed.filters.hasLink) result.push({ key: 'has:link', label: 'has:link' })
    if (parsed.filters.hasBacklink) result.push({ key: 'has:backlink', label: 'has:backlink' })
    if (parsed.filters.orphan) result.push({ key: 'orphan', label: 'orphan' })
    for (const p of parsed.filters.exactPhrases ?? []) result.push({ key: 'exactPhrase', value: p, label: `"${p}"` })
    return result
  }, [parsed.filters])

  // Toggle Command Palette via custom event from shortcut manager
  useEffect(() => {
    const toggle = () => {
      setIsOpen((prev) => !prev)
      setQuery('')
      setSelectedIndex(0)
      setRemoteResults([])
    }
    window.addEventListener('app:toggleCommandPalette', toggle)
    return () => window.removeEventListener('app:toggleCommandPalette', toggle)
  }, [])

  // Escape to close via shortcut manager
  useShortcuts(
    [
      {
        id: 'palette.escape',
        key: 'Escape',
        scope: 'global',
        description: '',
        action: () => { if (isOpen) setIsOpen(false) }
      }
    ],
    [isOpen]
  )

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Dynamic system commands
  const commands = useMemo((): CommandItem[] => {
    return [
      {
        id: 'new-note',
        title: t('command.newNote', { defaultValue: '新建笔记 / Create New Note' }),
        subtitle: '⌘N',
        category: 'commands',
        icon: Plus,
        action: () => {
          createNote({ pin: false, viewMode: 'journal' })
          setIsOpen(false)
        }
      },
      {
        id: 'toggle-theme',
        title: t('command.toggleTheme', { defaultValue: '切换深浅主题 / Toggle Dark/Light Mode' }),
        subtitle: theme === 'dark' ? 'Switch to Light' : 'Switch to Dark',
        category: 'commands',
        icon: theme === 'dark' ? Sun : Moon,
        action: () => {
          updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
          setIsOpen(false)
        }
      },
      {
        id: 'open-settings',
        title: t('command.openSettings', { defaultValue: '打开设置 / Open Settings' }),
        subtitle: '⌘,',
        category: 'commands',
        icon: Settings,
        action: () => {
          setSettingsOpen(true)
          setIsOpen(false)
        }
      },
      {
        id: 'nav-capture',
        title: t('command.navCapture', { defaultValue: '跳转到收录视图 / Go to Capture' }),
        category: 'navigation',
        icon: Inbox,
        action: () => {
          setViewMode('capture')
          setIsOpen(false)
        }
      },
      {
        id: 'nav-vault',
        title: t('command.navVault', { defaultValue: '跳转到便签架视图 / Go to Vault' }),
        category: 'navigation',
        icon: Archive,
        action: () => {
          setViewMode('vault')
          setIsOpen(false)
        }
      },
      {
        id: 'nav-map',
        title: t('command.navMap', { defaultValue: '跳转到思维图谱 / Go to Map' }),
        category: 'navigation',
        icon: Map,
        action: () => {
          setViewMode('map')
          setIsOpen(false)
        }
      },
      {
        id: 'nav-journal',
        title: t('command.navJournal', { defaultValue: '跳转到时间线视图 / Go to Journal' }),
        category: 'navigation',
        icon: BookMarked,
        action: () => {
          setViewMode('journal')
          setIsOpen(false)
        }
      }
    ]
  }, [t, theme, createNote, updateSettings, setSettingsOpen, setViewMode])

  // Remote search when query has filters or is non-trivial
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!query.trim()) {
      setRemoteResults([])
      setRemoteLoading(false)
      return
    }
    searchTimeout.current = setTimeout(async () => {
      setRemoteLoading(true)
      const results = await searchNotes(query, 10)
      setRemoteResults(results ?? [])
      setRemoteLoading(false)
    }, 200)
  }, [query])

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()

    // 1. Filter commands & navigation
    const matchedCommands = commands.filter((c) =>
      c.title.toLowerCase().includes(q) || (c.subtitle && c.subtitle.toLowerCase().includes(q))
    )

    // 2. If filters are active, prefer remote results over local
    if (parsed.hasFilters && remoteResults.length > 0) {
      const matchedNotes: CommandItem[] = remoteResults.map((r) => ({
        id: `note-${r.slug}`,
        title: r.title,
        subtitle: r.summary ? r.summary.slice(0, 60) : r.slug,
        category: 'notes' as const,
        icon: FileText,
        action: () => {
          selectItem(r.slug, { reader: true })
          setViewMode('journal')
          setIsOpen(false)
        }
      }))
      return [...matchedCommands, ...matchedNotes]
    }

    // 3. Fallback: local library filter
    const matchedNotes: CommandItem[] = library
      .filter((note) =>
        note.title.toLowerCase().includes(q) ||
        note.summary.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.toLowerCase().includes(q))
      )
      .slice(0, 10)
      .map((note) => ({
        id: `note-${note.slug}`,
        title: note.title,
        subtitle: note.summary ? note.summary.slice(0, 60) : note.slug,
        category: 'notes',
        icon: FileText,
        action: () => {
          selectItem(note.slug, { reader: true })
          setViewMode('journal')
          setIsOpen(false)
        }
      }))

    return [...matchedCommands, ...matchedNotes]
  }, [query, commands, library, selectItem, setViewMode, remoteResults, parsed.hasFilters])

  // Auto scroll selected item into view
  useEffect(() => {
    const listEl = listRef.current
    if (!listEl) return
    const activeEl = listEl.querySelector('[data-active="true"]') as HTMLElement
    if (!activeEl) return

    const listRect = listEl.getBoundingClientRect()
    const activeRect = activeEl.getBoundingClientRect()

    if (activeRect.bottom > listRect.bottom) {
      listEl.scrollTop += activeRect.bottom - listRect.bottom + 4
    } else if (activeRect.top < listRect.top) {
      listEl.scrollTop -= listRect.top - activeRect.top + 4
    }
  }, [selectedIndex])

  // Keyboard navigation inside palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = filteredItems[selectedIndex]
        if (selected) {
          selected.action()
        }
      }
    },
    [isOpen, filteredItems, selectedIndex]
  )

  const removeChip = useCallback((key: string, value?: string) => {
    setQuery((prev) => removeFilterFromQuery(prev, key, value))
  }, [])

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh] px-4 no-drag">
      {/* Backdrop click closer */}
      <div className="absolute inset-0 -z-10" onClick={() => setIsOpen(false)} />

      {/* Palette container */}
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--color-paper)] shadow-2xl flex flex-col max-h-[50vh] overflow-hidden scale-in-palette">

        {/* Search input bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--divider)] shrink-0">
          <Search size={16} className="text-[var(--color-ink-500)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('command.placeholder', { defaultValue: '搜索笔记或执行命令... (⌘K / ⌘P)' })}
            className="flex-1 border-none outline-none bg-transparent text-[14px] text-[var(--color-ink-900)] placeholder-[var(--color-ink-400)]"
          />
          <kbd className="text-[10px] bg-[var(--color-paper-deep)] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--color-ink-500)] uppercase font-semibold font-mono">
            ESC
          </kbd>
        </div>

        {/* Active filter chips */}
        {chips.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap px-4 py-1.5 border-b border-[var(--divider)] shrink-0">
            {chips.map((c, i) => (
              <span
                key={`${c.key}-${c.value ?? ''}-${i}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              >
                {c.label}
                <button
                  type="button"
                  onClick={() => removeChip(c.key, c.value)}
                  className="hover:opacity-70"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {remoteLoading && (
              <span className="text-[9px] text-[var(--color-ink-400)] ml-1">searching...</span>
            )}
          </div>
        )}

        {/* Results list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 scrollbar-thin"
        >
          {filteredItems.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-ink-500)]">
              {t('command.noMatches', { defaultValue: '无匹配结果' })}
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const Icon = item.icon
              const isActive = index === selectedIndex

              // Group dividers
              const showGroupDivider =
                index === 0 || filteredItems[index - 1]?.category !== item.category

              return (
                <React.Fragment key={item.id}>
                  {showGroupDivider && (
                    <div className="text-[9px] font-bold tracking-wider text-[var(--color-ink-400)] uppercase px-3 py-1.5 mt-1">
                      {t(`command.category.${item.category}`, { defaultValue: item.category })}
                    </div>
                  )}
                  <button
                    data-active={isActive}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border-none text-left cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-ink-900)]'
                        : 'bg-transparent text-[var(--color-ink-700)] hover:bg-[var(--color-paper-deep)]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon size={14} className={isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-500)]'} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate leading-tight">
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div className={`text-[10px] truncate mt-0.5 ${isActive ? 'text-[var(--color-ink-600)]' : 'text-[var(--color-ink-400)]'}`}>
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-mono text-[var(--color-accent)] font-semibold shrink-0">
                        ENTER ↵
                      </span>
                    )}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
