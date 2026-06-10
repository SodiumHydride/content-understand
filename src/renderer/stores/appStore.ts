import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import type { AppState, UnderstandTask } from './types'
import { createSettingsSlice, migrateSettings } from './settingsStore'
import { createLibrarySlice } from './libraryStore'
import { createIngestTaskSlice } from './ingestTaskStore'
import { createCanvasSlice } from './canvasStore'
import { createUiSlice } from './uiStore'
import { DEFAULT_TOOL_PREFERENCES } from '../lib/thinkingCanvas/defaults'
import { createThrottledStorage } from '../lib/throttledStorage'

// Throttled storage: flushes to localStorage at most once per 500ms.
// Prevents ~18,000 writes during force layout animation (60fps x 300 frames).
const throttledLocalStorage = createThrottledStorage(localStorage, 500)

export const useAppStore = create<AppState>()(
  subscribeWithSelector(
    persist(
      (...args) => ({
        ...createSettingsSlice(...args),
        ...createLibrarySlice(...args),
        ...createIngestTaskSlice(...args),
        ...createCanvasSlice(...args),
        ...createUiSlice(...args)
      }),
      {
        name: 'content-understand-settings',
        storage: {
          getItem: (name) => {
            const value = throttledLocalStorage.getItem(name)
            return value ? JSON.parse(value) : null
          },
          setItem: (name, value) => {
            throttledLocalStorage.setItem(name, JSON.stringify(value))
          },
          removeItem: (name) => {
            throttledLocalStorage.removeItem(name)
          }
        },
        partialize: (s) => {
          const { vaultPath: _v, cacheDir: _c, modelsDir: _m, ...restSettings } = s.settings
          return {
            settings: restSettings,
            viewMode: s.viewMode,
            pinnedSlugs: s.pinnedSlugs,
            vaultLayout: s.vaultLayout,
            mapMode: s.mapMode,
            thinkingMap: s.thinkingMap,
            wikiMap: s.wikiMap,
            wikiLayoutMode: s.wikiLayoutMode,
            wikiPinnedSlugs: s.wikiPinnedSlugs,
            thinkingToolPrefs: s.thinkingToolPrefs,
            tasks: s.tasks.filter((t) => t.status === 'completed' || t.status === 'failed')
          }
        },
        merge: (persisted: unknown, current) => {
          const merged = { ...current, ...(persisted as Record<string, unknown>) } as AppState
          // Always reset health interval on load — setInterval IDs don't survive across sessions
          merged._healthInterval = null
          if (Array.isArray(merged.tasks)) {
            // Keep persisted completed/failed tasks, merge with any in-memory processing tasks
            const persistedTasks = merged.tasks as UnderstandTask[]
            const processingTasks = current.tasks.filter((t) => t.status === 'processing')
            merged.tasks = [...processingTasks, ...persistedTasks]
          }
          if (merged.settings && !merged.settings.providers) {
            merged.settings = migrateSettings(merged.settings)
          }
          if (!merged.thinkingToolPrefs) {
            merged.thinkingToolPrefs = { ...DEFAULT_TOOL_PREFERENCES }
          }
          return merged
        }
      }
    )
  )
)
