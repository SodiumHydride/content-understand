import type { LibraryItem, TaskProgress } from '../stores/types'

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
  const r = await fetch(`${base}/v1/library`)
  if (!r.ok) return []
  const data = (await r.json()) as { items: LibraryItem[] }
  return data.items ?? []
}

export async function fetchPage(slug: string): Promise<LibraryItem | null> {
  const base = await getBase()
  if (!base) return null
  const r = await fetch(`${base}/v1/pages/${encodeURIComponent(slug)}`)
  if (!r.ok) return null
  return (await r.json()) as LibraryItem
}

export async function startIngest(url: string): Promise<string | null> {
  const base = await getBase()
  if (!base) return null
  const r = await fetch(`${base}/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  if (!r.ok) return null
  const data = (await r.json()) as { job_id: string }
  return data.job_id
}

export async function pollJob(
  jobId: string,
  onProgress: (p: TaskProgress) => void
): Promise<void> {
  const base = await getBase()
  if (!base) return

  for (let i = 0; i < 600; i++) {
    const r = await fetch(`${base}/v1/jobs/${jobId}`)
    if (!r.ok) throw new Error('job poll failed')
    const data = (await r.json()) as {
      status: string
      progress?: TaskProgress
      error?: string
    }
    if (data.progress) onProgress(data.progress)
    if (data.status === 'completed') return
    if (data.status === 'failed') throw new Error(data.error || 'failed')
    await new Promise((res) => setTimeout(res, 1000))
  }
  throw new Error('timeout')
}

export async function rebuildIndex(): Promise<void> {
  const base = await getBase()
  if (!base) return
  await fetch(`${base}/v1/index/rebuild`, { method: 'POST' })
}
