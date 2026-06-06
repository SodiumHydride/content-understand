import clsx from 'clsx'
import type { ReactNode } from 'react'
import { AppChrome } from './AppChrome'
import { CaptureView } from './CaptureView'
import { VaultView } from './VaultView'
import { JournalView } from './JournalView'
import { MapView } from './MapView'
import { NotePreview } from './NotePreview'
import { SettingsModal } from './SettingsModal'
import { SetupBanner } from './SetupBanner'
import { TaskBar } from './TaskBar'
import { useOllamaOperationSync } from '../hooks/useOllamaOperationSync'
import { useAppStore } from '../stores/appStore'
import { getReaderPresentation } from '../lib/readerPresentation'

export function Layout({ children }: { children?: ReactNode }): React.JSX.Element {
  useOllamaOperationSync()
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
            <div className="app-main">
              {viewMode === 'capture' && <CaptureView />}
              {viewMode === 'vault' && <VaultView />}
              {viewMode === 'map' && <MapView />}
              {viewMode === 'journal' && <JournalView />}
            </div>
            {showSidebarReader ? <NotePreview presentation="sidebar" /> : null}
          </div>
          {showOverlayReader ? <NotePreview presentation="overlay" /> : null}
          {showCenterReader ? <NotePreview presentation="center" /> : null}
          <TaskBar />
        </div>
      </div>
      {children}
      <SettingsModal />
    </div>
  )
}
