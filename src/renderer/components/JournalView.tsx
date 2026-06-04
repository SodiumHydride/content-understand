import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BookMarked } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { groupLibraryByJournal } from '../lib/contentMeta'
import { LibraryCard } from './LibraryCard'
import { PipelineStepper } from './PipelineStepper'
import { EmptyState } from './EmptyState'

function filterItems(
  library: ReturnType<typeof useAppStore.getState>['library'],
  query: string
) {
  const q = query.trim().toLowerCase()
  if (!q) return library
  return library.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      item.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}

export function JournalView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const library = useAppStore((s) => s.library)
  const libraryQuery = useAppStore((s) => s.libraryQuery)
  const tasks = useAppStore((s) => s.tasks)
  const selectedSlug = useAppStore((s) => s.selectedSlug)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const laneRef = useRef<HTMLDivElement>(null)

  const locale = i18n.language.startsWith('zh') ? 'zh-cn' : 'en'
  const filtered = useMemo(() => filterItems(library, libraryQuery), [library, libraryQuery])
  const days = useMemo(() => groupLibraryByJournal(filtered, locale), [filtered, locale])
  const timelineDays = useMemo(() => [...days].reverse(), [days])
  const processing = tasks.filter((task) => task.status === 'processing')
  const isEmpty = days.length === 0 && processing.length === 0

  useEffect(() => {
    const lane = laneRef.current
    if (!lane) return
    lane.scrollLeft = lane.scrollWidth
  }, [timelineDays.length, filtered.length])

  return (
    <div className="view-page view-page-journal">
      <header className="view-header no-drag">
        <div className="view-header-top">
          <div className="page-heading">
            <h1 className="page-title">{t('journal.pageTitle')}</h1>
            <p className="page-lead">{t('journal.pageSub', { count: filtered.length })}</p>
          </div>
          {filtered.length > 0 && (
            <span className="journal-milestone">{t('journal.milestone', { count: filtered.length })}</span>
          )}
        </div>
      </header>

      <div ref={laneRef} className="journal-scroll journal-scroll-horizontal">
        {processing.length > 0 && (
          <section className="journal-processing no-drag">
            <span className="section-label">{t('journal.inProgress')}</span>
            <div className="journal-processing-track">
              {processing.map((task) => (
                <PipelineStepper key={task.id} task={task} />
              ))}
            </div>
          </section>
        )}

        {isEmpty ? (
          <EmptyState
            icon={<BookMarked size={28} strokeWidth={1.25} />}
            title={t('journal.empty')}
            hint={t('journal.emptyHint')}
            action={
              <button type="button" className="btn-primary" onClick={() => setViewMode('capture')}>
                {t('capture.goInbox')}
              </button>
            }
          />
        ) : (
          <div className="journal-lane" role="list">
            {timelineDays.map((day) => (
              <section key={day.dateKey} className="journal-day-column animate-fade-up" role="listitem">
                <div className="journal-day-marker">
                  <span className="journal-day-dot" aria-hidden />
                  <h2 className="journal-day-label">{day.label}</h2>
                  <span className="journal-day-count">{day.items.length}</span>
                </div>
                <div className="journal-day-stack">
                  {day.items.map((item) => (
                    <LibraryCard
                      key={item.slug}
                      item={item}
                      selected={selectedSlug === item.slug}
                      onSelect={() => selectItem(item.slug)}
                      showPath={false}
                      layout="timeline"
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
