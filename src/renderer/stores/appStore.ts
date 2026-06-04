import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  ContentType,
  LibraryItem,
  MapMode,
  MapNodePos,
  ScratchNode,
  UnderstandTask,
  ViewMode
} from './types'
import { getEffectiveLocale } from '../lib/i18n'
import i18n from '../lib/i18n'
import { syncDocumentLocale } from '../lib/localeUi'

const defaultSettings: AppSettings = {
  locale: 'system',
  vaultPath: '',
  apiBase: '',
  apiKey: '',
  videoBackend: 'mimo',
  imageBackend: 'mimo',
  audioBackend: 'mimo',
  articleBackend: 'mimo',
  cookiesPath: '',
  cacheDir: ''
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
  tasks: UnderstandTask[]
  library: LibraryItem[]
  sidecarOnline: boolean
  inputUrl: string
  isDragging: boolean
  pinnedSlugs: string[]
  mapMode: MapMode
  thinkingMap: Record<string, MapNodePos>
  wikiMap: Record<string, MapNodePos>
  thinkingScratch: ScratchNode[]

  setSettingsOpen: (open: boolean) => void
  setViewMode: (mode: ViewMode) => void
  setMapMode: (mode: MapMode) => void
  updateSettings: (patch: Partial<AppSettings>) => void
  applyLocale: () => void
  setFilter: (filter: ContentType) => void
  setLibraryQuery: (q: string) => void
  selectItem: (slug: string | null) => void
  setInputUrl: (url: string) => void
  setDragging: (v: boolean) => void
  setSidecarOnline: (v: boolean) => void
  setLibrary: (items: LibraryItem[]) => void
  togglePin: (slug: string) => void
  isPinned: (slug: string) => boolean
  createNote: () => void
  setMapNodePos: (map: MapMode, id: string, pos: MapNodePos) => void
  addScratchNode: (text: string) => void
  updateScratchNode: (id: string, patch: Partial<ScratchNode>) => void
  addTask: (task: UnderstandTask) => void
  updateTask: (id: string, patch: Partial<UnderstandTask>) => void
  refreshLibrary: () => Promise<void>
  startUnderstand: (url: string) => Promise<void>
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
      tasks: [],
      library: demoLibraryFor(getEffectiveLocale('system')),
      sidecarOnline: false,
      inputUrl: '',
      isDragging: false,
      pinnedSlugs: ['video/demo-welcome', 'article/demo-read'],
      mapMode: 'thinking',
      thinkingMap: {},
      wikiMap: {},
      thinkingScratch: [],

      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setViewMode: (viewMode) => set({ viewMode }),
      setMapMode: (mapMode) => set({ mapMode }),
      updateSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
        get().applyLocale()
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
      setFilter: (filter) => set({ filter }),
      setLibraryQuery: (libraryQuery) => set({ libraryQuery }),
      selectItem: (selectedSlug) => set({ selectedSlug }),
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
      createNote: () => {
        const lng = getEffectiveLocale(get().settings.locale)
        const now = new Date().toISOString()
        const id = Date.now()
        const slug = `notes/note-${id}`
        const item: LibraryItem = {
          slug,
          path: `notes/note-${id}.md`,
          title: lng === 'zh' ? '无标题笔记' : 'Untitled note',
          type: 'article',
          platform: 'self',
          url: '',
          summary: lng === 'zh' ? '从这里开始写。' : 'Start writing here.',
          tags: lng === 'zh' ? ['笔记'] : ['note'],
          created: now,
          updated: now,
          body: lng === 'zh' ? '# 无标题笔记\n\n' : '# Untitled note\n\n'
        }
        set((s) => ({
          library: [item, ...s.library],
          selectedSlug: slug,
          viewMode: 'journal'
        }))
      },
      setMapNodePos: (map, id, pos) =>
        set((s) =>
          map === 'thinking'
            ? { thinkingMap: { ...s.thinkingMap, [id]: pos } }
            : { wikiMap: { ...s.wikiMap, [id]: pos } }
        ),
      addScratchNode: (text) => {
        const id = `scratch-${crypto.randomUUID()}`
        const count = get().thinkingScratch.length
        set((s) => ({
          thinkingScratch: [
            ...s.thinkingScratch,
            { id, text, x: 80 + (count % 3) * 48, y: 80 + Math.floor(count / 3) * 40 }
          ]
        }))
      },
      updateScratchNode: (id, patch) =>
        set((s) => ({
          thinkingScratch: s.thinkingScratch.map((n) => (n.id === id ? { ...n, ...patch } : n))
        })),
      addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
        })),

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

      startUnderstand: async (url: string) => {
        const { startIngest, pollJob } = await import('../lib/sidecar')
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
            const stages = ['resolve', 'download', 'model', 'write'] as const
            for (let i = 0; i < stages.length; i++) {
              await new Promise((r) => setTimeout(r, 800))
              get().updateTask(id, {
                progress: {
                  stage: stages[i],
                  percent: (i + 1) * 25,
                  message: ''
                }
              })
            }
            get().updateTask(id, {
              status: 'completed',
              title: 'Demo · 理解完成',
              contentType: 'video',
              slug: 'video/demo-welcome'
            })
            set({ viewMode: 'journal', selectedSlug: 'video/demo-welcome' })
            return
          }

          await pollJob(jobId, (progress) => {
            get().updateTask(id, { progress })
          })

          get().updateTask(id, { status: 'completed' })
          await get().refreshLibrary()
          const lib = get().library
          if (lib.length > 0) {
            set({ viewMode: 'journal', selectedSlug: lib[0].slug })
          }
        } catch (e) {
          get().updateTask(id, {
            status: 'failed',
            error: e instanceof Error ? e.message : 'failed'
          })
        }
      }
    }),
    {
      name: 'content-understand-settings',
      partialize: (s) => ({
        settings: s.settings,
        viewMode: s.viewMode,
        pinnedSlugs: s.pinnedSlugs,
        mapMode: s.mapMode,
        thinkingMap: s.thinkingMap,
        wikiMap: s.wikiMap,
        thinkingScratch: s.thinkingScratch
      })
    }
  )
)
