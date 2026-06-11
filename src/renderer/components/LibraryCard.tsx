import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import type { LibraryItem } from '../stores/types'
import {
  normalizeShelfType,
  platformLabel,
  TYPE_STYLES,
  type ShelfType
} from '../lib/contentMeta'

dayjs.extend(relativeTime)

export function LibraryCard({
  item,
  selected,
  onSelect,
  showPath = true,
  layout = 'grid'
}: {
  item: LibraryItem
  selected: boolean
  onSelect: () => void
  showPath?: boolean
  layout?: 'grid' | 'timeline'
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const type = normalizeShelfType(String(item.type)) as ShelfType
  const style = TYPE_STYLES[type]
  const locale = i18n.language.startsWith('zh') ? 'zh-cn' : 'en'

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'lib-card',
        selected && 'lib-card-selected',
        layout === 'timeline' && 'lib-card-timeline'
      )}
      style={{ ['--lib-accent' as string]: style.accent }}
    >
      <div className="lib-card-title">{item.title}</div>
      {item.summary && <p className="lib-card-summary">{item.summary}</p>}
      <div className="lib-card-meta">
        <span className="type-dot" style={{ background: style.accent }} aria-hidden />
        <span className="lib-card-platform" style={{ color: style.accent }}>
          {platformLabel(item.platform)}
        </span>
        <span aria-hidden>·</span>
        <span>{t(`nav.${type}`)}</span>
        <span aria-hidden>·</span>
        <span>{item.updated ? dayjs(item.updated).locale(locale).fromNow() : ''}</span>
      </div>
      {showPath && <div className="lib-card-path">{item.path}</div>}
    </button>
  )
}
