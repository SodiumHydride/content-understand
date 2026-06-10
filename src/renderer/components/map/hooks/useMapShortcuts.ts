import { useMemo } from 'react'
import { useShortcuts } from '../../../hooks/useShortcuts'
import type { MapMode } from '../../../stores/types'

/** Return type of useThinkingCanvasInput — avoids circular import. */
type CanvasInput = {
  tool: string
  editingTextId: string | null
  selectedIds: string[]
  setTool: (tool: string) => void
  cancelTextEdit: () => void
  deleteSelected: () => void
}

export function useMapShortcuts(opts: {
  viewMode: string
  mapMode: MapMode
  canvasInput: CanvasInput
  linkingFrom: string | null
  setLinkingFrom: (v: string | null) => void
  readerOpen: boolean
  closeReader: () => void
  selectedSlug: string | null
  selectItem: (slug: string | null, opts?: { reader?: boolean }) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}): void {
  const {
    viewMode,
    mapMode,
    canvasInput,
    linkingFrom,
    setLinkingFrom,
    readerOpen,
    closeReader,
    selectedSlug,
    selectItem,
    fileInputRef
  } = opts

  // Thinking canvas tool shortcuts
  const thinkingToolDefs = useMemo(() => {
    if (viewMode !== 'map' || mapMode !== 'thinking') return []
    return [
      {
        id: 'map.escape',
        key: 'Escape',
        scope: 'map' as const,
        description: 'shortcuts.mapEscape',
        action: () => {
          if (canvasInput.editingTextId) canvasInput.cancelTextEdit()
          else if (linkingFrom) setLinkingFrom(null)
          else if (readerOpen) closeReader()
          else if (selectedSlug) selectItem(null)
        }
      },
      {
        id: 'map.delete',
        key: 'Delete',
        scope: 'map' as const,
        description: 'shortcuts.mapDelete',
        action: () => { if (canvasInput.selectedIds.length > 0) canvasInput.deleteSelected() }
      },
      {
        id: 'map.toolSelect',
        key: 'v',
        scope: 'map' as const,
        description: 'shortcuts.mapToolSelect',
        action: () => canvasInput.setTool('select')
      },
      {
        id: 'map.toolText',
        key: 't',
        scope: 'map' as const,
        description: 'shortcuts.mapToolText',
        action: () => canvasInput.setTool('text')
      },
      {
        id: 'map.toolPen',
        key: 'p',
        scope: 'map' as const,
        description: 'shortcuts.mapToolPen',
        action: () => canvasInput.setTool('pen')
      },
      {
        id: 'map.toolHighlighter',
        key: 'h',
        scope: 'map' as const,
        description: 'shortcuts.mapToolHighlighter',
        action: () => canvasInput.setTool('highlighter')
      },
      {
        id: 'map.toolEraser',
        key: 'e',
        scope: 'map' as const,
        description: 'shortcuts.mapToolEraser',
        action: () => canvasInput.setTool('eraser')
      },
      {
        id: 'map.toolImage',
        key: 'i',
        scope: 'map' as const,
        description: 'shortcuts.mapToolImage',
        action: () => { canvasInput.setTool('image'); fileInputRef.current?.click() }
      }
    ]
  }, [viewMode, mapMode, canvasInput, linkingFrom, readerOpen, selectedSlug, closeReader, selectItem, fileInputRef])

  useShortcuts(thinkingToolDefs, thinkingToolDefs)

  // Map-level escape when not in thinking mode
  const mapEscapeDefs = useMemo(() => {
    if (viewMode !== 'map') return []
    return [
      {
        id: 'map.escapeGlobal',
        key: 'Escape',
        scope: 'map' as const,
        description: 'shortcuts.mapEscape',
        action: () => {
          if (linkingFrom) setLinkingFrom(null)
          else if (readerOpen) closeReader()
          else if (selectedSlug) selectItem(null)
        }
      }
    ]
  }, [viewMode, readerOpen, selectedSlug, closeReader, selectItem, linkingFrom])

  useShortcuts(mapEscapeDefs, mapEscapeDefs)
}
