import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { NoteInkLayer } from './NoteInkLayer'
import type { StrokeStyle } from '../lib/thinkingCanvas/types'
import { useAppStore } from '../stores/appStore'
import { fetchPage, fetchBacklinks, savePage, fetchPageHistory, fetchPageHistoryVersion, type PageHistoryVersion, fetchPageRecommendations } from '../lib/sidecar'
import { normalizeShelfType, platformLabel, TYPE_STYLES } from '../lib/contentMeta'
import type { ReaderPresentation } from '../lib/readerPresentation'
import { getReaderPresentation } from '../lib/readerPresentation'
import { notify } from '../lib/notify'
import type { LibraryItem } from '../stores/types'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useShortcuts } from '../hooks/useShortcuts'
import { NoteToolbar, type AutoSaveStatus } from './note/NoteToolbar'
import { NoteMarkdown } from './note/NoteMarkdown'
import { NoteVersionHistory } from './note/NoteVersionHistory'
import { NoteInkToolbar } from './note/NoteInkToolbar'
import { NoteBacklinks } from './note/NoteBacklinks'
import { NoteReader } from './note/NoteReader'

/** Animation classes per presentation mode */
const READER_ANIM = {
  sidebar: { pane: 'animate-slide-in-right', overlay: null },
  overlay: { pane: 'animate-slide-in-right', overlay: 'animate-backdrop-in' },
  center:  { pane: 'animate-scale-in', overlay: 'animate-backdrop-in' },
} as const

export function NotePreview({
  presentation = 'sidebar'
}: {
  presentation?: ReaderPresentation
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const library = useAppStore((s) => s.library)
  const settings = useAppStore((s) => s.settings)
  const typography = useAppStore((s) => s.settings.typography)
  const viewMode = useAppStore((s) => s.viewMode)
  const mapMode = useAppStore((s) => s.mapMode)
  const selectItem = useAppStore((s) => s.selectItem)
  const closeReader = useAppStore((s) => s.closeReader)
  const togglePin = useAppStore((s) => s.togglePin)
  const isPinned = useAppStore((s) => s.isPinned)
  const deletePage = useAppStore((s) => s.deletePage)

  const { data: backlinksData } = useQuery({
    queryKey: ['backlinks', selectedSlug],
    queryFn: () => fetchBacklinks(selectedSlug!),
    enabled: !!selectedSlug,
  })
  const backlinks = backlinksData ?? []

  const { data: recommendationsData } = useQuery({
    queryKey: ['recommendations', selectedSlug],
    queryFn: () => fetchPageRecommendations(selectedSlug!),
    enabled: !!selectedSlug,
  })
  const recommendations = recommendationsData ?? []

  const [detail, setDetail] = useState<LibraryItem | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [drawMode, setDrawMode] = useState(false)

  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle')
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const lastSavedBodyRef = useRef('')
  const [inkTool, setInkTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen')
  const [penColor, setPenColor] = useState('#1a1a1a')
  const scrollRef = useRef<HTMLDivElement>(null)

  const [historyMode, setHistoryMode] = useState(false)
  const [historyVersions, setHistoryVersions] = useState<PageHistoryVersion[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<PageHistoryVersion | null>(null)
  const [selectedVersionContent, setSelectedVersionContent] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    if (!detail?.slug) return
    setLoadingHistory(true)
    try {
      const versions = await fetchPageHistory(detail.slug)
      setHistoryVersions(versions ?? [])
      setSelectedVersion(null)
      setSelectedVersionContent(null)
    } catch (e) {
      notify(t('note.historyLoadFailed') || 'Failed to load history', { type: 'error' })
    } finally {
      setLoadingHistory(false)
    }
  }, [detail?.slug, t])

  const selectVersion = useCallback(async (ver: PageHistoryVersion) => {
    if (!detail?.slug) return
    setSelectedVersion(ver)
    try {
      const body = await fetchPageHistoryVersion(detail.slug, ver.timestamp)
      setSelectedVersionContent(body)
    } catch (e) {
      notify(t('note.historyVersionLoadFailed') || 'Failed to load version content', { type: 'error' })
    }
  }, [detail?.slug, t])

  // Apply typography CSS variables to .note-markdown
  useEffect(() => {
    const el = document.querySelector('.note-markdown')
    if (!el) return
    const fontMap: Record<string, string> = {
      serif: 'var(--font-serif)',
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)'
    }
    ;(el as HTMLElement).style.setProperty('--reading-font', fontMap[typography.fontFamily])
    ;(el as HTMLElement).style.setProperty('--reading-size', `${typography.fontSize}px`)
    ;(el as HTMLElement).style.setProperty('--reading-leading', String(typography.lineHeight))
  }, [typography])

  const penStyle: StrokeStyle = React.useMemo(() => ({
    color: penColor,
    width: 2.5,
    opacity: 1,
    variant: 'pen'
  }), [penColor])

  const highlighterStyle: StrokeStyle = React.useMemo(() => ({
    color: '#fde68a',
    width: 16,
    opacity: 0.45,
    variant: 'highlighter'
  }), [])

  // Core save logic — reusable by manual save, auto-save, and flush
  // NOTE: Must be defined BEFORE flushAutoSave to avoid temporal dead zone
  const performSave = useCallback(async (body: string, { silent = false, exitEdit = false } = {}): Promise<boolean> => {
    if (!detail?.slug) return false
    if (!silent) setSaving(true)
    if (silent) setAutoSaveStatus('saving')
    try {
      const ok = await savePage(detail.slug, body)
      if (ok) {
        setDetail((prev) => (prev ? { ...prev, body } : prev))
        lastSavedBodyRef.current = body
        dirtyRef.current = false
        if (exitEdit) {
          setEditMode(false)
          setEditBody('')
        }
        if (silent) {
          setAutoSaveStatus('saved')
          // Clear "saved" indicator after 2s
          setTimeout(() => setAutoSaveStatus((s) => s === 'saved' ? 'idle' : s), 2000)
        } else {
          notify(t('note.saved'), { type: 'success' })
        }
        return true
      } else {
        if (silent) setAutoSaveStatus('error')
        else notify(t('note.saveFailed'), { type: 'error' })
        return false
      }
    } catch {
      if (silent) setAutoSaveStatus('error')
      else notify(t('note.saveFailed'), { type: 'error' })
      return false
    } finally {
      if (!silent) setSaving(false)
    }
  }, [detail?.slug, t])

  // Flush any pending auto-save immediately (returns a promise that resolves when done)
  const flushAutoSave = useCallback((): Promise<boolean> => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (dirtyRef.current && detail?.slug) {
      return performSave(editBody, { silent: true })
    }
    return Promise.resolve(true)
  }, [detail?.slug, editBody, performSave])

  const startEdit = useCallback(() => {
    if (!detail?.body) return
    setDrawMode(false)
    setEditBody(detail.body)
    setEditMode(true)
    lastSavedBodyRef.current = detail.body
    dirtyRef.current = false
    setAutoSaveStatus('idle')
  }, [detail?.body])

  const cancelEdit = useCallback(async () => {
    // Flush any pending auto-save before exiting edit mode
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // Fire-and-forget: save dirty changes silently before discarding
    if (dirtyRef.current && detail?.slug) {
      void performSave(editBody, { silent: true })
    }
    setEditMode(false)
    setEditBody('')
    dirtyRef.current = false
    setAutoSaveStatus('idle')
  }, [detail?.slug, editBody, performSave])

  // Manual save (Cmd+S / Save button) — cancels debounce, saves immediately, exits edit mode
  const handleSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    dirtyRef.current = false
    await performSave(editBody, { exitEdit: true })
  }, [editBody, performSave])

  useEffect(() => {
    let cancelled = false

    // Flush any pending auto-save before switching notes
    if (editMode && dirtyRef.current) {
      void flushAutoSave()
    }
    // Reset edit state on note switch
    setEditMode(false)
    setEditBody('')
    dirtyRef.current = false
    setAutoSaveStatus('idle')
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    if (!selectedSlug) {
      setDetail(null)
      setDrawMode(false)
      setHistoryMode(false)
      setSelectedVersion(null)
      setSelectedVersionContent(null)
      return
    }
    const local = library.find((i) => i.slug === selectedSlug)
    if (local?.body) {
      setDetail(local)
      setHistoryMode(false)
      setSelectedVersion(null)
      setSelectedVersionContent(null)
      return
    }
    setHistoryMode(false)
    setSelectedVersion(null)
    setSelectedVersionContent(null)
    void fetchPage(selectedSlug).then((page) => {
      if (!cancelled) setDetail(page ?? local ?? null)
    })
    return () => { cancelled = true }
  }, [selectedSlug, library, editMode, flushAutoSave])

  const dismissReader = (): void => {
    const mode = getReaderPresentation(viewMode, mapMode)
    if (mode === 'center' || mode === 'overlay') closeReader()
    else selectItem(null)
  }

  // Reader/overlay escape
  useShortcuts(
    (presentation === 'center' || presentation === 'overlay') && selectedSlug
      ? [{
          id: 'reader.escape',
          key: 'Escape',
          scope: 'reader',
          description: 'shortcuts.readerEscape',
          action: () => closeReader()
        }]
      : [],
    [presentation, selectedSlug, closeReader]
  )

  // Note-level shortcuts: edit toggle, draw toggle, save
  useShortcuts(
    [
      {
        id: 'note.editToggle',
        key: 'Mod+e',
        scope: 'reader',
        description: 'shortcuts.editToggle',
        action: () => {
          if (editMode) cancelEdit()
          else startEdit()
        }
      },
      {
        id: 'note.drawToggle',
        key: 'Mod+d',
        scope: 'reader',
        description: 'shortcuts.drawToggle',
        action: () => setDrawMode(prev => !prev)
      },
      {
        id: 'note.save',
        key: 'Mod+s',
        scope: 'editor',
        description: 'shortcuts.save',
        action: () => { if (editMode) void handleSave() }
      }
    ],
    [editMode, startEdit, cancelEdit, handleSave]
  )

  // Auto-save: debounced save when editBody changes
  useEffect(() => {
    if (!editMode) return

    // Check if body actually changed from last saved version
    const isDirty = editBody !== lastSavedBodyRef.current
    dirtyRef.current = isDirty

    if (!isDirty) {
      // No changes — clear any pending timer and reset status
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      setAutoSaveStatus('idle')
      return
    }

    // Mark as unsaved immediately
    setAutoSaveStatus('unsaved')

    // Clear any existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Start 1500ms debounce
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      if (dirtyRef.current && detail?.slug) {
        void performSave(editBody, { silent: true })
      }
    }, 1500)

    // Cleanup on unmount or before next effect run
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [editBody, editMode, detail?.slug, performSave])

  // Focus trap for center/overlay presentations
  const focusContainerSelector = presentation === 'center'
    ? '.note-reader-overlay-panel'
    : '[role="dialog"][aria-modal="true"]'
  useFocusTrap(focusContainerSelector, (presentation === 'center' || presentation === 'overlay') && !!selectedSlug)

  // Memoize toolbar callbacks to avoid re-rendering NoteToolbar on every parent render
  const handlePin = useCallback(() => detail && togglePin(detail.slug), [detail, togglePin])
  const handleOpenFolder = useCallback(() => {
    if (!detail) return
    const sep = settings.vaultPath?.includes('\\') ? '\\' : '/'
    const normalizedPath = detail.path.replace(/[/\\]/g, sep)
    const full = settings.vaultPath
      ? `${settings.vaultPath}${sep}${normalizedPath}`
      : detail.path
    void window.api.showItemInFolder(full)
  }, [detail, settings.vaultPath])
  const handleExport = useCallback(() => detail && void window.api.exportNote(detail.path), [detail])
  const handleCopyWikilink = useCallback(() => {
    if (!detail) return
    void navigator.clipboard.writeText(`[[${detail.title}]]`)
    notify(t('note.wikilinkCopied', { title: detail.title }), { type: 'success', duration: 2000 })
  }, [detail, t])
  const handleDelete = useCallback(() => {
    if (!detail) return
    if (window.confirm(t('note.deleteConfirm'))) {
      void deletePage(detail.slug).then((ok) => {
        if (ok) {
          notify(t('note.deleted'), { type: 'success', duration: 2000 })
          dismissReader()
        }
      })
    }
  }, [detail, t, deletePage, dismissReader])
  const handleHistoryToggle = useCallback(() => {
    if (historyMode) {
      setHistoryMode(false)
      setSelectedVersion(null)
      setSelectedVersionContent(null)
    } else {
      setHistoryMode(true)
      void loadHistory()
    }
  }, [historyMode, loadHistory])
  const handleDrawToggle = useCallback(() => setDrawMode(prev => !prev), [])

  if (!selectedSlug) return null

  const type = detail ? normalizeShelfType(String(detail.type)) : 'article'
  const accent = TYPE_STYLES[type].accent

  const pane = (
    <aside
      className={clsx(
        'note-preview-pane no-drag',
        presentation === 'center' && 'note-preview-pane-center',
        presentation === 'overlay' && 'note-preview-pane-overlay',
        READER_ANIM[presentation].pane
      )}
    >
      <NoteToolbar
        detail={detail}
        editMode={editMode}
        drawMode={drawMode}
        historyMode={historyMode}
        saving={saving}
        autoSaveStatus={autoSaveStatus}
        accent={accent}
        isPinned={detail ? isPinned(detail.slug) : false}
        onDismiss={dismissReader}
        onPin={handlePin}
        onOpenFolder={handleOpenFolder}
        onExport={handleExport}
        onCopyWikilink={handleCopyWikilink}
        onDelete={handleDelete}
        onHistoryToggle={handleHistoryToggle}
        onEdit={startEdit}
        onCancel={cancelEdit}
        onSave={handleSave}
        onDrawToggle={handleDrawToggle}
      />

      <div className="flex flex-1 min-h-0 relative">
        <div className="note-reader-scroll flex-1" ref={scrollRef}>
          {drawMode && !editMode && (
            <NoteInkToolbar
              inkTool={inkTool}
              penColor={penColor}
              onToolChange={setInkTool}
              onColorChange={setPenColor}
            />
          )}
          <NoteInkLayer
            slug={detail?.slug ?? ''}
            scrollRef={scrollRef}
            active={drawMode && !editMode}
            tool={inkTool}
            penStyle={penStyle}
            highlighterStyle={highlighterStyle}
            eraserWidth={20}
          />
          {!detail ? (
            <p className="note-reader-loading">{t('preview.loading')}</p>
          ) : (
            <article className="note-reader-column">
              {selectedVersion && (
                <NoteReader
                  selectedVersion={selectedVersion}
                  saving={saving}
                  onRestore={async () => {
                    if (!detail?.slug || !selectedVersionContent) return
                    setSaving(true)
                    try {
                      const ok = await savePage(detail.slug, selectedVersionContent)
                      if (ok) {
                        setDetail(prev => prev ? { ...prev, body: selectedVersionContent } : null)
                        setHistoryMode(false)
                        setSelectedVersion(null)
                        setSelectedVersionContent(null)
                        notify(t('note.saved') || 'Saved', { type: 'success' })
                      } else {
                        notify(t('note.saveFailed') || 'Save failed', { type: 'error' })
                      }
                    } finally {
                      setSaving(false)
                    }
                  }}
                  onCancel={() => {
                    setSelectedVersion(null)
                    setSelectedVersionContent(null)
                  }}
                />
              )}
              {detail.summary && !selectedVersion && <p className="note-reader-lead">{detail.summary}</p>}
              {editMode ? (
                <div className="note-markdown">
                  <MarkdownEditor
                    value={editBody}
                    onChange={setEditBody}
                  />
                </div>
              ) : (
                <NoteMarkdown
                  body={detail.body || detail.summary}
                  selectedVersionContent={selectedVersionContent}
                  onNavigate={(slug) => selectItem(slug, { reader: true })}
                />
              )}
              <NoteBacklinks
                backlinks={backlinks}
                recommendations={recommendations}
                editMode={editMode}
                onSelectBacklink={(slug) => selectItem(slug, { reader: true })}
                onInsertRecommendation={(title) => {
                  setEditBody((prev) => {
                    const suffix = `\n\n[[${title}]]`
                    return prev.endsWith('\n') ? prev + `[[${title}]]` : prev + suffix
                  })
                }}
              />
            </article>
          )}
        </div>

        {/* Version History Sidebar */}
        {historyMode && detail && (
          <NoteVersionHistory
            historyVersions={historyVersions}
            selectedVersion={selectedVersion}
            loadingHistory={loadingHistory}
            onSelectVersion={selectVersion}
            onClose={() => {
              setHistoryMode(false)
              setSelectedVersion(null)
              setSelectedVersionContent(null)
            }}
          />
        )}
      </div>

      {detail && (
        <footer className="note-footer">
          <p className="note-footer-text">
            {detail.path.split('/').slice(0, -1).join(' / ') || detail.type}
          </p>
        </footer>
      )}
    </aside>
  )

  if (presentation === 'center') {
    return createPortal(
      <div
        className={clsx('note-reader-overlay no-drag', READER_ANIM.center.overlay)}
        role="presentation"
        onClick={() => closeReader()}
      >
        <div
          className="note-reader-overlay-panel"
          role="dialog"
          aria-modal="true"
          aria-label={detail?.title ?? t('preview.reading')}
          onClick={(e) => e.stopPropagation()}
        >
          {pane}
        </div>
      </div>,
      document.body
    )
  }

  if (presentation === 'overlay') {
    return createPortal(
      <div className={clsx('note-reader-drawer-layer no-drag', READER_ANIM.overlay.overlay)} role="presentation">
        <button
          type="button"
          className="note-reader-drawer-scrim"
          aria-label={t('preview.close')}
          onClick={() => closeReader()}
        />
        <div role="dialog" aria-modal="true" aria-label={detail?.title ?? t('preview.reading')}>
          {pane}
        </div>
      </div>,
      document.body
    )
  }

  return pane
}
