import clsx from 'clsx'
import type { ReactNode } from 'react'
import { AppChrome } from './AppChrome'
import { CaptureView } from './CaptureView'
import { VaultView } from './VaultView'
import { JournalView } from './JournalView'
import { MapView } from './MapView'
import { NotePreview } from './NotePreview'
import { SettingsModal } from './SettingsModal'
import { useAppStore } from '../stores/appStore'

export function Layout({ children }: { children?: ReactNode }): React.JSX.Element {
  const viewMode = useAppStore((s) => s.viewMode)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const showPreview = selectedSlug && viewMode !== 'vault'

  return (
    <div className="app-canvas flex h-full flex-col">
      <div className="titlebar-spacer drag-region" />
      <div className="workspace-frame flex min-h-0 flex-1 flex-col no-drag">
        <div className="app-shell">
          <AppChrome />
          <div className={clsx('app-body', showPreview && 'preview-open')}>
            <div className="app-main">
              {viewMode === 'capture' && <CaptureView />}
              {viewMode === 'vault' && <VaultView />}
              {viewMode === 'map' && <MapView />}
              {viewMode === 'journal' && <JournalView />}
            </div>
            {showPreview ? <NotePreview /> : null}
          </div>
        </div>
      </div>
      {children}
      <SettingsModal />
    </div>
  )
}
