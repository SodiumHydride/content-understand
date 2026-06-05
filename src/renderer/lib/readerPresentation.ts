import type { MapMode, ViewMode } from '../stores/types'

export type ReaderPresentation = 'sidebar' | 'center' | 'overlay'

/** How the note reader is shown — derived from view + map mode (see docs/COMPETITOR-READING-UX.md). */
export function getReaderPresentation(
  viewMode: ViewMode,
  mapMode: MapMode
): ReaderPresentation {
  if (viewMode === 'journal') return 'sidebar'
  if (viewMode === 'map' && mapMode === 'wiki') return 'center'
  if (viewMode === 'vault' || viewMode === 'map') return 'overlay'
  return 'sidebar'
}
