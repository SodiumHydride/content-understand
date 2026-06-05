export type ContentType = 'all' | 'video' | 'image' | 'audio' | 'article'

export type ViewMode = 'capture' | 'vault' | 'journal' | 'map'

export type MapMode = 'thinking' | 'wiki'

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

export type TaskStage = 'resolve' | 'download' | 'model' | 'write'

export type TaskStatus = 'processing' | 'completed' | 'failed'

export interface TaskProgress {
  stage: TaskStage
  percent: number
  message: string
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

  // ── Misc ──
  cookiesPath: string
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
