import React from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { History, Clock, X } from 'lucide-react'
import type { PageHistoryVersion } from '../../lib/sidecar'

interface NoteVersionHistoryProps {
  historyVersions: PageHistoryVersion[]
  selectedVersion: PageHistoryVersion | null
  loadingHistory: boolean
  onSelectVersion: (ver: PageHistoryVersion) => void
  onClose: () => void
}

export const NoteVersionHistory = React.memo(function NoteVersionHistory({
  historyVersions,
  selectedVersion,
  loadingHistory,
  onSelectVersion,
  onClose,
}: NoteVersionHistoryProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="w-80 border-l border-[var(--divider)] bg-[var(--color-paper-deep)] flex flex-col shrink-0">
      <div className="p-4 border-b border-[var(--divider)] flex items-center justify-between bg-[var(--color-paper)]">
        <h3 className="font-semibold text-sm text-[var(--color-ink-900)] flex items-center gap-2">
          <History size={16} />
          {t('note.historyTitle')}
        </h3>
        <button
          type="button"
          className="btn-ghost p-1 cursor-pointer"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingHistory ? (
          <p className="text-xs text-[var(--color-ink-500)] text-center py-4">{t('preview.loading')}</p>
        ) : historyVersions.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-500)] text-center py-4">{t('note.noHistory')}</p>
        ) : (
          historyVersions.map((ver) => {
            const isSelected = selectedVersion?.timestamp === ver.timestamp
            return (
              <div
                key={ver.timestamp}
                className={clsx(
                  'p-3 rounded-lg border cursor-pointer transition-colors',
                  isSelected
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--divider)] hover:bg-[var(--color-shelf)] bg-[var(--color-paper)]'
                )}
                onClick={() => onSelectVersion(ver)}
              >
                <div className="flex items-start gap-2">
                  <Clock size={14} className="mt-0.5 text-[var(--color-ink-500)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--color-ink-800)] truncate">
                      {ver.formatted_time.replace('T', ' ').slice(0, 19)}
                    </p>
                    <p className="text-[10px] text-[var(--color-ink-500)] mt-1">
                      {(ver.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
})
