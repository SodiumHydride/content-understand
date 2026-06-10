import type { StateCreator } from 'zustand'
import type { AppState, UiSlice, ViewMode, MapMode } from './types'

export const createUiSlice: StateCreator<
  AppState,
  [],
  [],
  UiSlice
> = (set, get) => ({
  settingsOpen: false,
  viewMode: 'capture' as ViewMode,
  mapMode: 'thinking' as MapMode,
  readerOpen: false,
  sidecarOnline: false,
  inputUrl: '',
  isDragging: false,
  _healthInterval: null as ReturnType<typeof setInterval> | null,

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setViewMode: (viewMode) => set({ viewMode }),
  setMapMode: (mapMode) =>
    set((s) => ({
      mapMode,
      readerOpen: mapMode === 'wiki' && s.viewMode === 'map' ? false : s.readerOpen
    })),
  closeReader: () => set({ readerOpen: false }),
  setInputUrl: (inputUrl) => set({ inputUrl }),
  setDragging: (isDragging) => set({ isDragging }),
  setSidecarOnline: (sidecarOnline) => set({ sidecarOnline }),

  startHealthPolling: () => {
    if (get()._healthInterval) return
    const interval = setInterval(async () => {
      const { checkHealth } = await import('../lib/sidecar')
      const ok = await checkHealth()
      const wasOnline = get().sidecarOnline
      if (!ok && wasOnline) {
        set({ sidecarOnline: false })
      } else if (ok && !wasOnline) {
        set({ sidecarOnline: true })
        await get().refreshLibrary()
      }
    }, 30_000)
    set({ _healthInterval: interval })
  },

  stopHealthPolling: () => {
    const id = get()._healthInterval
    if (id) {
      clearInterval(id)
      set({ _healthInterval: null })
    }
  }
})
