import type { ContentType, LibraryItem, UnderstandTask } from '../stores/types'

export type ShelfType = 'video' | 'image' | 'audio' | 'article'

export const SHELF_ORDER: ShelfType[] = ['video', 'image', 'audio', 'article']

export const TYPE_STYLES: Record<
  ShelfType,
  { accent: string; soft: string; label: string }
> = {
  video: { accent: '#d49aaa', soft: '#faf4f6', label: 'video' },
  image: { accent: '#7eb89a', soft: '#f4faf7', label: 'image' },
  audio: { accent: '#d4b07a', soft: '#faf7f0', label: 'audio' },
  article: { accent: '#6a9ec4', soft: '#f2f7fb', label: 'article' }
}

export function normalizeShelfType(type: string): ShelfType {
  if (type === 'video' || type === 'image' || type === 'audio' || type === 'article') {
    return type
  }
  return 'article'
}

export function platformLabel(platform: string): string {
  const p = platform.toLowerCase()
  if (p.includes('bilibili') || p === 'b站') return 'Bilibili'
  if (p.includes('youtube')) return 'YouTube'
  if (p.includes('demo')) return 'Demo'
  if (!platform || platform === '—') return 'Web'
  return platform
}

export function groupLibraryByShelf(items: LibraryItem[]): Record<ShelfType, LibraryItem[]> {
  const groups: Record<ShelfType, LibraryItem[]> = {
    video: [],
    image: [],
    audio: [],
    article: []
  }
  for (const item of items) {
    groups[normalizeShelfType(String(item.type))].push(item)
  }
  for (const key of SHELF_ORDER) {
    groups[key].sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
  }
  return groups
}

export interface JournalGroup {
  dateKey: string
  label: string
  items: LibraryItem[]
}

export function groupLibraryByJournal(
  items: LibraryItem[],
  locale: string
): JournalGroup[] {
  const sorted = [...items].sort(
    (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
  )
  const map = new Map<string, LibraryItem[]>()
  for (const item of sorted) {
    const d = new Date(item.updated)
    const dateKey = d.toISOString().slice(0, 10)
    if (!map.has(dateKey)) map.set(dateKey, [])
    map.get(dateKey)!.push(item)
  }
  return [...map.entries()].map(([dateKey, groupItems]) => ({
    dateKey,
    label: formatJournalDate(dateKey, locale),
    items: groupItems
  }))
}

function formatJournalDate(dateKey: string, locale: string): string {
  const d = new Date(`${dateKey}T12:00:00`)
  const zh = locale.startsWith('zh')
  if (zh) {
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    })
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  })
}

export function detectPlatformHint(url: string): 'bilibili' | 'youtube' | 'article' | null {
  const u = url.toLowerCase()
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (u.startsWith('http')) return 'article'
  return null
}

export const PLATFORM_QUICK: Record<
  'bilibili' | 'youtube' | 'article',
  { prefix: string; placeholder: string }
> = {
  bilibili: {
    prefix: 'https://www.bilibili.com/video/',
    placeholder: 'BV… 或 av…'
  },
  youtube: {
    prefix: 'https://www.youtube.com/watch?v=',
    placeholder: 'video id'
  },
  article: {
    prefix: 'https://',
    placeholder: 'article-url'
  }
}

export function parseNoteSections(body: string): {
  preamble: string
  sections: { title: string; content: string }[]
} {
  const chunks = body.split(/^##\s+/m)
  const preamble = chunks[0]
    .replace(/^#\s+.+\n?/m, '')
    .trim()
  const sections = chunks
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf('\n')
      const title = nl === -1 ? chunk.trim() : chunk.slice(0, nl).trim()
      const content = nl === -1 ? '' : chunk.slice(nl + 1).trim()
      return { title, content }
    })
    .filter((s) => s.title)
  return { preamble, sections }
}

export function mergeTimelineEntries(
  library: LibraryItem[],
  tasks: UnderstandTask[]
): Array<
  | { kind: 'note'; item: LibraryItem; at: string }
  | { kind: 'task'; task: UnderstandTask; at: string }
> {
  const notes = library.map((item) => ({
    kind: 'note' as const,
    item,
    at: item.updated
  }))
  const running = tasks
    .filter((t) => t.status === 'processing')
    .map((task) => ({
      kind: 'task' as const,
      task,
      at: task.createdAt
    }))
  return [...running, ...notes].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  )
}
