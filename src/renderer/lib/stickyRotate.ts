/** Stable slight rotation per slug for sticky-note wall. */
export function stickyRotation(slug: string): number {
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash << 5) - hash + slug.charCodeAt(i)
    hash |= 0
  }
  return ((hash % 7) - 3) * 0.65
}
