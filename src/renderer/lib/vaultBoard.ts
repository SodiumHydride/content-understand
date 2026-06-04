/** Sticky note footprint on the vault board (px, matches CSS). */
export const VAULT_NOTE_W = 180
export const VAULT_NOTE_H = 152

export type VaultNoteSlice = {
  x: number
  y: number
  kind: 'body' | 'wrap'
}

function intersectsBoard(x: number, y: number, boardW: number, boardH: number): boolean {
  return (
    x + VAULT_NOTE_W > 0 && x < boardW && y + VAULT_NOTE_H > 0 && y < boardH
  )
}

/** Canonical position on the torus (full board period). */
export function wrapVaultPos(
  x: number,
  y: number,
  boardW: number,
  boardH: number
): { x: number; y: number } {
  if (boardW <= 0 || boardH <= 0) return { x: 0, y: 0 }
  return {
    x: ((Math.round(x) % boardW) + boardW) % boardW,
    y: ((Math.round(y) % boardH) + boardH) % boardH
  }
}

/**
 * Toroidal wrap — when a note crosses an edge, its other half appears on the opposite side.
 * No portal FX; just continuous visibility on the looped board.
 */
export function getVaultWrapSlices(
  x: number,
  y: number,
  boardW: number,
  boardH: number
): VaultNoteSlice[] {
  const slices: VaultNoteSlice[] = []
  const seen = new Set<string>()

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const px = x + dx * boardW
      const py = y + dy * boardH
      if (!intersectsBoard(px, py, boardW, boardH)) continue
      const key = `${Math.round(px)}:${Math.round(py)}`
      if (seen.has(key)) continue
      seen.add(key)
      slices.push({
        x: px,
        y: py,
        kind: dx === 0 && dy === 0 ? 'body' : 'wrap'
      })
    }
  }

  if (slices.length === 0) {
    const w = wrapVaultPos(x, y, boardW, boardH)
    return [{ x: w.x, y: w.y, kind: 'body' }]
  }

  return slices
}

export function defaultVaultLayout(
  slugs: string[],
  boardW: number,
  boardH: number,
  cellW = 200,
  cellH = 168
): Record<string, { x: number; y: number }> {
  const pad = 32
  const cols = Math.max(1, Math.floor((boardW - pad * 2) / cellW))
  const out: Record<string, { x: number; y: number }> = {}
  slugs.forEach((slug, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const raw = {
      x: pad + col * cellW,
      y: pad + row * cellH
    }
    out[slug] = wrapVaultPos(raw.x, raw.y, boardW, boardH)
  })
  return out
}

export function mergeVaultLayout(
  slugs: string[],
  saved: Record<string, { x: number; y: number }>,
  boardW: number,
  boardH: number
): Record<string, { x: number; y: number }> {
  const defaults = defaultVaultLayout(slugs, boardW, boardH)
  const out: Record<string, { x: number; y: number }> = {}
  for (const slug of slugs) {
    const raw = saved[slug] ?? defaults[slug] ?? { x: 32, y: 32 }
    out[slug] = wrapVaultPos(raw.x, raw.y, boardW, boardH)
  }
  return out
}
