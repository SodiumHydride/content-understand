import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppChrome } from './AppChrome'
import { ErrorBoundary } from './ErrorBoundary'
import { CaptureView } from './CaptureView'
import { VaultView } from './VaultView'
import { JournalView } from './JournalView'
import { MapView } from './MapView'
import { NotePreview } from './NotePreview'
import { SettingsModal } from './SettingsModal'
import { SetupBanner } from './SetupBanner'
import { TaskBar } from './TaskBar'
import { CommandPalette } from './CommandPalette'
import { ShortcutHelpPanel } from './ShortcutHelpPanel'
import { useOllamaOperationSync } from '../hooks/useOllamaOperationSync'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { useAppStore } from '../stores/appStore'
import { getReaderPresentation } from '../lib/readerPresentation'
import { shortcutManager } from '../lib/shortcuts'
import { transitions } from '../lib/transitions'
import type { ViewMode } from '../stores/types'

const VIEW_COMPONENTS: Record<ViewMode, React.ComponentType> = {
  capture: CaptureView,
  vault: VaultView,
  journal: JournalView,
  map: MapView,
}

function AnimatedView({ viewMode }: { viewMode: ViewMode }): React.JSX.Element {
  const [displayed, setDisplayed] = useState<{ mode: ViewMode; phase: 'enter' | 'idle' }>({
    mode: viewMode,
    phase: 'enter',
  })
  const prevModeRef = useRef(viewMode)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (viewMode === prevModeRef.current) return
    prevModeRef.current = viewMode

    // Start exit animation on the currently displayed view
    setDisplayed((d) => ({ ...d, phase: 'exit' } as typeof d))

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDisplayed({ mode: viewMode, phase: 'enter' })
      timerRef.current = setTimeout(() => {
        setDisplayed((d) => ({ ...d, phase: 'idle' }))
        timerRef.current = null
      }, transitions.viewSwitch.duration)
    }, transitions.viewSwitch.duration)
  }, [viewMode])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const View = VIEW_COMPONENTS[displayed.mode]
  const animClass =
    displayed.phase === 'enter'
      ? transitions.viewSwitch.enter
      : displayed.phase === 'exit'
        ? transitions.viewSwitch.exit
        : ''

  return (
    <div className={clsx('app-main view-transition-container', animClass)}>
      <View />
    </div>
  )
}

export function Layout({ children }: { children?: ReactNode }): React.JSX.Element {
  useOllamaOperationSync()

  // Start the shortcut manager once and register global shortcuts.
  useEffect(() => {
    shortcutManager.start()
    return () => { shortcutManager.stop() }
  }, [])
  useGlobalShortcuts()
  const viewMode = useAppStore((s) => s.viewMode)
  const mapMode = useAppStore((s) => s.mapMode)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const readerOpen = useAppStore((s) => s.readerOpen)
  const readerPresentation =
    selectedSlug && readerOpen ? getReaderPresentation(viewMode, mapMode) : null
  const showSidebarReader = readerPresentation === 'sidebar'
  const showOverlayReader = readerPresentation === 'overlay'
  const showCenterReader = readerPresentation === 'center'

  return (
    <div className="app-canvas flex h-full flex-col">
      <div className="titlebar-spacer drag-region" />
      <div className="workspace-frame flex min-h-0 flex-1 flex-col no-drag">
        <div className="app-shell">
          <SetupBanner />
          <AppChrome />
          <div className={clsx('app-body', showSidebarReader && 'preview-open')}>
            <ErrorBoundary>
              <AnimatedView viewMode={viewMode} />
            </ErrorBoundary>
            {showSidebarReader ? <NotePreview presentation="sidebar" /> : null}
          </div>
          {showOverlayReader ? <NotePreview presentation="overlay" /> : null}
          {showCenterReader ? <NotePreview presentation="center" /> : null}
          <TaskBar />
        </div>
      </div>
      {children}
      <SettingsModal />
      <CommandPalette />
      <ShortcutHelpPanel />
    </div>
  )
}
