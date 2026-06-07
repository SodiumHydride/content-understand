import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Search, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { notify } from '../lib/notify'

interface WikilinkSearchProps {
  open: boolean
  onClose: () => void
}

export function WikilinkSearch({ open, onClose }: WikilinkSearchProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = React.useMemo(() => {
    if (!query.trim()) return library.slice(0, 10)
    const lower = query.toLowerCase()
    return library
      .filter((item) => item.title.toLowerCase().includes(lower))
      .slice(0, 10)
  }, [query, library])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // Focus input after portal renders
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1))
    }
  }, [results.length, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll('[data-wl-item]')
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const copyWikilink = useCallback((title: string) => {
    void navigator.clipboard.writeText(`[[${title}]]`)
    notify(t('note.wikilinkCopied', { title }), { type: 'success', duration: 2000 })
    onClose()
  }, [onClose, t])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          copyWikilink(results[selectedIndex].title)
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [results, selectedIndex, copyWikilink, onClose])

  if (!open) return null

  return (
    <div
      className="wikilink-search-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="wikilink-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('search.wikilinkTitle')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="wikilink-search-header">
          <div className="wikilink-search-input-wrap">
            <Search size={14} className="wikilink-search-icon" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
              placeholder={t('search.wikilinkPlaceholder')}
              className="wikilink-search-input"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost shrink-0 p-1"
            aria-label={t('preview.close')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="wikilink-search-list" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <p className="wikilink-search-empty">{t('library.noMatch')}</p>
          ) : (
            results.map((item, i) => (
              <button
                key={item.slug}
                type="button"
                data-wl-item
                role="option"
                aria-selected={i === selectedIndex}
                className={`wikilink-search-item${i === selectedIndex ? ' wikilink-search-item-active' : ''}`}
                onClick={() => copyWikilink(item.title)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <Link size={12} className="shrink-0 opacity-50" />
                <span className="wikilink-search-item-title">{item.title}</span>
              </button>
            ))
          )}
        </div>

        <div className="wikilink-search-footer">
          <span className="wikilink-search-hint">
            {t('search.wikilinkHint')}
          </span>
        </div>
      </div>
    </div>
  )
}
