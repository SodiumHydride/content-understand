import type { StateCreator } from 'zustand'
import type { AppState, CanvasSlice, MapMode, WikiLayoutMode, MapNodePos, ScratchNode } from './types'
import { createEmptyDocument, applyToolPreferences } from '../lib/thinkingCanvas/document'
import { DEFAULT_TOOL_PREFERENCES } from '../lib/thinkingCanvas/defaults'
import { buildMigrationFromPersistedState, parseCanvasDocument } from '../lib/thinkingCanvas/migration'
import { fetchThinkingCanvas, saveThinkingCanvas } from '../lib/thinkingCanvas/api'

export const createCanvasSlice: StateCreator<
  AppState,
  [],
  [],
  CanvasSlice
> = (set, get) => ({
  thinkingMap: {},
  wikiMap: {},
  wikiLayoutMode: 'force' as WikiLayoutMode,
  wikiPinnedSlugs: [],
  thinkingScratch: [],
  thinkingCanvas: null,
  thinkingCanvasReady: false,
  thinkingToolPrefs: { ...DEFAULT_TOOL_PREFERENCES },

  setMapNodePos: (map, id, pos) =>
    set((s) =>
      map === 'thinking'
        ? { thinkingMap: { ...s.thinkingMap, [id]: pos } }
        : { wikiMap: { ...s.wikiMap, [id]: pos } }
    ),

  setWikiLayoutMode: (wikiLayoutMode) => set({ wikiLayoutMode }),

  toggleWikiPin: (slug) =>
    set((s) => {
      const pinned = s.wikiPinnedSlugs.includes(slug)
      return {
        wikiPinnedSlugs: pinned
          ? s.wikiPinnedSlugs.filter((id) => id !== slug)
          : [...s.wikiPinnedSlugs, slug]
      }
    }),

  setWikiPinnedSlugs: (wikiPinnedSlugs) => set({ wikiPinnedSlugs }),

  addScratchNode: (text, pos) => {
    const id = `scratch-${crypto.randomUUID()}`
    const count = get().thinkingScratch.length
    const x = pos?.x ?? 80 + (count % 3) * 48
    const y = pos?.y ?? 80 + Math.floor(count / 3) * 40
    set((s) => ({
      thinkingScratch: [...s.thinkingScratch, { id, text, x, y }]
    }))
    return id
  },

  updateScratchNode: (id, patch) =>
    set((s) => ({
      thinkingScratch: s.thinkingScratch.map((n) => (n.id === id ? { ...n, ...patch } : n))
    })),

  removeScratchNode: (id) =>
    set((s) => ({
      thinkingScratch: s.thinkingScratch.filter((n) => n.id !== id)
    })),

  setThinkingCanvas: (doc) => set({ thinkingCanvas: doc }),

  patchThinkingCanvas: (updater) =>
    set((s) => {
      const base = s.thinkingCanvas ?? createEmptyDocument()
      return { thinkingCanvas: updater(base) }
    }),

  setThinkingToolPrefs: (patch) =>
    set((s) => ({
      thinkingToolPrefs:
        typeof patch === 'function'
          ? patch(s.thinkingToolPrefs)
          : applyToolPreferences(s.thinkingToolPrefs, patch)
    })),

  loadThinkingCanvas: async () => {
    let legacyTexts: { id: string; text: string; x: number; y: number }[] | undefined
    let legacyStrokes:
      | { id: string; points: { x: number; y: number }[]; color: string; width: number }[]
      | undefined
    let legacyScratch = get().thinkingScratch

    try {
      const raw = localStorage.getItem('content-understand-settings')
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown> }
        const st = parsed.state
        if (st) {
          legacyTexts = st.thinkingTexts as typeof legacyTexts
          legacyStrokes = st.thinkingStrokes as typeof legacyStrokes
          if (Array.isArray(st.thinkingScratch)) {
            legacyScratch = st.thinkingScratch as ScratchNode[]
          }
        }
      }
    } catch {
      /* ignore corrupt local storage */
    }

    let doc = await fetchThinkingCanvas()
    doc = doc ? parseCanvasDocument(doc) : null

    const legacyHasData =
      (legacyTexts?.length ?? 0) > 0 ||
      (legacyStrokes?.length ?? 0) > 0 ||
      legacyScratch.length > 0

    if ((!doc || doc.elements.length === 0) && legacyHasData) {
      doc = buildMigrationFromPersistedState({
        thinkingTexts: legacyTexts,
        thinkingStrokes: legacyStrokes,
        thinkingScratch: legacyScratch
      })
      const saved = await saveThinkingCanvas(doc)
      if (saved) doc = parseCanvasDocument(saved)
    }

    if (!doc) doc = createEmptyDocument()
    set({ thinkingCanvas: doc, thinkingCanvasReady: true })
  }
})
