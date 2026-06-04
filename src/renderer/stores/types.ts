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

export type BackendId = 'mimo' | 'openai_compat' | 'gemma'

export interface AppSettings {
  locale: 'zh' | 'en' | 'system'
  vaultPath: string
  apiBase: string
  apiKey: string
  videoBackend: BackendId
  imageBackend: BackendId
  audioBackend: BackendId
  articleBackend: BackendId
  cookiesPath: string
  cacheDir: string
}
