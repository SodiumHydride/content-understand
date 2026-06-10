import React from 'react'
import { useTranslation } from 'react-i18next'
import { notify } from '../../lib/notify'
import type { RecommendationItem } from '../../lib/sidecar'

interface BacklinkItem {
  slug: string
  title: string
  context?: string
}

interface NoteBacklinksProps {
  backlinks: BacklinkItem[]
  recommendations: RecommendationItem[]
  editMode: boolean
  onSelectBacklink: (slug: string) => void
  onInsertRecommendation: (title: string) => void
}

export const NoteBacklinks = React.memo(function NoteBacklinks({
  backlinks,
  recommendations,
  editMode,
  onSelectBacklink,
  onInsertRecommendation,
}: NoteBacklinksProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (backlinks.length === 0 && recommendations.length === 0) return null

  return (
    <>
      {backlinks.length > 0 && (
        <div className="backlinks-section">
          <h3 className="backlinks-heading">
            {t('note.backlinks')} ({backlinks.length})
          </h3>
          <ul className="backlinks-list">
            {backlinks.map((bl) => (
              <li key={bl.slug} className="backlinks-item" onClick={() => onSelectBacklink(bl.slug)}>
                <span className="backlinks-title">{bl.title}</span>
                {bl.context && <span className="backlinks-context">{bl.context}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {recommendations.length > 0 && (
        <div className="backlinks-section mt-6 pt-4 border-t border-[var(--divider)]">
          <h3 className="backlinks-heading flex items-center justify-between">
            <span>{t('note.recommendations') || 'Suggested Connections'}</span>
          </h3>
          <ul className="backlinks-list mt-2 space-y-1">
            {recommendations.map((rec) => (
              <li
                key={rec.slug}
                className="backlinks-item flex items-center justify-between group py-2"
                onClick={() => onSelectBacklink(rec.slug)}
              >
                <div className="min-w-0 flex-1">
                  <span className="backlinks-title truncate">{rec.title}</span>
                  <span className="text-[10px] text-[var(--color-ink-500)] block mt-0.5">
                    {rec.reason === 'tag'
                      ? (t('note.reasonTag') || 'Shared tags')
                      : (t('note.reasonSimilarity') || 'Semantic similarity')}
                  </span>
                </div>
                {editMode && (
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 btn-ghost p-1 text-xs text-[var(--color-accent)] font-medium shrink-0 ml-2 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      onInsertRecommendation(rec.title)
                      notify(t('note.linkSuggestedAdded') || `Suggested link [[${rec.title}]] added`, { type: 'success' })
                    }}
                    title={t('note.insertLink') || 'Insert link'}
                  >
                    + {t('note.insertLink') || 'Link'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
})
