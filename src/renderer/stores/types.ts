import type { ThinkingCanvasDocument, ThinkingToolPreferences } from '../lib/thinkingCanvas/types'

export type ContentType = 'all' | 'video' | 'image' | 'audio' | 'article'

export type ViewMode = 'capture' | 'vault' | 'journal' | 'map'

export type MapMode = 'thinking' | 'wiki'

export type WikiLayoutMode = 'grid' | 'force'

export interface MapNodePos {
  x: number
  y: number
}

export interface ScratchNode {
  id: string
  text: string
  x: number
  y: number
}

/** Freeform text placed directly on the thinking canvas (no sticky chrome). */
export interface ThinkingTextNode {
  id: string
  text: string
  x: number
  y: number
}

/** Pen stroke in world coordinates. */
export interface ThinkingStroke {
  id: string
  points: MapNodePos[]
  color: string
  width: number
}

export type ThinkingTool = 'select' | 'text' | 'pen'

export type TaskStage = 'setup' | 'resolve' | 'download' | 'model' | 'write'

export type TaskStatus = 'processing' | 'completed' | 'failed'

export interface TaskProgress {
  stage: TaskStage
  percent: number
  message: string
  /** Seconds elapsed since task started (from backend, used for ETA). */
  elapsed_sec?: number
}

export interface UnderstandTask {
  id: string
  url: string
  status: TaskStatus
  progress?: TaskProgress
  error?: string
  createdAt: string
  title?: string
  contentType?: string
  slug?: string
  abortController?: AbortController
}

export interface LibraryItem {
  slug: string
  path: string
  title: string
  type: ContentType | string
  platform: string
  url: string
  summary: string
  tags: string[]
  created: string
  updated: string
  body?: string
}

/** Provider identifiers — fixed set, extensible later. */
export type ProviderId = 'mimo' | 'gemini' | 'claude' | 'openai_compat' | 'local_server'

export type InferenceMode = 'prefer_local' | 'prefer_api' | 'local_only' | 'api_only'

/** Per-provider configuration. */
export interface ProviderConfig {
  id: ProviderId
  enabled: boolean
  baseUrl: string
  apiKeys: string
  /** Models fetched from provider's /v1/models or preset list. */
  models: string[]
  /** User-selected default model for this provider. */
  selectedModel: string
}

/** Per-modality routing override (null = use default provider). */
export interface ModalityRoute {
  providerId: ProviderId | null
  model: string
}

export interface AppSettings {
  locale: 'zh' | 'en' | 'system'
  theme?: 'light' | 'dark' | 'system'
  /** Filled from app userData — not user-picked C: / D: drive. */
  vaultPath: string
  cacheDir: string
  modelsDir: string

  // ── Provider configs ──
  providers: Record<string, ProviderConfig>

  // ── Modality routing ──
  defaultProvider: ProviderId
  modalityOverrides: {
    video: ModalityRoute
    image: ModalityRoute
    audio: ModalityRoute
    article: ModalityRoute
  }

  // ── Local inference ──
  inferenceMode: InferenceMode
  localPresetId: string
  useOllamaIfAvailable: boolean
  autoStartLocal: boolean

  // ── Video processing ──
  frameSettings: FrameSettings
  audioExtractSettings: AudioExtractSettings

  // ── Output ──
  outputLanguage: 'zh' | 'en'
  promptTemplate: string

  // ── Misc ──
  cookiesPath: string

  // ── Network / Proxy ──
  proxySettings: ProxySettings

  // ── Typography ──
  typography: TypographySettings
}

export interface TypographySettings {
  /** Font family for reading: 'serif' | 'sans' | 'mono' */
  fontFamily: 'serif' | 'sans' | 'mono'
  /** Font size in px (12-24) */
  fontSize: number
  /** Line height multiplier (1.2-2.2) */
  lineHeight: number
}

/** Proxy and mirror settings for downloads. */
export interface ProxySettings {
  /** HTTP proxy URL (e.g. "http://127.0.0.1:7890"). Empty = system default. */
  httpProxy: string
  /** GitHub release mirror prefix (e.g. "https://mirror.ghproxy.com/"). Empty = direct. */
  githubMirror: string
  /** Ollama registry mirror (e.g. "https://mirror.ollama.com"). Empty = official. */
  ollamaMirror: string
}

/** Video frame extraction settings. */
export interface FrameSettings {
  fps: number           // 0.1 ~ 5.0, default 1.0
  maxFrames: number     // 10 ~ 100, default 30
  scale: string         // "" (original) | "512:-2" | "720:-2"
  strategy: 'uniform' | 'keyframe'  // default 'uniform'
  numCtx: number        // Ollama context size, default 16384
}

/** Audio extraction from video settings. */
export interface AudioExtractSettings {
  enabled: boolean      // default true
  sampleRate: number    // default 16000
}

// ── Provider presets (for model lists when /v1/models is unavailable) ──

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; defaultModels: string[] }> = {
  mimo: {
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModels: ['mimo-v2.5', 'mimo-v2.5-pro']
  },
  gemini: {
    baseUrl: '',
    defaultModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']
  },
  claude: {
    baseUrl: 'https://api.anthropic.com',
    defaultModels: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8']
  },
  openai_compat: {
    baseUrl: '',
    defaultModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo']
  },
  local_server: {
    baseUrl: '',
    defaultModels: []
  }
}

/** Default ModalityRoute: use provider default model. */
export const DEFAULT_MODALITY_ROUTE: ModalityRoute = { providerId: null, model: '' }

export interface SettingsSlice {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  setModalityRoute: (modality: string, route: ModalityRoute) => void
  applyLocale: () => void
  syncAppPaths: () => Promise<void>
  pushEngineConfig: () => Promise<boolean>
}

export interface LibrarySlice {
  library: LibraryItem[]
  filter: ContentType
  libraryQuery: string
  selectedSlug: string | null
  pinnedSlugs: string[]
  vaultLayout: Record<string, MapNodePos>
  setFilter: (filter: ContentType) => void
  setLibraryQuery: (q: string) => void
  selectItem: (slug: string | null, opts?: { reader?: boolean }) => void
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
  refreshLibrary: () => Promise<void>
  deletePage: (slug: string) => Promise<boolean>
}

export interface IngestTaskSlice {
  tasks: UnderstandTask[]
  startUnderstandRunning: boolean
  addTask: (task: UnderstandTask) => void
  updateTask: (id: string, patch: Partial<UnderstandTask>) => void
  removeTask: (id: string) => void
  startUnderstand: (url: string) => Promise<void>
}

export interface CanvasSlice {
  thinkingMap: Record<string, MapNodePos>
  wikiMap: Record<string, MapNodePos>
  wikiLayoutMode: WikiLayoutMode
  wikiPinnedSlugs: string[]
  thinkingScratch: ScratchNode[]
  thinkingCanvas: ThinkingCanvasDocument | null
  thinkingCanvasReady: boolean
  thinkingToolPrefs: ThinkingToolPreferences
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
}

export interface UiSlice {
  settingsOpen: boolean
  viewMode: ViewMode
  mapMode: MapMode
  readerOpen: boolean
  sidecarOnline: boolean
  inputUrl: string
  isDragging: boolean
  _healthInterval: ReturnType<typeof setInterval> | null
  startHealthPolling: () => void
  stopHealthPolling: () => void
  setSettingsOpen: (open: boolean) => void
  setViewMode: (mode: ViewMode) => void
  setMapMode: (mode: MapMode) => void
  closeReader: () => void
  setInputUrl: (url: string) => void
  setDragging: (v: boolean) => void
  setSidecarOnline: (v: boolean) => void
}

export type AppState = SettingsSlice & LibrarySlice & IngestTaskSlice & CanvasSlice & UiSlice

