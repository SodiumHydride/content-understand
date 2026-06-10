import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu'
import { createTextElement, removeElements } from '../../lib/thinkingCanvas/document'
import type { ThinkingCanvasDocument, ThinkingTool, ThinkingToolPreferences } from '../../lib/thinkingCanvas/types'

export type MapMenuState = {
  x: number
  y: number
  canvasX: number
  canvasY: number
  target: 'canvas' | 'note' | 'text' | 'image'
  slug?: string
  elementId?: string
}

export type MapContextMenuProps = {
  menu: MapMenuState | null
  onClose: () => void
  mapMode: 'thinking' | 'wiki'
  selectedSlug: string | null
  wikiPinnedSlugs: string[]
  toggleWikiPin: (slug: string) => void
  selectItem: (slug: string | null, opts?: { reader?: boolean }) => void
  setLinkingFrom: (slug: string | null) => void
  canvasInput: {
    setEditingTextId: (id: string) => void
    setTool: (tool: ThinkingTool) => void
  }
  patchThinkingCanvas: (fn: (doc: ThinkingCanvasDocument) => ThinkingCanvasDocument) => void
  thinkingToolPrefs: ThinkingToolPreferences
  deletePage: (slug: string) => Promise<boolean>
  queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => void }
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function MapContextMenu({
  menu,
  onClose,
  mapMode,
  selectedSlug,
  wikiPinnedSlugs,
  toggleWikiPin,
  selectItem,
  setLinkingFrom,
  canvasInput,
  patchThinkingCanvas,
  thinkingToolPrefs,
  deletePage,
  queryClient,
  fileInputRef
}: MapContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()

  const menuItems = useMemo((): ContextMenuEntry[] => {
    if (!menu) return []

    if ((menu.target === 'text' || menu.target === 'image') && menu.elementId) {
      const id = menu.elementId
      return [
        {
          kind: 'item',
          label: menu.target === 'text' ? t('map.menu.editText') : t('map.menu.replaceImage'),
          onSelect: () => {
            if (menu.target === 'text') canvasInput.setEditingTextId(id)
            else fileInputRef.current?.click()
          }
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('map.menu.deleteElement'),
          onSelect: () => patchThinkingCanvas((doc) => removeElements(doc, new Set([id])))
        }
      ]
    }

    if (menu.target === 'note' && menu.slug) {
      const slug = menu.slug
      const isWikiPinned = wikiPinnedSlugs.includes(slug)
      const items: ContextMenuEntry[] = [
        {
          kind: 'item',
          label: t('map.menu.readNote'),
          onSelect: () => selectItem(slug, { reader: true })
        }
      ]
      if (mapMode === 'wiki') {
        items.push({
          kind: 'item',
          label: t('map.menu.linkNotes'),
          onSelect: () => setLinkingFrom(slug)
        })
      }
      if (mapMode === 'wiki') {
        items.push({
          kind: 'item',
          label: isWikiPinned ? t('map.menu.unpinNote') : t('map.menu.pinNote'),
          onSelect: () => toggleWikiPin(slug)
        })
      }
      items.push({ kind: 'separator' })
      items.push({
        kind: 'item',
        label: t('note.delete'),
        onSelect: () => {
          if (window.confirm(t('note.deleteConfirm'))) {
            void deletePage(slug).then((ok) => {
              if (ok) {
                void queryClient.invalidateQueries({ queryKey: ['wiki-graph'] })
              }
            })
          }
        }
      })
      return items
    }

    if (mapMode === 'wiki') {
      return [
        { kind: 'label', label: t('map.menu.wikiCanvasLabel') },
        {
          kind: 'item',
          label: t('map.menu.linkNotes'),
          onSelect: () => {
            const source = menu.slug ?? selectedSlug
            if (source) setLinkingFrom(source)
          }
        }
      ]
    }

    return [
      {
        kind: 'item',
        label: t('map.menu.addTextHere'),
        onSelect: () => {
          canvasInput.setTool('text')
          patchThinkingCanvas((doc) => {
            const result = createTextElement(doc, menu.canvasX, menu.canvasY, '', thinkingToolPrefs.text)
            canvasInput.setEditingTextId(result.element.id)
            return result.doc
          })
        }
      }
    ]
  }, [menu, mapMode, t, selectItem, canvasInput, patchThinkingCanvas, thinkingToolPrefs.text, wikiPinnedSlugs, toggleWikiPin, selectedSlug, deletePage, queryClient, fileInputRef])

  if (!menu || menuItems.length === 0) return null
  return <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={onClose} />
}
