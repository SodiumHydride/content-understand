import type { ThinkingCanvasDocument } from './types'

async function getBase(): Promise<string | null> {
  try {
    return await window.api.getSidecarBase()
  } catch {
    return null
  }
}

export async function fetchThinkingCanvas(): Promise<ThinkingCanvasDocument | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/thinking-canvas`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    return (await r.json()) as ThinkingCanvasDocument
  } catch {
    return null
  }
}

export async function saveThinkingCanvas(
  doc: ThinkingCanvasDocument
): Promise<ThinkingCanvasDocument | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/v1/thinking-canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(15000)
    })
    if (!r.ok) return null
    return (await r.json()) as ThinkingCanvasDocument
  } catch {
    return null
  }
}

export async function uploadCanvasAsset(
  blob: Blob,
  mimeType: string,
  name?: string
): Promise<{ assetId: string; mimeType: string } | null> {
  const base = await getBase()
  if (!base) return null
  try {
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    const data = btoa(binary)
    const r = await fetch(`${base}/v1/thinking-canvas/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, mimeType, name: name ?? '' }),
      signal: AbortSignal.timeout(30000)
    })
    if (!r.ok) return null
    return (await r.json()) as { assetId: string; mimeType: string }
  } catch {
    return null
  }
}

export function canvasAssetUrl(base: string, assetId: string): string {
  return `${base}/v1/thinking-canvas/assets/${encodeURIComponent(assetId)}`
}
