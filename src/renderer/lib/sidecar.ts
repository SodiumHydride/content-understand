import type { AppSettings, LibraryItem, TaskProgress } from '../stores/types'

let baseUrl: string | null = null

async function getBase(): Promise<string | null> {
  if (baseUrl) return baseUrl
  try {
    baseUrl = await window.api.getSidecarBase()
    console.log('[sidecar] getBase resolved:', baseUrl)
    return baseUrl
  } catch (e) {
    console.error('[sidecar] getBase failed:', e)
    return null
  }
}

export async function checkHealth(): Promise<boolean> {
  const base = await getBase()
  if (!base) {
    console.warn('[sidecar] checkHealth: no base URL')
    return false
  }
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })
    console.log('[sidecar] checkHealth:', r.status, r.ok)
    return r.ok
  } catch (e) {
    console.error('[sidecar] checkHealth fetch failed:', e)
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
    if (!r.ok) {
      let detail = ""
      try { const d = await r.json(); detail = d.detail || d.error || "" } catch {}
      throw new Error(detail || "Ingest failed (" + r.status + ")")
    }
    const data = (await r.json()) as { job_id: string }
    return data.job_id
  } catch (e) {
    if (e instanceof Error) throw e
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
      logs?: string[]
    }
    if (data.progress) onProgress(data.progress)
    if (data.status === 'completed') return data.result_slug ?? null
    if (data.status === 'failed') {
      const tail = (data.logs ?? []).slice(-4).join('\n')
      const msg = [data.error || 'failed', tail].filter(Boolean).join('\n')
      throw new Error(msg)
    }

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

export interface LogEntry {
  ts: number
  level: string
  logger: string
  message: string
}

export async function fetchLogs(opts?: {
  limit?: number
  level?: string
  jobId?: string
}): Promise<LogEntry[]> {
  const base = await getBase()
  if (!base) return []
  try {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.level) params.set('level', opts.level)
    if (opts?.jobId) params.set('job_id', opts.jobId)
    const q = params.toString()
    const r = await fetch(`${base}/v1/logs${q ? `?${q}` : ''}`)
    if (!r.ok) return []
    const data = (await r.json()) as { entries: LogEntry[] }
    return data.entries ?? []
  } catch {
    return []
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

/** Fetch available models from a provider's API. */
export async function fetchProviderModels(
  providerId: string,
  baseUrl: string,
  apiKey: string
): Promise<string[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/providers/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: providerId, base_url: baseUrl, api_key: apiKey })
    })
    if (!r.ok) return null
    const data = (await r.json()) as { models: string[] }
    return data.models ?? null
  } catch {
    return null
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
  preset_id?: string
  label_zh: string
  label_en: string
  tier: string
  modalities: string[]
  ollama_model: string
  download_size_gb: number
  min_ram_gb: number
  min_vram_gb: number
  min_unified_memory_gb?: number
  cpu_recommended: boolean
  installed?: boolean
  installed_name?: string | null
  selected?: boolean
  recommended?: boolean
  size?: number
  ollama_note_zh?: string
  ollama_note_en?: string
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

export async function startRuntimeSetup(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/runtime/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true })
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
  source?: 'app' | 'user' | null
  preset?: string | null
  hardware?: Record<string, unknown> | null
  recommendation?: string | null
}

export async function autoDetectRuntime(opts?: {
  useUserOllama?: boolean
  autoSetup?: boolean
}): Promise<RuntimeAutoDetect | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/runtime/auto-detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        use_user_ollama: opts?.useUserOllama ?? true,
        auto_setup: opts?.autoSetup ?? false
      })
    })
    if (!r.ok) return null
    return (await r.json()) as RuntimeAutoDetect
  } catch {
    return null
  }
}

// ── Cookies export ──

export interface CookiesExportResult {
  ok: boolean
  path?: string
  size?: number
  error?: string
}

export async function exportCookies(browser: string): Promise<CookiesExportResult> {
  const base = await getBase()
  if (!base) return { ok: false, error: 'Sidecar offline' }
  try {
    const r = await fetch(`${base}/v1/cookies/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser })
    })
    return (await r.json()) as CookiesExportResult
  } catch {
    return { ok: false, error: 'Request failed' }
  }
}

// ── Ollama management ──

export interface OllamaOperationProgress {
  stage: string
  percent: number
  message: string
  total_bytes?: number
  completed_bytes?: number
  speed_bps?: number
  elapsed_sec?: number
}

export interface OllamaOperation {
  state: 'idle' | 'working' | 'ready' | 'error'
  message: string
  progress: OllamaOperationProgress
  pulling_preset_id: string | null
  setup_running: boolean
  ollama_health?: 'unknown' | 'healthy' | 'unhealthy' | 'restarting' | 'error'
  ollama_last_health_check?: number
  ollama_restart_count?: number
}

export interface OllamaCatalog {
  source: 'app' | 'user' | null
  running: boolean
  app_binary_installed: boolean
  app_download_in_progress?: boolean
  app_download_progress?: OllamaOperationProgress
  app_download_error?: string | null
  models_dir: string
  selected_preset_id: string | null
  recommended_preset_id: string | null
  presets: RuntimePreset[]
  installed: RuntimePreset[]
  operation?: OllamaOperation
}

export interface OllamaStatus {
  app_binary_installed: boolean
  app_binary_path: string | null
  user_binary_path: string | null
  running: boolean
  base_url: string | null
  source: 'app' | 'user' | null
  models_dir: string
  version: string | null
  catalog: OllamaCatalog
  models: RuntimePreset[]
  ollama_health?: 'unknown' | 'healthy' | 'unhealthy' | 'restarting' | 'error'
  ollama_last_health_check?: number
  ollama_restart_count?: number
}

export interface InstalledModel {
  name: string
  size: number
  is_preset: boolean
  preset_id?: string
  modalities?: string[]
}

export async function fetchOllamaCatalog(): Promise<OllamaCatalog | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/ollama/catalog`)
    if (!r.ok) return null
    return (await r.json()) as OllamaCatalog
  } catch {
    return null
  }
}

export async function fetchOllamaStatus(): Promise<OllamaStatus | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/ollama/status`)
    if (!r.ok) return null
    return (await r.json()) as OllamaStatus
  } catch {
    return null
  }
}

export async function downloadOllama(): Promise<{
  ok: boolean
  status?: 'started' | 'in_progress' | 'already_installed'
  path?: string
  error?: string
}> {
  const base = await getBase()
  if (!base) return { ok: false, error: 'Sidecar offline' }
  try {
    const r = await fetch(`${base}/v1/ollama/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true })
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` }
    }
    return (await r.json()) as {
      ok: boolean
      status?: 'started' | 'in_progress' | 'already_installed'
      path?: string
      error?: string
    }
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function startOllama(
  preferUser = true
): Promise<{
  ok: boolean
  status?: 'ready' | 'started' | 'in_progress'
  base_url?: string
  source?: string
  error?: string
}> {
  const base = await getBase()
  if (!base) return { ok: false, error: 'Sidecar offline' }
  try {
    const r = await fetch(`${base}/v1/ollama/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefer_user: preferUser })
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` }
    }
    return (await r.json()) as {
      ok: boolean
      status?: 'ready' | 'started' | 'in_progress'
      base_url?: string
      source?: string
      error?: string
    }
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function uninstallAppOllama(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/uninstall-app`, { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}

export async function pullOllamaPreset(
  presetId: string
): Promise<{
  ok: boolean
  status?: 'started' | 'in_progress' | 'already_installed'
  preset_id?: string
  error?: string
  name?: string
}> {
  const base = await getBase()
  if (!base) return { ok: false, error: 'Sidecar offline' }
  try {
    const r = await fetch(`${base}/v1/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset_id: presetId })
    })
    const data = (await r.json()) as {
      ok: boolean
      status?: 'started' | 'in_progress' | 'already_installed'
      preset_id?: string
      error?: string
      detail?: string
      name?: string
    }
    if (!r.ok) {
      const msg = data.detail || data.error || `Pull failed (${r.status})`
      return { ok: false, error: msg }
    }
    return data
  } catch {
    return { ok: false, error: 'Request failed' }
  }
}

export async function selectOllamaPreset(presetId: string): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/select-preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset_id: presetId })
    })
    return r.ok
  } catch {
    return false
  }
}

export async function deleteOllamaModel(modelName: string): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/models`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName })
    })
    return r.ok
  } catch {
    return false
  }
}

export async function stopOllama(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/stop`, { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}

export async function fetchAllInstalledModels(): Promise<InstalledModel[]> {
  const base = await getBase()
  if (!base) return []
  try {
    const r = await fetch(`${base}/v1/ollama/installed-all`)
    if (!r.ok) return []
    const data = (await r.json()) as { models: InstalledModel[] }
    return data.models ?? []
  } catch {
    return []
  }
}

// ── Per-modality model routing ──

export async function fetchModalityModels(): Promise<Record<string, string>> {
  const base = await getBase()
  if (!base) return {}
  try {
    const r = await fetch(`${base}/v1/ollama/modality-models`)
    if (!r.ok) return {}
    const data = (await r.json()) as { models: Record<string, string> }
    return data.models ?? {}
  } catch {
    return {}
  }
}

export async function setModalityModel(
  modality: string,
  model: string
): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/modality-models`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modality, model })
    })
    return r.ok
  } catch {
    return false
  }
}

// ── Wikilinks / Graph ──

export interface BacklinkItem {
  slug: string
  title: string
  context: string | null
}

export async function fetchBacklinks(slug: string): Promise<BacklinkItem[]> {
  const base = await getBase()
  if (!base) return []
  try {
    const r = await fetch(`${base}/v1/links/backlinks?slug=${encodeURIComponent(slug)}`)
    if (!r.ok) return []
    const data = (await r.json()) as { backlinks: BacklinkItem[] }
    return data.backlinks ?? []
  } catch {
    return []
  }
}

export interface GraphNode {
  slug: string
  title: string
  type: string
  summary: string | null
  tags: string[]
}

export interface GraphEdge {
  source_slug: string
  target_slug: string
  context: string | null
}

export async function deletePage(slug: string): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    return r.ok
  } catch {
    return false
  }
}

export async function createLink(sourceSlug: string, targetSlug: string): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/links/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_slug: sourceSlug, target_slug: targetSlug })
    })
    return r.ok
  } catch {
    return false
  }
}

export async function fetchGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const base = await getBase()
  if (!base) return { nodes: [], edges: [] }
  try {
    const r = await fetch(`${base}/v1/links/graph`)
    if (!r.ok) return { nodes: [], edges: [] }
    return (await r.json()) as { nodes: GraphNode[]; edges: GraphEdge[] }
  } catch {
    return { nodes: [], edges: [] }
  }
}

// ── Search ──

export interface SearchResult {
  slug: string
  title: string
  type: string
  summary: string | null
  snippet: string | null
  rank: number
}

export async function searchNotes(query: string, limit = 20): Promise<SearchResult[]> {
  const base = await getBase()
  if (!base || !query.trim()) return []
  try {
    const r = await fetch(`${base}/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`)
    if (!r.ok) return []
    const data = await r.json() as { results: SearchResult[] }
    return data.results ?? []
  } catch {
    return []
  }
}

// ── Save page ──

export async function savePage(slug: string, body: string): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    })
    return r.ok
  } catch {
    return false
  }
}
