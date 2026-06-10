import React from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, RotateCcw } from 'lucide-react'
import type { PageHistoryVersion } from '../../lib/sidecar'

interface NoteReaderProps {
  selectedVersion: PageHistoryVersion
  saving: boolean
  onRestore: () => void
  onCancel: () => void
}

export const NoteReader = React.memo(function NoteReader({
  selectedVersion,
  saving,
  onRestore,
  onCancel,
}: NoteReaderProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-6 p-4 rounded-md border border-[#d4b07a] bg-[#fdf8f0] flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-[#856404] font-medium">
          <Clock size={16} />
          <span>
            {t('note.viewingVersion') || 'Viewing history version from:'}{' '}
            {selectedVersion.formatted_time.replace('T', ' ').slice(0, 19)}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary flex items-center gap-1 py-1 px-3 text-xs bg-[#7eb89a] hover:bg-[#6ca487] text-white border-none cursor-pointer"
            onClick={onRestore}
            disabled={saving}
          >
            <RotateCcw size={12} />
            {t('note.restore') || 'Restore version'}
          </button>
          <button
            type="button"
            className="btn-ghost py-1 px-3 text-xs cursor-pointer"
            onClick={onCancel}
          >
            {t('note.cancel') || 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
})
