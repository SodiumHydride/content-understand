import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import type { LibraryItem } from '../stores/types'
import { normalizeShelfType, TYPE_STYLES, type ShelfType } from '../lib/contentMeta'
import { stickyRotation } from '../lib/stickyRotate'

export function StickyNoteCard({
  item,
  selected,
  onSelect
}: {
  item: LibraryItem
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const type = normalizeShelfType(String(item.type)) as ShelfType
  const style = TYPE_STYLES[type]
  const rot = stickyRotation(item.slug)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx('sticky-note', selected && 'sticky-note-selected')}
      style={
        {
          '--stick-rot': `${rot}deg`,
          '--stick-accent': style.accent,
          '--stick-soft': style.soft
        } as React.CSSProperties
      }
    >
      <span className="sticky-note-pin" aria-hidden />
      <h3 className="sticky-note-title">{item.title}</h3>
      {item.summary && <p className="sticky-note-summary">{item.summary}</p>}
      <span className="sticky-note-meta">{t(`nav.${type}`)}</span>
    </button>
  )
}
