import type { MapNodePos } from '../stores/types'

export function defaultGridLayout(
  slugs: string[],
  cellW = 196,
  cellH = 132,
  cols = 4
): Record<string, MapNodePos> {
  const out: Record<string, MapNodePos> = {}
  slugs.forEach((slug, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    out[slug] = { x: 48 + col * cellW, y: 48 + row * cellH }
  })
  return out
}

export function mergeMapLayout(
  slugs: string[],
  saved: Record<string, MapNodePos>,
  cellW = 196,
  cellH = 132
): Record<string, MapNodePos> {
  const defaults = defaultGridLayout(slugs, cellW, cellH)
  const out: Record<string, MapNodePos> = { ...defaults }
  for (const slug of slugs) {
    if (saved[slug]) out[slug] = saved[slug]
  }
  return out
}
