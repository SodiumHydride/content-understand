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

/** Cloud OpenAI-compatible, local server, or vendor presets. */
export type BackendId = 'openai_compat' | 'local_server' | 'mimo' | 'gemini' | 'claude'

export type InferenceMode = 'prefer_local' | 'prefer_api' | 'local_only' | 'api_only'

export interface AppSettings {
  locale: 'zh' | 'en' | 'system'
  /** Filled from app userData — not user-picked C: / D: drive. */
  vaultPath: string
  cacheDir: string
  modelsDir: string
  /** Cloud API base URL (OpenAI-compatible, Anthropic, etc.) */
  apiBase: string
  /** Cloud API key (generic fallback) */
  apiKey: string
  /** Vendor-specific API keys (comma-separated for multi-key rotation) */
  mimoKeys: string
  geminiKeys: string
  videoBackend: BackendId
  imageBackend: BackendId
  audioBackend: BackendId
  articleBackend: BackendId
  videoModel: string
  imageModel: string
  audioModel: string
  articleModel: string
  cookiesPath: string
  huggingFaceModelId: string
  inferenceMode: InferenceMode
  localPresetId: string
  useOllamaIfAvailable: boolean
  localEngineConfirmed: boolean
  /** Auto-start local inference server on first understanding request */
  autoStartLocal: boolean
}
