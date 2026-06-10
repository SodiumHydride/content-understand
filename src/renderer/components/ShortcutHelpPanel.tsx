import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Keyboard, Search, X } from 'lucide-react'
import { shortcutManager, type ShortcutScope } from '../lib/shortcuts'
import { useShortcuts } from '../hooks/useShortcuts'

const SCOPE_ORDER: ShortcutScope[] = ['global', 'map', 'editor', 'reader']

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'shortcuts.scope.global',
  map: 'shortcuts.scope.map',
  editor: 'shortcuts.scope.editor',
  reader: 'shortcuts.scope.reader'
}

/** Format a combo like 'Mod+Shift+p' into platform-aware display like 'Cmd+Shift+P'. */
function formatCombo(combo: string): string {
  const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac')
  return combo
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase()
      if (p === 'mod') return isMac ? '⌘' : 'Ctrl'
      if (p === 'shift') return isMac ? '⇧' : 'Shift'
      if (p === 'alt') return isMac ? '⌥' : 'Alt'
      if (p === 'escape') return 'Esc'
      if (p === 'enter') return '↵'
      if (p === ' ') return 'Space'
      return p.length === 1 ? p.toUpperCase() : p
    })
    .join(isMac ? '' : '+')
}

export function ShortcutHelpPanel(): boolean {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useShortcuts(
    [
      {
        id: 'shortcut-help',
        key: 'Mod+/',
        scope: 'global',
        description: 'shortcuts.help',
        action: () => setOpen((prev) => !prev)
      }
    ],
    []
  )

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open])

  const allShortcuts = useMemo(() => shortcutManager.getShortcuts(), [open]) // refresh on open

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups: { scope: ShortcutScope; items: typeof allShortcuts }[] = []

    for (const scope of SCOPE_ORDER) {
      let items = allShortcuts.filter((s) => s.scope === scope)
      if (q) {
        items = items.filter(
          (s) =>
            s.description.toLowerCase().includes(q) ||
            s.key.toLowerCase().includes(q)
        )
      }
      if (items.length > 0) {
        groups.push({ scope, items })
      }
    }

    return groups
  }, [allShortcuts, query])

  if (!open) return false

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh] px-4 no-drag"
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title', { defaultValue: 'Keyboard Shortcuts' })}
    >
      <div className="absolute inset-0 -z-10" onClick={close} />

      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--color-paper)] shadow-2xl flex flex-col max-h-[60vh] overflow-hidden scale-in-palette">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--divider)] shrink-0">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[var(--color-accent)]" />
            <span className="text-sm font-semibold text-[var(--color-ink-900)]">
              {t('shortcuts.title', { defaultValue: 'Keyboard Shortcuts' })}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            className="btn-ghost p-1 rounded"
            aria-label={t('preview.close')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--divider)] shrink-0">
          <Search size={14} className="text-[var(--color-ink-500)] shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('shortcuts.search', { defaultValue: 'Search shortcuts…' })}
            className="flex-1 border-none outline-none bg-transparent text-[13px] text-[var(--color-ink-900)] placeholder-[var(--color-ink-400)]"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4 scrollbar-thin">
          {grouped.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-ink-500)]">
              {t('shortcuts.noMatches', { defaultValue: 'No matching shortcuts' })}
            </div>
          ) : (
            grouped.map(({ scope, items }) => (
              <div key={scope}>
                <div className="text-[9px] font-bold tracking-wider text-[var(--color-ink-400)] uppercase px-1 pb-1.5">
                  {t(SCOPE_LABELS[scope], { defaultValue: scope })}
                </div>
                <div className="flex flex-col gap-0.5">
                  {items.map((def) => (
                    <div
                      key={def.id}
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[var(--color-paper-deep)] transition-colors"
                    >
                      <span className="text-[12px] text-[var(--color-ink-700)]">
                        {t(def.description, { defaultValue: def.description })}
                      </span>
                      <kbd className="text-[10px] font-mono bg-[var(--color-paper-deep)] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--color-ink-500)] font-semibold whitespace-nowrap ml-3 shrink-0">
                        {formatCombo(def.key)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
