import { sortByZIndex } from '../../lib/thinkingCanvas/document'
import type { ThinkingCanvasDocument } from '../../lib/thinkingCanvas/types'
import { ThinkingCanvasImage } from './ThinkingCanvasImage'
import { ThinkingCanvasInk } from './ThinkingCanvasInk'
import { ThinkingCanvasText } from './ThinkingCanvasText'

export function ThinkingCanvasLayer({
  document,
  activeStroke,
  editingTextId,
  selectedIds,
  tool,
  onStartTextEdit,
  onCommitText,
  onCancelText,
  onTextDragStart,
  onImageDragStart,
  onTextContextMenu,
  onImageContextMenu
}: {
  document: ThinkingCanvasDocument
  activeStroke: import('../../lib/thinkingCanvas/types').ThinkingStrokeElement | null
  editingTextId: string | null
  selectedIds: string[]
  tool: import('../../lib/thinkingCanvas/types').ThinkingTool
  onStartTextEdit: (id: string) => void
  onCommitText: (id: string, text: string) => void
  onCancelText: () => void
  onTextDragStart: (e: React.PointerEvent, id: string, x: number, y: number) => void
  onImageDragStart: (e: React.PointerEvent, id: string, x: number, y: number) => void
  onTextContextMenu: (e: React.MouseEvent, id: string) => void
  onImageContextMenu: (e: React.MouseEvent, id: string) => void
}): React.JSX.Element {
  const strokes = document.elements.filter((e) => e.kind === 'stroke')
  const sorted = sortByZIndex(document.elements.filter((e) => e.kind !== 'stroke'))

  return (
    <>
      <ThinkingCanvasInk strokes={strokes} activeStroke={activeStroke} />
      {sorted.map((el) => {
        if (el.kind === 'text') {
          return (
            <ThinkingCanvasText
              key={el.id}
              element={el}
              editing={editingTextId === el.id}
              selected={selectedIds.includes(el.id)}
              dragging={false}
              draggable={tool === 'select'}
              clickToEdit={tool === 'text'}
              onStartEdit={() => onStartTextEdit(el.id)}
              onCommit={(text) => onCommitText(el.id, text)}
              onCancel={onCancelText}
              onDragStart={(e) => onTextDragStart(e, el.id, el.x, el.y)}
              onContextMenu={(e) => onTextContextMenu(e, el.id)}
            />
          )
        }
        if (el.kind === 'image') {
          return (
            <ThinkingCanvasImage
              key={el.id}
              element={el}
              selected={selectedIds.includes(el.id)}
              dragging={false}
              onDragStart={(e) => onImageDragStart(e, el.id, el.x, el.y)}
              onContextMenu={(e) => onImageContextMenu(e, el.id)}
            />
          )
        }
        return null
      })}
    </>
  )
}
