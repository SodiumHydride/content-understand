import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  ContentType,
  LibraryItem,
  MapMode,
  MapNodePos,
  ModalityRoute,
  ProviderConfig,
  ProviderId,
  ScratchNode,
  UnderstandTask,
  ViewMode,
  WikiLayoutMode
} from './types'
import type { ThinkingCanvasDocument, ThinkingToolPreferences } from '../lib/thinkingCanvas/types'
import { createEmptyDocument } from '../lib/thinkingCanvas/document'
import { DEFAULT_TOOL_PREFERENCES } from '../lib/thinkingCanvas/defaults'
import { applyToolPreferences } from '../lib/thinkingCanvas/document'
import { buildMigrationFromPersistedState, parseCanvasDocument } from '../lib/thinkingCanvas/migration'
import { fetchThinkingCanvas, saveThinkingCanvas } from '../lib/thinkingCanvas/api'
import { DEFAULT_MODALITY_ROUTE, PROVIDER_PRESETS } from './types'
import { getEffectiveLocale } from '../lib/i18n'
import i18n from '../lib/i18n'
import { syncDocumentLocale } from '../lib/localeUi'

const CONTENT_TYPES = ['video', 'image', 'audio', 'article'] as const

function makeDefaultProviders(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {}
  for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
    providers[id] = {
      id: id as ProviderId,
      enabled: false,
      baseUrl: preset.baseUrl,
      apiKeys: '',
      models: [...preset.defaultModels],
      selectedModel: preset.defaultModels[0] ?? ''
    }
  }
  // Enable openai_compat by default as the generic fallback
  providers.openai_compat.enabled = true
  return providers
}

function makeDefaultModalityOverrides(): AppSettings['modalityOverrides'] {
  return {
    video: { ...DEFAULT_MODALITY_ROUTE },
    image: { ...DEFAULT_MODALITY_ROUTE },
    audio: { ...DEFAULT_MODALITY_ROUTE },
    article: { ...DEFAULT_MODALITY_ROUTE }
  }
}

const defaultSettings: AppSettings = {
  locale: 'system',
  vaultPath: '',
  cacheDir: '',
  modelsDir: '',
  providers: makeDefaultProviders(),
  defaultProvider: 'openai_compat',
  modalityOverrides: makeDefaultModalityOverrides(),
  inferenceMode: 'prefer_api',
  localPresetId: '',
  useOllamaIfAvailable: true,
  autoStartLocal: true,
  frameSettings: {
    fps: 1.0,
    maxFrames: 30,
    scale: '',
    strategy: 'uniform'
  },
  audioExtractSettings: {
    enabled: true,
    sampleRate: 16000
  },
  outputLanguage: 'zh',
  promptTemplate: '',
  cookiesPath: '',
  proxySettings: {
    httpProxy: '',
    githubMirror: '',
    ollamaMirror: ''
  }
}

/** Migrate old flat settings to new provider-based format. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateSettings(old: any): AppSettings {
  if (old.providers) return old as AppSettings // already new format

  const providers = makeDefaultProviders()

  // Migrate apiKey/apiBase → openai_compat
  if (old.apiBase || old.apiKey) {
    providers.openai_compat = {
      ...providers.openai_compat,
      enabled: true,
      baseUrl: old.apiBase || '',
      apiKeys: old.apiKey || ''
    }
  }

  // Migrate mimoKeys → mimo
  if (old.mimoKeys) {
    providers.mimo = {
      ...providers.mimo,
      enabled: true,
      apiKeys: old.mimoKeys
    }
  }

  // Migrate geminiKeys → gemini
  if (old.geminiKeys) {
    providers.gemini = {
      ...providers.gemini,
      enabled: true,
      apiKeys: old.geminiKeys
    }
  }

  // Migrate per-modality backend+model → modalityOverrides
  const overrides = makeDefaultModalityOverrides()
  for (const ct of CONTENT_TYPES) {
    const backendKey = `${ct}Backend`
    const modelKey = `${ct}Model`
    const backend = old[backendKey]
    const model = old[modelKey]
    if (backend && backend !== 'openai_compat') {
      overrides[ct as keyof typeof overrides] = {
        providerId: backend as ProviderId,
        model: model || ''
      }
    } else if (model) {
      overrides[ct as keyof typeof overrides] = {
        providerId: 'openai_compat',
        model
      }
    }
  }

  // Determine defaultProvider from the most common backend
  const backendCounts = new Map<string, number>()
  for (const ct of CONTENT_TYPES) {
    const b = old[`${ct}Backend`] || 'openai_compat'
    backendCounts.set(b, (backendCounts.get(b) || 0) + 1)
  }
  let defaultProvider: ProviderId = 'openai_compat'
  let maxCount = 0
  for (const [b, count] of backendCounts) {
    if (count > maxCount) {
      maxCount = count
      defaultProvider = b as ProviderId
    }
  }

  return {
    locale: old.locale || 'system',
    vaultPath: old.vaultPath || '',
    cacheDir: old.cacheDir || '',
    modelsDir: old.modelsDir || '',
    providers,
    defaultProvider,
    modalityOverrides: overrides,
    inferenceMode: old.inferenceMode || 'prefer_api',
    localPresetId: old.localPresetId || '',
    useOllamaIfAvailable: old.useOllamaIfAvailable ?? true,
    autoStartLocal: old.autoStartLocal ?? true,
    frameSettings: old.frameSettings || { fps: 1.0, maxFrames: 30, scale: '', strategy: 'uniform' },
    audioExtractSettings: old.audioExtractSettings || { enabled: true, sampleRate: 16000 },
    outputLanguage: old.outputLanguage || 'zh',
    promptTemplate: old.promptTemplate || '',
    cookiesPath: old.cookiesPath || ''
  }
}

const demoSlug = 'video/demo-welcome'
const demoSlugs = new Set(['video/demo-welcome', 'article/demo-read', 'notes/demo-thought'])

function buildDemoLibrary(lng: 'zh' | 'en'): LibraryItem[] {
  if (lng === 'zh') {
    return [
      {
        slug: 'video/demo-welcome',
        path: 'video/demo-welcome.md',
        title: '欢迎使用 Content Understand',
        type: 'video',
        platform: 'demo',
        url: 'https://example.com/welcome',
        summary: '演示笔记。连接引擎后，理解结果会写入你的 Vault。',
        tags: ['demo'],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        body: `# 欢迎使用\n\n## 摘要\n\n这是演示数据。\n\n## 要点\n\n- 粘贴链接或写一条笔记\n- 重要的贴上便签架\n- 在导图里随意摆`
      },
      {
        slug: 'article/demo-read',
        path: 'article/demo-read.md',
        title: '如何建立个人 Wiki',
        type: 'article',
        platform: 'web',
        url: 'https://example.com/wiki',
        summary: '收录 → 时间线积累 → 导图看关系。重要的贴便签架。',
        tags: ['wiki', '方法'],
        created: new Date(Date.now() - 86400000).toISOString(),
        updated: new Date(Date.now() - 3600000).toISOString(),
        body: `# 如何建立个人 Wiki\n\n## 摘要\n\n用时间线感受积累，用便签架放精选。\n\n## 要点\n\n- 时间线：全部笔记\n- 便签架：pinned 重要\n- 导图：思考 + 全库`
      },
      {
        slug: 'notes/demo-thought',
        path: 'notes/demo-thought.md',
        title: '一条手写笔记',
        type: 'article',
        platform: 'self',
        url: '',
        summary: '自己写的想法也会出现在时间线里，重要的可以贴上便签架。',
        tags: ['笔记'],
        created: new Date(Date.now() - 172800000).toISOString(),
        updated: new Date(Date.now() - 7200000).toISOString(),
        body: `# 一条手写笔记\n\n这里是从「写一条」进来的空白笔记示例。\n\n可以贴上便签架，也可以拖进思考导图。`
      }
    ]
  }
  return [
    {
      slug: 'video/demo-welcome',
      path: 'video/demo-welcome.md',
      title: 'Welcome to Content Understand',
      type: 'video',
      platform: 'demo',
      url: 'https://example.com/welcome',
      summary: 'Demo note. Connect the engine for real results.',
      tags: ['demo'],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      body: `# Welcome\n\n## Summary\n\nDemo data for the UI.\n\n## Highlights\n\n- Paste a link or write a note\n- Pin important ones\n- Arrange on the map`
    },
    {
      slug: 'article/demo-read',
      path: 'article/demo-read.md',
      title: 'Building a personal wiki',
      type: 'article',
      platform: 'web',
      url: 'https://example.com/wiki',
      summary: 'Capture → timeline → map. Pin what matters on the sticky wall.',
      tags: ['wiki'],
      created: new Date(Date.now() - 86400000).toISOString(),
      updated: new Date(Date.now() - 3600000).toISOString(),
      body: `# Building a personal wiki\n\n## Summary\n\nTimeline for growth, sticky wall for favorites.\n\n## Highlights\n\n- Timeline: everything\n- Sticky wall: pinned\n- Map: thinking + wiki`
    },
    {
      slug: 'notes/demo-thought',
      path: 'notes/demo-thought.md',
      title: 'A handwritten note',
      type: 'article',
      platform: 'self',
      url: '',
      summary: 'Notes you write appear on the timeline; pin the important ones.',
      tags: ['note'],
      created: new Date(Date.now() - 172800000).toISOString(),
      updated: new Date(Date.now() - 7200000).toISOString(),
      body: `# A handwritten note\n\nExample from **Write a note**.\n\nPin it or drop it on the thinking map.`
    }
  ]
}

function demoLibraryFor(lng: 'zh' | 'en'): LibraryItem[] {
  return buildDemoLibrary(lng)
}

function isDemoLibrary(items: LibraryItem[]): boolean {
  if (items.length === 0) return false
  return items.every((i) => demoSlugs.has(i.slug))
}

interface AppState {
  settings: AppSettings
  settingsOpen: boolean
  viewMode: ViewMode
  filter: ContentType
  libraryQuery: string
  selectedSlug: string | null
  readerOpen: boolean
  tasks: UnderstandTask[]
  library: LibraryItem[]
  sidecarOnline: boolean
  inputUrl: string
  isDragging: boolean
  pinnedSlugs: string[]
  vaultLayout: Record<string, MapNodePos>
  mapMode: MapMode
  thinkingMap: Record<string, MapNodePos>
  wikiMap: Record<string, MapNodePos>
  wikiLayoutMode: WikiLayoutMode
  wikiPinnedSlugs: string[]
  thinkingScratch: ScratchNode[]
  thinkingCanvas: ThinkingCanvasDocument | null
  thinkingCanvasReady: boolean
  thinkingToolPrefs: ThinkingToolPreferences
  startUnderstandRunning: boolean
  _healthInterval: ReturnType<typeof setInterval> | null
  startHealthPolling: () => void

  setSettingsOpen: (open: boolean) => void
  setViewMode: (mode: ViewMode) => void
  setMapMode: (mode: MapMode) => void
  updateSettings: (patch: Partial<AppSettings>) => void
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  setModalityRoute: (modality: string, route: ModalityRoute) => void
  applyLocale: () => void
  syncAppPaths: () => Promise<void>
  pushEngineConfig: () => Promise<boolean>
  setFilter: (filter: ContentType) => void
  setLibraryQuery: (q: string) => void
  selectItem: (slug: string | null, opts?: { reader?: boolean }) => void
  closeReader: () => void
  setInputUrl: (url: string) => void
  setDragging: (v: boolean) => void
  setSidecarOnline: (v: boolean) => void
  setLibrary: (items: LibraryItem[]) => void
  togglePin: (slug: string) => void
  isPinned: (slug: string) => boolean
  pinNote: (slug: string, pos?: MapNodePos) => void
  createNote: (opts?: {
    pin?: boolean
    viewMode?: ViewMode
    pos?: MapNodePos
  }) => string
  updateNote: (slug: string, patch: Partial<Pick<LibraryItem, 'title' | 'body' | 'summary'>>) => void
  setVaultNodePos: (slug: string, pos: MapNodePos) => void
  setMapNodePos: (map: MapMode, id: string, pos: MapNodePos) => void
  setWikiLayoutMode: (mode: WikiLayoutMode) => void
  toggleWikiPin: (slug: string) => void
  setWikiPinnedSlugs: (slugs: string[]) => void
  addScratchNode: (text: string, pos?: MapNodePos) => string
  updateScratchNode: (id: string, patch: Partial<ScratchNode>) => void
  removeScratchNode: (id: string) => void
  setThinkingCanvas: (doc: ThinkingCanvasDocument) => void
  patchThinkingCanvas: (
    updater: (doc: ThinkingCanvasDocument) => ThinkingCanvasDocument
  ) => void
  setThinkingToolPrefs: (
    patch:
      | Partial<ThinkingToolPreferences>
      | ((prev: ThinkingToolPreferences) => ThinkingToolPreferences)
  ) => void
  loadThinkingCanvas: () => Promise<void>
  addTask: (task: UnderstandTask) => void
  updateTask: (id: string, patch: Partial<UnderstandTask>) => void
  removeTask: (id: string) => void
  refreshLibrary: () => Promise<void>
  startUnderstand: (url: string) => Promise<void>
  deletePage: (slug: string) => Promise<boolean>
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      settingsOpen: false,
      viewMode: 'capture',
      filter: 'all',
      libraryQuery: '',
      selectedSlug: null,
      readerOpen: false,
      tasks: [],
      library: demoLibraryFor(getEffectiveLocale('system')),
      sidecarOnline: false,
      inputUrl: '',
      isDragging: false,
      pinnedSlugs: ['video/demo-welcome', 'article/demo-read'],
      vaultLayout: {},
      mapMode: 'thinking',
      thinkingMap: {},
      wikiMap: {},
      wikiLayoutMode: 'force',
      wikiPinnedSlugs: [],
      thinkingScratch: [],
      thinkingCanvas: null,
      thinkingCanvasReady: false,
      thinkingToolPrefs: { ...DEFAULT_TOOL_PREFERENCES },
      startUnderstandRunning: false,
      _healthInterval: null as ReturnType<typeof setInterval> | null,
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

      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setViewMode: (viewMode) => set({ viewMode }),
      setMapMode: (mapMode) =>
        set((s) => ({
          mapMode,
          readerOpen: mapMode === 'wiki' && s.viewMode === 'map' ? false : s.readerOpen
        })),
      updateSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
        get().applyLocale()
      },
      updateProvider: (id, patch) => {
        set((s) => ({
          settings: {
            ...s.settings,
            providers: {
              ...s.settings.providers,
              [id]: { ...s.settings.providers[id], ...patch }
            }
          }
        }))
      },
      setModalityRoute: (modality, route) => {
        set((s) => ({
          settings: {
            ...s.settings,
            modalityOverrides: {
              ...s.settings.modalityOverrides,
              [modality]: route
            }
          }
        }))
      },
      applyLocale: () => {
        const lng = getEffectiveLocale(get().settings.locale)
        void i18n.changeLanguage(lng)
        syncDocumentLocale(lng)
        const lib = get().library
        if (isDemoLibrary(lib)) {
          set({ library: demoLibraryFor(lng) })
        }
      },
      syncAppPaths: async () => {
        const paths = await window.api.getAppPaths()
        set((s) => ({
          settings: {
            ...s.settings,
            vaultPath: paths.vault,
            cacheDir: paths.cache,
            modelsDir: paths.models
          }
        }))
      },
      pushEngineConfig: async (): Promise<boolean> => {
        const { pushConfig } = await import('../lib/sidecar')
        const ok = await pushConfig(get().settings)
        if (!ok) {
          console.warn('[appStore] pushEngineConfig failed — sidecar may be offline')
        }
        return ok
      },
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
      closeReader: () => set({ readerOpen: false }),
      setInputUrl: (inputUrl) => set({ inputUrl }),
      setDragging: (isDragging) => set({ isDragging }),
      setSidecarOnline: (sidecarOnline) => set({ sidecarOnline }),
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
        const id = Date.now()
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
      },
      addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
        })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      refreshLibrary: async () => {
        const { fetchLibrary } = await import('../lib/sidecar')
        const items = await fetchLibrary()
        if (items.length > 0) {
          const prev = get().selectedSlug
          const still = prev && items.some((i) => i.slug === prev)
          set({
            library: items,
            sidecarOnline: true,
            selectedSlug: still ? prev : null
          })
        }
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
      },

      startUnderstand: async (url: string) => {
        if (get().startUnderstandRunning) return
        set({ startUnderstandRunning: true })
        const { startIngest, pollJob } = await import('../lib/sidecar')
        const configOk = await get().pushEngineConfig()
        if (!configOk) {
          const id = crypto.randomUUID()
          get().addTask({
            id,
            url,
            status: 'failed',
            error: i18n.t('errors.configSyncFailed'),
            createdAt: new Date().toISOString()
          })
          set({ startUnderstandRunning: false })
          return
        }
        const id = crypto.randomUUID()
        const task: UnderstandTask = {
          id,
          url,
          status: 'processing',
          progress: { stage: 'resolve', percent: 5, message: '' },
          createdAt: new Date().toISOString()
        }
        get().addTask(task)
        set({ inputUrl: '', viewMode: 'capture', selectedSlug: null })

        try {
          const jobId = await startIngest(url)
          if (!jobId) {
            get().updateTask(id, {
              status: 'failed',
              error: i18n.t('errors.engineOffline')
            })
            return
          }

          const resultSlug = await pollJob(jobId, (progress) => {
            get().updateTask(id, { progress })
          })

          get().updateTask(id, { status: 'completed', slug: resultSlug ?? undefined })
          await get().refreshLibrary()
          const slug = resultSlug ?? get().library[0]?.slug
          if (slug) {
            set({ viewMode: 'journal', selectedSlug: slug })
          }
        } catch (e) {
          get().updateTask(id, {
            status: 'failed',
            error: e instanceof Error ? e.message : 'failed'
          })
        } finally {
          set({ startUnderstandRunning: false })
        }
      }
    }),
    {
      name: 'content-understand-settings',
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
          tasks: s.tasks.filter(t => t.status === "completed" || t.status === "failed")
        }
      },
      merge: (persisted: unknown, current) => {
        const merged = { ...current, ...(persisted as Record<string, unknown>) } as AppState
        if (Array.isArray(merged.tasks)) {
          // Keep persisted completed/failed tasks, merge with any in-memory processing tasks
          const persistedTasks = merged.tasks as UnderstandTask[]
          const processingTasks = current.tasks.filter(t => t.status === "processing")
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
