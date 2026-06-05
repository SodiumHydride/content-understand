import type { AppSettings, LibraryItem, TaskProgress } from '../stores/types'

let baseUrl: string | null = null

async function getBase(): Promise<string | null> {
  if (baseUrl) return baseUrl
  try {
    baseUrl = await window.api.getSidecarBase()
    return baseUrl
  } catch {
    return null
  }
}

export async function checkHealth(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

export async function fetchLibrary(): Promise<LibraryItem[]> {
  const base = await getBase()
  if (!base) return []
  try {
    const r = await fetch(`${base}/v1/library`)
    if (!r.ok) return []
    const data = (await r.json()) as { items: LibraryItem[] }
    return data.items ?? []
  } catch {
    return []
  }
}

export async function fetchPage(slug: string): Promise<LibraryItem | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}`)
    if (!r.ok) return null
    return (await r.json()) as LibraryItem
  } catch {
    return null
  }
}

export async function startIngest(url: string): Promise<string | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
    if (!r.ok) return null
    const data = (await r.json()) as { job_id: string }
    return data.job_id
  } catch {
    return null
  }
}

export async function pollJob(
  jobId: string,
  onProgress: (p: TaskProgress) => void
): Promise<string | null> {
  const base = await getBase()
  if (!base) return null

  const INITIAL_DELAY = 500
  const MAX_DELAY = 5_000
  const BACKOFF_FACTOR = 1.5
  const MAX_DURATION = 15 * 60 * 1000

  let delay = INITIAL_DELAY
  const deadline = Date.now() + MAX_DURATION

  while (Date.now() < deadline) {
    const r = await fetch(`${base}/v1/jobs/${jobId}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error('job poll failed')
    const data = (await r.json()) as {
      status: string
      progress?: TaskProgress
      error?: string
      result_slug?: string
    }
    if (data.progress) onProgress(data.progress)
    if (data.status === 'completed') return data.result_slug ?? null
    if (data.status === 'failed') throw new Error(data.error || 'failed')

    const jitter = delay * (0.8 + Math.random() * 0.4)
    await new Promise((res) => setTimeout(res, jitter))
    delay = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY)
  }
  throw new Error('timeout')
}

export async function rebuildIndex(): Promise<void> {
  const base = await getBase()
  if (!base) return
  try {
    await fetch(`${base}/v1/index/rebuild`, { method: 'POST' })
  } catch {
    // ignore — index rebuild is best-effort
  }
}

export async function pushConfig(settings: AppSettings): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    })
    return r.ok
  } catch {
    return false
  }
}

export interface RuntimeRecommend {
  hardware: Record<string, unknown>
  recommended_preset_id: string
  preset: Record<string, unknown>
  summary_zh: string
  summary_en: string
}

export interface RuntimeStatus {
  state: string
  backend?: string
  progress?: { percent?: number; message?: string }
}

export interface RuntimePreset {
  id: string
  label_zh: string
  label_en: string
  tier: string
  modalities: string[]
  download_size_gb: number
  min_ram_gb: number
  min_vram_gb: number
  min_unified_memory_gb: number
  cpu_recommended: boolean
}

export async function fetchRuntimeRecommend(): Promise<RuntimeRecommend | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/runtime/recommend`)
    if (!r.ok) return null
    return (await r.json()) as RuntimeRecommend
  } catch {
    return null
  }
}

export async function fetchRuntimeStatus(): Promise<RuntimeStatus | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/runtime/status`)
    if (!r.ok) return null
    return (await r.json()) as RuntimeStatus
  } catch {
    return null
  }
}

export async function fetchPresets(): Promise<RuntimePreset[]> {
  const base = await getBase()
  if (!base) return []
  try {
    const r = await fetch(`${base}/v1/runtime/presets`)
    if (!r.ok) return []
    const data = (await r.json()) as { presets: RuntimePreset[] }
    return data.presets ?? []
  } catch {
    return []
  }
}

export async function startRuntimeSetup(
  presetId: string | null,
  preferOllama: boolean
): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/runtime/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset_id: presetId || null,
        prefer_ollama: preferOllama,
        confirm: true
      })
    })
    return r.ok
  } catch {
    return false
  }
}

export interface RuntimeAutoDetect {
  backend: string | null
  url: string | null
  state: string
  preset?: string | null
  hardware?: Record<string, unknown> | null
  recommendation?: string | null
}

export async function autoDetectRuntime(): Promise<RuntimeAutoDetect | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/runtime/auto-detect`, { method: 'POST' })
    if (!r.ok) return null
    return (await r.json()) as RuntimeAutoDetect
  } catch {
    return null
  }
}

// ── Local model management ──

export interface DownloadedModel {
  filename: string
  path: string
  size_bytes: number
  preset_id: string | null
  preset_label_zh: string | null
  preset_label_en: string | null
  is_mmproj: boolean
}

export interface ModelsResponse {
  models: DownloadedModel[]
  total_size_bytes: number
}

export async function fetchDownloadedModels(): Promise<ModelsResponse | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/models`)
    if (!r.ok) return null
    return (await r.json()) as ModelsResponse
  } catch {
    return null
  }
}

export async function deleteModel(filename: string): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/models/${encodeURIComponent(filename)}`, { method: 'DELETE' })
    return r.ok
  } catch {
    return false
  }
}
