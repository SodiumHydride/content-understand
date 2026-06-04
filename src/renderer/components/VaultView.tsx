import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { StickyNoteCard } from './StickyNoteCard'
import { EmptyState } from './EmptyState'

export function VaultView(): React.JSX.Element {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const pinnedSlugs = useAppStore((s) => s.pinnedSlugs)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)

  const pinned = useMemo(
    () => library.filter((item) => pinnedSlugs.includes(item.slug)),
    [library, pinnedSlugs]
  )

  return (
    <div className="view-page view-page-vault">
      <header className="view-header no-drag">
        <div className="view-header-top">
          <div className="page-heading">
            <h1 className="page-title">{t('vault.pageTitle')}</h1>
            <p className="page-lead">{t('vault.pageSub')}</p>
          </div>
          <span className="journal-milestone">{t('vault.pinnedCount', { count: pinned.length })}</span>
        </div>
      </header>

      <div className="vault-board-scroll">
        {pinned.length === 0 ? (
          <EmptyState
            icon={<Pin size={28} strokeWidth={1.25} />}
            title={t('vault.emptyPinned')}
            hint={t('vault.emptyPinnedHint')}
            action={
              <button type="button" className="btn-primary" onClick={() => setViewMode('journal')}>
                {t('vault.goTimeline')}
              </button>
            }
          />
        ) : (
          <div className="vault-board">
            {pinned.map((item) => (
              <StickyNoteCard
                key={item.slug}
                item={item}
                selected={selectedSlug === item.slug}
                onSelect={() => selectItem(item.slug)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
