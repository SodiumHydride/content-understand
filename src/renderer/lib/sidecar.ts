import type { AppSettings, LibraryItem, TaskProgress } from '../stores/types'
import type { ThinkingStrokeElement } from './thinkingCanvas/types'

let baseUrl: string | null = null

function invalidateBase() {
  baseUrl = null
}

async function getBase(): Promise<string | null> {
  if (baseUrl) return baseUrl
  try {
    baseUrl = await window.api.getSidecarBase()
    console.log('[sidecar] getBase resolved:', baseUrl)
    return baseUrl
  } catch (e) {
    console.error('[sidecar] getBase failed:', e)
    invalidateBase()
    return null
  }
}

/** Public accessor for the cached sidecar base URL (may be null if never resolved). */
export function getCachedSidecarBase(): string | null {
  return baseUrl
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
    invalidateBase()
    return false
  }
}

export async function fetchLibrary(): Promise<LibraryItem[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/library`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { items: LibraryItem[] }
    return data.items ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export async function fetchPage(slug: string): Promise<LibraryItem | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return (await r.json()) as LibraryItem
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!r.ok) {
      let detail = ""
      try { const d = await r.json(); detail = d.detail || d.error || "" } catch { /* ignore */ }
      throw new Error(detail || "Ingest failed (" + r.status + ")")
    }
    const data = (await r.json()) as { job_id: string }
    return data.job_id
  } catch (e) {
    invalidateBase()
    throw e instanceof Error ? e : new Error(String(e))
  }
}

export async function pollJob(
  jobId: string,
  onProgress: (p: TaskProgress) => void,
  signal?: AbortSignal
): Promise<string | null> {
  const base = await getBase()
  if (!base) return null

  const INITIAL_DELAY = 500
  const MAX_DELAY = 5_000
  const BACKOFF_FACTOR = 1.5
  const MAX_DURATION = 17 * 60 * 1000

  let delay = INITIAL_DELAY
  const deadline = Date.now() + MAX_DURATION

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('aborted')
    const r = await fetch(`${base}/v1/jobs/${jobId}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`job poll failed (HTTP ${r.status})`)
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
    await fetch(`${base}/v1/index/rebuild`, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  } catch {
    invalidateBase()
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
}): Promise<LogEntry[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.level) params.set('level', opts.level)
    if (opts?.jobId) params.set('job_id', opts.jobId)
    const q = params.toString()
    const r = await fetch(`${base}/v1/logs${q ? `?${q}` : ''}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { entries: LogEntry[] }
    return data.entries ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export async function pushConfig(settings: AppSettings): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ provider: providerId, base_url: baseUrl, api_key: apiKey }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!r.ok) return null
    const data = (await r.json()) as { models: string[] }
    return data.models ?? null
  } catch {
    invalidateBase()
    return null
  }
}

interface HardwareInfo { gpu?: string; ram?: string; [key: string]: unknown }
interface PresetInfo { id: string; name: string; [key: string]: unknown }

export interface RuntimeRecommend {
  hardware: HardwareInfo
  recommended_preset_id: string
  preset: PresetInfo
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
    const r = await fetch(`${base}/v1/runtime/recommend`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return (await r.json()) as RuntimeRecommend
  } catch {
    invalidateBase()
    return null
  }
}

export async function fetchRuntimeStatus(): Promise<RuntimeStatus | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/runtime/status`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return (await r.json()) as RuntimeStatus
  } catch {
    invalidateBase()
    return null
  }
}

export async function fetchPresets(): Promise<RuntimePreset[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/runtime/presets`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { presets: RuntimePreset[] }
    return data.presets ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export async function startRuntimeSetup(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/runtime/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

export interface RuntimeAutoDetect {
  backend: string | null
  url: string | null
  state: string
  source?: 'app' | 'user' | null
  preset?: string | null
  hardware?: HardwareInfo | null
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
      }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!r.ok) return null
    return (await r.json()) as RuntimeAutoDetect
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ browser }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` }
    }
    return (await r.json()) as CookiesExportResult
  } catch {
    invalidateBase()
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
    const r = await fetch(`${base}/v1/ollama/catalog`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return (await r.json()) as OllamaCatalog
  } catch {
    invalidateBase()
    return null
  }
}

export async function fetchOllamaStatus(): Promise<OllamaStatus | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/ollama/status`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return (await r.json()) as OllamaStatus
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(10_000)
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
    invalidateBase()
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
      body: JSON.stringify({ prefer_user: preferUser }),
      signal: AbortSignal.timeout(10_000)
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
    invalidateBase()
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function uninstallAppOllama(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/uninstall-app`, { method: 'POST', signal: AbortSignal.timeout(10_000) })
    return r.ok
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ preset_id: presetId }),
      signal: AbortSignal.timeout(10_000)
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
    invalidateBase()
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
      body: JSON.stringify({ preset_id: presetId }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

export async function stopOllama(): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/ollama/stop`, { method: 'POST', signal: AbortSignal.timeout(10_000) })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

export async function fetchAllInstalledModels(): Promise<InstalledModel[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/ollama/installed-all`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { models: InstalledModel[] }
    return data.models ?? []
  } catch {
    invalidateBase()
    return null
  }
}

// ── Per-modality model routing ──

export async function fetchModalityModels(): Promise<Record<string, string>> {
  const base = await getBase()
  if (!base) return {}
  try {
    const r = await fetch(`${base}/v1/ollama/modality-models`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return {}
    const data = (await r.json()) as { models: Record<string, string> }
    return data.models ?? {}
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ modality, model }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

// ── Wikilinks / Graph ──

export interface BacklinkItem {
  slug: string
  title: string
  context: string | null
}

export async function fetchBacklinks(slug: string): Promise<BacklinkItem[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/links/backlinks?slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { backlinks: BacklinkItem[] }
    return data.backlinks ?? []
  } catch {
    invalidateBase()
    return null
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
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
    return r.ok
  } catch {
    invalidateBase()
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
      body: JSON.stringify({ source_slug: sourceSlug, target_slug: targetSlug }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

export async function fetchGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/links/graph`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return (await r.json()) as { nodes: GraphNode[]; edges: GraphEdge[] }
  } catch {
    invalidateBase()
    return null
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

export interface SearchResponse {
  results: SearchResult[]
  filters: Record<string, unknown>
}

export async function searchNotes(query: string, limit = 20): Promise<SearchResult[] | null> {
  const base = await getBase()
  if (!base) return null
  if (!query.trim()) return []
  try {
    const r = await fetch(`${base}/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = await r.json() as SearchResponse
    return data.results ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export async function searchNotesWithFilters(query: string, limit = 20): Promise<SearchResponse | null> {
  const base = await getBase()
  if (!base) return null
  if (!query.trim()) return { results: [], filters: {} }
  try {
    const r = await fetch(`${base}/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return await r.json() as SearchResponse
  } catch {
    invalidateBase()
    return null
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
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

export async function fetchNoteInk(slug: string): Promise<ThinkingStrokeElement[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}/ink`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = await r.json() as { strokes: ThinkingStrokeElement[] }
    return data.strokes ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export async function saveNoteInk(slug: string, strokes: ThinkingStrokeElement[]): Promise<boolean> {
  const base = await getBase()
  if (!base) return false
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}/ink`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes }),
      signal: AbortSignal.timeout(10_000)
    })
    return r.ok
  } catch {
    invalidateBase()
    return false
  }
}

export interface PageHistoryVersion {
  timestamp: number
  formatted_time: string
  size: number
}

export async function fetchPageHistory(slug: string): Promise<PageHistoryVersion[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}/history`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { versions: PageHistoryVersion[] }
    return data.versions ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export async function fetchPageHistoryVersion(slug: string, timestamp: number): Promise<string | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}/history/${timestamp}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { body: string }
    return data.body ?? null
  } catch {
    invalidateBase()
    return null
  }
}

export interface RecommendationItem {
  slug: string
  title: string
  score: number
  reason: string
}

export async function fetchPageRecommendations(slug: string, limit = 5): Promise<RecommendationItem[] | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}/recommendations?limit=${limit}`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const data = (await r.json()) as { recommendations: RecommendationItem[] }
    return data.recommendations ?? []
  } catch {
    invalidateBase()
    return null
  }
}

export interface QAHistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

export interface QASourceItem {
  slug: string
  title: string
  type: string
  summary: string | null
}

export interface QAResponse {
  answer: string
  sources: QASourceItem[]
}

export async function askVault(question: string, history: QAHistoryEntry[]): Promise<QAResponse | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
      signal: AbortSignal.timeout(65_000)
    })
    if (!r.ok) return null
    return (await r.json()) as QAResponse
  } catch {
    invalidateBase()
    return null
  }
}

