// Regex matching [[target]] and [[target|display]]
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:\|([^\]]+))?\]\]/g

export interface WikilinkMatch {
  raw: string        // full [[...]] string
  target: string     // the link target (before |)
  display: string    // display text (after |, or same as target)
  start: number      // index in the original text
  end: number        // index in the original text
}

/** Extract all [[wikilinks]] from a text string */
export function parseWikilinks(text: string): WikilinkMatch[] {
  const matches: WikilinkMatch[] = []
  // Reset regex lastIndex for safety
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const target = m[1].trim()
    matches.push({
      raw: m[0],
      target,
      display: m[2] != null ? m[2].trim() : target,
      start: m.index,
      end: m.index + m[0].length
    })
  }
  return matches
}

/**
 * Given a list of library items (with slug + title), resolve a wikilink target
 * to a slug. Match by title (case-insensitive) first, then by slug.
 */
export function resolveWikilinkTarget(
  target: string,
  library: Array<{ slug: string; title?: string }>
): string | null {
  const lower = target.toLowerCase()

  // 1. Match by title (case-insensitive)
  for (const item of library) {
    if (item.title && item.title.toLowerCase() === lower) {
      return item.slug
    }
  }

  // 2. Match by slug (case-insensitive)
  for (const item of library) {
    if (item.slug.toLowerCase() === lower) {
      return item.slug
    }
  }

  return null
}

/** Split text into segments: plain text and wikilink segments */
export function splitTextWithWikilinks(text: string): Array<
  | { kind: 'text'; value: string }
  | { kind: 'wikilink'; raw: string; target: string; display: string }
> {
  const segments: Array<
    | { kind: 'text'; value: string }
    | { kind: 'wikilink'; raw: string; target: string; display: string }
  > = []

  let lastIndex = 0
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    // Push preceding plain text if any
    if (m.index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, m.index) })
    }
    const target = m[1].trim()
    segments.push({
      kind: 'wikilink',
      raw: m[0],
      target,
      display: m[2] != null ? m[2].trim() : target
    })
    lastIndex = m.index + m[0].length
  }

  // Push trailing plain text if any
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) })
  }

  return segments
}
