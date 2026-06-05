import type { LibraryItem } from '../stores/types'

export function filterLibraryItems(library: LibraryItem[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return library
  return library.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      item.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}

export function libraryItemMatchesQuery(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return filterLibraryItems([item], q).length > 0
}
