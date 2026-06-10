/**
 * Registers all global keyboard shortcuts for the app.
 * Called once from Layout; actions are bound to store methods at call time.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { shortcutManager, type ShortcutDef } from '../lib/shortcuts'
import { useShortcuts } from './useShortcuts'
import { useAppStore } from '../stores/appStore'
import type { ViewMode } from '../stores/types'

export function useGlobalShortcuts(): void {
  const { t } = useTranslation()

  // Pull store methods — these are stable references.
  const setViewMode = useAppStore((s) => s.setViewMode)
  const createNote = useAppStore((s) => s.createNote)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  // Set scope predicates so the manager knows when scoped shortcuts are active.
  useMemo(() => {
    shortcutManager.setScopePredicate('map', () => {
      return useAppStore.getState().viewMode === 'map'
    })
    shortcutManager.setScopePredicate('editor', () => {
      // Editor is active when the NotePreview is in edit mode.
      // We use a loose check — readerOpen implies note is visible.
      return useAppStore.getState().readerOpen
    })
    shortcutManager.setScopePredicate('reader', () => {
      return useAppStore.getState().readerOpen
    })
  }, [])

  const defs = useMemo((): ShortcutDef[] => [
    {
      id: 'global.commandPalette.k',
      key: 'Mod+k',
      scope: 'global',
      description: 'shortcuts.commandPalette',
      action: () => {
        // Dispatch a custom event that CommandPalette listens to.
        window.dispatchEvent(new CustomEvent('app:toggleCommandPalette'))
      }
    },
    {
      id: 'global.commandPalette.p',
      key: 'Mod+p',
      scope: 'global',
      description: 'shortcuts.commandPalette',
      action: () => {
        window.dispatchEvent(new CustomEvent('app:toggleCommandPalette'))
      }
    },
    {
      id: 'global.newNote',
      key: 'Mod+n',
      scope: 'global',
      description: 'shortcuts.newNote',
      action: () => createNote({ pin: false, viewMode: 'journal' })
    },
    {
      id: 'global.settings',
      key: 'Mod+,',
      scope: 'global',
      description: 'shortcuts.settings',
      action: () => setSettingsOpen(true)
    },
    {
      id: 'global.viewCapture',
      key: 'Mod+1',
      scope: 'global',
      description: 'shortcuts.viewCapture',
      action: () => setViewMode('capture')
    },
    {
      id: 'global.viewVault',
      key: 'Mod+2',
      scope: 'global',
      description: 'shortcuts.viewVault',
      action: () => setViewMode('vault')
    },
    {
      id: 'global.viewJournal',
      key: 'Mod+3',
      scope: 'global',
      description: 'shortcuts.viewJournal',
      action: () => setViewMode('journal')
    },
    {
      id: 'global.viewMap',
      key: 'Mod+4',
      scope: 'global',
      description: 'shortcuts.viewMap',
      action: () => setViewMode('map')
    },
    {
      id: 'global.search',
      key: 'Mod+f',
      scope: 'global',
      description: 'shortcuts.searchNotes',
      action: () => {
        // Focus the existing search input in AppChrome.
        const input = document.querySelector('.toolbar-search') as HTMLInputElement | null
        if (input) {
          input.focus()
          input.select()
        }
      }
    },
    {
      id: 'global.toggleSidebar',
      key: 'Mod+b',
      scope: 'global',
      description: 'shortcuts.toggleSidebar',
      action: () => {
        window.dispatchEvent(new CustomEvent('app:toggleSidebar'))
      }
    },
    {
      id: 'global.wikilinkSearch',
      key: 'Mod+l',
      scope: 'global',
      description: 'shortcuts.wikilinkSearch',
      action: () => {
        window.dispatchEvent(new CustomEvent('app:toggleWikilinkSearch'))
      }
    }
  ], [setViewMode, createNote, setSettingsOpen, t])

  useShortcuts(defs, defs)
}
