/**
 * Advanced search query parser.
 *
 * Syntax:
 *   tag:技术              Filter by tag
 *   type:video            Filter by content type
 *   created:2024-01       Filter by creation date (prefix match)
 *   has:link              Has outgoing wikilinks
 *   has:backlink          Has incoming backlinks
 *   orphan:true           No links at all
 *   "exact phrase"        Exact phrase match
 *   plain text            Free-text search
 *
 * Filters are combined with AND.  Multiple values for the same key
 * (e.g. tag:a tag:b) are ORed within that key.
 */

export interface SearchFilters {
  tags?: string[]
  types?: string[]
  createdPrefix?: string
  hasLink?: boolean
  hasBacklink?: boolean
  orphan?: boolean
  exactPhrases?: string[]
  freeText?: string
}

export interface ParsedSearchQuery {
  filters: SearchFilters
  /** The raw query string. */
  raw: string
  /** True when at least one filter is active (not just free text). */
  hasFilters: boolean
}

/** Recognised filter key names. */
const FILTER_KEYS = new Set(['tag', 'type', 'created', 'has', 'orphan'])

const FILTER_RE = /(tag|type|created|has|orphan):(\S+)/gi
const QUOTED_RE = /"([^"]+)"/g

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const filters: SearchFilters = {}
  let remaining = query

  // 1. Extract quoted phrases
  const phrases: string[] = []
  let m: RegExpExecArray | null
  while ((m = QUOTED_RE.exec(remaining)) !== null) {
    phrases.push(m[1])
  }
  remaining = remaining.replace(QUOTED_RE, '')
  if (phrases.length > 0) filters.exactPhrases = phrases

  // 2. Extract key:value filters
  FILTER_RE.lastIndex = 0
  while ((m = FILTER_RE.exec(remaining)) !== null) {
    const key = m[1].toLowerCase()
    const val = m[2].toLowerCase()

    if (key === 'tag') {
      filters.tags = filters.tags ?? []
      filters.tags.push(val)
    } else if (key === 'type') {
      filters.types = filters.types ?? []
      filters.types.push(val)
    } else if (key === 'created') {
      filters.createdPrefix = val
    } else if (key === 'has') {
      if (val === 'link') filters.hasLink = true
      else if (val === 'backlink') filters.hasBacklink = true
    } else if (key === 'orphan') {
      filters.orphan = val === 'true' || val === '1' || val === 'yes'
    }
  }
  remaining = remaining.replace(FILTER_RE, '')

  // 3. Remaining free text
  const free = remaining.trim()
  if (free) filters.freeText = free

  const hasFilters = !!(
    filters.tags?.length ||
    filters.types?.length ||
    filters.createdPrefix ||
    filters.hasLink !== undefined ||
    filters.hasBacklink !== undefined ||
    filters.orphan !== undefined ||
    filters.exactPhrases?.length
  )

  return { filters, raw: query, hasFilters }
}

/**
 * Serialise filters back into a query string (for display / round-trip).
 */
export function filtersToQueryString(filters: SearchFilters): string {
  const parts: string[] = []

  for (const tag of filters.tags ?? []) parts.push(`tag:${tag}`)
  for (const t of filters.types ?? []) parts.push(`type:${t}`)
  if (filters.createdPrefix) parts.push(`created:${filters.createdPrefix}`)
  if (filters.hasLink) parts.push('has:link')
  if (filters.hasBacklink) parts.push('has:backlink')
  if (filters.orphan) parts.push('orphan:true')
  for (const p of filters.exactPhrases ?? []) parts.push(`"${p}"`)
  if (filters.freeText) parts.push(filters.freeText)

  return parts.join(' ')
}

/**
 * Remove a single filter value from the raw query string.
 * Used when clicking a chip's "x" button.
 */
export function removeFilterFromQuery(raw: string, key: string, value?: string): string {
  if (key === 'exactPhrase' && value) {
    return raw.replace(`"${value}"`, '').replace(/\s{2,}/g, ' ').trim()
  }
  if (key === 'freeText') {
    return raw.replace(value ?? '', '').replace(/\s{2,}/g, ' ').trim()
  }
  // For key:value filters
  const pattern = value ? `${key}:${value}` : `${key}:\\S+`
  const re = new RegExp(pattern, 'gi')
  return raw.replace(re, '').replace(/\s{2,}/g, ' ').trim()
}
