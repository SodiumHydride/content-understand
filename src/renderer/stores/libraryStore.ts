import type { StateCreator } from 'zustand'
import type { AppState, LibrarySlice, LibraryItem, MapNodePos, ViewMode, ContentType } from './types'
import { getEffectiveLocale } from '../lib/i18n'
import { demoLibraryFor } from './demoLibrary'

export const createLibrarySlice: StateCreator<
  AppState,
  [],
  [],
  LibrarySlice
> = (set, get) => ({
  library: demoLibraryFor(getEffectiveLocale('system')),
  filter: 'all' as ContentType,
  libraryQuery: '',
  selectedSlug: null,
  pinnedSlugs: ['video/demo-welcome', 'article/demo-read'],
  vaultLayout: {},

  setFilter: (filter) => set({ filter }),
  setLibraryQuery: (libraryQuery) => set({ libraryQuery }),

  selectItem: (selectedSlug, opts) => {
    if (selectedSlug === null) {
      set({ selectedSlug: null, readerOpen: false })
      return
    }
    const s = get()
    let readerOpen = opts?.reader
    if (readerOpen === undefined) {
      readerOpen = s.viewMode === 'journal'
    }
    set({ selectedSlug, readerOpen })
  },

  setLibrary: (library) => set({ library }),

  togglePin: (slug) =>
    set((s) => {
      const pinned = s.pinnedSlugs.includes(slug)
      return {
        pinnedSlugs: pinned
          ? s.pinnedSlugs.filter((id) => id !== slug)
          : [...s.pinnedSlugs, slug]
      }
    }),

  isPinned: (slug) => get().pinnedSlugs.includes(slug),

  pinNote: (slug, pos) =>
    set((s) => {
      const already = s.pinnedSlugs.includes(slug)
      const pinnedSlugs = already ? s.pinnedSlugs : [...s.pinnedSlugs, slug]
      const vaultLayout =
        pos && !already
          ? { ...s.vaultLayout, [slug]: pos }
          : s.vaultLayout
      return { pinnedSlugs, vaultLayout, selectedSlug: slug, viewMode: 'vault' }
    }),

  createNote: (opts) => {
    const lng = getEffectiveLocale(get().settings.locale)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const slug = `notes/note-${id}`
    const item: LibraryItem = {
      slug,
      path: `notes/note-${id}.md`,
      title: lng === 'zh' ? '无标题便签' : 'Untitled sticky',
      type: 'article',
      platform: 'self',
      url: '',
      summary: '',
      tags: lng === 'zh' ? ['笔记'] : ['note'],
      created: now,
      updated: now,
      body: ''
    }
    const pin = opts?.pin ?? false
    const viewMode = opts?.viewMode ?? 'journal'
    set((s) => ({
      library: [item, ...s.library],
      selectedSlug: slug,
      viewMode,
      pinnedSlugs: pin ? [...s.pinnedSlugs, slug] : s.pinnedSlugs,
      vaultLayout:
        pin && opts?.pos
          ? { ...s.vaultLayout, [slug]: opts.pos }
          : s.vaultLayout
    }))
    return slug
  },

  updateNote: (slug, patch) =>
    set((s) => ({
      library: s.library.map((item) =>
        item.slug === slug
          ? { ...item, ...patch, updated: new Date().toISOString() }
          : item
      )
    })),

  setVaultNodePos: (slug, pos) =>
    set((s) => ({ vaultLayout: { ...s.vaultLayout, [slug]: pos } })),

  refreshLibrary: async () => {
    const { fetchLibrary } = await import('../lib/sidecar')
    const items = await fetchLibrary()
    if (!items) return
    const prev = get().selectedSlug
    const still = prev && items.some((i) => i.slug === prev)
    set({
      library: items,
      sidecarOnline: true,
      selectedSlug: still ? prev : null
    })
  },

  deletePage: async (slug: string): Promise<boolean> => {
    const { deletePage: apiDelete } = await import('../lib/sidecar')
    const ok = await apiDelete(slug)
    if (!ok) return false
    set((s) => {
      const library = s.library.filter((i) => i.slug !== slug)
      const pinnedSlugs = s.pinnedSlugs.filter((id) => id !== slug)
      const wikiPinnedSlugs = s.wikiPinnedSlugs.filter((id) => id !== slug)
      const { [slug]: _tw, ...thinkingMap } = s.thinkingMap
      const { [slug]: _ww, ...wikiMap } = s.wikiMap
      return {
        library,
        pinnedSlugs,
        wikiPinnedSlugs,
        thinkingMap,
        wikiMap,
        selectedSlug: s.selectedSlug === slug ? null : s.selectedSlug,
        readerOpen: s.selectedSlug === slug ? false : s.readerOpen
      }
    })
    return true
  }
})
