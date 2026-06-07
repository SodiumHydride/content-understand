import type { MapMode, ViewMode } from '../stores/types'

export type ReaderPresentation = 'sidebar' | 'center' | 'overlay'

/** How the note reader is shown — derived from view + map mode (see docs/COMPETITOR-READING-UX.md). */
export function getReaderPresentation(
  viewMode: ViewMode,
  mapMode: MapMode
): ReaderPresentation {
  if (viewMode === 'journal') return 'sidebar'
  // Map and vault views use centered modal for comfortable reading
  if (viewMode === 'map' || viewMode === 'vault') return 'center'
  return 'sidebar'
}
